const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

const INITIAL_SUPPLY = ethers.parseUnits("20000000000", "ether").toString();
const WBTC_INITIAL_SUPPLY = ethers.parseUnits("22000000", "ether").toString();
const MIN_TIMELOCK_DELAY = 24 * 60 * 60;
const PROPOSER_ROLE_ID = ethers.solidityPackedKeccak256(
  ["string"],
  ["PROPOSER_ROLE"]
);

const InsuranceSetup = buildModule("InsuranceContracts", (m) => {
  const initialSupply = m.getParameter("initialSupply", INITIAL_SUPPLY);
  const wbtcInitialSupply = m.getParameter(
    "wbtcInitialSupply",
    WBTC_INITIAL_SUPPLY
  );
  const bonusPerEpisodeStaked = m.getParameter("bonusPerEpisodeStaked", 0);

  // Claimer parameters
  const claimerOwner = m.getParameter("claimerOwner", m.getAccount(0));
  const claimerOperatorManager = m.getParameter("claimerOperatorManager", m.getAccount(0));
  const claimerOperator = m.getParameter("claimerOperator", m.getAccount(0));
  const claimDeposit = m.getParameter("claimDeposit", 0);
  const approvalPeriod = m.getParameter("approvalPeriod", 3 * 7 * 24 * 60 * 60); // 3 weeks

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

  // Deploy InsurancePool implementation
  let insurancePoolLogic = m.contract("InsurancePool", [], {
    id: "insurancePoolLogic",
  });

  // Deploy InsurancePoolBeacon with the implementation
  let insurancePoolBeacon = m.contract("UpgradeableBeacon", [
    insurancePoolLogic,
    timelock, // timelock as beacon owner
  ]);

  // Deploy UriDescriptor
  let uriDescriptor = m.contract("UriDescriptor", []);

  // Deploy upgradable CoverNFT
  let coverNFTLogic = m.contract("CoverNFT", [], {
    id: "coverNFTLogic",
  });
  let coverNFTProxy = m.contract(
    "ERC1967Proxy",
    [
      coverNFTLogic,
      m.encodeFunctionCall(coverNFTLogic, "initialize", [
        m.getAccount(0), // owner (deployer for now)
        m.getAccount(0), // manager (deployer for now)
        uriDescriptor, // uriDescriptor address
      ]),
    ],
    { id: "CoverNFTProxy" }
  );
  const coverNFT = m.contractAt("CoverNFT", coverNFTProxy);

  // Deploy PoolFactory
  let poolFactory = m.contract("PoolFactory", [
    m.getAccount(0), // owner (deployer)
    m.getAccount(0), // operator (deployer for now)
    m.getAccount(2), // capitalPool (unused account for now)
    insurancePoolBeacon, // beacon address
    coverNFT, // coverNFT address
    1500, // 15% protocol fee
  ]);

  // Grant PoolFactory MANAGER_ROLE on CoverNFT to manage pool permissions
  const MANAGER_ROLE = m.staticCall(coverNFT, "MANAGER_ROLE", []);
  const DEFAULT_ADMIN_ROLE = m.staticCall(coverNFT, "DEFAULT_ADMIN_ROLE", []);
  m.call(coverNFT, "grantRole", [MANAGER_ROLE, poolFactory], { id: "coverNFT1" });
  m.call(coverNFT, "grantRole", [DEFAULT_ADMIN_ROLE, timelock], { id: "coverNFT2" });
  m.call(coverNFT, "revokeRole", [MANAGER_ROLE, m.getAccount(0)], { id: "coverNFT3" });
  const lastCoverNFTRoleTx = m.call(coverNFT, "revokeRole", [DEFAULT_ADMIN_ROLE, m.getAccount(0)], { id: "coverNFT4" });

  // Deploy upgradable Claimer
  let claimerLogic = m.contract("Claimer", [], {
    id: "claimerLogic",
  });
  let claimerProxy = m.contract(
    "ERC1967Proxy",
    [
      claimerLogic,
      m.encodeFunctionCall(claimerLogic, "initialize", [
        claimerOwner, // owner address
        claimerOperatorManager, // operatorManager address
        claimerOperator, // operator address
        claimDeposit, // claimDeposit amount
        btcToken, // depositToken address
        approvalPeriod, // approvalPeriod in seconds
      ]),
    ],
    { id: "ClaimerProxy" }
  );

  // Prepare initialization data for InsurancePool
  const initData = m.encodeFunctionCall(insurancePoolLogic, "initialize", [
    m.getAccount(1), // poolUnderwriter
    timelock, // governor (owner)
    btcToken,
    claimerProxy, // claimer address
    1000, // 10%
    bonusPerEpisodeStaked, // Bonus per episode staked
    true,
    1000, // 10% underwriter fee
  ]);

  // Create InsurancePool through factory
  const createPoolCall = m.call(poolFactory, "create", [initData], { after: [lastCoverNFTRoleTx] });

  // Get the created pool address and create contract instance
  const insurancePoolAddress = m.readEventArgument(
    createPoolCall,
    "PoolCreated",
    "poolAddress"
  );
  const insurancePool = m.contractAt("InsurancePool", insurancePoolAddress);

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
    poolFactory,
    insurancePoolBeacon,
    coverNFT,
    uriDescriptor,
  };
});

module.exports = InsuranceSetup;
