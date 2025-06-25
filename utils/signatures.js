const { ethers } = require("hardhat");

const DOMAIN_NAME = "Insurance Pool";
const DOMAIN_VERSION = "1";
const POOL_FACTORY_DOMAIN_NAME = "PoolFactory";
const POOL_FACTORY_DOMAIN_VERSION = "1";

async function signUnstakeRequest(signer, contractAddress, params) {
  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: params.chainId,
    verifyingContract: contractAddress,
  };

  const types = {
    UnstakeRequest: [
      { name: "user", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    user: params.user,
    positionId: params.positionId,
    deadline: params.deadline,
  };

  const signature = await signer.signTypedData(domain, types, value);
  return ethers.Signature.from(signature);
}

async function signCoveragePurchase(signer, contractAddress, params) {
  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: params.chainId,
    verifyingContract: contractAddress,
  };

  const types = {
    PurchaseCoverageRequest: [
      { name: "coverId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "coverAmount", type: "uint256" },
      { name: "purchaseAmount", type: "uint256" },
      { name: "startDate", type: "uint256" },
      { name: "endDate", type: "uint256" },
      { name: "description", type: "string" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    coverId: params.coverId,
    account: params.account,
    coverAmount: params.coverAmount,
    purchaseAmount: params.purchaseAmount,
    startDate: params.startDate,
    endDate: params.endDate,
    description: params.description,
    deadline: params.deadline,
  };

  const signature = await signer.signTypedData(domain, types, value);
  return ethers.Signature.from(signature);
}

async function signCreatePool(signer, contractAddress, params) {
  const domain = {
    name: POOL_FACTORY_DOMAIN_NAME,
    version: POOL_FACTORY_DOMAIN_VERSION,
    chainId: params.chainId,
    verifyingContract: contractAddress,
  };

  const types = {
    CreatePool: [
      { name: "poolInitData", type: "bytes" },
      { name: "deadline", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  const value = {
    poolInitData: params.poolInitData,
    deadline: params.deadline,
    nonce: params.nonce,
  };

  const signature = await signer.signTypedData(domain, types, value);
  return ethers.Signature.from(signature);
}

module.exports = {
  signUnstakeRequest,
  signCoveragePurchase,
  signCreatePool,
  DOMAIN_NAME,
  DOMAIN_VERSION,
  POOL_FACTORY_DOMAIN_NAME,
  POOL_FACTORY_DOMAIN_VERSION,
};
