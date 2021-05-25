// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "../Interfaces.sol";

import "./AbstractGoodStaking.sol";
import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";
import "../utils/DAOContract.sol";
import "./StakingToken.sol";
import "../governance/StakersDistribution.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the contracts buy intrest tokens and can transfer the daily interest to the  DAO
 */
contract SimpleStaking is AbstractGoodStaking, StakingToken {
	using SafeMath for uint256;

	// Token address
	ERC20 token;
	// Interest Token address
	ERC20 public iToken;

	// Interest and staker data
	//InterestDistribution.InterestData public interestData;

	// The block interval defines the number of
	// blocks that shall be passed before the
	// next execution of `collectUBIInterest`
	uint256 public blockInterval;
	// Gas cost to collect interest from this staking contract
	uint32 public collectInterestGasCost;
	// The last block number which
	// `collectUBIInterest` has been executed in
	uint256 public lastUBICollection;
	// The total staked Token amount in the contract
	// uint256 public totalStaked = 0;

	bool public isPaused;

	/**
	 * @dev Constructor
	 * @param _token The address of Token
	 * @param _iToken The address of Interest Token
	 * @param _blockInterval How many blocks should be passed before the next execution of `collectUBIInterest`
	 * @param _ns The address of the NameService contract
	 * @param _tokenName The name of the staking token
	 * @param _tokenSymbol The symbol of the staking token
	 * @param _maxRewardThreshold the blocks that should pass to get 1x reward multiplier
	 * @param _collectInterestGasCost Gas cost for the collect interest of this staking contract
	 */
	constructor(
		address _token,
		address _iToken,
		uint256 _blockInterval,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		uint32 _collectInterestGasCost
	) StakingToken(_tokenName, _tokenSymbol) {
		setDAO(_ns);
		token = ERC20(_token);
		iToken = ERC20(_iToken);
		require(
			token.decimals() <= 18,
			"Token decimals should be less than 18 decimals"
		);
		decimals = token.decimals(); // Staking token decimals should be same with token's decimals
		tokenDecimalDifference = 18 - token.decimals();
		maxMultiplierThreshold = _maxRewardThreshold;
		blockInterval = _blockInterval;
		lastUBICollection = block.number.div(blockInterval);
		collectInterestGasCost = _collectInterestGasCost; // Should be adjusted according to this contract's gas cost
		
		token.approve(address(iToken), type(uint256).max); // approve the transfers to defi protocol as much as possible in order to save gas
	}

	/**
	 * @dev Set Gas cost to interest collection for this contract
	 * @param _amount Gas cost to collect interest
	 */
	function setcollectInterestGasCost(uint32 _amount) external {
		_onlyAvatar();
		collectInterestGasCost = _amount;
	}

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of Token or iToken to stake (it depends on _inInterestToken parameter)
	 * @param _donationPer The % of interest staker want to donate.
	 * @param _inInterestToken specificy if stake in iToken or Token
	 */
	function stake(
		uint256 _amount,
		uint256 _donationPer,
		bool _inInterestToken
	) external override {
		require(isPaused == false, "Staking is paused");
		require(
			_donationPer == 0 || _donationPer == 100,
			"Donation percentage should be 0 or 100"
		);
		require(_amount > 0, "You need to stake a positive token amount");
		require(
				(_inInterestToken ? iToken : token).transferFrom(msg.sender, address(this), _amount),
				"transferFrom failed, make sure you approved token transfer"
			);
		_amount =_inInterestToken ? iTokenWorthinToken(_amount) : _amount;
		if (_inInterestToken == false){
			mintInterestToken(_amount); //mint iToken
		}

		UserInfo storage userInfo = users[msg.sender];
		userInfo.donationPer = uint8(_donationPer);

		_mint(msg.sender, _amount); // mint Staking token for staker
		_increaseProductivity(msg.sender, _amount);

		//notify GDAO distrbution for stakers
		StakersDistribution sd =
			StakersDistribution(
				nameService.addresses(nameService.GDAO_STAKERS())
			);
		if (address(sd) != address(0)) {
			uint stakeAmountInEighteenDecimals = token.decimals() == 18 ? _amount : _amount * 10 ** (18 - token.decimals());
			sd.userStaked(msg.sender, stakeAmountInEighteenDecimals);
		}

		emit Staked(msg.sender, address(token), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 * @dev _amount Amount to withdraw in Token or iToken depends on the _inInterestToken parameter
	 * @param _inInterestToken specificy if stake in iToken or Token
	 */
	function withdrawStake(uint256 _amount, bool _inInterestToken)
		external
		override
	{
		//InterestDistribution.Staker storage staker = interestData.stakers[msg.sender];
		uint256 tokenWithdraw;
		require(_amount > 0, "Should withdraw positive amount");
		(uint256 userProductivity, ) = getProductivity(msg.sender);
		if (_inInterestToken) {
			uint256 tokenWorth = iTokenWorthinToken(_amount);
			require(userProductivity >= tokenWorth, "Not enough token staked");
			require(
				iToken.transfer(msg.sender, _amount),
				"withdraw transfer failed"
			);
			_amount = tokenWorth;
		} else {
			tokenWithdraw = _amount;
			require(userProductivity >= _amount, "Not enough token staked");
			redeem(tokenWithdraw);
			uint256 tokenActual = token.balanceOf(address(this));
			if (tokenActual < tokenWithdraw) {
				tokenWithdraw = tokenActual;
			}
			require(
				token.transfer(msg.sender, tokenWithdraw),
				"withdraw transfer failed"
			);
		}

		FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
		_burn(msg.sender, _amount); // burn their staking tokens
		_decreaseProductivity(msg.sender, _amount);
		fm.mintReward(nameService.getAddress("CDAI"), msg.sender); // send rewards to user and use cDAI address since reserve in cDAI

		//notify GDAO distrbution for stakers
		StakersDistribution sd =
			StakersDistribution(
				nameService.addresses(nameService.GDAO_STAKERS())
			);
		if (address(sd) != address(0)) {
			uint withdrawAmountInEighteenDecimals = token.decimals() == 18 ? _amount : _amount * 10 ** (18 - token.decimals());
			sd.userWithdraw(msg.sender, withdrawAmountInEighteenDecimals);
		}

		emit StakeWithdraw(
			msg.sender,
			address(token),
			_inInterestToken == false ? tokenWithdraw : _amount,
			token.balanceOf(address(this))
		);
	}

	/**
	 * @dev withdraw staker G$ rewards + GDAO rewards
	 * withdrawing rewards resets the multiplier! so if user just want GDAO he should use claimReputation()
	 */
	function withdrawRewards() public {
		FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
		fm.mintReward(nameService.getAddress("CDAI"), msg.sender); // send rewards to user and use cDAI address since reserve in cDAI
		claimReputation();
	}

	/**
	 * @dev withdraw staker GDAO rewards
	 */
	function claimReputation() public {
		//claim reputation rewards
		StakersDistribution sd =
			StakersDistribution(
				nameService.addresses(nameService.GDAO_STAKERS())
			);
		if (address(sd) != address(0)) {
			address[] memory contracts = new address[](1);
			contracts[0] = (address(this));
			sd.claimReputation(msg.sender, contracts);
		}
	}

	/**
	 * @dev notify stakersdistribution when user performs transfer operation
	 */
	function _transfer(
		address from,
		address to,
		uint256 value
	) internal override {
		super._transfer(from, to, value);

		StakersDistribution sd =
			StakersDistribution(
				nameService.addresses(nameService.GDAO_STAKERS())
			);
		if (address(sd) != address(0)) {
			address[] memory contracts;
			contracts[0] = (address(this));
			sd.userWithdraw(from, value);
			sd.userStaked(to, value);
			sd.claimReputation(to, contracts);
			sd.claimReputation(from, contracts);
		}
	}

	/**
	 * @dev Calculates worth of given amount of iToken in Token
	 * @param _amount Amount of token to calculate worth in Token
	 * @return Worth of given amount of token in Token
	 */
	function iTokenWorthinToken(uint256 _amount)
		public
		view
		override
		returns (uint256)
	{
		uint256 er = exchangeRate();
		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal();
		uint256 tokenWorth =
			caseType == true
				? (_amount * (10 ** decimalDifference) * er) / 10 ** mantissa
				: ((_amount / (10 ** decimalDifference)) * er) / 10 ** mantissa; // calculation based on https://compound.finance/docs#protocol-math
		return tokenWorth;
	}

	/**
	 * @dev Calculates the worth of the staked iToken tokens in Token.
	 * @return (uint256) The worth in Token
	 */
	function currentTokenWorth() public view override returns (uint256) {
		uint256 er = exchangeRate();

		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal();
		uint256 tokenBalance;
		if (caseType) {
			tokenBalance =
				(iToken.balanceOf(address(this)) *
					(10**decimalDifference) *
					er) /
				10**mantissa; // based on https://compound.finance/docs#protocol-math
		} else {
			tokenBalance =
				((iToken.balanceOf(address(this)) / (10**decimalDifference)) *
					er) /
				10**mantissa; // based on https://compound.finance/docs#protocol-math
		}
		return tokenBalance;
	}

	// @dev To find difference in token's decimal and iToken's decimal
	// @return difference in decimals.
	// @return true if token's decimal is more than iToken's
	function tokenDecimalPrecision() internal view returns (uint256, bool) {
		uint256 tokenDecimal = tokenDecimal();
		uint256 iTokenDecimal = iTokenDecimal();
		uint256 decimalDifference;
		// Need to find easy way to do it.
		if (tokenDecimal > iTokenDecimal) {
			decimalDifference = tokenDecimal.sub(iTokenDecimal);
		} else {
			decimalDifference = iTokenDecimal.sub(tokenDecimal);
		}
		return (decimalDifference, tokenDecimal > iTokenDecimal);
	}

	function getStakerData(address _staker)
		public
		view
		returns (
			uint256,
			uint256,
			uint256,
			uint256
		)
	{
		return (
			users[_staker].amount,
			users[_staker].rewardDebt,
			users[_staker].rewardEarn,
			users[_staker].lastRewardTime
		);
	}

	/**
	 * @dev Calculates the current interest that was gained.
	 * @return (uint256, uint256, uint256) The interest in iToken, the interest in USD
	 */
	function currentUBIInterest()
		public
		view
		override
		returns (uint256, uint256)
	{
		uint256 er = exchangeRate();
		uint256 tokenWorth = currentTokenWorth();
		if (tokenWorth <= totalProductivity) {
			return (0, 0);
		}
		uint256 tokenGains = tokenWorth.sub(totalProductivity);
		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		//mul by `10^decimalDifference` to equalize precision otherwise since exchangerate is very big, dividing by it would result in 0.
		uint256 iTokenGains;
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal(); // based on https://compound.finance/docs#protocol-math
		if (caseType) {
			iTokenGains =
				((tokenGains / 10**decimalDifference) * 10**mantissa) /
				er; // based on https://compound.finance/docs#protocol-math
		} else {
			iTokenGains =
				((tokenGains * 10**decimalDifference) * 10**mantissa) /
				er; // based on https://compound.finance/docs#protocol-math
		}
		tokenGains = getTokenValueInUSD(tokenGains);
		return (iTokenGains, tokenGains);
	}

	/**
	 * @dev Collects gained interest by fundmanager. Can be collected only once
	 * in an interval which is defined above.
	 * @param _recipient The recipient of cDAI gains
	 * @return (uint256, uint256) The interest in iToken, the interest in Token
	 */
	function collectUBIInterest(address _recipient)
		public
		override
		onlyFundManager
		returns (uint256, uint256)
	{
		// otherwise fund manager has to wait for the next interval
		require(
			_recipient != address(this),
			"Recipient cannot be the staking contract"
		);
		(uint256 iTokenGains, uint256 tokenGains) = currentUBIInterest();
		lastUBICollection = block.number.div(blockInterval);
		(address redeemedToken, uint256 redeemedAmount) =
			redeemUnderlyingToDAI(iTokenGains);
		if (redeemedAmount > 0)
			require(
				ERC20(redeemedToken).transfer(_recipient, redeemedAmount),
				"collect transfer failed"
			);

		emit InterestCollected(
			_recipient,
			address(token),
			address(iToken),
			iTokenGains,
			tokenGains
		);
		return (iTokenGains, tokenGains);
	}

	function pause(bool _isPaused) public {
		_onlyAvatar();
		isPaused = _isPaused;
	}

	/**
	 * @dev making the contract inactive
	 * NOTICE: this could theoretically result in future interest earned in cdai to remain locked
	 * but we dont expect any other stakers but us in SimpleDAIStaking
	 */
	function end() public {
		pause(true);
	}

	/**
	 * @dev method to recover any stuck erc20 tokens (ie  compound COMP)
	 * @param _token the ERC20 token to recover
	 */
	function recover(ERC20 _token) public {
		_onlyAvatar();
		uint256 toWithdraw = _token.balanceOf(address(this));

		// recover left iToken(stakers token) only when all stakes have been withdrawn
		if (address(_token) == address(iToken)) {
			require(
				totalProductivity == 0 && isPaused,
				"can recover iToken only when stakes have been withdrawn"
			);
		}
		require(
			_token.transfer(address(avatar), toWithdraw),
			"recover transfer failed"
		);
	}

	/**
	 @dev function calculate Token price in USD 
	 @dev _amount Amount of Token to calculate worth of it
	 @return Returns worth of Tokens in USD
	 */
	function getTokenValueInUSD(uint256 _amount) public view returns (uint256) {
		AggregatorV3Interface tokenPriceOracle =
			AggregatorV3Interface(getTokenUsdOracle());
		(, int256 tokenPriceinUSD, , , ) = tokenPriceOracle.latestRoundData();
		return (uint256(tokenPriceinUSD) * _amount) / (10**token.decimals()); // tokenPriceinUSD in 8 decimals and _amount is in Token's decimals so we divide it to Token's decimal at the end to reduce 8 decimals back
	}
}
