require("@nomicfoundation/hardhat-toolbox");
require("hardhat-deploy");
require("dotenv").config(); // Fixed: removed incorrect path, now looks for .env by default
require("@midl-xyz/hardhat-deploy");
const { MempoolSpaceProvider } = require("@midl-xyz/midl-js-core");

const walletsPaths = {
  leather: "m/86'/1'/0'/0/0"
}


const config = {
  networks: {
    default: {
      url: "https://rpc.regtest.midl.xyz",
      accounts: {
        mnemonic: process.env.LEATHER_MNEMONIC,
        path: walletsPaths.leather
      },
      chainId: 777
    },
  },
  midl: {
    path: "deployments",
    networks: {
      default: {
        mnemonic: process.env.LEATHER_MNEMONIC,
        confirmationsRequired: 1,
        btcConfirmationsRequired: 1,
        hardhatNetwork: "default",
        network: {
          explorerUrl: "https://mempool.regtest.midl.xyz",
          id: "regtest",
          network: "regtest"
        },
        provider: new MempoolSpaceProvider({
          "regtest": "https://mempool.regtest.midl.xyz",
        })

      }
    }


  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    poolUnderwriter: {
      default: 1,
    },
    protocolRewardsAddress: {
      default: 2,
    }
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
}

module.exports = config
