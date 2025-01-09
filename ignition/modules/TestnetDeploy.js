const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");
const InsuranceSetup = require("./Insurance");

module.exports = buildModule("LocalDeploy", (m) => {
  const { btcToken, sursToken, insurancePool, governor_c, timelock } =
    m.useModule(InsuranceSetup);
  m.call(btcToken, "approve", [
    insurancePool,
    ethers.parseUnits("20000", "ether").toString(),
  ]);
  m.call(insurancePool, "rewardPool", [
    ethers.parseUnits("20", "ether").toString(),
  ]);

  return {};
});
