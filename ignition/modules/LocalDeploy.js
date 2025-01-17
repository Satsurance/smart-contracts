const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");
const InsuranceSetup = require("./Insurance");

const BIG_STAKER_ADDR = "0xe63b611C72e046e5FA05C3EaA972F2bbD6E9a1CB";
const POOL_OWNER_ADDR = "0xe1a5328f489C261410563a08a92f1FFdfF045407";
const FAUCET_ADDR = "0x7F21b4286ed33a09dD44e3068b524e759511dA76";

module.exports = buildModule("LocalDeploy", (m) => {
  const { btcToken, sursToken, insurancePool, governor_c, timelock } =
    m.useModule(InsuranceSetup);

  let coverPurchaser = m.contract("CoverPurchaser", [btcToken]);

  m.call(btcToken, "approve", [
    insurancePool,
    ethers.parseUnits("200", "ether").toString(),
  ]);
  m.call(insurancePool, "rewardPool", [
    ethers.parseUnits("1", "ether").toString(),
  ]);
  m.call(
    btcToken,
    "transfer",
    [BIG_STAKER_ADDR, ethers.parseUnits("200", "ether").toString()],
    { id: "transfer2Staker" }
  );
  m.call(
    btcToken,
    "transfer",
    [POOL_OWNER_ADDR, ethers.parseUnits("10", "ether").toString()],
    { id: "transfer2Owner" }
  );
  m.call(
    btcToken,
    "transfer",
    [FAUCET_ADDR, ethers.parseUnits("200", "ether").toString()],
    { id: "transfer2Faucet" }
  );

  m.call(
    sursToken,
    "transfer",
    [BIG_STAKER_ADDR, ethers.parseUnits("200", "ether").toString()],
    { id: "transferSurs2Staker" }
  );
  m.call(
    sursToken,
    "transfer",
    [POOL_OWNER_ADDR, ethers.parseUnits("200", "ether").toString()],
    { id: "transferSurs2Owner" }
  );
  m.call(
    sursToken,
    "transfer",
    [FAUCET_ADDR, ethers.parseUnits("200", "ether").toString()],
    { id: "transferSurs2Faucet" }
  );

  const send1btc = m.send(
    "Send2Staker",
    BIG_STAKER_ADDR,
    BigInt(ethers.parseUnits("10", "ether").toString())
  );
  const send2btc = m.send(
    "Send2Owner",
    POOL_OWNER_ADDR,
    BigInt(ethers.parseUnits("10", "ether").toString())
  );
  const send3btc = m.send(
    "Send2Faucet",
    FAUCET_ADDR,
    BigInt(ethers.parseUnits("10", "ether").toString())
  );

  return { coverPurchaser };
});
