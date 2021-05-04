// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../DAOStackInterfaces.sol";
import "../Interfaces.sol";
import "./GoodMarketMaker.sol";

interface ContributionCalc {
	function calculateContribution(
		GoodMarketMaker _marketMaker,
		GoodReserveCDai _reserve,
		address _contributer,
		ERC20 _token,
		uint256 _gdAmount
	) external view returns (uint256);
}

/**
@title Reserve based on cDAI and dynamic reserve ratio market maker
*/

//TODO: feeless scheme, active period
contract GoodReserveCDai is
	Initializable,
	DAOContract,
	ERC20PresetMinterPauserUpgradeable,
	GlobalConstraintInterface
{
	using SafeMathUpgradeable for uint256;

	bytes32 public constant RESERVE_MINTER_ROLE =
		keccak256("RESERVE_MINTER_ROLE");

	uint256 public cap;

	// The last block number which
	// `mintInterestAndUBI` has been executed in
	uint256 public lastMinted;

	// The contribution contract is responsible
	// for calculates the contribution amount
	// when selling GD
	// ContributionCalc public contribution;

	address public daiAddress;
	address public cDaiAddress;

	/// @dev merkleroot
	bytes32 public gdxAirdrop;

	mapping(address => bool) public isClaimedGDX;

	// Emits when GD tokens are purchased
	event TokenPurchased(
		// The initiate of the action
		address indexed caller,
		// The convertible token address
		// which the GD tokens were
		// purchased with
		address indexed reserveToken,
		// Reserve tokens amount
		uint256 reserveAmount,
		// Minimal GD return that was
		// permitted by the caller
		uint256 minReturn,
		// Actual return after the
		// conversion
		uint256 actualReturn
	);

	// Emits when GD tokens are sold
	event TokenSold(
		// The initiate of the action
		address indexed caller,
		// The convertible token address
		// which the GD tokens were
		// sold to
		address indexed reserveToken,
		// GD tokens amount
		uint256 gdAmount,
		// The amount of GD tokens that
		// was contributed during the
		// conversion
		uint256 contributionAmount,
		// Minimal reserve tokens return
		// that was permitted by the caller
		uint256 minReturn,
		// Actual return after the
		// conversion
		uint256 actualReturn
	);

	// Emits when new GD tokens minted
	event UBIMinted(
		//epoch of UBI
		uint256 indexed day,
		//the token paid as interest
		address indexed interestToken,
		//wei amount of interest paid in interestToken
		uint256 interestReceived,
		// Amount of GD tokens that was
		// added to the supply as a result
		// of `mintInterest`
		uint256 gdInterestMinted,
		// Amount of GD tokens that was
		// added to the supply as a result
		// of `mintExpansion`
		uint256 gdExpansionMinted,
		// Amount of GD tokens that was
		// minted to the `ubiCollector`
		uint256 gdUbiTransferred
	);

	function initialize(NameService _ns, bytes32 _gdxAirdrop)
		public
		virtual
		initializer
	{
		__ERC20PresetMinterPauser_init("GDX", "G$X");
		setDAO(_ns);

		//fixed cdai/dai
		setAddresses();

		//gdx roles
		renounceRole(MINTER_ROLE, _msgSender());
		renounceRole(PAUSER_ROLE, _msgSender());
		renounceRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(DEFAULT_ADMIN_ROLE, address(avatar));

		//mint access through reserve
		_setupRole(RESERVE_MINTER_ROLE, address(avatar)); //only Avatar can manage minters

		cap = 22 * 1e14; //22 trillion G$ cents

		gdxAirdrop = _gdxAirdrop;
	}

	function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(y).add(10**27 / 2) / 10**27;
	}

	function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(10**27).add(y / 2) / y;
	}

	/// @dev GDX decimals
	function decimals() public pure override returns (uint8) {
		return 2;
	}

	function setAddresses() public {
		daiAddress = nameService.getAddress("DAI");
		cDaiAddress = nameService.getAddress("CDAI");
	}

	/**
	 * @dev get current FundManager from name service
	 */
	function getFundManager() public view returns (address) {
		return nameService.getAddress("FUND_MANAGER");
	}

	//
	/**
	 * @dev get current MarketMaker from name service
	 * The address of the market maker contract
	 * which makes the calculations and holds
	 * the token and accounts info (should be owned by the reserve)
	 */
	function getMarketMaker() public view returns (GoodMarketMaker) {
		return GoodMarketMaker(nameService.getAddress("MARKET_MAKER"));
	}

	/**
	@dev Converts any 'buyWith' tokens to cDAI then call buy function to convert it to GD tokens
	* @param _buyWith The tokens that should be converted to GD tokens
	* @param _tokenAmount The amount of `buyWith` tokens that should be converted to GD tokens
	* @param _minReturn The minimum allowed return in GD tokens
	* @param _minDAIAmount The mininmum dai out amount from Exchange swap function
	* @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	* @return (gdReturn) How much GD tokens were transferred
	 */
	function buy(
		ERC20 _buyWith,
		uint256 _tokenAmount,
		uint256 _minReturn,
		uint256 _minDAIAmount,
		address _targetAddress
	) public returns (uint256) {
		require(
			_buyWith.allowance(msg.sender, address(this)) >= _tokenAmount,
			"You need to approve input token transfer first"
		);
		require(
			_buyWith.transferFrom(msg.sender, address(this), _tokenAmount) ==
				true,
			"transferFrom failed, make sure you approved input token transfer"
		);

		uint256 result;
		if (address(_buyWith) == cDaiAddress) {
			result = _buy(_tokenAmount, _minReturn, _targetAddress);
		} else if (address(_buyWith) == daiAddress) {
			result = _cdaiMintAndBuy(_tokenAmount, _minReturn, _targetAddress);
		} else {
			address[] memory path = new address[](2);
			path[0] = address(_buyWith);
			path[1] = daiAddress;
			Uniswap uniswapContract =
				Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
			_buyWith.approve(address(uniswapContract), _tokenAmount);
			uint256[] memory swap =
				uniswapContract.swapExactTokensForTokens(
					_tokenAmount,
					_minDAIAmount,
					path,
					address(this),
					block.timestamp
				);

			uint256 dai = swap[1];
			require(dai > 0, "token selling failed");

			result = _cdaiMintAndBuy(dai, _minReturn, _targetAddress);
		}

		emit TokenPurchased(
			msg.sender,
			address(_buyWith),
			_tokenAmount,
			_minReturn,
			result
		);

		return result;
	}
	/**
	 * @dev Converts ETH to cDAI then buy GD with this cDAI
	 * @param _minReturn The minimum allowed return in GD tokens
	 * @param _minDAIAmount The mininmum dai out amount from Exchange swap function
	 * @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	 * @return (gdReturn) How much GD tokens were transferred

	 */
	function buyWithETH(
		uint256 _minReturn,
		uint256 _minDAIAmount,
		address _targetAddress)
		public payable returns(uint256){
			Uniswap uniswapContract =
				Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
			address[] memory path = new address[](2);
			path[0] = uniswapContract.WETH();
			path[1] = daiAddress;
			uint256[] memory swap = uniswapContract.swapExactETHForTokens{ value: msg.value }(
				_minDAIAmount,
				path,
			 	address(this),
			  	block.timestamp);
			uint256 dai = swap[1];
			require(dai > 0, "token selling failed");

			uint256 result = _cdaiMintAndBuy(dai, _minReturn, _targetAddress);
			emit TokenPurchased(
				msg.sender,
				uniswapContract.WETH(),
				msg.value,
				_minReturn,
				result
			);

			return result;
			
	}
	/**
	 * @dev Convert Dai to CDAI and buy
	 * @param _amount DAI amount to convert
	 * @param _minReturn The minimum allowed return in GD tokens
	 * @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	 * @return (gdReturn) How much GD tokens were transferred
	 */
	function _cdaiMintAndBuy(
		uint256 _amount,
		uint256 _minReturn,
		address _targetAddress
	) internal returns (uint256) {
		cERC20 cDai = cERC20(cDaiAddress);
		// Approve transfer to cDAI contract
		ERC20(daiAddress).approve(address(cDai), _amount);

		uint256 currCDaiBalance = cDai.balanceOf(address(this));

		//Mint cDAIs
		uint256 cDaiResult = cDai.mint(_amount);
		require(cDaiResult == 0, "Minting cDai failed");

		uint256 cDaiInput =
			(cDai.balanceOf(address(this))).sub(currCDaiBalance);
		return _buy(cDaiInput, _minReturn, _targetAddress);
	}

	/**
	 * @dev Converts `buyWith` tokens to GD tokens and updates the bonding curve params.
	 * `buy` occurs only if the GD return is above the given minimum. It is possible
	 * to buy only with cDAI and when the contract is set to active. MUST call to
	 * `buyWith` `approve` prior this action to allow this contract to accomplish the
	 * conversion.
	 * @param _tokenAmount The amount of `buyWith` tokens that should be converted to GD tokens
	 * @param _minReturn The minimum allowed return in GD tokens
	 * @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	 * @return (gdReturn) How much GD tokens were transferred
	 */
	function _buy(
		uint256 _tokenAmount,
		uint256 _minReturn,
		address _targetAddress
	) internal returns (uint256) {
		ERC20 buyWith = ERC20(cDaiAddress);
		uint256 gdReturn = getMarketMaker().buy(buyWith, _tokenAmount);
		require(
			gdReturn >= _minReturn,
			"GD return must be above the minReturn"
		);

		address receiver =
			_targetAddress == address(0x0) ? msg.sender : _targetAddress;

		_mintGoodDollars(receiver, gdReturn, true);

		//mint GDX
		_mintGDX(receiver, gdReturn);

		return gdReturn;
	}
	/**
	 * @dev Mint rewards for staking contracts in G$ and update RR
	 * @param _to Receipent address for rewards
	 * @param _amount G$ amount to mint for rewards
	 */
	function mintRewardFromRR(
		address _token,
		address _to,
		uint _amount
	) public{
		
		getMarketMaker().mintFromReserveRatio(ERC20(_token),_amount);
		_mintGoodDollars(_to, _amount, false);
		//mint GDX
		_mintGDX(_to, _amount);
		
		}
	/**
	 * @dev Converts GD tokens to `sellTo` tokens and update the bonding curve params.
	 * `sell` occurs only if the token return is above the given minimum. Notice that
	 * there is a contribution amount from the given GD that remains in the reserve.
	 * It is only possible to sell to cDAI and only when the contract is set to
	 * active. MUST be called to G$ `approve` prior to this action to allow this
	 * contract to accomplish the conversion.
	 * @param _sellTo The tokens that will be received after the conversion if address equals 0x0 then sell to ETH
	 * @param _gdAmount The amount of GD tokens that should be converted to `_sellTo` tokens
	 * @param _minReturn The minimum allowed `sellTo` tokens return
	 * @param _minTokenReturn The mininmum dai out amount from Exchange swap function
	 * @param _targetAddress address of _sellTo token recipient if different than msg.sender
	 * @return (tokenReturn) How much `sellTo` tokens were transferred
	 */
	function sell(
		ERC20 _sellTo,
		uint256 _gdAmount,
		uint256 _minReturn,
		uint256 _minTokenReturn,
		address _targetAddress
	) public returns (uint256) {
		address receiver =
			_targetAddress == address(0x0) ? msg.sender : _targetAddress;

		uint256 result;
		uint256 contributionAmount;

		(result, contributionAmount) = _sell(_gdAmount, _minReturn);
		if (address(_sellTo) == cDaiAddress || address(_sellTo) == daiAddress) {
			if (address(_sellTo) == daiAddress) result = _redeemDAI(result);

			require(
				_sellTo.transfer(receiver, result) == true,
				"Transfer failed"
			);
		} else {
			result = _redeemDAI(result);
			address[] memory path = new address[](2);
			
			Uniswap uniswapContract =
				Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
			ERC20(daiAddress).approve(address(uniswapContract), result);
			uint256[] memory swap;
			if(address(_sellTo) == address(0x0)){
				path[0] = daiAddress;
				path[1] = uniswapContract.WETH();
				swap = uniswapContract.swapExactTokensForETH(
					result,
				 	_minTokenReturn,
					path,
					receiver,
					block.timestamp);
			}else{
				path[0] = daiAddress;
				path[1] = address(_sellTo);
				swap =uniswapContract.swapExactTokensForTokens(
					result,
					_minTokenReturn,
					path,
					receiver,
					block.timestamp
				);
			}
			

			result = swap[1];
			require(result > 0, "token selling failed");
		}

		emit TokenSold(
			receiver,
			address(_sellTo),
			_gdAmount,
			contributionAmount,
			_minReturn,
			result
		);
		return result;
	}

	/**
	 * @dev Redeem DAI for cDAI
	 * @param _amount Amount of cDAI to redeem for DAI
	 */
	function _redeemDAI(uint256 _amount) internal returns (uint256) {
		cERC20 cDai = cERC20(cDaiAddress);
		ERC20 dai = ERC20(daiAddress);

		uint256 currDaiBalance = dai.balanceOf(address(this));

		uint256 daiResult = cDai.redeem(_amount);
		require(daiResult == 0, "cDai redeem failed");

		uint256 daiReturnAmount =
			(dai.balanceOf(address(this))).sub(currDaiBalance);

		return daiReturnAmount;
	}

	/**
	 * @dev Converts GD tokens to `sellTo` tokens and update the bonding curve params.
	 * `sell` occurs only if the token return is above the given minimum. Notice that
	 * there is a contribution amount from the given GD that remains in the reserve.
	 * It is only possible to sell to cDAI and only when the contract is set to
	 * active. MUST be called to G$ `approve` prior to this action to allow this
	 * contract to accomplish the conversion.
	 * @param _gdAmount The amount of GD tokens that should be converted to `_sellTo` tokens
	 * @param _minReturn The minimum allowed `sellTo` tokens return
	 * @return (tokenReturn) How much `sellTo` tokens were transferred
	 */
	function _sell(uint256 _gdAmount, uint256 _minReturn)
		internal
		returns (uint256, uint256)
	{
		ERC20 sellTo = ERC20(cDaiAddress);
		IGoodDollar(address(avatar.nativeToken())).burnFrom(
			msg.sender,
			_gdAmount
		);

		//discount on exit contribution based on gdx
		uint256 gdx = balanceOf(msg.sender);
		uint256 discount = gdx <= _gdAmount ? gdx : _gdAmount;

		//burn gdx used for discount
		burn(discount);

		uint256 contributionAmount =
			discount >= _gdAmount
				? 0
				: ContributionCalc(
					nameService.getAddress("CONTRIBUTION_CALCULATION")
				)
					.calculateContribution(
					getMarketMaker(),
					this,
					msg.sender,
					sellTo,
					_gdAmount.sub(discount)
				);

		uint256 tokenReturn =
			getMarketMaker().sellWithContribution(
				sellTo,
				_gdAmount,
				contributionAmount
			);
		require(
			tokenReturn >= _minReturn,
			"Token return must be above the minReturn"
		);

		return (tokenReturn, contributionAmount);
	}

	// /**
	//  * @dev Current price of GD in `token`. currently only cDAI is supported.
	//  * @param _token The desired reserve token to have
	//  * @return price of GD
	//  */
	// function currentPrice(ERC20 _token) public view returns (uint256) {
	// 	uint256 priceInCDai = getMarketMaker().currentPrice(ERC20(cDaiAddress));
	// 	if (address(_token) == cDaiAddress) return priceInCDai;
	// 	cERC20 cDai = cERC20(cDaiAddress);
	// 	uint256 priceInDai =
	// 		rmul(
	// 			priceInCDai * 1e10, //bring cdai 8 decimals to Dai precision
	// 			cDai.exchangeRateStored().div(10) //exchange rate is 1e28 reduce to 1e27
	// 		);
	// 	if (address(_token) == daiAddress) {
	// 		return priceInDai;
	// 	} else {
	// 		address[] memory path = new address[](2);
	// 		path[0] = daiAddress;
	// 		path[1] = address(_token);
	// 		Uniswap uniswapContract =
	// 			Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
	// 		uint256[] memory priceInXToken =
	// 			uniswapContract.getAmountsOut(priceInDai, path);
	// 		require(
	// 			priceInXToken[priceInXToken.length - 1] > 0,
	// 			"No valid price data for pair"
	// 		);
	// 		return priceInXToken[priceInXToken.length - 1];
	// 	}
	// }

	function currentPrice() public view returns (uint256) {
		return getMarketMaker().currentPrice(ERC20(cDaiAddress));
	}

	function currentPriceDAI() public view returns (uint256) {
		cERC20 cDai = cERC20(cDaiAddress);
		return
			rmul(
				currentPrice() * 1e10, //bring cdai 8 decimals to Dai precision
				cDai.exchangeRateStored().div(10) //exchange rate is 1e28 reduce to 1e27
			);
	}

	function mintByPrice(
		ERC20 _interestToken,
		address _to,
		uint256 _transfered
	) public {
		uint256 gdToMint =
			getMarketMaker().mintInterest(_interestToken, _transfered);

		_mintGoodDollars(_to, gdToMint, false);
	}

	function _mintGoodDollars(
		address _to,
		uint256 _gdToMint,
		bool _internalCall
	) internal {
		//enforce minting rules
		require(
			_internalCall ||
				_msgSender() ==
				nameService.addresses(nameService.FUND_MANAGER()) ||
				hasRole(RESERVE_MINTER_ROLE, _msgSender()),
			"GoodReserve: not a minter"
		);

		require(
			IGoodDollar(address(avatar.nativeToken())).totalSupply() +
				_gdToMint <=
				cap,
			"GoodReserve: cap enforced"
		);

		IGoodDollar(address(avatar.nativeToken())).mint(_to, _gdToMint);
	}

	function _mintGDX(address _to, uint256 _gdx) internal {
		_mint(_to, _gdx);
	}

	//TODO: can we send directly to UBI via bridge here?
	/**
	 * @dev only FundManager can call this to trigger minting.
	 * Reserve sends UBI + interest to FundManager.
	 * @param _interestToken The token that was transfered to the reserve
	 * @param _transfered How much was transfered to the reserve for UBI in `_interestToken`
	 * @return gdUBI how much GD UBI was minted
	 */
	function mintUBI(
		ERC20 _interestToken,
		uint256 _transfered
	) public returns (uint256) {
		//uint256 price = getMarketMaker().currentPrice(ERC20(cDaiAddress));
		// uint256 price = currentPrice(_interestToken);
		uint256 gdInterestToMint =
			getMarketMaker().mintInterest(_interestToken, _transfered);
		//IGoodDollar gooddollar = IGoodDollar(address(avatar.nativeToken()));
		//uint256 precisionLoss = uint256(27).sub(uint256(gooddollar.decimals()));
		//uint256 gdInterest = rdiv(_interest, price).div(10**precisionLoss);
		uint256 gdExpansionToMint =
			getMarketMaker().mintExpansion(_interestToken);
		uint256 gdUBI = gdInterestToMint;
		gdUBI = gdUBI.add(gdExpansionToMint);
		uint256 toMint = gdUBI;
		_mintGoodDollars(getFundManager(), toMint, false);
		lastMinted = block.number;
		emit UBIMinted(
			lastMinted,
			address(_interestToken),
			_transfered,
			gdInterestToMint,
			gdExpansionToMint,
			gdUBI
		);
		return gdUBI;
	}

	/**
	 * @dev Allows the DAO to change the daily expansion rate
	 * it is calculated by _nom/_denom with e27 precision. Emits
	 * `ReserveRatioUpdated` event after the ratio has changed.
	 * Only Avatar can call this method.
	 * @param _nom The numerator to calculate the global `reserveRatioDailyExpansion` from
	 * @param _denom The denominator to calculate the global `reserveRatioDailyExpansion` from
	 */
	function setReserveRatioDailyExpansion(uint256 _nom, uint256 _denom)
		public
	{
		_onlyAvatar();
		getMarketMaker().setReserveRatioDailyExpansion(_nom, _denom);
	}

	/**
	 * @dev Making the contract inactive after it has transferred the cDAI funds to `_avatar`
	 * and has transferred the market maker ownership to `_avatar`. Inactive means that
	 * buy / sell / mintInterestAndUBI actions will no longer be active. Only the Avatar can
	 * executes this method
	 */
	function end() public {
		_onlyAvatar();
		// remaining cDAI tokens in the current reserve contract
		cERC20 cDai = cERC20(cDaiAddress);
		uint256 remainingReserve = cDai.balanceOf(address(this));
		if (remainingReserve > 0) {
			require(
				cDai.transfer(address(avatar), remainingReserve),
				"cdai transfer failed"
			);
		}

		// // restore minting to avatar, so he can re-delegate it
		IGoodDollar gd = IGoodDollar(address(avatar.nativeToken()));
		if (gd.isMinter(address(avatar)) == false)
			gd.addMinter(address(avatar));

		IGoodDollar(address(avatar.nativeToken())).renounceMinter();
	}

	/**
	 * @dev method to recover any stuck erc20 tokens (ie compound COMP)
	 * @param _token the ERC20 token to recover
	 */
	function recover(ERC20 _token) public {
		_onlyAvatar();
		require(
			_token.transfer(address(avatar), _token.balanceOf(address(this))),
			"recover transfer failed"
		);
	}

	/**
	 * @notice prove user balance in a specific blockchain state hash
	 * @dev "rootState" is a special state that can be supplied once, and actually mints reputation on the current blockchain
	 * @param _user the user to prove his balance
	 * @param _gdx the balance we are prooving
	 * @param _proof array of byte32 with proof data (currently merkle tree path)
	 * @return true if proof is valid
	 */
	function claimGDX(
		address _user,
		uint256 _gdx,
		bytes32[] memory _proof
	) public returns (bool) {
		require(isClaimedGDX[_user] == false, "already claimed gdx");
		bytes32 leafHash = keccak256(abi.encode(_user, _gdx));
		bool isProofValid =
			MerkleProofUpgradeable.verify(_proof, gdxAirdrop, leafHash);

		require(isProofValid, "invalid merkle proof");

		_mintGDX(_user, _gdx);

		isClaimedGDX[_user] = true;
		return true;
	}

	// implement minting constraints through the GlobalConstraintInterface interface. prevent any minting not through reserve
	function pre(
		address _scheme,
		bytes32 _hash,
		bytes32 _method
	) public pure override returns (bool) {
		_scheme;
		_hash;
		_method;
		if (_method == "mintTokens") return false;

		return true;
	}

	/**
	 * @dev enforce cap on DAOStack Controller mintTokens using GlobalConstraintInterface
	 */
	function post(
		address _scheme,
		bytes32 _hash,
		bytes32 _method
	) public view override returns (bool) {
		_hash;
		_scheme;
		return true;
	}

	function when() public pure override returns (CallPhase) {
		return CallPhase.Pre;
	}
}
