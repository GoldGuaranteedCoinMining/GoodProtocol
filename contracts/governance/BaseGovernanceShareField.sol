// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "../Interfaces.sol";

import "../utils/DSMath.sol";

/**
 * Contract to calculate staking rewards shares.
 * WARNING: WILL ONLY WORK WITH G$ IE STAKING TOKEN WITH 2 DECIMALS
 */
abstract contract BaseGovernanceShareField {
	// Total Amount of stakes
	uint256 totalProductivity;
	// Reward amount of the each share
	uint256 accAmountPerShare;
	// Amount of the rewards which minted so far
	uint256 public rewardsMintedSoFar;
	// Amount of the rewards with pending and minted ones together
	uint256 public totalRewardsAccumulated;
	// Block number of last reward calculation made
	uint256 public lastRewardBlock;
	// Rewards amount that will be provided each block
	uint256 public rewardsPerBlock;

	struct UserInfo {
		uint256 amount; // How many tokens the user has staked.
		uint256 rewardDebt; // Rewards that accounted already so should be substracted while calculating rewards of staker
		uint256 rewardEarn; // Reward earn and not minted
	}

	mapping(address => UserInfo) public users;

	function getChainBlocksPerMonth() public virtual returns (uint256);

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _monthlyAmount total rewards which will distribute monthly
	 */
	function _setMonthlyRewards(uint256 _monthlyAmount) internal {
		rewardsPerBlock = _monthlyAmount / getChainBlocksPerMonth();
	}

	/**
	 * @dev Update reward variables of the given pool to be up-to-date.
	 * Make reward calculations according to passed blocks and updates rewards by
	 * multiplying passed blocks since last calculation with rewards per block value
	 * and add it to accumalated amount per share by dividing total productivity
	 */
	function _update() internal virtual {
		if (totalProductivity == 0) {
			lastRewardBlock = block.number;
			return;
		}

		uint256 multiplier = block.number - lastRewardBlock; // Blocks passed since last reward block
		uint256 reward = multiplier * rewardsPerBlock; // rewardsPerBlock is in GDAO which is in 18 decimals

		accAmountPerShare =
			accAmountPerShare +
			rdiv(reward, totalProductivity * 1e16); // totalProductivity in 2decimals since it is GD so we multiply it by 1e16 to bring 18 decimals and rdiv result in 27decimals
		lastRewardBlock = block.number;
	}

	/**
	 * @dev Audit user's rewards and calculate their earned rewards based on stake_amount * accAmountPerShare
	 */
	function _audit(address user) internal virtual {
		UserInfo storage userInfo = users[user];
		if (userInfo.amount > 0) {
			uint256 pending =
				(userInfo.amount * accAmountPerShare) /
					1e11 -
					userInfo.rewardDebt; // Divide 1e11(because userinfo.amount in 2 decimals and accAmountPerShare is in 27decimals) since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
			userInfo.rewardEarn = userInfo.rewardEarn + pending; // Add user's earned rewards to user's account so it can be minted later
			totalRewardsAccumulated = totalRewardsAccumulated + pending;
		}
	}

	/**
	 * @dev This function increase user's productivity and updates the global productivity.
	 * This function increase user's productivity and updates the global productivity.
	 * the users' actual share percentage will calculated by:
	 * Formula:     user_productivity / global_productivity
	 */
	function _increaseProductivity(address user, uint256 value)
		internal
		virtual
		returns (bool)
	{
		UserInfo storage userInfo = users[user];
		_update();
		_audit(user);

		totalProductivity = totalProductivity + value;
		userInfo.amount = userInfo.amount + value;
		userInfo.rewardDebt = (userInfo.amount * accAmountPerShare) / 1e11; // Divide to 1e11 to keep rewardDebt in 18 decimals since accAmountPerShare is in 27 decimals and amount is GD which is 2 decimals
		return true;
	}

	/**
	 * @dev This function will decreases user's productivity by value, and updates the global productivity
	 * it will record which block this is happenning and accumulates the area of (productivity * time)
	 */

	function _decreaseProductivity(address user, uint256 value)
		internal
		virtual
		returns (bool)
	{
		UserInfo storage userInfo = users[user];
		require(
			value > 0 && userInfo.amount >= value,
			"INSUFFICIENT_PRODUCTIVITY"
		);

		_update();
		_audit(user);

		userInfo.amount = userInfo.amount - value;
		userInfo.rewardDebt = (userInfo.amount * accAmountPerShare) / 1e11; // Divide to 1e11 to keep rewardDebt in 18 decimals since accAmountPerShare is in 27 decimals and amount is GD which is 2 decimals
		totalProductivity = totalProductivity - value;

		return true;
	}

	/**
	 * @dev Query user's pending reward with updated variables
	 * @return returns  amount of user's earned but not minted rewards
	 */
	function getUserPendingReward(address user) public view returns (uint256) {
		UserInfo memory userInfo = users[user];
		uint256 _accAmountPerShare = accAmountPerShare;

		uint256 pending = 0;

		if (totalProductivity != 0) {
			uint256 multiplier = block.number - lastRewardBlock;
			uint256 reward = multiplier * rewardsPerBlock; // rewardsPerBlock is in GDAO which is in 18 decimals

			_accAmountPerShare =
				_accAmountPerShare +
				rdiv(reward, totalProductivity * 1e16); // totalProductivity in 2decimals since it is GD so we multiply it by 1e16 to bring 18 decimals and rdiv result in 27decimals

			pending =
				(userInfo.amount * _accAmountPerShare) /
				1e11 -
				userInfo.rewardDebt; // Divide 1e11(because userinfo.amount in 2 decimals and accAmountPerShare is in 27decimals) since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
		}
		return userInfo.rewardEarn + pending;
	}

	/** 
    @dev Calculate earned rewards of the user and update their reward info
    * @param user address of the user that will be accounted
    * @return returns minted amount
    */

	function _issueEarnedRewards(address user) internal returns (uint256) {
		_update();
		_audit(user);
		UserInfo storage userInfo = users[user];
		uint256 amount = userInfo.rewardEarn;
		userInfo.rewardEarn = 0;
		rewardsMintedSoFar = rewardsMintedSoFar + amount;
		return amount;
	}

	/**
	 * @return Returns how many productivity a user has and global has.
	 */

	function getProductivity(address user)
		public
		view
		virtual
		returns (uint256, uint256)
	{
		return (users[user].amount, totalProductivity);
	}

	/**
	 * @return Returns the current gross product rate.
	 */
	function totalRewardsPerShare() public view virtual returns (uint256) {
		return accAmountPerShare;
	}

	function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = (x * 10**27 + (y / 2)) / y;
	}

	uint256[50] private _gap;
}
