import { get, range, chunk, flatten, mergeWith, sortBy, uniq } from "lodash";
import fs from "fs";
import MerkleTree from "merkle-tree-solidity";
import coreContracts from "@gooddollar/goodcontracts/releases/deployment.json";
import stakingContracts from "@gooddollar/goodcontracts/stakingModel/releases/deployment.json";
import upgradablesContracts from "@gooddollar/goodcontracts/upgradables/releases/deployment.json";
import SimpleDAIStaking from "@gooddollar/goodcontracts/stakingModel/build/contracts/SimpleDAIStaking.min.json";
import { ethers as Ethers } from "hardhat";
import fetch from "node-fetch";
import { request, gql } from "graphql-request";
import PromiseQueue from "promise-queue";

const GD_FUSE = "0x495d133b938596c9984d462f007b676bdc57ecec";
const GD_MAINNET = "0x67c5870b4a41d4ebef24d2456547a03f1f3e094b";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
type Balances = {
  [key: string]: {
    isNotContract: boolean;
    balance: number;
    claims: number;
    stake: number;
    gdRepShare: number;
    claimRepShare: number;
    stakeRepShare: number;
  };
};

type Tree = {
  [key: string]: {
    hash: string;
    rep: number;
  };
};
const DefaultBalance = {
  balance: 0,
  claims: 0,
  gdRepShare: 0,
  claimRepShare: 0,
  stake: 0,
  stakeRepShare: 0,
  isNotContract: true
};
const otherContracts = [
  "0x8d441C2Ff54C015A1BE22ad88e5D42EFBEC6C7EF", //fuseswap
  "0x0bf36731724f0baceb0748a9e71cd4883b69c533", //fuseswap usdc
  "0x17b09b22823f00bb9b8ee2d4632e332cadc29458", //old bridge
  "0xd5d11ee582c8931f336fbcd135e98cee4db8ccb0", //new bridge
  "0xa56A281cD8BA5C083Af121193B2AaCCaAAC9850a", //mainnet uniswap
  "0x66c0f5449ba4ff4fba0b05716705a4176bbdb848", //defender automation
  "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11" //"uniswap DAI"
];

const systemContracts = {};
const allContracts = flatten(
  [coreContracts, stakingContracts, upgradablesContracts].map(_ =>
    Object.values(_).map(_ => Object.values(_))
  )
);
flatten(
  [].concat(
    ...[otherContracts, allContracts]
      .map(Object.values)
      .map(arr => arr.map(x => (typeof x === "object" ? Object.values(x) : x)))
  )
)
  .filter(x => typeof x === "string" && x.startsWith("0x"))
  .map(addr => (systemContracts[addr.toLowerCase()] = true));

const step = 500;

const isSystemContract = addr => systemContracts[addr.toLowerCase()] === true;

const updateBalance = (balance, update) => {
  return Object.assign({}, DefaultBalance, balance, update);
};

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);

  let sum = 0;
  for (let i = 0; i < base; i++) sum += sorted[i];

  return sum;
};

let FUSE_SNAPSHOT_BLOCK = 12000000;
let ETH_SNAPSHOT_BLOCK = 12000000;

export const airdrop = (
  ethers: typeof Ethers,
  ethplorer_key,
  etherscan_key
) => {
  const fuseArchiveProvider = new ethers.providers.JsonRpcProvider(
    "https://explorer-node.fuse.io/"
  );

  const poktArchiveProvider = new ethers.providers.JsonRpcProvider({
    url: "https://eth-trace.gateway.pokt.network/v1/lb/6130bad2dc57c50036551041",
    user: "",
    password: "15439e4f4aeceb469b6b38e319f4f2a5" //end point will be removed, so its ok to keep clear text password
  });

  console.log({ systemContracts });
  let gd = new ethers.Contract(
    GD_FUSE,
    [
      "event Transfer(address indexed from, address indexed to, uint amount)",
      "function balanceOf(address) view returns(uint256)"
    ],
    fuseArchiveProvider
  );

  let gdMainnet = new ethers.Contract(
    GD_MAINNET,
    [
      "event Transfer(address indexed from, address indexed to, uint256 value)",
      "function balanceOf(address) view returns(uint256)"
    ],
    poktArchiveProvider //we need balances at specific time so we use archive node
  );

  let dai = new ethers.Contract(
    DAI,
    [
      "event Transfer(address indexed from, address indexed to, uint256 value)",
      "function balanceOf(address) view returns(uint256)"
    ],
    new ethers.providers.InfuraProvider()
  );

  const ubi = new ethers.Contract(
    "0xAACbaaB8571cbECEB46ba85B5981efDB8928545e",
    ["event UBIClaimed(address indexed from, uint amount)"],
    fuseArchiveProvider
  );
  const ubinew = new ethers.Contract(
    "0xD7aC544F8A570C4d8764c3AAbCF6870CBD960D0D",
    ["event UBIClaimed(address indexed from, uint amount)"],
    fuseArchiveProvider
  );
  const usdcgdYieldFarming = new ethers.Contract(
    "0x04Ee5DE43332aF99eeC2D40de19962AA1cC583EC",
    [
      "event Staked(address indexed staker, uint256 value, uint256 _globalYieldPerToken)",
      "function interestData() view returns(uint256,uint256,uint256)",
      "function getStakerData(address) public view returns(uint256, uint256)"
    ],
    fuseArchiveProvider
  );

  const getStakersBalance = async (): Promise<Balances> => {
    const staking = new ethers.Contract(
      "0xEa12bB3917cf6aE2FDE97cE4756177703426d41F",
      SimpleDAIStaking.abi,
      new ethers.providers.InfuraProvider()
    );

    //calculate staking period * stake value (already in $=DAI)
    const events = await staking.queryFilter(
      staking.filters.DAIStaked(),
      10575628, //block contract was created,
      ETH_SNAPSHOT_BLOCK
    );

    const nowBlock = ETH_SNAPSHOT_BLOCK; //await staking.provider.getBlockNumber();
    let toAggregate = events.map(_ => [
      _.args.staker.toLowerCase(),
      parseFloat(ethers.utils.formatEther(_.args.daiValue)) *
        (nowBlock - _.blockNumber), //value staked multiplied by time staked (there where no withdraws so far besides foundation account)
      parseFloat(ethers.utils.formatEther(_.args.daiValue))
    ]);

    const stakers = uniq(events.map(_ => _.args.staker));

    //get dai donations
    const daiDonationEvents = await dai.queryFilter(
      dai.filters.Transfer(null, "0x93FB057EeC37aBc11D955d1C09e6A0d218F35CfF"),
      11512056, //donation staking contract creation block,
      ETH_SNAPSHOT_BLOCK
    );

    const daiDonationsToAggregate = daiDonationEvents
      .filter(_ => !isSystemContract(_.args.from))
      .map(e => [
        e.args.from.toLowerCase(),
        parseFloat(ethers.utils.formatEther(e.args.value)) *
          (nowBlock - e.blockNumber),
        parseFloat(ethers.utils.formatEther(e.args.value))
      ]);

    //read eth donations and calculate period * $ value
    let provider = new ethers.providers.EtherscanProvider(
      "homestead",
      etherscan_key
    );
    let historyPromises = (
      await provider.getHistory(
        "0x93FB057EeC37aBc11D955d1C09e6A0d218F35CfF",
        11512056,
        ETH_SNAPSHOT_BLOCK
      )
    )
      .filter(_ => _.value.gt(ethers.constants.Zero))
      .map(async _ => {
        const data = await fetch(
          `https://poloniex.com/public?command=returnChartData&currencyPair=USDT_ETH&start=${
            _.timestamp
          }&end=${_.timestamp + 30000}&period=300`
        ).then(_ => _.json());
        const price = data[0].weightedAverage || data[0].open;
        if (price == 0) console.error("error 0 price", { data });
        return {
          from: _.from.toLowerCase(),
          value: ethers.utils.formatEther(_.value),
          timestamp: _.timestamp,
          price,
          usdvalue: price * parseFloat(ethers.utils.formatEther(_.value)),
          share:
            price *
            parseFloat(ethers.utils.formatEther(_.value)) *
            (nowBlock - _.blockNumber) //value staked multiplied by time staked
        };
      });

    let ethDonations = await Promise.all(historyPromises);

    let donationsToAggregate = daiDonationsToAggregate.concat(
      ethDonations.map(_ => [_.from, _.share, _.usdvalue])
    );

    const stakerToTotal: { [key: string]: number } = {};
    toAggregate = toAggregate.concat(donationsToAggregate);

    let totalStakedAndDonated = 0;
    toAggregate.forEach(_ => {
      stakerToTotal[_[0]] = (stakerToTotal[_[0]] || 0) + _[1];
      totalStakedAndDonated += _[2];
    });

    // deduct withdrawn stakes
    const withdrawevents = await staking.queryFilter(
      staking.filters.DAIStakeWithdraw(),
      10575628,
      ETH_SNAPSHOT_BLOCK
    );
    withdrawevents.forEach(
      _ =>
        (stakerToTotal[_.args.staker.toLowerCase()] -=
          parseFloat(ethers.utils.formatEther(_.args.daiValue)) *
          (nowBlock - _.blockNumber))
    );

    //filter contracts + calculate total shares
    let totalShares = 0;
    for (let k in stakerToTotal) {
      if (isSystemContract(k)) {
        //filter the donationstaking contract
        delete stakerToTotal[k];
        continue;
      }
      totalShares += stakerToTotal[k];
    }

    const result: Balances = {};
    //calculate relative share
    for (let k in stakerToTotal) {
      result[k] = {
        ...DefaultBalance,
        stakeRepShare: stakerToTotal[k] / totalShares,
        isNotContract: true
      };
    }

    console.log("stakers and donator shares:", {
      stakerToTotal,
      totalStakedAndDonated
    });

    return result;
    // const ps = stakers.map(async s => {
    //   return {
    //     balance: (await staking.stakers(s)).stakedDAI.toString(),
    //     isNotContract:
    //       (await staking.provider.getCode(s).catch(e => "0x")) === "0x",
    //     s
    //   };
    // });
    // const res = await Promise.all(ps);

    // console.log({
    //   stakers,
    //   toAggregate,
    //   stakerToTotal,
    //   totalShares,
    //   ethDonations,
    //   donationsToAggregate,
    //   totalStakedAndDonated
    // });
  };

  const getUniswapBalances = async (addresses: Balances = {}) => {
    const query = gql`
      {
        liquidityPositions(
          orderDirection: desc
          orderBy: liquidityTokenBalance
          where: {
            pair: "0xa56a281cd8ba5c083af121193b2aaccaaac9850a"
            liquidityTokenBalance_gt: 0
          }
        ) {
          id
          user {
            id
          }
          pair {
            reserve0
            totalSupply
          }
          liquidityTokenBalance
        }
      }
    `;

    let pair = await ethers.getContractAt(
      "UniswapPair",
      "0xa56a281cd8ba5c083af121193b2aaccaaac9850a"
    );
    pair = pair.connect(poktArchiveProvider);

    const pairTotalSupply = await pair
      .totalSupply({
        blockTag: ETH_SNAPSHOT_BLOCK
      })
      .then(_ => _.toNumber());
    const [reserve0] = await pair.getReserves({
      blockTag: ETH_SNAPSHOT_BLOCK
    });
    console.log("uniswap pair data:", { reserve0, pairTotalSupply });

    //TODO: read supplier balance at snapshot
    const { liquidityPositions } = await request(
      "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2",
      query
    );

    const gdHoldings = liquidityPositions.map(async pos => {
      const uAddress = pos.user.id.toLowerCase();

      const providerBalance = await pair.balanceOf(uAddress, {
        blockTag: ETH_SNAPSHOT_BLOCK
      });
      const share = providerBalance.toNumber() / pairTotalSupply;
      const gdShare = parseInt((share * reserve0).toFixed(0)); //parseInt((pos.pair.reserve0 * share * 100).toFixed(0)); //to G$ cents
      const isNotContract = get(
        addresses,
        `${uAddress}.isNotContract`,
        (await gdMainnet.provider.getCode(uAddress).catch(e => "0x")) === "0x"
      );
      const newBalance = get(addresses, `${uAddress}.balance`, 0) + gdShare;
      console.log("uniswap position:", {
        pos,
        newBalance,
        uAddress,
        share,
        gdShare
      });
      addresses[uAddress] = updateBalance(addresses[uAddress], {
        balance: newBalance,
        isNotContract
      });

      return [uAddress, gdShare];
    });
    await Promise.all(gdHoldings);
    return addresses;
  };

  const getFuseSwapBalances = async (
    graphqlUrl,
    tokenId,
    addresses: Balances = {}
  ) => {
    const _calcHoldings = async (pair, addresses: Balances = {}) => {
      const { liquidityPositions, reserve0: isReserve0, id } = pair;
      let pairContract = await ethers.getContractAt("UniswapPair", id);
      pairContract = pairContract.connect(fuseArchiveProvider);

      try {
        const pairTotalSupply = await pairContract
          .totalSupply({
            blockTag: FUSE_SNAPSHOT_BLOCK
          })
          .then(_ => _.toNumber());
        const [reserve0, reserve1] = await pairContract.getReserves({
          blockTag: FUSE_SNAPSHOT_BLOCK
        });

        const reserve = isReserve0 ? reserve0.toNumber() : reserve1.toNumber();

        console.log("fuseswap pair data:", {
          id,
          reserve0,
          reserve1,
          pairTotalSupply
        });

        liquidityPositions.map(async pos => {
          const uAddress = pos.user.id.toLowerCase();

          const providerBalance = await pairContract.balanceOf(uAddress, {
            blockTag: FUSE_SNAPSHOT_BLOCK
          });

          const share = providerBalance.toNumber() / pairTotalSupply;
          const gdShare = parseInt((share * reserve).toFixed(0));
          if (gdShare > 0) {
            console.log("liquidity provider:", {
              uAddress,
              pair: id,
              share,
              gdShare,
              reserve: reserve
            });

            const newBalance =
              get(addresses, `${uAddress}.balance`, 0) + gdShare;

            addresses[uAddress] = updateBalance(addresses[uAddress], {
              balance: newBalance
            });
          }
        });
      } catch (e) {
        console.error("failed fuseswap pair", id, e);
        return;
      }
    };

    const query = gql`
      {
        t0: pairs(
          where: {
            token0: "${tokenId}"
            reserve0_gt: 1
          }
        ) {
          id
          reserve0
          totalSupply
          liquidityPositions(where: { liquidityTokenBalance_gt: 0 }) {
            user {
              id
            }
            liquidityTokenBalance
          }
        }

        t1: pairs(
          where: {
            token1: "${tokenId}"
            reserve1_gt: 1
          }
        ) {
          id
          reserve1
          totalSupply
          liquidityPositions(where: { liquidityTokenBalance_gt: 0 }) {
            user {
              id
            }
            liquidityTokenBalance
            pair {
              totalSupply
            }
          }
        }
      }
    `;

    const { t0, t1 } = await request(graphqlUrl, query);
    const t0Promises = t0.map(pair => {
      return _calcHoldings(pair, addresses);
    });

    const t1Promises = t1.map(pair => {
      return _calcHoldings(pair, addresses);
    });

    await Promise.all([...t0Promises, ...t1Promises]);
    //get liquidity miners for 0x04Ee5DE43332aF99eeC2D40de19962AA1cC583EC, fuse G$ liquidity farmin rewards
    const staked = await usdcgdYieldFarming.queryFilter(
      usdcgdYieldFarming.filters.Staked(),
      10560021,
      FUSE_SNAPSHOT_BLOCK
    );
    const [totalStaked, ,] = await usdcgdYieldFarming.interestData({
      blockTag: FUSE_SNAPSHOT_BLOCK
    });

    const farmers = {};
    const yieldFarmingRep =
      addresses[usdcgdYieldFarming.address.toLowerCase()]?.balance || 0;
    if (yieldFarmingRep > 0) {
      await Promise.all(
        staked.map(async e => {
          const [balance] = await usdcgdYieldFarming.getStakerData(
            e.args.staker,
            { blockTag: FUSE_SNAPSHOT_BLOCK }
          );

          if (balance > 0) {
            const share = balance.toNumber() / totalStaked.toNumber();
            const uAddress = e.args.staker;
            const repShare = parseInt((share * yieldFarmingRep).toFixed(0));
            farmers[uAddress] = [share, repShare];
            const newBalance =
              get(addresses, `${uAddress}.balance`, 0) +
              share * yieldFarmingRep;

            addresses[uAddress] = updateBalance(addresses[uAddress], {
              balance: newBalance
            });
          }
        })
      );
      console.log("got fuseswap yield farmers:", {
        farmers,
        contract: usdcgdYieldFarming.address.toLowerCase(),
        yieldFarmingRep,
        totalStaked: totalStaked.toNumber(),
        totalFarmers: Object.values(farmers).length,
        totalShares: Object.values(farmers)
          .map(_ => _[0])
          .reduceRight((x: number, y: number) => x + y)
      });

      //dont send rep to the yield farming contract
      delete addresses[usdcgdYieldFarming.address.toLowerCase()];
    }

    return addresses;
  };

  const getBlockScoutHolders = async (addresses: Balances = {}) => {
    let initialUrl = `https://explorer.fuse.io/tokens/${gd.address}/token-holders?type=JSON`;
    const queue = new PromiseQueue(30);
    let analyzedPages = 0;
    let analyzedBalances = 0;
    let failedAccounts = [];

    const fetchBalances = async foundBalances => {
      const ps = foundBalances
        .filter(b => isSystemContract(b[0]) === false)
        .map(async b => {
          const uAddress = b[0].toLowerCase();
          const curBalance = get(addresses, `${uAddress}.balance`, 0);
          const isNotContract = get(
            addresses,
            `${uAddress}.isNotContract`,
            (await gd.provider.getCode(b[0]).catch(e => "0x")) === "0x"
          );
          const cleanBalance = await gd
            .balanceOf(uAddress, { blockTag: FUSE_SNAPSHOT_BLOCK })
            .catch(e =>
              gd.balanceOf(uAddress, {
                blockTag: FUSE_SNAPSHOT_BLOCK
              })
            )
            .then(_ => _.toNumber())
            .catch(e => failedAccounts.push(uAddress));
          // const cleanBalance = parseFloat(b[3].replace(/[,G$\s]/g, "")) * 100; //in G$ cents
          addresses[uAddress] = updateBalance(addresses[uAddress], {
            balance: curBalance + cleanBalance,
            isNotContract
          });
        });
      await Promise.all(ps);
    };

    const analyzeUrl = async url => {
      console.log("fetching:", url);
      const { items, next_page_path } = await fetch(url).then(_ => _.json());
      if (next_page_path) {
        let [, path] = next_page_path.match(/\?(.*$)/);
        const params = path + "&type=JSON";
        let nextUrl = `https://explorer.fuse.io/tokens/${gd.address}/token-holders?${params}`;
        queue.add(() => analyzeUrl(nextUrl));
      }

      if (items && items.length) {
        const foundBalances = items.map(i =>
          i.match(/(0x\w{20,})|([0-9\.,]+ G\$)/g)
        );
        analyzedPages++;
        analyzedBalances += foundBalances.length;
        await fetchBalances(foundBalances);
      }
      console.log("fetched:", { url, next_page_path });
    };

    queue.add(() => analyzeUrl(initialUrl));
    while (true) {
      console.log("waiting for queue:", queue.pendingPromises, {
        queued: queue.queue.length,
        analyzedBalances,
        analyzedPages
      });
      if (queue.pendingPromises === 0) {
        break;
      }
      await new Promise(res => setTimeout(res, 5000));
    }
    console.log("refetching fuse balances failed:", failedAccounts.length);
    await fetchBalances(failedAccounts);
  };

  const getEthPlorerHolders = async (addresses: Balances = {}) => {
    let nextUrl = `https://api.ethplorer.io/getTopTokenHolders/${gdMainnet.address}?limit=1000&apiKey=${ethplorer_key}`;

    const { holders } = await fetch(nextUrl).then(_ => _.json());
    console.log("getEthplorerHolders got holders:", { holders });
    let failedAccounts = [];

    const _fetchBalances = holders => {
      const ps: Array<Promise<any>> = holders
        .filter(address => isSystemContract(address) === false)
        .map(async address => {
          const uAddress = address.toLowerCase();
          const cleanBalance = await gdMainnet
            .balanceOf(uAddress, { blockTag: ETH_SNAPSHOT_BLOCK })
            .catch(e =>
              gdMainnet.balanceOf(uAddress, {
                blockTag: ETH_SNAPSHOT_BLOCK
              })
            )
            .then(_ => _.toNumber())
            .catch(e => failedAccounts.push(uAddress));

          const newBalance =
            get(addresses, `${uAddress}.balance`, 0) + cleanBalance;
          const isNotContract = get(
            addresses,
            `${uAddress}.isNotContract`,
            (await gdMainnet.provider.getCode(uAddress).catch(e => "0x")) ===
              "0x"
          );
          addresses[uAddress] = updateBalance(addresses[uAddress], {
            balance: newBalance,
            isNotContract
          });
        });
      return ps;
    };
    console.log("getEthplorerHolders fetching snapshot balances...");

    await Promise.all(_fetchBalances(holders.map(_ => _.address)));

    console.log("refetching eth balances failed:", failedAccounts.length);
    await Promise.all(_fetchBalances(failedAccounts));

    return addresses;
  };

  const getClaimsPerAddress = async (
    balances: Balances = {},
    ubiContract = ubi
  ) => {
    const latestBlock = FUSE_SNAPSHOT_BLOCK; //await ubiContract.provider.getBlockNumber();
    const blocks = range(6400000, latestBlock, step);
    const filter = ubiContract.filters.UBIClaimed();
    for (let blockChunk of chunk(blocks, 10)) {
      // Get the filter (the second null could be omitted)
      const ps = blockChunk.map(async bc => {
        // Query the filter (the latest could be omitted)
        const logs = await ubiContract
          .queryFilter(filter, bc, Math.min(bc + step - 1, latestBlock))
          .catch(e => {
            console.log("block ubiclaimed logs failed retrying...", bc);
            return ubiContract.queryFilter(
              filter,
              bc,
              Math.min(bc + step - 1, latestBlock)
            );
          });
        console.log("found claim logs in block:", { bc }, logs.length);
        // Print out all the values:
        logs.map(log => {
          const uAddress = log.args.from.toLowerCase();
          const claims = get(uAddress, "claims", 0) + 1;
          balances[uAddress] = updateBalance(balances[uAddress], {
            claims
          });
        });
      });
      await Promise.all(ps);
    }
    return balances;
  };

  const calcRelativeRep = (balances: Balances) => {
    const totalSupply = Object.values(balances).reduce(
      (cur, data) => cur + data.balance,
      0
    );
    const totalClaims = Object.values(balances).reduce(
      (cur, data) => cur + (data.claims || 0),
      0
    );

    for (let addr in balances) {
      balances[addr].gdRepShare =
        totalSupply > 0 ? balances[addr].balance / totalSupply : 0;
      balances[addr].claimRepShare =
        totalClaims > 0 ? balances[addr].claims / totalClaims : 0;
    }
    return { totalSupply, totalClaims, balances };
  };

  const collectAirdropData = async (fuseBlock, ethBlock) => {
    FUSE_SNAPSHOT_BLOCK = parseInt(
      fuseBlock || (await fuseArchiveProvider.getBlockNumber())
    );
    ETH_SNAPSHOT_BLOCK = parseInt(
      ethBlock || (await poktArchiveProvider.getBlockNumber())
    );

    console.log({
      FUSE_SNAPSHOT_BLOCK,
      ETH_SNAPSHOT_BLOCK,
      GD_FUSE,
      GD_MAINNET,
      DAI
    });
    const ps = [];

    ps[0] = getFuseSwapBalances(
      "https://graph.fuse.io/subgraphs/name/fuseio/fuseswap",
      GD_FUSE
    ).then(r => fs.writeFileSync("fuseswapBalances.json", JSON.stringify(r)));
    ps[1] = getUniswapBalances().then(r =>
      fs.writeFileSync("uniswapBalances.json", JSON.stringify(r))
    );
    ps[2] = getClaimsPerAddress()
      .then(r => getClaimsPerAddress(r, ubinew))
      .then(r => fs.writeFileSync("claimBalances.json", JSON.stringify(r)));
    ps[3] = getEthPlorerHolders().then(r =>
      fs.writeFileSync("ethBalances.json", JSON.stringify(r))
    );
    ps[4] = getBlockScoutHolders().then(r =>
      fs.writeFileSync("fuseBalances.json", JSON.stringify(r))
    );
    ps[5] = getStakersBalance().then(r =>
      fs.writeFileSync("stakersBalances.json", JSON.stringify(r))
    );
    await Promise.all(ps);
  };

  const buildMerkleTree = () => {
    // const files = ["test/testnetBalances.json"].map(f =>
    //   JSON.parse(fs.readFileSync(f).toString())
    // );
    const files = [
      "claimBalances.json",
      "ethBalances.json",
      "fuseBalances.json",
      "uniswapBalances.json",
      "fuseswapBalances.json",
      "stakersBalances.json"
    ].map(f => JSON.parse(fs.readFileSync(f).toString()));

    const merge = (obj1, obj2, key) => {
      obj1 = { ...DefaultBalance, ...obj1 };
      obj1.claims = get(obj1, "claims", 0) + get(obj2, "claims", 0);
      obj1.balance = get(obj1, "balance", 0) + get(obj2, "balance", 0);
      obj1.stake = get(obj1, "stake", 0) + get(obj2, "stake", 0);
      obj1.stakeRepShare =
        get(obj1, "stakeRepShare") || get(obj2, "stakeRepShare", 0);
      obj1.isNotContract = get(
        obj1,
        "isNotContract",
        get(obj2, "isNotContract")
      );
      return obj1;
    };

    const data: Balances = mergeWith(files[0], ...files.slice(1), merge);

    let { totalSupply, totalClaims, balances } = calcRelativeRep(data);

    const CLAIMER_REP_ALLOCATION = 48000000;
    const HOLDER_REP_ALLOCATION = 24000000;
    const STAKER_REP_ALLOCATION = 24000000;

    let toTree: Array<[string, number, boolean]> = Object.entries(balances).map(
      ([addr, data]) => {
        let rep =
          data.claimRepShare * CLAIMER_REP_ALLOCATION +
          data.gdRepShare * HOLDER_REP_ALLOCATION +
          data.stakeRepShare * STAKER_REP_ALLOCATION;

        return [addr, rep, data.isNotContract];
      }
    );
    toTree = sortBy(toTree, "1")
      .reverse()
      .filter(x => x[1] > 0);

    console.log({ toTree });
    const topContracts = toTree.filter(_ => _[2] === false);
    const totalReputationAirdrop = toTree.reduce((c, a) => c + a[1], 0);
    console.log({
      topContracts,
      totalReputationAirdrop,
      numberOfAccounts: toTree.length,
      totalGDSupply: totalSupply,
      totalClaims
    });

    const sorted = toTree.map(_ => _[1]);
    fs.writeFileSync("reptree.json", JSON.stringify(toTree));
    console.log("Reputation Distribution\nFoundation: 33%");
    [0.001, 0.01, 0.1, 0.5].forEach(q =>
      console.log({
        precentile: q * 100 + "%",
        rep:
          quantile(sorted, q) /
          (CLAIMER_REP_ALLOCATION +
            HOLDER_REP_ALLOCATION +
            STAKER_REP_ALLOCATION)
      })
    );

    const treeData = {};
    const elements = toTree.map(e => {
      const repInWei = (e[1] * 1e18)
        .toLocaleString("fullwide", {
          useGrouping: false
        })
        .split(".")[0];
      const hash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [e[0], repInWei]
        )
      );
      treeData[e[0]] = {
        rep: repInWei,
        hash
      };
      return Buffer.from(hash.slice(2), "hex");
    });

    const merkleTree = new MerkleTree(elements, true);
    // get the merkle root
    // returns 32 byte buffer
    const merkleRoot = merkleTree.getRoot().toString("hex");
    // generate merkle proof
    // returns array of 32 byte buffers
    const proof = merkleTree.getProof(elements[0]).map(_ => _.toString("hex"));
    console.log({ merkleRoot, proof, sampleProofFor: toTree[50] });
    fs.writeFileSync("airdrop.json", JSON.stringify({ treeData, merkleRoot }));
  };

  const getProof = addr => {
    const { treeData, merkleRoot } = JSON.parse(
      fs.readFileSync("airdrop.json").toString()
    );

    const elements = Object.entries(treeData as Tree).map(e =>
      Buffer.from(e[1].hash.slice(2), "hex")
    );

    const merkleTree = new MerkleTree(elements, true);
    const proof = merkleTree
      .getProof(Buffer.from(treeData[addr].hash.slice(2), "hex"))
      .map(_ => "0x" + _.toString("hex"));
    console.log({ proof, [addr]: treeData[addr] });
  };

  return { buildMerkleTree, collectAirdropData, getProof };
};
