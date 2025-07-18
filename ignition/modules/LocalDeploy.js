const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");
const InsuranceSetup = require("./Insurance");
const { EPISODE_DURATION } = require("../../test/constants");
const { findClosestStakableEpisodeParams } = require("../../test/helpers");

const BIG_STAKER_ADDR = "0xe63b611C72e046e5FA05C3EaA972F2bbD6E9a1CB";
const POOL_OWNER_ADDR = "0xe1a5328f489C261410563a08a92f1FFdfF045407";
const FAUCET_ADDR = "0x7F21b4286ed33a09dD44e3068b524e759511dA76";

module.exports = buildModule("LocalDeploy", (m) => {
  const { btcToken, insurancePool } = m.useModule(InsuranceSetup);
  m.call(btcToken, "approve", [
    insurancePool,
    ethers.parseUnits("200", "ether").toString(),
  ]);
  m.call(btcToken, "transfer", [
    m.getAccount(1),
    ethers.parseUnits("100", "ether").toString(),
  ]);
  m.call(btcToken, "transfer", [
    m.getAccount(2),
    ethers.parseUnits("100", "ether").toString(),
  ], { id: "transferBtcToUser" });
  m.call(btcToken, "approve", [
    insurancePool,
    ethers.parseUnits("100", "ether").toString(),
  ], { from: m.getAccount(1), id: "underwriterApprove" });
  m.call(
    insurancePool,
    "createProduct",
    ["Basic Coverage", 1000, 365 * 24 * 60 * 60, 10000],
    { from: m.getAccount(1), id: "createProduct" }
  );

  const stakeEpisodeOffset = 23n;
  const currentTime = BigInt(Math.floor(Date.now() / 1000));
  const currentEpisode = currentTime / EPISODE_DURATION;
  const episodeToStake = findClosestStakableEpisodeParams(currentEpisode, stakeEpisodeOffset);

  const joinPool = m.call(
    insurancePool,
    "joinPool",
    [ethers.parseUnits("10", "ether").toString(), episodeToStake],
    { from: m.getAccount(1), id: "underwriterJoin" }
  );

  m.call(
    insurancePool,
    "purchaseCover",
    [
      0,
      m.getAccount(0),
      365 * 24 * 60 * 60,
      ethers.parseUnits("9", "ether").toString(),
    ],
    { id: "purchaseCoverage", after: [joinPool] }
  );

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

  return { send1btc, send2btc, send3btc };
});
