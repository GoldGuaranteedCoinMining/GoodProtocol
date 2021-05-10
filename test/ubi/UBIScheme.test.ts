import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { UBIScheme } from "../../types";
import { createDAO, deployUBI, advanceBlocks, increaseTime } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

const MAX_INACTIVE_DAYS = 3;
const ONE_DAY = 86400;

describe("UBIScheme", () => {
  let goodDollar, identity, formula, avatar, ubi, controller, firstClaimPool;
  let reputation;
  let root,
    acct,
    claimer1,
    claimer2,
    claimer3,
    signers,
    nameService,
    genericCall,
    ubiScheme;

  before(async () => {
    [
      root,
      acct,
      claimer1,
      claimer2,
      claimer3,
      ...signers
    ] = await ethers.getSigners();

    const deployedDAO = await createDAO();
    let {
      nameService: ns,
      genericCall: gn,
      reputation: rep,
      setDAOAddress,
      setSchemes,
      addWhitelisted
    } = deployedDAO;
    nameService = ns;
    genericCall = gn;
    reputation = rep;

    let ubi = await deployUBI(deployedDAO);

    ubiScheme = ubi.ubiScheme;
    firstClaimPool = ubi.firstClaim;

    // setDAOAddress("GDAO_CLAIMERS", cd.address);
    addWhitelisted(claimer1.address, "claimer1");
    await addWhitelisted(claimer2.address, "claimer2");
    // await increaseTime(60 * 60 * 24);
  });

  it("should not accept 0 inactive days in the constructor", async () => {
    let ubi1 = await (await ethers.getContractFactory("UBIScheme")).deploy();

    await expect(
      ubi1.initialize(nameService.address, firstClaimPool.address, 0, 7)
    ).revertedWith("Max inactive days cannot be zero");
  });

  // it("should deploy the ubi", async () => {
  //   const block = await web3.eth.getBlock("latest");
  //   const startUBI = block.timestamp;
  //   const endUBI = startUBI + 60 * 60 * 24 * 30;
  //   ubi = await UBIMock.new(
  //     avatar.address,
  //     identity.address,
  //     firstClaimPool.address,
  //     startUBI,
  //     endUBI,
  //     MAX_INACTIVE_DAYS,
  //     1
  //   );
  //   let isActive = await ubi.isActive();
  //   expect(isActive).to.be.false;
  // });

  // it("should not be able to set the claim amount if the sender is not the avatar", async () => {
  //   let error = await firstClaimPool.setClaimAmount(200).catch(e => e);
  //   expect(error.message).to.have.string("only Avatar");
  // });

  // it("should not be able to set the ubi scheme if the sender is not the avatar", async () => {
  //   let error = await firstClaimPool.setUBIScheme(ubi.address).catch(e => e);
  //   expect(error.message).to.have.string("only Avatar");
  // });

  // it("should not be able to execute claiming when start has not been executed yet", async () => {
  //   let error = await ubi.claim().catch(e => e);
  //   expect(error.message).to.have.string("is not active");
  // });

  // it("should not be able to execute fish when start has not been executed yet", async () => {
  //   let error = await ubi.fish(NULL_ADDRESS).catch(e => e);
  //   expect(error.message).to.have.string("is not active");
  // });

  // it("should not be able to execute fishMulti when start has not been executed yet", async () => {
  //   let error = await ubi.fishMulti([NULL_ADDRESS]).catch(e => e);
  //   expect(error.message).to.have.string("is not active");
  // });

  // it("should start the ubi", async () => {
  //   await ubi.start();
  //   let isActive = await ubi.isActive();
  //   const newUbi = await firstClaimPool.ubi();
  //   let periodStart = await ubi.periodStart().then(_ => _.toNumber());
  //   let startDate = new Date(periodStart * 1000);
  //   expect(startDate.toISOString()).to.have.string("T12:00:00.000Z"); //contract set itself to start at noon GMT
  //   expect(newUbi.toString()).to.be.equal(ubi.address);
  //   expect(isActive).to.be.true;
  // });

  // it("should not be able to execute claiming when the caller is not whitelisted", async () => {
  //   let error = await ubi.claim().catch(e => e);
  //   expect(error.message).to.have.string("is not whitelisted");
  // });

  // it("should not be able to claim when the claim pool is not active", async () => {
  //   await identity.addWhitelisted(claimer1);
  //   let error = await ubi.claim({ from: claimer1 }).catch(e => e);
  //   expect(error.message).to.have.string("is not active");
  // });

  // it("should set the ubi scheme by avatar", async () => {
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setUBIScheme",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "address",
  //           name: "_ubi"
  //         }
  //       ]
  //     },
  //     [NULL_ADDRESS]
  //   );
  //   await controller.genericCall(
  //     firstClaimPool.address,
  //     encodedCall,
  //     avatar.address,
  //     0
  //   );
  //   const newUbi = await firstClaimPool.ubi();
  //   expect(newUbi.toString()).to.be.equal(NULL_ADDRESS);
  // });

  // it("should not be able to claim when the ubi is not initialized", async () => {
  //   await firstClaimPool.start();
  //   let error = await ubi.claim({ from: claimer1 }).catch(e => e);
  //   expect(error.message).to.have.string("ubi has not initialized");

  //   // initializing the ubi
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setUBIScheme",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "address",
  //           name: "_ubi"
  //         }
  //       ]
  //     },
  //     [ubi.address]
  //   );
  //   await controller.genericCall(
  //     firstClaimPool.address,
  //     encodedCall,
  //     avatar.address,
  //     0
  //   );
  // });

  // it("should not be able to call award user if the caller is not the ubi", async () => {
  //   let error = await firstClaimPool.awardUser(claimer1).catch(e => e);
  //   expect(error.message).to.have.string("Only UBIScheme can call this method");
  // });

  // it("should award a new user with 0 on first time execute claim if the first claim contract has no balance", async () => {
  //   let tx = await ubi.claim({ from: claimer1 });
  //   let claimer1Balance = await goodDollar.balanceOf(claimer1);
  //   expect(claimer1Balance.toNumber()).to.be.equal(0);
  //   const emittedEvents = tx.logs.map(e => e.event);
  //   expect(emittedEvents).to.include.members(["ActivatedUser", "UBIClaimed"]);
  // });

  // it("should award a new user with the award amount on first time execute claim", async () => {
  //   await goodDollar.mint(firstClaimPool.address, "10000000");
  //   await identity.addWhitelisted(claimer2);
  //   let transaction = await ubi.claim({ from: claimer2 });
  //   let activeUsersCount = await ubi.activeUsersCount();
  //   let claimer2Balance = await goodDollar.balanceOf(claimer2);
  //   expect(claimer2Balance.toNumber()).to.be.equal(100);
  //   expect(activeUsersCount.toNumber()).to.be.equal(2);
  //   const activatedUserEventExists = transaction.logs.some(
  //     e => e.event === "ActivatedUser"
  //   );
  //   expect(activatedUserEventExists).to.be.true;
  // });

  // it("should updates the daily stats when a new user is getting an award", async () => {
  //   await identity.addWhitelisted(claimer8);
  //   const currentDay = await ubi.currentDay();
  //   const amountOfClaimersBefore = await ubi.getClaimerCount(
  //     currentDay.toString()
  //   );
  //   const claimAmountBefore = await ubi.getClaimAmount(currentDay.toString());
  //   await ubi.claim({ from: claimer8 });
  //   const amountOfClaimersAfter = await ubi.getClaimerCount(
  //     currentDay.toString()
  //   );
  //   const claimAmountAfter = await ubi.getClaimAmount(currentDay.toString());
  //   expect(
  //     amountOfClaimersAfter.sub(amountOfClaimersBefore).toString()
  //   ).to.be.equal("1");
  //   expect(claimAmountAfter.sub(claimAmountBefore).toString()).to.be.equal(
  //     "100"
  //   );
  // });

  // it("should not be able to fish a new user", async () => {
  //   let error = await ubi.fish(claimer1, { from: fisherman }).catch(e => e);
  //   expect(error.message).to.have.string("is not an inactive user");
  // });

  // it("should not initiate the scheme balance and distribution formula when a new user execute claim", async () => {
  //   let balance = await goodDollar.balanceOf(ubi.address);
  //   let dailyUbi = await ubi.dailyUbi();
  //   expect(balance.toString()).to.be.equal("0");
  //   expect(dailyUbi.toString()).to.be.equal("0");
  // });

  // it("should returns a valid distribution calculation when the current balance is lower than the number of daily claimers", async () => {
  //   // there is 0.01 gd and 2 claimers
  //   // this is an edge case
  //   await goodDollar.mint(avatar.address, "1");
  //   await increaseTime(ONE_DAY);
  //   await ubi.claim({ from: claimer1 });
  //   await ubi.claim({ from: claimer2 });
  //   let ubiBalance = await goodDollar.balanceOf(ubi.address);
  //   await increaseTime(ONE_DAY);
  //   let dailyUbi = await ubi.dailyUbi();
  //   let claimer1Balance = await goodDollar.balanceOf(claimer1);
  //   expect(ubiBalance.toString()).to.be.equal("1");
  //   expect(dailyUbi.toString()).to.be.equal("0");
  //   expect(claimer1Balance.toString()).to.be.equal("0");
  // });

  // it("should calculate the daily distribution and withdraw balance from the dao when an active user executes claim", async () => {
  //   // checking that the distirbution works ok also when not all claimers claim
  //   // achieving that goal by leaving the claimed amount of the second claimer
  //   // in the ubi and in the next day after transferring the balances from the
  //   // dao, making sure that the tokens that have not been claimed are
  //   // taken by the formula as expected.
  //   const currentDay = await ubi.currentDayInCycle().then(_ => _.toNumber());
  //   await increaseTime(ONE_DAY);
  //   await goodDollar.mint(avatar.address, "901");
  //   //ubi will have 902GD in pool so daily ubi is now 902/1(cycle)/3(claimers) = 300
  //   await ubi.claim({ from: claimer1 });
  //   await increaseTime(ONE_DAY);
  //   await goodDollar.mint(avatar.address, "1");
  //   //daily ubi is 0 since only 1 GD is in pool and can't be divided
  //   // an edge case
  //   await ubi.claim({ from: claimer1 });
  //   let avatarBalance = await goodDollar.balanceOf(avatar.address);
  //   let claimer1Balance = await goodDollar.balanceOf(claimer1);
  //   expect(avatarBalance.toString()).to.be.equal("0");
  //   // 300 GD from first day and 201 from the second day claimed in this test
  //   expect(claimer1Balance.toString()).to.be.equal("501");
  // });

  // it("should return the reward value for entitlement user", async () => {
  //   let amount = await ubi.checkEntitlement({ from: claimer4 });
  //   let claimAmount = await firstClaimPool.claimAmount();
  //   expect(amount.toString()).to.be.equal(claimAmount.toString());
  // });

  // it("should return that a new user is not an active user", async () => {
  //   let isActiveUser = await ubi.isActiveUser(claimer7);
  //   expect(isActiveUser).to.be.false;
  // });

  // it("should not be able to fish an active user", async () => {
  //   await identity.addWhitelisted(claimer3);
  //   await identity.addWhitelisted(claimer4);
  //   await ubi.claim({ from: claimer3 });
  //   await ubi.claim({ from: claimer4 });
  //   let isActiveUser = await ubi.isActiveUser(claimer4);
  //   let error = await ubi.fish(claimer4, { from: fisherman }).catch(e => e);
  //   expect(isActiveUser).to.be.true;
  //   expect(error.message).to.have.string("is not an inactive use");
  // });

  // it("should not be able to execute claim twice a day", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await increaseTime(ONE_DAY);
  //   let claimer4Balance1 = await goodDollar.balanceOf(claimer4);
  //   await ubi.claim({ from: claimer4 });
  //   let claimer4Balance2 = await goodDollar.balanceOf(claimer4);
  //   let dailyUbi = await ubi.dailyUbi();
  //   await ubi.claim({ from: claimer4 });
  //   let claimer4Balance3 = await goodDollar.balanceOf(claimer4);
  //   expect(
  //     claimer4Balance2.toNumber() - claimer4Balance1.toNumber()
  //   ).to.be.equal(dailyUbi.toNumber());
  //   expect(
  //     claimer4Balance3.toNumber() - claimer4Balance1.toNumber()
  //   ).to.be.equal(dailyUbi.toNumber());
  // });

  // it("should return the daily ubi for entitlement user", async () => {
  //   // claimer3 hasn't claimed during that interval so that user
  //   // may have the dailyUbi
  //   let amount = await ubi.checkEntitlement({ from: claimer3 });
  //   let dailyUbi = await ubi.dailyUbi();
  //   expect(amount.toString()).to.be.equal(dailyUbi.toString());
  // });

  // it("should return 0 for entitlement if the user has already claimed for today", async () => {
  //   await ubi.claim({ from: claimer4 });
  //   let amount = await ubi.checkEntitlement({ from: claimer4 });
  //   expect(amount.toString()).to.be.equal("0");
  // });

  // it("should be able to fish inactive user", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4);
  //   let isFishedBefore = await ubi.fishedUsersAddresses(claimer1);
  //   let tx = await ubi.fish(claimer1, { from: claimer4 });
  //   let isFishedAfter = await ubi.fishedUsersAddresses(claimer1);
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4);
  //   let dailyUbi = await ubi.dailyUbi();
  //   expect(isFishedBefore).to.be.false;
  //   expect(isFishedAfter).to.be.true;
  //   expect(tx.logs.some(e => e.event === "InactiveUserFished")).to.be.true;
  //   expect(
  //     claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
  //   ).to.be.equal(dailyUbi.toNumber());
  // });

  // it("should not be able to fish the same user twice", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4);
  //   let isFishedBefore = await ubi.fishedUsersAddresses(claimer1);
  //   let error = await ubi.fish(claimer1, { from: claimer4 }).catch(e => e);
  //   let isFishedAfter = await ubi.fishedUsersAddresses(claimer1);
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4);
  //   expect(error.message).to.have.string("already fished");
  //   expect(isFishedBefore).to.be.true;
  //   expect(isFishedAfter).to.be.true;
  //   expect(claimer4BalanceAfter.toNumber()).to.be.equal(
  //     claimer4BalanceBefore.toNumber()
  //   );
  // });

  // it("should be able to fish multiple user", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4);
  //   let tx = await ubi.fishMulti([claimer2, claimer3], { from: claimer4 });
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4);
  //   let dailyUbi = await ubi.dailyUbi();
  //   const totalFishedEventExists = tx.logs.some(
  //     e => e.event === "TotalFished" && e.args["total"].toNumber() === 2
  //   );
  //   expect(tx.logs.some(e => e.event === "InactiveUserFished")).to.be.true;
  //   expect(
  //     claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
  //   ).to.be.equal(2 * dailyUbi.toNumber());
  //   expect(totalFishedEventExists).to.be.true;
  // });

  // it("should not be able to remove an active user that no longer whitelisted", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await ubi.claim({ from: claimer2 }); // makes sure that the user is active
  //   await identity.removeWhitelisted(claimer2);
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4);
  //   let isFishedBefore = await ubi.fishedUsersAddresses(claimer2);
  //   let error = await ubi.fish(claimer2, { from: claimer4 }).catch(e => e);
  //   let isFishedAfter = await ubi.fishedUsersAddresses(claimer2);
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4);
  //   expect(error.message).to.have.string("is not an inactive user");
  //   expect(isFishedBefore).to.be.false;
  //   expect(isFishedAfter).to.be.false;
  //   expect(claimer4BalanceAfter.toNumber()).to.be.equal(
  //     claimer4BalanceBefore.toNumber()
  //   );
  // });

  // it("should be able to remove an inactive user that no longer whitelisted", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4);
  //   let isFishedBefore = await ubi.fishedUsersAddresses(claimer2);
  //   let tx = await ubi.fish(claimer2, { from: claimer4 });
  //   let isFishedAfter = await ubi.fishedUsersAddresses(claimer2);
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4);
  //   let dailyUbi = await ubi.dailyUbi();
  //   expect(isFishedBefore).to.be.false;
  //   expect(isFishedAfter).to.be.true;
  //   expect(tx.logs.some(e => e.event === "InactiveUserFished")).to.be.true;
  //   expect(
  //     claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
  //   ).to.be.equal(dailyUbi.toNumber());
  // });

  // it("should be able to fish user that removed from the whitelist", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await identity.addWhitelisted(claimer2);
  //   await ubi.claim({ from: claimer2 });
  //   await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
  //   await identity.removeWhitelisted(claimer2);
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4);
  //   let isFishedBefore = await ubi.fishedUsersAddresses(claimer2);
  //   let tx = await ubi.fish(claimer2, { from: claimer4 });
  //   let isFishedAfter = await ubi.fishedUsersAddresses(claimer2);
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4);
  //   let dailyUbi = await ubi.dailyUbi();
  //   expect(isFishedBefore).to.be.false;
  //   expect(isFishedAfter).to.be.true;
  //   expect(tx.logs.some(e => e.event === "InactiveUserFished")).to.be.true;
  //   expect(
  //     claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
  //   ).to.be.equal(dailyUbi.toNumber());
  // });

  // it("should recieves a claim reward on claim after removed and added again to the whitelist", async () => {
  //   let isFishedBefore = await ubi.fishedUsersAddresses(claimer2);
  //   let activeUsersCountBefore = await ubi.activeUsersCount();
  //   await identity.addWhitelisted(claimer2);
  //   let claimerBalanceBefore = await goodDollar.balanceOf(claimer2);
  //   await ubi.claim({ from: claimer2 });
  //   let claimerBalanceAfter = await goodDollar.balanceOf(claimer2);
  //   let isFishedAfter = await ubi.fishedUsersAddresses(claimer2);
  //   let activeUsersCountAfter = await ubi.activeUsersCount();
  //   expect(isFishedBefore).to.be.true;
  //   expect(isFishedAfter).to.be.false;
  //   expect(
  //     activeUsersCountAfter.toNumber() - activeUsersCountBefore.toNumber()
  //   ).to.be.equal(1);
  //   expect(
  //     claimerBalanceAfter.toNumber() - claimerBalanceBefore.toNumber()
  //   ).to.be.equal(100);
  // });

  // it("distribute formula should return correct value", async () => {
  //   await goodDollar.mint(avatar.address, "20");
  //   await increaseTime(ONE_DAY);
  //   let ubiBalance = await goodDollar.balanceOf(ubi.address);
  //   let avatarBalance = await goodDollar.balanceOf(avatar.address);
  //   let activeUsersCount = await ubi.activeUsersCount();
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer2);
  //   await ubi.claim({ from: claimer2 });
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer2);
  //   expect(
  //     ubiBalance
  //       .add(avatarBalance)
  //       .div(activeUsersCount)
  //       .toNumber()
  //   ).to.be.equal(
  //     claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
  //   );
  // });

  // it("distribute formula should return correct value while gd has transferred directly to the ubi", async () => {
  //   await goodDollar.mint(ubi.address, "200");
  //   await increaseTime(ONE_DAY);
  //   let ubiBalance = await goodDollar.balanceOf(ubi.address);
  //   let avatarBalance = await goodDollar.balanceOf(avatar.address);
  //   let activeUsersCount = await ubi.activeUsersCount();
  //   let claimer4BalanceBefore = await goodDollar.balanceOf(claimer2);
  //   await ubi.claim({ from: claimer2 });
  //   let claimer4BalanceAfter = await goodDollar.balanceOf(claimer2);
  //   let dailyUbi = await ubi.dailyUbi();
  //   expect(
  //     ubiBalance
  //       .add(avatarBalance)
  //       .div(activeUsersCount)
  //       .toNumber()
  //   ).to.be.equal(
  //     claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
  //   );
  //   expect(
  //     ubiBalance
  //       .add(avatarBalance)
  //       .div(activeUsersCount)
  //       .toNumber()
  //   ).to.be.equal(dailyUbi.toNumber());
  // });

  // it("should calcualte the correct distribution formula and transfer the correct amount when the ubi has a large amount of tokens", async () => {
  //   await increaseTime(ONE_DAY);
  //   await goodDollar.mint(avatar.address, "948439324829"); // checking claim with a random number
  //   await increaseTime(ONE_DAY);
  //   await identity.authenticate(claimer1);
  //   // first claim
  //   await ubi.claim({ from: claimer1 });
  //   await increaseTime(ONE_DAY);
  //   let claimer1Balance1 = await goodDollar.balanceOf(claimer1);
  //   // regular claim
  //   await ubi.claim({ from: claimer1 });
  //   let claimer1Balance2 = await goodDollar.balanceOf(claimer1);
  //   // there are 4 claimers and the total ubi balance after the minting include the previous balance and
  //   // the 948439324829 minting tokens. that divides into 4
  //   expect(claimer1Balance2.sub(claimer1Balance1).toString()).to.be.equal(
  //     "237109831254"
  //   );
  // });

  // it("should be able to iterate over all accounts if enough gas in fishMulti", async () => {
  //   //should not reach fishin first user because atleast 150k gas is required
  //   let tx = await ubi
  //     .fishMulti([claimer5, claimer6, claimer1], {
  //       from: fisherman,
  //       gas: 100000
  //     })
  //     .then(_ => true)
  //     .catch(_ => console.log({ e }));
  //   expect(tx).to.be.true;
  //   //should loop over all users when enough gas without exceptions
  //   let res = await ubi
  //     .fishMulti([claimer5, claimer6, claimer1], { gas: 1000000 })
  //     .then(_ => true)
  //     .catch(e => console.log({ e }));
  //   expect(res).to.be.true;
  // });

  // it("should return the reward value for entitlement user", async () => {
  //   await increaseTime(ONE_DAY);
  //   await ubi.claim({ from: claimer1 });
  //   await increaseTime(ONE_DAY);
  //   let amount = await ubi.checkEntitlement({ from: claimer1 });
  //   let balance2 = await goodDollar.balanceOf(ubi.address);
  //   let activeUsersCount = await ubi.activeUsersCount();
  //   expect(amount.toString()).to.be.equal(
  //     balance2.div(activeUsersCount).toString()
  //   );
  // });

  // it("should set the ubi claim amount by avatar", async () => {
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setClaimAmount",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "uint256",
  //           name: "_claimAmount"
  //         }
  //       ]
  //     },
  //     [200]
  //   );
  //   await controller.genericCall(
  //     firstClaimPool.address,
  //     encodedCall,
  //     avatar.address,
  //     0
  //   );
  //   const claimAmount = await firstClaimPool.claimAmount();
  //   expect(claimAmount.toString()).to.be.equal("200");
  // });

  // it("should set if withdraw from the dao or not", async () => {
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setShouldWithdrawFromDAO",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "bool",
  //           name: "_shouldWithdraw"
  //         }
  //       ]
  //     },
  //     [true]
  //   );
  //   await controller.genericCall(ubi.address, encodedCall, avatar.address, 0);
  //   const shouldWithdrawFromDAO = await ubi.shouldWithdrawFromDAO();
  //   expect(shouldWithdrawFromDAO).to.be.equal(true);
  // });

  // it("should not be able to destroy the ubi contract if not avatar", async () => {
  //   await increaseTime(10 * ONE_DAY);
  //   let avatarBalanceBefore = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceBefore = await goodDollar.balanceOf(ubi.address);
  //   let error = await ubi.end().catch(e => e);
  //   expect(error.message).to.have.string("only Avatar can call this method");
  //   let avatarBalanceAfter = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceAfter = await goodDollar.balanceOf(ubi.address);
  //   let isActive = await ubi.isActive();
  //   expect((avatarBalanceAfter - avatarBalanceBefore).toString()).to.be.equal(
  //     "0"
  //   );
  //   expect(contractBalanceAfter.toString()).to.be.equal(
  //     contractBalanceBefore.toString()
  //   );
  //   expect(isActive.toString()).to.be.equal("true");
  // });

  // it("should destroy the ubi contract and transfer funds to the avatar", async () => {
  //   let avatarBalanceBefore = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceBefore = await goodDollar.balanceOf(ubi.address);
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "end",
  //       type: "function",
  //       inputs: []
  //     },
  //     []
  //   );
  //   await controller.genericCall(ubi.address, encodedCall, avatar.address, 0);
  //   let avatarBalanceAfter = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceAfter = await goodDollar.balanceOf(ubi.address);
  //   let code = await web3.eth.getCode(ubi.address);
  //   expect((avatarBalanceAfter - avatarBalanceBefore).toString()).to.be.equal(
  //     contractBalanceBefore.toString()
  //   );
  //   expect(contractBalanceAfter.toString()).to.be.equal("0");
  //   expect(code.toString()).to.be.equal("0x");
  // });

  // it("should be able to destroy an empty pool contract", async () => {
  //   let firstClaimPool1 = await FirstClaimPool.new(
  //     avatar.address,
  //     identity.address,
  //     100
  //   );
  //   await firstClaimPool1.start();
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "end",
  //       type: "function",
  //       inputs: []
  //     },
  //     []
  //   );
  //   await controller.genericCall(
  //     firstClaimPool1.address,
  //     encodedCall,
  //     avatar.address,
  //     0
  //   );
  //   let code = await web3.eth.getCode(firstClaimPool1.address);
  //   expect(code.toString()).to.be.equal("0x");
  // });

  // it("should not be able to destroy the first claim pool contract if not avatar", async () => {
  //   let avatarBalanceBefore = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceBefore = await goodDollar.balanceOf(
  //     firstClaimPool.address
  //   );
  //   let error = await firstClaimPool.end().catch(e => e);
  //   expect(error.message).to.have.string("only Avatar can call this method");
  //   let avatarBalanceAfter = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceAfter = await goodDollar.balanceOf(
  //     firstClaimPool.address
  //   );
  //   let isActive = await firstClaimPool.isActive();
  //   expect((avatarBalanceAfter - avatarBalanceBefore).toString()).to.be.equal(
  //     "0"
  //   );
  //   expect(contractBalanceAfter.toString()).to.be.equal(
  //     contractBalanceBefore.toString()
  //   );
  //   expect(isActive.toString()).to.be.equal("true");
  // });

  // it("should destroy the first claim pool contract and transfer funds to the avatar", async () => {
  //   let avatarBalanceBefore = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceBefore = await goodDollar.balanceOf(
  //     firstClaimPool.address
  //   );
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "end",
  //       type: "function",
  //       inputs: []
  //     },
  //     []
  //   );
  //   await controller.genericCall(
  //     firstClaimPool.address,
  //     encodedCall,
  //     avatar.address,
  //     0
  //   );
  //   let avatarBalanceAfter = await goodDollar.balanceOf(avatar.address);
  //   let contractBalanceAfter = await goodDollar.balanceOf(
  //     firstClaimPool.address
  //   );
  //   let code = await web3.eth.getCode(firstClaimPool.address);
  //   expect((avatarBalanceAfter - avatarBalanceBefore).toString()).to.be.equal(
  //     contractBalanceBefore.toString()
  //   );
  //   expect(contractBalanceAfter.toString()).to.be.equal("0");
  //   expect(code.toString()).to.be.equal("0x");
  // });
});
