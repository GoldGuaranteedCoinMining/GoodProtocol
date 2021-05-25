// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

pragma experimental ABIEncoderV2;

interface ERC20 {
	function balanceOf(address addr) external view returns (uint256);

	function transfer(address to, uint256 amount) external returns (bool);

	function approve(address spender, uint256 amount) external returns (bool);

	function decimals() external view returns (uint8);

	function mint(address to, uint256 mintAmount) external returns (uint256);

	function totalSupply() external view returns (uint256);

	function allowance(address owner, address spender)
		external
		view
		returns (uint256);

	function transferFrom(
		address sender,
		address recipient,
		uint256 amount
	) external returns (bool);

	event Transfer(address indexed from, address indexed to, uint256 amount);
}

interface cERC20 is ERC20 {
	function mint(uint256 mintAmount) external returns (uint256);

	function redeemUnderlying(uint256 mintAmount) external returns (uint256);

	function redeem(uint256 mintAmount) external returns (uint256);

	function exchangeRateCurrent() external returns (uint256);

	function exchangeRateStored() external view returns (uint256);
}

interface IGoodDollar is ERC20 {
	function getFees(uint256 value) external view returns (uint256, bool);

	function burn(uint256 amount) external;

	function burnFrom(address account, uint256 amount) external;

	function renounceMinter() external;

	function addMinter(address minter) external;

	function isMinter(address minter) external view returns (bool);

	function transferAndCall(
		address to,
		uint256 value,
		bytes calldata data
	) external returns (bool);
}

interface IERC2917 is ERC20 {
	/// @dev This emit when interests amount per block is changed by the owner of the contract.
	/// It emits with the old interests amount and the new interests amount.
	event InterestRatePerBlockChanged(uint256 oldValue, uint256 newValue);

	/// @dev This emit when a users' productivity has changed
	/// It emits with the user's address and the the value after the change.
	event ProductivityIncreased(address indexed user, uint256 value);

	/// @dev This emit when a users' productivity has changed
	/// It emits with the user's address and the the value after the change.
	event ProductivityDecreased(address indexed user, uint256 value);

	/// @dev Return the current contract's interests rate per block.
	/// @return The amount of interests currently producing per each block.
	function interestsPerBlock() external view returns (uint256);

	/// @notice Change the current contract's interests rate.
	/// @dev Note the best practice will be restrict the gross product provider's contract address to call this.
	/// @return The true/fase to notice that the value has successfully changed or not, when it succeed, it will emite the InterestRatePerBlockChanged event.
	function changeInterestRatePerBlock(uint256 value) external returns (bool);

	/// @notice It will get the productivity of given user.
	/// @dev it will return 0 if user has no productivity proved in the contract.
	/// @return user's productivity and overall productivity.
	function getProductivity(address user)
		external
		view
		returns (uint256, uint256);

	/// @notice increase a user's productivity.
	/// @dev Note the best practice will be restrict the callee to prove of productivity's contract address.
	/// @return true to confirm that the productivity added success.
	function increaseProductivity(address user, uint256 value)
		external
		returns (bool);

	/// @notice decrease a user's productivity.
	/// @dev Note the best practice will be restrict the callee to prove of productivity's contract address.
	/// @return true to confirm that the productivity removed success.
	function decreaseProductivity(address user, uint256 value)
		external
		returns (bool);

	/// @notice take() will return the interests that callee will get at current block height.
	/// @dev it will always calculated by block.number, so it will change when block height changes.
	/// @return amount of the interests that user are able to mint() at current block height.
	function take() external view returns (uint256);

	/// @notice similar to take(), but with the block height joined to calculate return.
	/// @dev for instance, it returns (_amount, _block), which means at block height _block, the callee has accumulated _amount of interests.
	/// @return amount of interests and the block height.
	function takeWithBlock() external view returns (uint256, uint256);

	/// @notice mint the avaiable interests to callee.
	/// @dev once it mint, the amount of interests will transfer to callee's address.
	/// @return the amount of interests minted.
	function mint() external returns (uint256);
}

interface Staking {
	struct Staker {
		// The staked DAI amount
		uint256 stakedDAI;
		// The latest block number which the
		// staker has staked tokens
		uint256 lastStake;
	}

	function stakeDAI(uint256 amount) external;

	function withdrawStake() external;

	function stakers(address staker) external view returns (Staker memory);
}

interface Uniswap {
	function swapExactETHForTokens(
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external payable returns (uint256[] memory amounts);

	function swapExactTokensForETH(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external returns (uint256[] memory amounts);

	function swapExactTokensForTokens(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external returns (uint256[] memory amounts);

	function WETH() external pure returns (address);

	function factory() external pure returns (address);

	function quote(
		uint256 amountA,
		uint256 reserveA,
		uint256 reserveB
	) external pure returns (uint256 amountB);

	function getAmountIn(
		uint256 amountOut,
		uint256 reserveIn,
		uint256 reserveOut
	) external pure returns (uint256 amountIn);

	function getAmountOut(
		uint256 amountI,
		uint256 reserveIn,
		uint256 reserveOut
	) external pure returns (uint256 amountOut);

	function getAmountsOut(uint256 amountIn, address[] memory path)
		external
		pure
		returns (uint256[] memory amounts);
}

interface UniswapFactory {
	function getPair(address tokenA, address tokenB)
		external
		view
		returns (address);
}

interface UniswapPair {
	function getReserves()
		external
		view
		returns (
			uint112 reserve0,
			uint112 reserve1,
			uint32 blockTimestampLast
		);

	function kLast() external view returns (uint256);
}

interface Reserve {
	function buy(
		address _buyWith,
		uint256 _tokenAmount,
		uint256 _minReturn
	) external returns (uint256);
}

interface IIdentity {
	function isWhitelisted(address user) external view returns (bool);

	function addWhitelistedWithDID(address account, string memory did) external;

	function removeWhitelisted(address account) external;

	function addIdentityAdmin(address account) external returns (bool);

	function setAvatar(address _avatar) external;
}

interface IUBIScheme {
	function currentDay() external view returns (uint256);

	function periodStart() external view returns (uint256);

	function hasClaimed(address claimer) external view returns (bool);
}

interface IFirstClaimPool {
	function awardUser(address user) external returns (uint256);

	function claimAmount() external view returns (uint256);
}

interface ProxyAdmin {
	function getProxyImplementation(address proxy)
		external
		view
		returns (address);

	function getProxyAdmin(address proxy) external view returns (address);

	function upgrade(address proxy, address implementation) external;

	function owner() external view returns (address);

	function transferOwnership(address newOwner) external;
}

/**
 * @dev Interface for chainlink oracles to obtain price datas
 */
interface AggregatorV3Interface {
	function decimals() external view returns (uint8);

	function description() external view returns (string memory);

	function version() external view returns (uint256);

	// getRoundData and latestRoundData should both raise "No data present"
	// if they do not have data to report, instead of returning unset values
	// which could be misinterpreted as actual reported values.
	function getRoundData(uint80 _roundId)
		external
		view
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		);

	function latestRoundData()
		external
		view
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		);
}
