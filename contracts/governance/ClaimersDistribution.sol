// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/GReputation.sol";

contract ClaimersDistribution is Initializable, DAOContract {
	///@notice reputation to distribute each month, will effect next month when set
	uint256 public monthlyReputationDistribution;

	///@notice month number since epoch
	uint256 public currentMonth;

	struct MonthData {
		mapping(address => uint256) claims; //claims per user in month
		uint256 totalClaims; // total claims in month
		uint256 monthlyDistribution; //monthlyReputationDistribution at the time when _updateMonth was called
	}

	///@notice keep track of each month distribution data
	mapping(uint256 => MonthData) public months;

	///@notice marks last month user claimed reputation for
	mapping(address => uint256) public lastMonthClaimed;

	///@notice tracks timestamp of last time user claimed UBI
	mapping(address => uint256) public lastUpdated;

	function initialize(NameService _ns) public initializer {
		monthlyReputationDistribution = 4000000;
		_updateMonth();
		setDAO(_ns);
	}

	/**
	 * @dev update the monthly reputation distribution. only avatar can do that.
	 * @param newMonthlyReputationDistribution the new reputation amount to distribute
	 */
	function setMonthlyReputationDistribution(
		uint256 newMonthlyReputationDistribution
	) external {
		_onlyAvatar();
		monthlyReputationDistribution = newMonthlyReputationDistribution;
	}

	/**
	 * @dev internal function to switch to new month. records for new month the current monthlyReputationDistribution
	 */
	function _updateMonth() internal {
		uint256 month = block.timestamp / 30 days;
		if (month != currentMonth) {
			//update new month
			currentMonth = month;
			months[currentMonth]
				.monthlyDistribution = monthlyReputationDistribution;
		}
	}

	/**
	 * @dev increase user count of claims if he claimed today. (called automatically by latest version of UBIScheme)
	 * @param _claimer the user to update
	 */
	function updateClaim(address _claimer) external {
		IUBIScheme ubi = IUBIScheme(nameService.getAddress("UBISCHEME"));
		require(
			ubi.hasClaimed(_claimer),
			"ClaimersDistribution: didn't claim today"
		);
		require(
			ubi.currentDay() * 1 days + ubi.periodStart() >
				lastUpdated[_claimer],
			"ClaimersDistribution: already updated"
		);
		_updateMonth();

		lastUpdated[_claimer] = block.timestamp;
		months[currentMonth].claims[_claimer] += 1;
		months[currentMonth].totalClaims += 1;

		uint256 prevMonth = currentMonth - 1;
		if (lastMonthClaimed[_claimer] >= prevMonth) return;
		claimReputation(_claimer);
	}

	/**
	 * @dev helper func
	 * @return number of UBI claims user performed this month
	 */
	function getMonthClaims(address _claimer) public view returns (uint256) {
		return months[currentMonth].claims[_claimer];
	}

	/**
	 * @dev mints reputation to user according to his share in last month claims
	 * @param _claimer the user to distribute reputation to
	 */
	function claimReputation(address _claimer) public {
		uint256 prevMonth = currentMonth - 1;
		require(
			lastMonthClaimed[_claimer] < prevMonth,
			"ClaimersDistribution: already claimed"
		);
		if (months[prevMonth].monthlyDistribution > 0) {
			lastMonthClaimed[_claimer] = prevMonth;
			uint256 userShare =
				(months[prevMonth].monthlyDistribution *
					months[prevMonth].claims[_claimer]) /
					months[prevMonth].totalClaims;
			if (userShare > 0) {
				GReputation grep =
					GReputation(nameService.getAddress("GReputation"));
				grep.mint(_claimer, userShare);
			}
		}
	}
}