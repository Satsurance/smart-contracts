// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

const INITIAL_SUPPLY = ethers.parseUnits("2000", "ether").toString();
const WBTC_INITIAL_SUPPLY = ethers.parseUnits("51000000", "ether").toString();
const MIN_TIMELOCK_DELAY = 24 * 60 * 60;
const PROPOSER_ROLE_ID = ethers.solidityPackedKeccak256(
  ["string"],
  ["PROPOSER_ROLE"]
);

exports.InsuranceSetup = buildModule("InsuranceContracts", (m) => {
  const initialSupply = m.getParameter("initialSupply", INITIAL_SUPPLY);
  const wbtcInitialSupply = m.getParameter(
    "wbtcInitialSupply",
    WBTC_INITIAL_SUPPLY
  );
  // Mock Btc token
  let btcToken = m.contract("BTCToken", [wbtcInitialSupply]);

  // Deploy upgradable token
  let sursTokenLogic = m.contract("SursToken", [], { id: "sursTokenLogic" });
  let sursTokenProxy = m.contract(
    "ERC1967Proxy",
    [
      sursTokenLogic,
      m.encodeFunctionCall(sursTokenLogic, "initialize", [initialSupply]),
    ],
    { id: "SursTokenProxy" }
  );

  let timelock = m.contract("Timelock", [
    MIN_TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
  ]);
  let governor_c = m.contract("SatsuranceGovernor", [sursTokenProxy, timelock]);
  m.call(timelock, "grantRole", [PROPOSER_ROLE_ID, governor_c]);

  // Deploy upgradable Insurance Pool
  let insurancePoolLogic = m.contract("InsurancePool", [], {
    id: "insurancePoolLogic",
  });
  let insurancePoolProxy = m.contract(
    "ERC1967Proxy",
    [
      insurancePoolLogic,
      m.encodeFunctionCall(insurancePoolLogic, "initialize", [
        timelock,
        btcToken,
        m.getAccount(0),
      ]),
    ],
    { id: "InsurancePoolProxy" }
  );

  // Set logic abi to proxies
  const insurancePool = m.contractAt("InsurancePool", insurancePoolProxy);
  const sursToken = m.contractAt("SursToken", sursTokenProxy);
  m.call(sursToken, "transferOwnership", [timelock]);

  return { btcToken, sursToken, insurancePool, governor_c, timelock };
});
