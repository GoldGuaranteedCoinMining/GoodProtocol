const GoodCompoundStaking = artifacts.require("GoodCompoundStaking");
const GoodDollar = artifacts.require("GoodDollar");
const GoodFundManager = artifacts.require("GoodFundManager");
const GoodReserve = artifacts.require("GoodReserveCDai");
const DAIMock = artifacts.require("DAIMock");
const cDAIMock = artifacts.require("cDAIMock");
const cDAINonMintableMock = artifacts.require("cDAINonMintableMock");
const cDAILowWorthMock = artifacts.require("cDAILowWorthMock");
const Identity = artifacts.require("IdentityMock");
const Formula = artifacts.require("FeeFormula");
const avatarMock = artifacts.require("AvatarMock");
const ControllerMock = artifacts.require("ControllerMock");
const MarketMaker = artifacts.require("GoodMarketMaker");
const ContributionCalculation = artifacts.require("ContributionCalculation");
const GoodCompoundStakingSetFM = artifacts.require("GoodCompoundStakingSetFM");

const BN = web3.utils.BN;
export const BLOCK_INTERVAL = 30;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

async function evm_mine(blocks) {
  for (let i = 0; i < blocks; ++i)
    await web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_mine", id: 123 },
      () => {}
    );
}

contract("SimpleDAIStaking - staking with DAI mocks", ([founder, staker]) => {
  let dai;
  let cDAI1;
  let cDAI2;
  let cDAI3;
  let cDAI;
  let simpleStaking;
  let avatar, goodDollar, identity, formula, controller, fundManager, goodReserve;
  let marketMaker;
  let simpleStakingFM;
  let contributionCal;
  before(async () => {
    dai = await DAIMock.new();
    cDAI = await cDAIMock.new(dai.address);
    [, formula, identity] = await Promise.all([
      dai.mint(cDAI.address, web3.utils.toWei("100000000", "ether")),
      Formula.new(0),
      Identity.new()
    ]);
    goodDollar = await GoodDollar.new(
      "GoodDollar",
      "GDD",
      "0",
      formula.address,
      identity.address,
      NULL_ADDRESS
    );
    avatar = await avatarMock.new("", goodDollar.address, NULL_ADDRESS);
    controller = await ControllerMock.new(avatar.address);
    await avatar.transferOwnership(controller.address);
    fundManager = await GoodFundManager.new(
      avatar.address,
      identity.address,
      cDAI.address,
      founder,
      founder,
      BLOCK_INTERVAL
    );
    await fundManager.start();
    await identity.addContract(fundManager.address);
    simpleStaking = await GoodCompoundStaking.new(
      dai.address,
      cDAI.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    simpleStakingFM = await GoodCompoundStakingSetFM.new(
      dai.address,
      cDAI.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    marketMaker = await MarketMaker.new(avatar.address, 999388834642296, 1e15);
    contributionCal = await ContributionCalculation.new(avatar.address, 0, 1e15);
    goodReserve = await GoodReserve.new(
        dai.address,
        cDAI.address,
        fundManager.address,
        avatar.address,
        identity.address,
        marketMaker.address,
        contributionCal.address,
        BLOCK_INTERVAL
      );
    await goodReserve.start();
    await simpleStaking.start();
    await simpleStakingFM.start();
    await identity.addContract(simpleStaking.address);
    await marketMaker.initializeToken(
          cDAI.address,
          "100", //1gd
          "10000", //0.0001 cDai
          "1000000" //100% rr
        );
    await goodDollar.addMinter(goodReserve.address);
    cDAI1 = await cDAIMock.new(dai.address);
    await marketMaker.initializeToken(
          cDAI1.address,
          "100", //1gd
          "10000", //0.0001 cDai
          "1000000" //100% rr
        );
    cDAI2 = await cDAINonMintableMock.new(dai.address);
    await marketMaker.initializeToken(
          cDAI2.address,
          "100", //1gd
          "10000", //0.0001 cDai
          "1000000" //100% rr
        );
    cDAI3 = await cDAILowWorthMock.new(dai.address);
    await marketMaker.initializeToken(
          cDAI3.address,
          "100", //1gd
          "10000", //0.0001 cDai
          "1000000" //100% rr
        );
    await marketMaker.transferOwnership(goodReserve.address);
  });

  it("should set the reserve in the fund manager", async () => {
      let encodedCall = web3.eth.abi.encodeFunctionCall(
        {
          name: "setReserve",
          type: "function",
          inputs: [
            {
              type: "address",
              name: "_reserve"
            }
          ]
        },
        [goodReserve.address]
      );
      await controller.genericCall(
        fundManager.address,
        encodedCall,
        avatar.address,
        0
      );
      let reserve = await fundManager.reserve();
      expect(reserve).to.be.equal(goodReserve.address);
    });

  it("should mock cdai exchange rate 1e28 precision", async () => {
    let rate = await cDAI.exchangeRateStored();
    expect(rate.toString()).to.be.equal("10101010101010101010101010101");
  });
  it("should mint new dai", async () => {
    let balance = await dai.balanceOf(founder);
    expect(balance.toString()).to.be.equal("0");
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    balance = await dai.balanceOf(staker);
    expect(balance.toString()).to.be.at.equal(web3.utils.toWei("100", "ether"));
  });

  it("should mint new cdai", async () => {
    let balance = await dai.balanceOf(staker);
    expect(balance.toString()).to.be.at.equal(web3.utils.toWei("100", "ether"));
    await dai.approve(cDAI.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    await cDAI.mint(web3.utils.toWei("100", "ether"), { from: staker });
    balance = await dai.balanceOf(staker);
    expect(balance.toString()).to.be.equal("0");
    let cdaiBalance = await cDAI.balanceOf(staker);
    expect(cdaiBalance.toString()).to.be.equal(web3.utils.toWei("9900", "mwei"));
  });

  it("should redeem cdai", async () => {
    let cdaiBalance = await cDAI.balanceOf(staker);
    await cDAI.redeem(cdaiBalance.toString(), { from: staker });
    let balance = await dai.balanceOf(staker);
    expect(balance.toString()).to.be.equal(web3.utils.toWei("100", "ether"));
    dai.transfer(dai.address, balance.toString(), { from: staker });
  });

  it("should return an error if non avatar account is trying to execute recover", async () => {
    const cdai1 = await cDAIMock.new(dai.address);
    let error = await simpleStaking.recover(cdai1.address).catch(e => e);
    expect(error.message).to.have.string("only Avatar can call this method");
  });

  it("should not transfer any funds if trying to execute recover of token without balance", async () => {
    const cdai1 = await cDAIMock.new(dai.address);
    await dai.mint(cdai1.address, web3.utils.toWei("100", "ether"));
    let balanceBefore = await cdai1.balanceOf(avatar.address);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cdai1.address]
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    let balanceAfter = await cdai1.balanceOf(avatar.address);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
  });

  it("should transfer funds when execute recover of token which the contract has some balance", async () => {
    const cdai1 = await cDAIMock.new(dai.address);
    await dai.mint(cdai1.address, web3.utils.toWei("100", "ether"));
    const cdai1BalanceFounder = await cdai1.balanceOf(founder);
    await cdai1.transfer(simpleStaking.address, cdai1BalanceFounder);
    let balanceBefore = await cdai1.balanceOf(avatar.address);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cdai1.address]
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    let balanceAfter = await cdai1.balanceOf(avatar.address);
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal(
      cdai1BalanceFounder.toString()
    );
  });

  it("should returns the exact amount of staked dai without any effect of having excessive dai tokens in the contract", async () => {
    
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI1.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    const weiAmount = web3.utils.toWei("1000", "ether");

    // staking dai
    await dai.mint(staker, weiAmount);
    let stakerBalanceBefore = await dai.balanceOf(staker);
    await dai.approve(simpleStaking1.address, weiAmount, {
      from: staker
    });
    await identity.addContract(simpleStaking1.address);
    
    
    await simpleStaking1.stake(weiAmount, 100, {
      from: staker
    });
    // transfer excessive dai to the contract
    await dai.mint(founder, weiAmount);
    await dai.transfer(simpleStaking1.address, weiAmount);
    let balanceBefore = await dai.balanceOf(avatar.address);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [dai.address]
    );
    await controller.genericCall(simpleStaking1.address, encodedCall, avatar.address, 0);
    await simpleStaking1.withdrawStake(weiAmount, {
      from: staker
    });
    let balanceAfter = await dai.balanceOf(avatar.address);
    let stakerBalanceAfter = await dai.balanceOf(staker);

    // checks that the excessive dai tokens have recovered and that all of the staked
    // tokens have returned to the staker
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal(weiAmount.toString());
    expect(stakerBalanceAfter.toString()).to.be.equal(stakerBalanceBefore.toString());
  });

  it("should not transfer user's funds when execute recover", async () => {
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    let balanceBefore = await dai.balanceOf(avatar.address);
    let stakerBalanceBefore = await dai.balanceOf(staker);
    await simpleStaking
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
      });
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [dai.address]
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    await simpleStaking.withdrawStake(web3.utils.toWei("100", "ether"), {
      from: staker
    });
    let balanceAfter = await dai.balanceOf(avatar.address);
    let stakerBalanceAfter = await dai.balanceOf(staker);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
    expect(stakerBalanceAfter.toString()).to.be.equal(stakerBalanceBefore.toString());
  });

  it("should not transfer excessive cdai funds when total staked is more than 0 and not paused and execute recover", async () => {
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI1.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    await identity.addContract(simpleStaking1.address);
    const weiAmount = web3.utils.toWei("1000", "ether");
    await dai.mint(founder, web3.utils.toWei("100", "ether"));
    await dai.approve(cDAI1.address, web3.utils.toWei("100", "ether"));
    await cDAI1.mint(web3.utils.toWei("100", "ether"));
    const cdaiBalanceFM = await cDAI1.balanceOf(fundManager.address);
    await cDAI1.transfer(simpleStaking1.address, cdaiBalanceFM);
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking1.address, weiAmount, {
      from: staker
    });
    let balanceBefore = await cDAI1.balanceOf(avatar.address);
    let stakerBalanceBefore = await dai.balanceOf(staker);
    await simpleStaking1.stake(weiAmount, 100, {
      from: staker
    });
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cDAI1.address]
    );
    await controller.genericCall(simpleStaking1.address, encodedCall, avatar.address, 0);
    await simpleStaking1.withdrawStake(weiAmount, {
      from: staker
    });
    let balanceAfter = await cDAI1.balanceOf(avatar.address);
    let stakerBalanceAfter = await dai.balanceOf(staker);
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal("0");
    expect(stakerBalanceAfter.toString()).to.be.equal(stakerBalanceBefore.toString());
  });

  it("should transfer excessive dai funds when execute recover", async () => {
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    let totalStaked0 = (await simpleStaking.interestData()).globalTotalStaked;
    await simpleStaking
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
    });
    let totalStaked1 = (await simpleStaking.interestData()).globalTotalStaked;
    await dai.mint(simpleStaking.address, web3.utils.toWei("100", "ether"));
    let stakerBalanceBefore = await dai.balanceOf(staker);
    let avatarBalanceBefore = await dai.balanceOf(avatar.address);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [dai.address]
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    let avatarBalanceAfter = await dai.balanceOf(avatar.address);

    // checks that after recover stake balance is still available
    await simpleStaking.withdrawStake(web3.utils.toWei("100", "ether"), {
      from: staker
    });
    let stakerBalanceAfter = await dai.balanceOf(staker);    
    expect(totalStaked1.sub(totalStaked0).toString()).to.be.equal(
      web3.utils.toWei("100", "ether")
    );
    expect(stakerBalanceAfter.sub(stakerBalanceBefore).toString()).to.be.equal(
      totalStaked1.sub(totalStaked0).toString()
    );
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      web3.utils.toWei("100", "ether")
    );
  });

  it("should be able to stake dai", async () => {
    let totalStakedBefore = (await simpleStaking.interestData()).globalTotalStaked;
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    await simpleStaking
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
      })
      .catch(console.log);
    let totalStakedAfter = (await simpleStaking.interestData()).globalTotalStaked;
    let balance = (await simpleStaking.getStakerData(staker));
    expect(balance[0].toString()).to.be.equal(
      web3.utils.toWei("100", "ether") //100 dai
    );
    expect(totalStakedAfter.sub(totalStakedBefore).toString()).to.be.equal(web3.utils.toWei("100", "ether"));
    let stakedcDaiBalance = await cDAI.balanceOf(simpleStaking.address);
    expect(stakedcDaiBalance.toString()).to.be.equal(
      web3.utils.toWei("9900", "mwei") //8 decimals precision (99 cdai because of the exchange rate dai <> cdai)
    );
  });

  it("should be able to withdraw stake by staker", async () => {
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(simpleStaking.address); // simpleStaking cDAI balance
    let stakerDaiBalanceBefore = await dai.balanceOf(staker); // staker DAI balance
    let balanceBefore = (await simpleStaking.getStakerData(staker)); // user staked balance in GoodStaking
    let totalStakedBefore = (await simpleStaking.interestData()).globalTotalStaked; // total staked in GoodStaking
    const transaction = await simpleStaking.withdrawStake(balanceBefore[0], {
      from: staker
    });
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(simpleStaking.address); // simpleStaking cDAI balance
    let stakerDaiBalanceAfter = await dai.balanceOf(staker); // staker DAI balance
    let balanceAfter = (await simpleStaking.getStakerData(staker)); // user staked balance in GoodStaking
    let totalStakedAfter = (await simpleStaking.interestData()).globalTotalStaked; // total staked in GoodStaking
    expect(stakedcDaiBalanceAfter.lt(stakedcDaiBalanceBefore)).to.be.true;
    expect(stakerDaiBalanceAfter.gt(stakerDaiBalanceBefore)).to.be.true;
    expect(balanceBefore[0].toString()).to.be.equal(
      (stakerDaiBalanceAfter - stakerDaiBalanceBefore).toString()
    );
    expect((totalStakedBefore - totalStakedAfter).toString()).to.be.equal(
      balanceBefore[0].toString()
    );
    expect(balanceAfter[0].toString()).to.be.equal("0");
    expect(stakedcDaiBalanceAfter.toString()).to.be.equal("0");
    expect(transaction.logs[1].event).to.be.equal("StakeWithdraw");
    expect(transaction.logs[1].args.staker).to.be.equal(staker);
    expect(transaction.logs[1].args.value.toString()).to.be.equal(
      (stakerDaiBalanceAfter - stakerDaiBalanceBefore).toString()
    );
  });

  it("should be able to withdraw stake by staker when the worth is lower than the actual staked", async () => {
    
    dai.mint(cDAI3.address, web3.utils.toWei("100000000", "ether"));
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI3.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    await identity.addContract(simpleStaking1.address);
    const weiAmount = web3.utils.toWei("1000", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking1.address, weiAmount, {
      from: staker
    });
    await simpleStaking1.stake(weiAmount, 100, {
      from: staker
    });
    let balanceBefore = (await simpleStaking1.getStakerData(staker)); // user staked balance in GoodStaking
    let stakerDaiBalanceBefore = await dai.balanceOf(staker); // staker DAI balance
    await simpleStaking1.withdrawStake(weiAmount, { from: staker });
    let balanceAfter = (await simpleStaking1.getStakerData(staker)); // user staked balance in GoodStaking
    let stakerDaiBalanceAfter = await dai.balanceOf(staker); // staker DAI balance
    expect(balanceAfter[0].toString()).to.be.equal("0");
    expect(balanceBefore[0].div(new BN(2)).toString()).to.be.equal(
      (stakerDaiBalanceAfter - stakerDaiBalanceBefore).toString()
    );
  });

  it("should return 0s for gains when the current cdai worth is lower than the inital worth", async () => {
    dai.mint(cDAI1.address, web3.utils.toWei("100000000", "ether"));
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI1.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    await identity.addContract(simpleStaking1.address);
    const weiAmount = web3.utils.toWei("1000", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking1.address, weiAmount, {
      from: staker
    });
    await simpleStaking1.stake(weiAmount, 100, {
      from: staker
    });
    let gains = await simpleStaking1.currentUBIInterest();

    expect(gains["0"].toString()).to.be.equal("0"); // cdaiGains
    expect(gains["1"].toString()).to.be.equal("0"); // daiGains
    expect(gains["2"].toString()).to.be.equal("0"); // precisionLossDai
  });

  it("should convert user staked DAI to the equal value of cDAI owned by the staking contract", async () => {
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    await simpleStaking
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
      })
      .catch(console.log);
    let stakedcDaiBalance = await cDAI.balanceOf(simpleStaking.address);
    let stakercDaiBalance = await cDAI.balanceOf(staker);
    expect(stakedcDaiBalance.toString()).to.be.equal(
      web3.utils.toWei("9900", "mwei") //8 decimals precision
    );
    let stakedDaiBalance = await dai.balanceOf(simpleStaking.address);
    expect(stakedDaiBalance.isZero()).to.be.true;
    expect(stakercDaiBalance.isZero()).to.be.true;
    await simpleStaking.withdrawStake(web3.utils.toWei("100", "ether"),{
      from: staker
    });
  });

  it("should not change the staker DAI balance if the conversion failed", async () => {
    let fakeDai = await DAIMock.new();
    let fakecDAI = await cDAIMock.new(fakeDai.address);
    await fakeDai.mint(fakecDAI.address, web3.utils.toWei("100000000", "ether"));
    let fakeSimpleStaking = await GoodCompoundStaking.new(
      dai.address,
      fakecDAI.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    ); // staking should failed
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(fakeSimpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    let stakerDaiBalanceBefore = await dai.balanceOf(staker);
    const error = await fakeSimpleStaking
      .stake(web3.utils.toWei("100", "ether"), {
        from: staker
      })
      .catch(e => e);
    expect(error.message).not.to.be.empty;
    let stakerDaiBalanceAfter = await dai.balanceOf(staker);
    expect(stakerDaiBalanceAfter.toString()).to.be.equal(
      stakerDaiBalanceBefore.toString()
    );
  });

  it("should not change the totalStaked if the conversion failed", async () => {
    let fakeDai = await DAIMock.new();
    let fakecDAI = await cDAIMock.new(fakeDai.address);
    await fakeDai.mint(fakecDAI.address, web3.utils.toWei("100000000", "ether"));
    let fakeSimpleStaking = await GoodCompoundStaking.new(
      dai.address,
      fakecDAI.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    ); // staking should failed
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(fakeSimpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    let totalStakedBefore = await fakeSimpleStaking.interestData();
    const error = await fakeSimpleStaking
      .stake(web3.utils.toWei("100", "ether"), {
        from: staker
      })
      .catch(e => e);
    expect(error.message).not.to.be.empty;
    let totalStakedAfter = await fakeSimpleStaking.interestData();
    expect(totalStakedAfter[0].toString()).to.be.equal(totalStakedBefore[0].toString());
  });

  it("should not update the staker list if the conversion failed", async () => {
    let fakeDai = await DAIMock.new();
    let fakecDAI = await cDAIMock.new(fakeDai.address);
    await fakeDai.mint(fakecDAI.address, web3.utils.toWei("100000000", "ether"));
    let fakeSimpleStaking = await GoodCompoundStaking.new(
      dai.address,
      fakecDAI.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    ); // staking should failed
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(fakeSimpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    const error = await fakeSimpleStaking
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
      })
      .catch(e => e);
    expect(error.message).not.to.be.empty;
    let balance = await fakeSimpleStaking.getStakerData(staker);
    expect(balance[0].toString()).to.be.equal(
      web3.utils.toWei("0", "ether") //100 dai
    );
  });

  it("should not be able to stake 0 dai", async () => {
    const error = await simpleStaking
      .stake(web3.utils.toWei("0", "ether"), 100, {
        from: staker
      })
      .catch(e => e);
    expect(error.message).to.have.string("You need to stake a positive token amount");
  });

  it("should be able to stake dai when the allowed dai amount is higher than the staked amount", async () => {
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("200", "ether"), {
      from: staker
    });

    let balanceBefore = await simpleStaking.getStakerData(staker);
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(simpleStaking.address);

    await simpleStaking
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
      })
      .catch(console.log);

    let balanceAfter = await simpleStaking.getStakerData(staker);
    expect((balanceAfter[0] - balanceBefore[0]).toString()).to.be.equal(
      web3.utils.toWei("100", "ether") //100 dai
    );

    let stakedcDaiBalanceAfter = await cDAI.balanceOf(simpleStaking.address);
    expect((stakedcDaiBalanceAfter - stakedcDaiBalanceBefore).toString()).to.be.equal(
      web3.utils.toWei("9900", "mwei") //8 decimals precision (99 cdai)
    );

    await simpleStaking.withdrawStake(web3.utils.toWei("100", "ether"), {
      from: staker
    });
  });

  it("should not be able to stake when approved dai amount is too low", async () => {
    let lowWeiAmount = web3.utils.toWei("99", "ether");
    let weiAmount = web3.utils.toWei("100", "ether");

    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking.address, lowWeiAmount, {
      from: staker
    });

    const error = await simpleStaking
      .stake(weiAmount, {
        from: staker
      })
      .catch(e => e);
    expect(error);
  });

  it("should not be able to stake when staker dai balance is too low", async () => {
    let currentBalance = await dai.balanceOf(staker);
    let weiAmount = web3.utils.toWei("100", "ether");
    let approvedAmount = currentBalance.valueOf() + weiAmount;

    await dai.approve(simpleStaking.address, approvedAmount, {
      from: staker
    });

    const error = await simpleStaking
      .stake(approvedAmount, {
        from: staker
      })
      .catch(e => e);

    expect(error.message).not.to.be.empty;
  });

  it("should emit a DAIStaked event", async () => {
    const weiAmount = web3.utils.toWei("100", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking.address, weiAmount, {
      from: staker
    });

    const transaction = await simpleStaking
      .stake(weiAmount, 100, {
        from: staker
      })
      .catch(console.log);

    assert(transaction.logs[1].event === "Staked");
    assert.equal(transaction.logs[1].args.value.valueOf(), weiAmount);

    await simpleStaking.withdrawStake(weiAmount, {
      from: staker
    });
  });

  it("should not withdraw interest to owner if cDAI value is lower than the staked", async () => {
    const weiAmount = web3.utils.toWei("1000", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStakingFM.address, weiAmount, {
      from: staker
    });
    await simpleStakingFM
      .stake(weiAmount, 100, {
        from: staker
      })
      .catch(console.log);
    const gains = await simpleStakingFM.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"].toString(); //last 10 decimals since cdai is only 8 decimals while dai is 18
    const fundBalanceBefore = await cDAI.balanceOf(founder);
    await evm_mine(BLOCK_INTERVAL);
    await simpleStakingFM.setFundManager(founder);
    const res = await simpleStakingFM.collectUBIInterest(founder);
    await simpleStakingFM.setFundManager(fundManager.address);
    const fundBalanceAfter = await cDAI.balanceOf(founder);
    expect(cdaiGains.toString()).to.be.equal("0");
    expect(precisionLossDai.toString()).to.be.equal("0");
    expect(fundBalanceAfter.toString()).to.be.equal(fundBalanceBefore.toString());
    await simpleStakingFM.withdrawStake(weiAmount, {
      from: staker
    });
  });

  it("should not be able to stake if the getting an error while minting new cdai", async () => {
    dai.mint(cDAI2.address, web3.utils.toWei("100000000", "ether"));
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI2.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    await identity.addContract(simpleStaking1.address);
    const weiAmount = web3.utils.toWei("1000", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking1.address, weiAmount, {
      from: staker
    });
    const error = await simpleStaking1
      .stake(weiAmount, 100, {
        from: staker
      })
      .catch(e => e);
    expect(error.message).to.have.string("Minting cDai failed, funds returned");
  });

  it("should mock cdai updated exchange rate", async () => {
    await cDAI.exchangeRateCurrent();
    let rate = await cDAI.exchangeRateStored();
    expect(rate.toString()).to.be.equal("10201010101010101010101010101");
  });

  it("should report interest gains", async () => {
    await dai.mint(staker, web3.utils.toWei("400", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("400", "ether"), {
      from: staker
    });
    await simpleStaking
      .stake(web3.utils.toWei("400", "ether"), 100, {
        from: staker
      })
      .catch(console.log);
    await cDAI.exchangeRateCurrent();
    const gains = await simpleStaking.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"];
    expect(cdaiGains.toString()).to.be.equal("380659786"); //8 decimals precision
    expect(precisionLossDai.toString()).to.be.equal("5733333332"); //10 decimals precision lost
    await simpleStaking.withdrawStake(web3.utils.toWei("400", "ether"), {
      from: staker
    });
  });

  it("should withdraw interest to owner", async () => {
    const totalStaked = (await simpleStakingFM.interestData())[0];
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStakingFM.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    await simpleStakingFM
      .stake(web3.utils.toWei("100", "ether"), 100, {
        from: staker
      })
      .catch(console.log);
    const gains = await simpleStakingFM.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"].toString(); //last 10 decimals since cdai is only 8 decimals while dai is 18
    await simpleStakingFM.setFundManager(founder);
    const res = await simpleStakingFM.collectUBIInterest(founder);
    await simpleStakingFM.setFundManager(fundManager.address);
    const fundBalance = await cDAI.balanceOf(founder);
    const fundDaiWorth = await simpleStakingFM.currentTokenWorth();
    expect(cdaiGains.toString()).to.be.equal(fundBalance.toString());
    // expect(fundDaiWorth.toString()).to.be.equal(
    //   //10 gwei = 10 decimals + precisionLoss = 20 decimals = 100 ether of DAI
    //   web3.utils.toWei("10", "gwei") + precisionLossDai
    // );
    await simpleStakingFM.withdrawStake(web3.utils.toWei("100", "ether"), {
      from: staker
    });
  });

  it("should withdraw only by fundmanager", async () => {
    const error = await simpleStaking
      .collectUBIInterest(founder, {
        from: staker
      })
      .catch(e => e);
    expect(error.message).to.have.string("Only FundManager can call this method");
  });

  it("should not be able to double withdraw stake", async () => {
    await dai.mint(staker, web3.utils.toWei("100", "ether"));
    await dai.approve(simpleStaking.address, web3.utils.toWei("100", "ether"), {
      from: staker
    });
    await simpleStaking.stake(web3.utils.toWei("100", "ether"), 100, {
      from: staker
    });
    let balance = await simpleStaking.getStakerData(staker);
    await simpleStaking
      .withdrawStake(balance[0], {
        from: staker
      })
      .catch(e => console.log({ e }));
    const error = await simpleStaking
      .withdrawStake(web3.utils.toWei("100", "ether"), {
        from: staker
      })
      .catch(e => e);
    expect(error.message).to.have.string("Not enough token staked");
  });

  it("should not be able to withdraw if not a staker", async () => {
    const error = await simpleStaking
      .withdrawStake(web3.utils.toWei("100", "ether"), {
        from: founder
      })
      .catch(e => e);
    expect(error.message).to.have.string("Not enough token staked");
  });

  it("should not be able to change the reserve cDAI balance in case of an error", async () => {
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(simpleStaking.address);
    await simpleStaking
      .withdrawStake({
        from: founder
      })
      .catch(e => e);
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(simpleStaking.address);
    expect(stakedcDaiBalanceAfter.toString()).to.be.equal(
      stakedcDaiBalanceBefore.toString()
    );
  });

  it("should be able to withdraw stake by staker and precision loss should not be equal to 0", async () => {
    const weiAmount = web3.utils.toWei("100", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking.address, weiAmount, {
      from: staker
    });
    await simpleStaking
      .stake(weiAmount, 100, {
        from: staker
      })
      .catch(console.log);
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(simpleStaking.address); // simpleStaking cDAI balance
    const transaction = await simpleStaking.withdrawStake(weiAmount, {
      from: staker
    });
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(simpleStaking.address); // simpleStaking cDAI balance
    expect(stakedcDaiBalanceAfter.lt(stakedcDaiBalanceBefore)).to.be.true;
    expect(stakedcDaiBalanceAfter.toString()).to.not.be.equal("0"); //precision loss, so it wont be exactly 0
  });

  it("should withdraw interest to recipient specified by the owner", async () => {
    const weiAmount = web3.utils.toWei("100", "ether");
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStakingFM.address, weiAmount, {
      from: staker
    });
    await simpleStakingFM
      .stake(weiAmount, 100, {
        from: staker
      })
      .catch(console.log);
    const gains = await simpleStakingFM.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"].toString(); //last 10 decimals since cdai is only 8 decimals while dai is 18
    await evm_mine(BLOCK_INTERVAL);
    await simpleStakingFM.setFundManager(founder);
    const res = await simpleStakingFM.collectUBIInterest(staker);
    await simpleStakingFM.setFundManager(fundManager.address);
    const fundBalance = await cDAI.balanceOf(staker);
    const fundDaiWorth = await simpleStakingFM.currentTokenWorth();
    expect(cdaiGains.toString()).to.be.equal(fundBalance.toString());
    // expect(fundDaiWorth.toString()).to.be.equal(
    //   // 10 gwei = 10 decimals + precisionLoss = 20 decimals = 100 ether of DAI
    //   web3.utils.toWei("10", "gwei") + precisionLossDai
    // );
  });

  it("should not withdraw interest if the recipient specified by the owner is the staking contract", async () => {
    await evm_mine(BLOCK_INTERVAL);
    await simpleStakingFM.setFundManager(founder);
    const error = await simpleStakingFM
      .collectUBIInterest(simpleStakingFM.address)
      .catch(e => e);
      await simpleStakingFM.setFundManager(fundManager.address);
    expect(error.message).to.have.string("Recipient cannot be the staking contract");
  });

  it("should pause the contract", async () => {
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "end",
        type: "function",
        inputs: []
      },
      []
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    const isPaused = await simpleStaking.paused();
    expect(isPaused).to.be.true;
  });

  it("should not transfer excessive cdai funds when the contract is paused and the total staked is not 0", async () => {
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI.address,
      fundManager.address,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    await identity.addContract(simpleStaking1.address);
    const weiAmount = web3.utils.toWei("100", "ether");

    // staking dai
    await dai.mint(staker, weiAmount);
    await dai.approve(simpleStaking1.address, weiAmount, {
      from: staker
    });
    await simpleStaking1.stake(weiAmount, 100, {
      from: staker
    });

    // transfer excessive cdai to the contract
    await dai.mint(founder, weiAmount);
    await dai.approve(cDAI.address, weiAmount);
    await cDAI.mint(weiAmount);
    const cdaiBalanceFounder = await cDAI.balanceOf(founder);
    await cDAI.transfer(simpleStaking1.address, cdaiBalanceFounder);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "end",
        type: "function",
        inputs: []
      },
      []
    );
    await controller.genericCall(simpleStaking1.address, encodedCall, avatar.address, 0);
    let avatarBalanceBefore = await cDAI.balanceOf(avatar.address);
    encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cDAI.address]
    );
    await controller.genericCall(simpleStaking1.address, encodedCall, avatar.address, 0);
    let avatarBalanceAfter = await cDAI.balanceOf(avatar.address);
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      web3.utils.toWei("0", "ether")
    );
  });

  it("should not transfer excessive cdai funds when the contract is not paused and the total staked is 0", async () => {
    // totalStaked is equal to 0
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cDAI.address,
      founder,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    let avatarBalanceBefore = await cDAI.balanceOf(avatar.address);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cDAI.address]
    );
    await controller.genericCall(simpleStaking1.address, encodedCall, avatar.address, 0);
    let avatarBalanceAfter = await cDAI.balanceOf(avatar.address);
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      web3.utils.toWei("0", "ether")
    );
  });

  it("should transfer excessive cdai funds when execute recover", async () => {
    await dai.mint(founder, web3.utils.toWei("100", "ether"));
    await dai.approve(cDAI.address, web3.utils.toWei("100", "ether"));
    const cdaiBalanceFounder1 = await cDAI.balanceOf(founder);
    await cDAI.mint(web3.utils.toWei("100", "ether"));
    const cdaiBalanceFounder2 = await cDAI.balanceOf(founder);
    await cDAI.transfer(simpleStaking.address, cdaiBalanceFounder2.sub(cdaiBalanceFounder1).toString());
    let avatarBalanceBefore = await cDAI.balanceOf(avatar.address);
    
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cDAI.address]
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    let avatarBalanceAfter = await cDAI.balanceOf(avatar.address);
    let stakingBalance = await cDAI.balanceOf(simpleStaking.address);
    // checks that something was recovered
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.not.equal("0");
    expect(stakingBalance.toString()).to.be.equal("0");
  });

  it("should not transfer any funds if trying to execute recover of a token without balance", async () => {
    const cdai1 = await cDAIMock.new(dai.address);
    let simpleStaking1 = await GoodCompoundStaking.new(
      dai.address,
      cdai1.address,
      founder,
      BLOCK_INTERVAL,
      avatar.address,
      identity.address
    );
    await dai.mint(founder, web3.utils.toWei("100", "ether"));
    await dai.approve(cdai1.address, web3.utils.toWei("100", "ether"));
    await cdai1.balanceOf(founder);
    await cdai1.mint(web3.utils.toWei("100", "ether"));
    await cdai1.transfer(simpleStaking1.address, "0");
    let balanceBefore = await cdai1.balanceOf(avatar.address);
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "recover",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_token"
          }
        ]
      },
      [cdai1.address]
    );
    await controller.genericCall(simpleStaking1.address, encodedCall, avatar.address, 0);
    let balanceAfter = await cdai1.balanceOf(avatar.address);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
  });

  it("should not be able to change the fund manager address if not owner", async () => {
    const e = await simpleStaking.setFundManager(NULL_ADDRESS).catch(e => e);
    const newFM = await simpleStaking.fundManager();
    expect(e.message).to.not.be.empty;
    expect(newFM.toString()).to.not.be.equal(NULL_ADDRESS);
  });

  it("should be able to change the fund manager address", async () => {
    let encodedCall = web3.eth.abi.encodeFunctionCall(
      {
        name: "setFundManager",
        type: "function",
        inputs: [
          {
            type: "address",
            name: "_fundManager"
          }
        ]
      },
      [NULL_ADDRESS]
    );
    await controller.genericCall(simpleStaking.address, encodedCall, avatar.address, 0);
    const newFM = await simpleStaking.fundManager();
    expect(newFM.toString()).to.be.equal(NULL_ADDRESS);
  });
});