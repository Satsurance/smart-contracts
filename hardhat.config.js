require("@nomicfoundation/hardhat-toolbox");
require("hardhat-deploy");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  networks: {
    hardhat: {},
    bitlayer_testnet: {
      url: "https://rpc.ankr.com/bitlayer_testnet",
    },
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 20000,
      },
      viaIR: true,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0, // here this will by default take the first account as deployer
      bitlayer_testnet: process.env.DEPLOYER_ADDRESS || 0,
    },
    poolUnderwriter: {
      default: 1, // here this will by default take the second account
      bitlayer_testnet: process.env.POOL_UNDERWRITER_ADDRESS || 1,
    },
    protocolRewardsAddress: {
      default: 2, // here this will by default take the third account
      bitlayer_testnet: process.env.PROTOCOL_REWARDS_ADDRESS || 2,
    },
  },
  paths: {
    deploy: "deploy",
    deployments: "deployments",
  },
};

// Add private keys to bitlayer_testnet if they exist in .env
if (process.env.PRIVATE_KEY) {
  config.networks.bitlayer_testnet.accounts = [process.env.PRIVATE_KEY];
}

// Add API key to URL if it exists in .env
if (process.env.BITLAYER_API_KEY) {
  config.networks.bitlayer_testnet.url = `https://rpc.ankr.com/bitlayer_testnet/${process.env.BITLAYER_API_KEY}`;
}

module.exports = config;
