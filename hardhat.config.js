require("@nomicfoundation/hardhat-toolbox");
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
    },
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
