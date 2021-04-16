/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import { HardhatUserConfig } from "hardhat/types";
import "hardhat-typechain";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import { task, types } from "hardhat/config";
import { sha3 } from "web3-utils";
import { config } from "dotenv";
import { airdrop } from "./scripts/governance/airdropCalculation";
import { airdrop as gdxAirdrop } from "./scripts/gdx/gdxAirdropCalculation";
import "hardhat-gas-reporter";

config();

const mnemonic = process.env.MNEMONIC;
const infura_api = process.env.INFURA_API;
const alchemy_key = process.env.ALCHEMY_KEY;
const etherscan_key = process.env.ETHERSCAN_KEY;
const ethplorer_key = process.env.ETHPLORER_KEY;

console.log({ mnemonic: sha3(mnemonic) });
const hhconfig: HardhatUserConfig = {
  solidity: {
    version: "0.8.0",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  typechain: {
    outDir: "types"
  },
  etherscan: {
    apiKey: etherscan_key
  },
  networks: {
    ropsten: {
      accounts: { mnemonic },
      url: "https://ropsten.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 25000000000,
      chainId: 3
    },
    fuse: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 122
    },
    staging: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 122
    },
    production: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 122
    },
    "production-mainnet": {
      accounts: { mnemonic },
      url: "https://mainnet.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 25000000000,
      chainId: 1
    }
  },
  mocha: {
    timeout: 60000
  }
};

task("repAirdrop", "Calculates airdrop data and merkle tree")
  .addParam("action", "calculate/tree/proof")
  .addOptionalPositionalParam("address", "proof for address")
  .setAction(async (taskArgs, hre) => {
    const actions = airdrop(hre.ethers, ethplorer_key);
    switch (taskArgs.action) {
      case "calculate":
        return actions.collectAirdropData();
      case "tree":
        return actions.buildMerkleTree();
      case "proof":
        return actions.getProof(taskArgs.address);
      default:
        console.log("unknown action use calculate or tree");
    }
  });

task("gdxAirdrop", "Calculates airdrop data")
  .addParam("action", "calculate/tree/proof")
  .addOptionalPositionalParam("address", "proof for address")
  .setAction(async (taskArgs, hre) => {
    const actions = gdxAirdrop(hre.ethers);
    switch (taskArgs.action) {
      case "calculate":
        return actions.collectAirdropData();
      case "tree":
        return actions.buildMerkleTree();
      case "proof":
        return actions.getProof(taskArgs.address);
      default:
        console.log("unknown action use calculate or tree");
    }
  });

export default hhconfig;
