const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

const INITIAL_SUPPLY = ethers.parseUnits("20000000000", "ether").toString();
const WBTC_INITIAL_SUPPLY = ethers.parseUnits("22000000", "ether").toString();
const MIN_TIMELOCK_DELAY = 24 * 60 * 60;
const PROPOSER_ROLE_ID = ethers.solidityPackedKeccak256(
  ["string"],
  ["PROPOSER_ROLE"]
);

// Constants for Claimer
const VOTING_PERIOD = 1 * 60 * 60; // 1 hour for test purposes

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

  // Deploy upgradable Insurance Pool (initially with zero address for claimer)
  let insurancePoolLogic = m.contract("InsurancePool", [], {
    id: "insurancePoolLogic",
  });
  let insurancePoolProxy = m.contract(
    "ERC1967Proxy",
    [
      insurancePoolLogic,
      m.encodeFunctionCall(insurancePoolLogic, "initialize", [
        m.getAccount(0),
        btcToken,
        m.getAccount(0),
        ethers.ZeroAddress, // temporary claimer address
      ]),
    ],
    { id: "InsurancePoolProxy" }
  );

  // Deploy upgradable Claimer
  let claimerLogic = m.contract("Claimer", [], {
    id: "claimerLogic",
  });
  let claimerProxy = m.contract(
    "ERC1967Proxy",
    [
      claimerLogic,
      m.encodeFunctionCall(claimerLogic, "initialize", [
        sursTokenProxy,
        insurancePoolProxy,
        VOTING_PERIOD,
      ]),
    ],
    { id: "ClaimerProxy" }
  );

  // Set Claimer address in InsurancePool
  const insurancePool = m.contractAt("InsurancePool", insurancePoolProxy);
  m.call(insurancePool, "updateClaimer", [claimerProxy]);
  m.call(insurancePool, "transferOwnership", [timelock]);

  // Set contract ABIs to proxies
  const sursToken = m.contractAt("SursToken", sursTokenProxy);
  const claimer = m.contractAt("Claimer", claimerProxy);

  // Transfer token ownership to timelock
  m.call(sursToken, "transferOwnership", [timelock]);

  return {
    btcToken,
    sursToken,
    insurancePool,
    governor_c,
    timelock,
    claimer,
  };
});

// module.exports = exports.InsuranceSetup;
