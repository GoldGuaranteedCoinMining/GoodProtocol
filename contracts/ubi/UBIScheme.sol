pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/ClaimersDistribution.sol";

/* @title Dynamic amount-per-day UBI scheme allowing claim once a day
 */
contract UBIScheme is Initializable, DAOContract {
	struct Day {
		mapping(address => bool) hasClaimed;
		uint256 amountOfClaimers;
		uint256 claimAmount;
	}

	mapping(uint256 => Day) public claimDay;

	mapping(address => uint256) public lastClaimed;

	uint256 public currentDay;

	uint256 public periodStart;

	// Result of distribution formula
	// calculated each day
	uint256 public dailyUbi;

	// Limits the gas for each iteration at `fishMulti`
	uint256 public iterationGasLimit;

	// Tracks the active users number. It changes when
	// a new user claim for the first time or when a user
	// has been fished
	uint256 public activeUsersCount;

	// Tracks the last withdrawal day of funds from avatar.
	// Withdraw occures on the first daily claim or the
	// first daily fish only
	uint256 public lastWithdrawDay;

	// How long can a user be inactive.
	// After those days the user can be fished
	// (see `fish` notes)
	uint256 public maxInactiveDays;

	// Whether to withdraw GD from avatar
	// before daily ubi calculation
	bool public shouldWithdrawFromDAO;

	//number of days of each UBI pool cycle
	//dailyPool = Pool/cycleLength
	uint256 public cycleLength;

	//the amount of G$ UBI pool for each day in the cycle to be divided by active users
	uint256 public dailyCyclePool;

	//timestamp of current cycle start
	uint256 public startOfCycle;

	//should be 0 for starters so distributionFormula detects new cycle on first day claim
	uint256 public currentCycleLength;

	// A pool of GD to give to activated users,
	// since they will enter the UBI pool
	// calculations only in the next day,
	// meaning they can only claim in the next
	// day
	IFirstClaimPool public firstClaimPool;

	struct Funds {
		// marks if the funds for a specific day has
		// withdrawn from avatar
		bool hasWithdrawn;
		// total GD held after withdrawing
		uint256 openAmount;
	}

	// Tracks the daily withdraws and the actual amount
	// at the begining of a trading day
	mapping(uint256 => Funds) public dailyUBIHistory;

	// Marks users that have been fished to avoid
	// double fishing
	mapping(address => bool) public fishedUsersAddresses;

	// Total claims per user stat
	mapping(address => uint256) public totalClaimsPerUser;

	// Emits when a withdraw has been succeded
	event WithdrawFromDao(uint256 prevBalance, uint256 newBalance);

	// Emits when a user is activated
	event ActivatedUser(address indexed account);

	// Emits when a fish has been succeded
	event InactiveUserFished(
		address indexed caller,
		address indexed fished_account,
		uint256 claimAmount
	);

	// Emits when finishing a `multi fish` execution.
	// Indicates the number of users from the given
	// array who actually been fished. it might not
	// be finished going over all the array if there
	// no gas left.
	event TotalFished(uint256 total);

	// Emits when daily ubi is calculated
	event UBICalculated(uint256 day, uint256 dailyUbi, uint256 blockNumber);

	event UBICycleCalculated(
		uint256 day,
		uint256 pool,
		uint256 cycleLength,
		uint256 dailyUBIPool
	);

	event UBIClaimed(address indexed claimer, uint256 amount);

	/**
	 * @dev Constructor
	 * @param _ns the DAO
	 * @param _firstClaimPool A pool for GD to give out to activated users
	 * @param _maxInactiveDays Days of grace without claiming request
	 * @param _cycleLength number of days current UBI pool is divided to
	 */
	function initialize(
		NameService _ns,
		IFirstClaimPool _firstClaimPool,
		uint256 _maxInactiveDays,
		uint256 _cycleLength
	) public initializer {
		require(_maxInactiveDays > 0, "Max inactive days cannot be zero");
		setDAO(_ns);
		maxInactiveDays = _maxInactiveDays;
		firstClaimPool = _firstClaimPool;
		shouldWithdrawFromDAO = false;
		cycleLength = _cycleLength;
		iterationGasLimit = 150000;
	}

	/* @dev function that gets the amount of people who claimed on the given day
	 * @param day the day to get claimer count from, with 0 being the starting day
	 * @return an integer indicating the amount of people who claimed that day
	 */
	function getClaimerCount(uint256 day) public view returns (uint256) {
		return claimDay[day].amountOfClaimers;
	}

	/* @dev function that gets the amount that was claimed on the given day
	 * @param day the day to get claimer count from, with 0 being the starting day
	 * @return an integer indicating the amount that has been claimed on the given day
	 */
	function getClaimAmount(uint256 day) public view returns (uint256) {
		return claimDay[day].claimAmount;
	}

	/* @dev function that gets count of claimers and amount claimed for the current day
	 * @return the amount of claimers and the amount claimed.
	 */
	function getDailyStats()
		public
		view
		returns (uint256 count, uint256 amount)
	{
		uint256 today = (block.timestamp - periodStart) / 1 days;
		return (getClaimerCount(today), getClaimAmount(today));
	}

	modifier requireStarted() {
		require(block.timestamp >= periodStart, "not in periodStarted");
		_;
	}

	/**
	 * @dev On a daily basis UBIScheme withdraws tokens from GoodDao.
	 * Emits event with caller address and last day balance and the
	 * updated balance.
	 */
	function _withdrawFromDao() internal {
		IGoodDollar token = nativeToken();
		uint256 prevBalance = token.balanceOf(address(this));
		uint256 toWithdraw = token.balanceOf(address(avatar));
		dao.genericCall(
			address(token),
			abi.encodeWithSignature(
				"transfer(address,uint256)",
				address(this),
				toWithdraw
			),
			avatar,
			0
		);
		uint256 newBalance = prevBalance + toWithdraw;
		require(
			newBalance == token.balanceOf(address(this)),
			"DAO transfer has failed"
		);
		emit WithdrawFromDao(prevBalance, newBalance);
	}

	/**
	 * @dev sets the ubi calculation cycle length
	 * @param _newLength the new length in days
	 */
	function setCycleLength(uint256 _newLength) public {
		_onlyAvatar();
		require(_newLength > 0, "cycle must be at least 1 day long");
		cycleLength = _newLength;
	}

	/**
	 * @dev returns the day count since start of current cycle
	 */
	function currentDayInCycle() public view returns (uint256) {
		return (block.timestamp - startOfCycle) / (1 days);
	}

	/**
	 * @dev The claim calculation formula. Divided the daily balance with
	 * the sum of the active users.
	 * @return The amount of GoodDollar the user can claim
	 */
	function distributionFormula() internal returns (uint256) {
		setDay();
		// on first day or once in 24 hrs calculate distribution
		if (currentDay != lastWithdrawDay) {
			IGoodDollar token = nativeToken();
			uint256 currentBalance = token.balanceOf(address(this));

			if (
				currentDayInCycle() >= currentCycleLength
			) //start of cycle or first time
			{
				if (shouldWithdrawFromDAO) _withdrawFromDao();
				currentBalance = token.balanceOf(address(this));
				dailyCyclePool = currentBalance / cycleLength;
				currentCycleLength = cycleLength;
				startOfCycle = (block.timestamp / (1 hours)) * 1 hours; //start at a round hour
				emit UBICycleCalculated(
					currentDay,
					currentBalance,
					cycleLength,
					dailyCyclePool
				);
			}

			lastWithdrawDay = currentDay;
			Funds storage funds = dailyUBIHistory[currentDay];
			funds.hasWithdrawn = shouldWithdrawFromDAO;
			funds.openAmount = currentBalance;
			if (activeUsersCount > 0) {
				dailyUbi = dailyCyclePool / activeUsersCount;
			}
			emit UBICalculated(currentDay, dailyUbi, block.number);
		}

		return dailyUbi;
	}

	/**
	 *@dev Sets the currentDay variable to amount of days
	 * since start of contract.
	 */
	function setDay() public {
		currentDay = (block.timestamp - periodStart) / (1 days);
	}

	/**
	 * @dev Checks if the given account has claimed today
	 * @param account to check
	 * @return True if the given user has already claimed today
	 */
	function hasClaimed(address account) public view returns (bool) {
		return claimDay[currentDay].hasClaimed[account];
	}

	/**
	 * @dev Checks if the given account has been owned by a registered user.
	 * @param _account to check
	 * @return True for an existing user. False for a new user
	 */
	function isNotNewUser(address _account) public view returns (bool) {
		if (lastClaimed[_account] > 0) {
			// the sender is not registered
			return true;
		}
		return false;
	}

	/**
	 * @dev Checks weather the given address is owned by an active user.
	 * A registered user is a user that claimed at least one time. An
	 * active user is a user that claimed at least one time but claimed
	 * at least one time in the last `maxInactiveDays` days. A user that
	 * has not claimed for `maxInactiveDays` is an inactive user.
	 * @param _account to check
	 * @return True for active user
	 */
	function isActiveUser(address _account) public view returns (bool) {
		uint256 _lastClaimed = lastClaimed[_account];
		if (isNotNewUser(_account)) {
			uint256 daysSinceLastClaim =
				(block.timestamp - _lastClaimed) / (1 days);
			if (daysSinceLastClaim < maxInactiveDays) {
				// active user
				return true;
			}
		}
		return false;
	}

	/**
	 * @dev Transfers `amount` DAO tokens to `account`. Updates stats
	 * and emits an event in case of claimed.
	 * In case that `isFirstTime` is true, it awards the user.
	 * @param _account the account which recieves the funds
	 * @param _amount the amount to transfer
	 * @param _isClaimed true for claimed
	 * @param _isFirstTime true for new user or fished user
	 */
	function _transferTokens(
		address _account,
		uint256 _amount,
		bool _isClaimed,
		bool _isFirstTime
	) internal {
		// updates the stats
		Day storage day = claimDay[currentDay];
		day.amountOfClaimers += 1;
		day.hasClaimed[_account] = true;
		lastClaimed[_account] = block.timestamp;
		totalClaimsPerUser[_account] += 1;

		// awards a new user or a fished user
		if (_isFirstTime) {
			uint256 awardAmount = firstClaimPool.awardUser(_account);
			day.claimAmount += awardAmount;
			emit UBIClaimed(_account, awardAmount);
		} else {
			day.claimAmount += _amount;
			IGoodDollar token = nativeToken();
			require(token.transfer(_account, _amount), "claim transfer failed");
			if (_isClaimed) {
				emit UBIClaimed(_account, _amount);
			}
		}
	}

	/**
	 * @dev Checks the amount which the sender address is eligible to claim for,
	 * regardless if they have been whitelisted or not. In case the user is
	 * active, then the current day must be equal to the actual day, i.e. claim
	 * or fish has already been executed today.
	 * @return The amount of GD tokens the address can claim.
	 */
	function checkEntitlement() public view requireStarted returns (uint256) {
		// new user or inactive should recieve the first claim reward
		if (!isNotNewUser(msg.sender) || fishedUsersAddresses[msg.sender]) {
			return firstClaimPool.claimAmount();
		}

		// current day has already been updated which means
		// that the dailyUbi has been updated
		if (currentDay == (block.timestamp - periodStart) / (1 days)) {
			return hasClaimed(msg.sender) ? 0 : dailyUbi;
		}
		// the current day has not updated yet
		IGoodDollar token = nativeToken();
		uint256 currentBalance = token.balanceOf(address(this));
		return currentBalance / activeUsersCount;
	}

	/**
	 * @dev Function for claiming UBI. Requires contract to be active. Calls distributionFormula,
	 * calculats the amount the account can claims, and transfers the amount to the account.
	 * Emits the address of account and amount claimed.
	 * @param _account The claimer account
	 * @return A bool indicating if UBI was claimed
	 */
	function _claim(address _account) internal returns (bool) {
		// calculats the formula up today ie on day 0 there are no active users, on day 1 any user
		// (new or active) will trigger the calculation with the active users count of the day before
		// and so on. the new or inactive users that will become active today, will not take into account
		// within the calculation.
		uint256 newDistribution = distributionFormula();

		// active user which has not claimed today yet, ie user last claimed < today
		if (
			isNotNewUser(_account) &&
			!fishedUsersAddresses[_account] &&
			!hasClaimed(_account)
		) {
			_transferTokens(_account, newDistribution, true, false);
			return true;
		} else if (!isNotNewUser(_account) || fishedUsersAddresses[_account]) {
			// a unregistered or fished user
			activeUsersCount += 1;
			fishedUsersAddresses[_account] = false;
			_transferTokens(_account, 0, false, true);
			emit ActivatedUser(_account);
			return true;
		}
		return false;
	}

	/**
	 * @dev Function for claiming UBI. Requires contract to be active and claimer to be whitelisted.
	 * Calls distributionFormula, calculats the amount the caller can claim, and transfers the amount
	 * to the caller. Emits the address of caller and amount claimed.
	 * @return A bool indicating if UBI was claimed
	 */
	function claim() public requireStarted returns (bool) {
		require(
			IIdentity(nameService.addresses(nameService.IDENTITY()))
				.isWhitelisted(msg.sender),
			"UBIScheme: not whitelisted"
		);
		bool didClaim = _claim(msg.sender);
		if (didClaim) {
			ClaimersDistribution(
				nameService.addresses(nameService.GDAO_CLAIMERS())
			)
				.updateClaim(msg.sender);
		}
		return didClaim;
	}

	/**
	 * @dev In order to update users from active to inactive, we give out incentive to people
	 * to update the status of inactive users, this action is called "Fishing". Anyone can
	 * send a tx to the contract to mark inactive users. The "fisherman" receives a reward
	 * equal to the daily UBI (ie instead of the “fished” user). User that “last claimed” > 14
	 * can be "fished" and made inactive (reduces active users count by one). Requires
	 * contract to be active.
	 * @param _account to fish
	 * @return A bool indicating if UBI was fished
	 */
	function fish(address _account) public requireStarted returns (bool) {
		// checking if the account exists. that's been done because that
		// will prevent trying to fish non-existence accounts in the system
		require(
			isNotNewUser(_account) && !isActiveUser(_account),
			"is not an inactive user"
		);
		require(!fishedUsersAddresses[_account], "already fished");
		fishedUsersAddresses[_account] = true; // marking the account as fished so it won't refish

		// making sure that the calculation will be with the correct number of active users in case
		// that the fisher is the first to make the calculation today
		uint256 newDistribution = distributionFormula();
		activeUsersCount -= 1;
		_transferTokens(msg.sender, newDistribution, false, false);
		emit InactiveUserFished(msg.sender, _account, newDistribution);
		return true;
	}

	/**
	 * @dev executes `fish` with multiple addresses. emits the number of users from the given
	 * array who actually been tried being fished.
	 * @param _accounts to fish
	 * @return A bool indicating if all the UBIs were fished
	 */
	function fishMulti(address[] memory _accounts)
		public
		requireStarted
		returns (uint256)
	{
		for (uint256 i = 0; i < _accounts.length; ++i) {
			if (gasleft() < iterationGasLimit) {
				emit TotalFished(i);
				return i;
			}
			if (
				isNotNewUser(_accounts[i]) &&
				!isActiveUser(_accounts[i]) &&
				!fishedUsersAddresses[_accounts[i]]
			) {
				require(fish(_accounts[i]), "fish has failed");
			}
		}
		emit TotalFished(_accounts.length);
		return _accounts.length;
	}

	/**
	 * @dev Start function. Adds this contract to identity as a feeless scheme and
	 * adds permissions to IFirstClaimPool
	 * Can only be called if scheme is registered
	 */
	function start() public {
		require(periodStart == 0, "UBIScheme: already started"); //can be called only once
		periodStart = (block.timestamp / (1 days)) * 1 days + 12 hours; //set start time to GMT noon
		startOfCycle = periodStart;
		dao.genericCall(
			address(firstClaimPool),
			abi.encodeWithSignature("setUBIScheme(address)", address(this)),
			avatar,
			0
		);
	}

	/**
	 * @dev Sets whether to also withdraw GD from avatar for UBI
	 * @param _shouldWithdraw boolean if to withdraw
	 */
	function setShouldWithdrawFromDAO(bool _shouldWithdraw) public {
		_onlyAvatar();
		shouldWithdrawFromDAO = _shouldWithdraw;
	}

	function upgrade(address prevUBIScheme) public {
		start();

		if (prevUBIScheme != address(0)) {
			IGoodDollar gd = nativeToken();

			uint256 ubiBalance = gd.balanceOf(prevUBIScheme);

			// transfer funds from old scheme here
			dao.genericCall(
				prevUBIScheme,
				abi.encodeWithSignature("end()"),
				avatar,
				0
			);

			dao.genericCall(
				address(firstClaimPool),
				abi.encodeWithSignature("setClaimAmount(uint256)", 1000),
				avatar,
				0
			);

			if (ubiBalance > 0) {
				dao.externalTokenTransfer(
					address(gd),
					address(this),
					ubiBalance,
					address(avatar)
				);
			}
		}
	}
}