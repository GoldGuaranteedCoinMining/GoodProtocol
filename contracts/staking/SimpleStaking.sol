// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;


import "../identity/Identity.sol";
import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "../Interfaces.sol";

import "../utils/DSMath.sol";
import "./AbstractGoodStaking.sol";
import ".//InterestDistribution.sol";
import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";
import "../utils/DAOContract.sol";
interface FundManager {
    function transferInterest(address _staking)
        external;

}

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the contracts buy intrest tokens and can transfer the daily interest to the  DAO
 */
contract SimpleStaking is DSMath, Pausable, DAOContract, AbstractGoodStaking {
    using SafeMath for uint256;

    // Token address
    ERC20 token;
    // Interest Token address
    ERC20 public iToken;

    // Interest and staker data
    InterestDistribution.InterestData public interestData;

    // The block interval defines the number of     
    // blocks that shall be passed before the       
    // next execution of `collectUBIInterest`
    uint256 public blockInterval;

    // The last block number which      
    // `collectUBIInterest` has been executed in
    uint256 public lastUBICollection;

    // The total staked Token amount in the contract
    // uint256 public totalStaked = 0;

    
    uint256 constant DECIMAL1e18 = 10**18;

   
   

    modifier onlyFundManager {
		require(
			msg.sender == nameService.getAddress("FUND_MANAGER"),
			"Only FundManager can call this method"
		);
		_;
	}

    /**     
     * @dev Constructor     
     * @param _token The address of Token       
     * @param _iToken The address of Interest Token         
     * @param _blockInterval How many blocks should be passed before the next execution of `collectUBIInterest` 
     * @param _ns The address of the NameService contract       
     */
    constructor(
        address _token,
        address _iToken,
        uint256 _blockInterval,
        NameService _ns
      
    ) public{
        setDAO(_ns);
        token = ERC20(_token);
        iToken = ERC20(_iToken);
        blockInterval = _blockInterval;
        lastUBICollection = block.number.div(blockInterval);
        
        // Adds the avatar as a pauser of this contract
        addPauser(address(avatar));
    }

    

    /**
     * @dev Allows a staker to deposit Tokens. Notice that `approve` is
     * needed to be executed before the execution of this method.
     * Can be executed only when the contract is not paused.
     * @param _amount The amount of DAI to stake
     * @param _donationPer The % of interest staker want to donate.
     */
    function stake(uint256 _amount, uint256 _donationPer) external override whenNotPaused {
        
        require(_amount > 0, "You need to stake a positive token amount");
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "transferFrom failed, make sure you approved token transfer"
        );

        FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
        fm.transferInterest(address(this));
        // approve the transfer to defi protocol
        token.approve(address(iToken), _amount);
        mint(_amount); //mint iToken
        InterestDistribution.stake(interestData, msg.sender, _amount, _donationPer);
        emit Staked(msg.sender, address(token), _amount);
    }

    /**
     * @dev Withdraws the sender staked Token.
     */
    function withdrawStake(uint256 _amount) external override {
        InterestDistribution.Staker storage staker = interestData.stakers[msg.sender];
        require(_amount > 0, "Should withdraw positive amount");
        require(staker.totalStaked >= _amount, "Not enough token staked");
        uint256 tokenWithdraw = _amount;
        FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
        fm.transferInterest(address(this));
        redeem(tokenWithdraw);
        uint256 tokenActual = token.balanceOf(address(this));
        if (tokenActual < tokenWithdraw) {
            tokenWithdraw = tokenActual;
        }
        uint256 gdInterest =  InterestDistribution.withdrawStakeAndInterest(interestData, msg.sender, _amount);
        //Since we use generic ERC20 function we can just use its interface
        ERC20 goodDollar = ERC20(address(avatar.nativeToken()));
        require(goodDollar.transfer(msg.sender, gdInterest), "withdraw interest transfer failed");
        require(token.transfer(msg.sender, tokenWithdraw), "withdraw transfer failed");
        emit StakeWithdraw(msg.sender, address(token), tokenWithdraw, token.balanceOf(address(this)));
    }

    function withdrawGDInterest() public {
        FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
        fm.transferInterest(address(this));
        uint256 gdInterest = InterestDistribution.withdrawGDInterest(interestData, msg.sender);
        ERC20 goodDollar = ERC20(address(avatar.nativeToken()));
        require(goodDollar.transfer(msg.sender, gdInterest), "withdraw interest transfer failed");
    }

    function getYieldData(address _staker) public view returns(uint256,uint256)
    {

      return (interestData.globalGDYieldPerToken, interestData.stakers[_staker].stakeBuyinRate);
    }

    function calculateGDInterest(
      address _staker
    ) 
    public 
    view 
    returns 
    (
      uint256 _earnedGDInterest
    ) 
    {
      return InterestDistribution.calculateGDInterest(_staker, interestData);
     
    }

    function updateGlobalGDYieldPerToken(
        uint256 _blockGDInterest,
        uint256 _blockInterestTokenEarned
        ) 
    public 
    onlyFundManager 
    {
        InterestDistribution.updateGlobalGDYieldPerToken(interestData, _blockGDInterest, _blockInterestTokenEarned);
    }

    /**
     * @dev Calculates the worth of the staked iToken tokens in Token.
     * @return (uint256) The worth in Token
     */
    function currentTokenWorth() public view override returns (uint256) {
        uint256 er = exchangeRate();

        (uint decimalDifference, bool caseType) = tokenDecimalPrecision();
        uint256 tokenBalance;
        if(caseType) {
            tokenBalance = rmul(iToken.balanceOf(address(this)).mul(10 ** decimalDifference), er).div(10);
        } else {
            tokenBalance = rmul(iToken.balanceOf(address(this)).div(10 ** decimalDifference), er).div(10);
        }
        return tokenBalance;
    }

    // @dev To find difference in token's decimal and iToken's decimal
    // @return difference in decimals.
    // @return true if token's decimal is more than iToken's
    function tokenDecimalPrecision() internal view returns(uint, bool)
    {

        uint tokenDecimal = tokenDecimal();
        uint iTokenDecimal = iTokenDecimal();
        uint decimalDifference;
        // Need to find easy way to do it.
        if(tokenDecimal > iTokenDecimal)
        {
            decimalDifference = tokenDecimal.sub(iTokenDecimal);
    
        } else {
            decimalDifference = iTokenDecimal.sub(tokenDecimal);
        }
        return (decimalDifference, tokenDecimal > iTokenDecimal);
    }

    function getStakerData(address _staker) public view returns(uint256, uint256, uint256, uint256)
    {

      return (interestData.stakers[_staker].totalStaked, interestData.stakers[_staker].totalEffectiveStake, interestData.stakers[_staker].lastStake, interestData.stakers[_staker].withdrawnToDate);
    }

    /**
     * @dev Calculates the current interest that was gained.
     * @return (uint256, uint256, uint256) The interest in iToken, the interest in Token,
     * the amount which is not covered by precision of Token
     */
    function currentUBIInterest()
        public
        view
        override
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        uint256 er = exchangeRate();
        uint256 tokenWorth = currentTokenWorth();
        if (tokenWorth <= interestData.globalTotalStaked) {
            return (0, 0, 0);
        }
        uint256 tokenGains = tokenWorth.sub(interestData.globalTotalStaked);
        (uint decimalDifference, bool caseType) = tokenDecimalPrecision();
        //mul by `10^decimalDifference` to equalize precision otherwise since exchangerate is very big, dividing by it would result in 0.
        uint256 iTokenGains;
        if(caseType) {
        
            iTokenGains = rdiv(tokenGains.mul(10 ** decimalDifference), er);

        } else {
            iTokenGains = rdiv(tokenGains.div(10 ** decimalDifference), er);
        }
        //get right most bits not covered by precision of iToken.
        uint256 precisionDecimal = uint(27).sub(iTokenDecimal());
        uint256 precisionLossITokenRay = iTokenGains % (10 ** precisionDecimal);
         // lower back to iToken's decimals
        iTokenGains = iTokenGains.div(10 ** precisionDecimal);
        //div by `10^decimalDifference` to get results in dai precision 1e18
        uint256 precisionLossToken;
        if(caseType) {
            precisionLossToken = rmul(precisionLossITokenRay, er).div(10 ** decimalDifference);
        } else {
            precisionLossToken = rmul(precisionLossITokenRay, er).mul(10 ** decimalDifference);
        }
        return (iTokenGains, tokenGains, precisionLossToken);
    }

    /**
     * @dev Collects gained interest by fundmanager. Can be collected only once
     * in an interval which is defined above.
     * @param _recipient The recipient of cDAI gains
     * @return (uint256, uint256, uint256, uint256) The interest in iToken, the interest in Token,
     * the amount which is not covered by precision of Token, how much of the generated interest is donated
     */
    function collectUBIInterest(address _recipient)
        public
        onlyFundManager
        override
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        // otherwise fund manager has to wait for the next interval
        require(_recipient != address(this), "Recipient cannot be the staking contract");
        (
            uint256 iTokenGains,
            uint256 tokenGains,
            uint256 precisionLossToken
        ) = currentUBIInterest();
        lastUBICollection = block.number.div(blockInterval);
        if (iTokenGains > 0)
            require(iToken.transfer(_recipient, iTokenGains), "collect transfer failed");
        emit InterestCollected(_recipient, address(token), address(iToken), iTokenGains, tokenGains, precisionLossToken);
        uint256 avgEffectiveStakedRatio = 0;
        if(interestData.globalTotalStaked > 0)
            avgEffectiveStakedRatio = interestData.globalTotalEffectiveStake.mul(DECIMAL1e18).div(interestData.globalTotalStaked);
        return (iTokenGains, tokenGains, precisionLossToken, avgEffectiveStakedRatio);
    }

    

    /**
     * @dev making the contract inactive
     * NOTICE: this could theoretically result in future interest earned in cdai to remain locked
     * but we dont expect any other stakers but us in SimpleDAIStaking
     */
    function end() public onlyAvatar {
        pause();
    
    }

    /**
     * @dev method to recover any stuck erc20 tokens (ie  compound COMP)
     * @param _token the ERC20 token to recover
     */
    function recover(ERC20 _token) public onlyAvatar {
        uint256 toWithdraw = _token.balanceOf(address(this));

        // recover left iToken(stakers token) only when all stakes have been withdrawn
        if (address(_token) == address(iToken)) {
            require(
                interestData.globalTotalStaked == 0 && paused(),
                "can recover iToken only when stakes have been withdrawn"
            );
        }
        require(_token.transfer(address(avatar), toWithdraw), "recover transfer failed");
    }
}