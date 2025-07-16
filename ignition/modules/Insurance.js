const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

const InsuranceSetup = buildModule("InsuranceContracts", (m) => {
  // Token supply parameters
  const wbtcInitialSupply = m.getParameter("wbtcInitialSupply", ethers.parseUnits("22000000", "ether").toString());

  // Timelock parameters
  const minTimelockDelay = m.getParameter("minTimelockDelay", 24 * 60 * 60); // 1 day

  // Fee parameters
  const protocolFee = m.getParameter("protocolFee", 1500); // 15%
  const underwriterFee = m.getParameter("underwriterFee", 1000); // 10%
  const minimalUnderwriterStake = m.getParameter("minimalUnderwriterStake", 1000);
  const underwriterFirstLoss = m.getParameter("underwriterFirstLoss", 0); // Default to 0

  // Staking parameters
  const bonusPerEpisodeStaked = m.getParameter("bonusPerEpisodeStaked", 0);

  // Claimer parameters
  const claimerOwner = m.getParameter("claimerOwner", m.getAccount(0));
  const claimerOperatorManager = m.getParameter("claimerOperatorManager", m.getAccount(0));
  const claimerOperator = m.getParameter("claimerOperator", m.getAccount(0));
  const claimDeposit = m.getParameter("claimDeposit", 0);
  const approvalPeriod = m.getParameter("approvalPeriod", 3 * 7 * 24 * 60 * 60); // 3 weeks
  const executionTimeout = m.getParameter("executionTimeout", 7 * 24 * 60 * 60); // 1 week
  const claimReduction = m.getParameter("claimReduction", 0); // Default to 0% reduction (0 basis points)

  // Account parameters
  const poolUnderwriter = m.getParameter("poolUnderwriter", m.getAccount(1));
  const protocolRewardsAddress = m.getParameter("protocolRewardsAddress", m.getAccount(2));
  const owner = m.getParameter("owner", m.getAccount(0));
  const manager = m.getParameter("manager", m.getAccount(0));
  const operator = m.getParameter("operator", m.getAccount(0));
  const guardian = m.getParameter("guardian", m.getAccount(0));

  // ControlBoard parameters
  const controlBoardController = m.getParameter("controlBoardController", m.getAccount(0));
  const controlBoardThreshold = m.getParameter("controlBoardThreshold", 1);

  // Mock Btc token
  let btcToken = m.contract("BTCToken", [wbtcInitialSupply]);

  // Deploy ControlBoard
  let controlBoard = m.contract("ControlBoard", [
    [controlBoardController], // array of initial controllers
    controlBoardThreshold,    // threshold
  ]);

  let timelock = m.contract("Timelock", [
    minTimelockDelay,
    [], // proposers - empty array allows anybody to propose
    [controlBoard], // executors - ControlBoard can execute
  ]);

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
  let coverDescriptor = m.contract("CoverDescriptor", []);
  let positionDescriptor = m.contract("PositionDescriptor", []);

  // Deploy upgradable CapitalPool first (before PoolFactory)
  let capitalPoolLogic = m.contract("CapitalPool", [], {
    id: "capitalPoolLogic",
  });
  let capitalPoolProxy = m.contract(
    "ERC1967Proxy",
    [
      capitalPoolLogic,
      m.encodeFunctionCall(capitalPoolLogic, "initialize", [
        "0x0000000000000000000000000000000000000000" // poolFactory placeholder
      ]),
    ],
    { id: "CapitalPoolProxy" }
  );
  const capitalPool = m.contractAt("CapitalPool", capitalPoolProxy);

  // Deploy upgradable CoverNFT
  let coverNFTLogic = m.contract("CoverNFT", [], {
    id: "coverNFTLogic",
  });
  let coverNFTProxy = m.contract(
    "ERC1967Proxy",
    [
      coverNFTLogic,
      m.encodeFunctionCall(coverNFTLogic, "initialize", [
        owner, // owner (deployer for now)
        manager, // manager (deployer for now)
        coverDescriptor, // uriDescriptor address
      ]),
    ],
    { id: "CoverNFTProxy" }
  );
  const coverNFT = m.contractAt("CoverNFT", coverNFTProxy);

  // Deploy ProtocolSettings (without positionNFT)
  let protocolSettingsLogic = m.contract("ProtocolSettings", [], {
    id: "protocolSettingsLogic",
  });
  let protocolSettingsProxy = m.contract(
    "ERC1967Proxy",
    [
      protocolSettingsLogic,
      m.encodeFunctionCall(protocolSettingsLogic, "initialize", [
        owner,
        operator,
        protocolRewardsAddress,
        capitalPool,
        insurancePoolBeacon,
        coverNFT,
        "0x0000000000000000000000000000000000000000",
        guardian,
        protocolFee,
      ]),
    ],
    { id: "ProtocolSettingsProxy" }
  );
  const protocolSettings = m.contractAt(
    "ProtocolSettings",
    protocolSettingsProxy
  );

  // Deploy upgradable PoolFactory
  let poolFactoryLogic = m.contract("PoolFactory", [], {
    id: "poolFactoryLogic",
  });
  let poolFactoryProxy = m.contract(
    "ERC1967Proxy",
    [
      poolFactoryLogic,
      m.encodeFunctionCall(poolFactoryLogic, "initialize", [
        owner,
        operator,
        protocolSettings,
      ]),
    ],
    { id: "PoolFactoryProxy" }
  );
  const poolFactory = m.contractAt("PoolFactory", poolFactoryProxy);

  // Update CapitalPool with the actual PoolFactory address
  const setPoolFactoryCall = m.call(capitalPool, "setPoolFactory", [poolFactory]);
  const updateGlobalSettingsCall = m.call(capitalPool, "updateGlobalSettings", [], { after: [setPoolFactoryCall] });

  // Deploy upgradable PositionNFT
  let positionNFTLogic = m.contract("PositionNFT", [], {
    id: "positionNFTLogic",
  });

  // Now deploy PositionNFT with poolFactory address
  let positionNFTProxy = m.contract(
    "ERC1967Proxy",
    [
      positionNFTLogic,
      m.encodeFunctionCall(positionNFTLogic, "initialize", [
        poolFactory, // poolFactory address
        owner, // owner (deployer for now)
        manager, // manager (deployer for now)
        positionDescriptor, // uriDescriptor address
      ]),
    ],
    { id: "PositionNFTProxy" }
  );
  const positionNFT = m.contractAt("PositionNFT", positionNFTProxy);

  // Update protocolSettings with the positionNFT address
  const setPositionNFTCall = m.call(protocolSettings, "setPositionNFT", [positionNFT]);

  // Grant PoolFactory MANAGER_ROLE on CoverNFT to manage pool permissions
  const MANAGER_ROLE = m.staticCall(coverNFT, "MANAGER_ROLE", []);
  const DEFAULT_ADMIN_ROLE = m.staticCall(coverNFT, "DEFAULT_ADMIN_ROLE", []);
  const cc1 = m.call(coverNFT, "grantRole", [MANAGER_ROLE, poolFactory], { id: "coverNFT1" });
  const cc2 = m.call(coverNFT, "grantRole", [DEFAULT_ADMIN_ROLE, timelock], { id: "coverNFT2" });
  const cc3 = m.call(coverNFT, "revokeRole", [MANAGER_ROLE, owner], { id: "coverNFT3" });
  const lastCoverNFTRoleTx = m.call(coverNFT, "revokeRole", [DEFAULT_ADMIN_ROLE, owner], { id: "coverNFT4", after: [cc1, cc2, cc3] });

  // Grant PoolFactory MANAGER_ROLE on PositionNFT to manage pool permissions
  const POSITION_MANAGER_ROLE = m.staticCall(positionNFT, "MANAGER_ROLE", []);
  const POSITION_DEFAULT_ADMIN_ROLE = m.staticCall(positionNFT, "DEFAULT_ADMIN_ROLE", []);
  const pc1 = m.call(positionNFT, "grantRole", [POSITION_MANAGER_ROLE, poolFactory], { id: "positionNFT1", after: [setPositionNFTCall] });
  const pc2 = m.call(positionNFT, "grantRole", [POSITION_DEFAULT_ADMIN_ROLE, timelock], { id: "positionNFT2", after: [setPositionNFTCall] });
  const pc3 = m.call(positionNFT, "revokeRole", [POSITION_MANAGER_ROLE, owner], { id: "positionNFT3" });
  const lastPositionNFTRoleTx = m.call(positionNFT, "revokeRole", [POSITION_DEFAULT_ADMIN_ROLE, owner], { id: "positionNFT4", after: [pc1, pc2, pc3] });

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
        executionTimeout, // executionTimeout in seconds
        claimReduction, // claimReduction in basis points
      ]),
    ],
    { id: "ClaimerProxy" }
  );

  // Prepare initialization data for InsurancePool
  const initData = m.encodeFunctionCall(insurancePoolLogic, "initialize", [
    poolUnderwriter, // poolUnderwriter
    timelock, // governor (owner)
    btcToken,
    claimerProxy, // claimer address
    minimalUnderwriterStake, // minimal underwriter stake
    bonusPerEpisodeStaked, // Bonus per episode staked
    true,
    underwriterFee, // underwriter fee
    underwriterFirstLoss, // underwriter first loss
  ]);

  // Create InsurancePool through factory
  const createPoolCall = m.call(poolFactory, "create", [initData], { after: [lastCoverNFTRoleTx, lastPositionNFTRoleTx] });

  // Get the created pool address and create contract instance
  const insurancePoolAddress = m.readEventArgument(
    createPoolCall,
    "PoolCreated",
    "poolAddress"
  );
  const insurancePool = m.contractAt("InsurancePool", insurancePoolAddress);

  // Set contract ABIs to proxies
  const claimer = m.contractAt("Claimer", claimerProxy);

  // Grant ControlBoard OPERATOR_ROLE in Claimer to allow claim approvals
  const OPERATOR_ROLE = m.staticCall(claimer, "OPERATOR_ROLE", []);
  m.call(claimer, "grantRole", [OPERATOR_ROLE, controlBoard]);

  return {
    btcToken,
    insurancePool,
    timelock,
    claimer,
    poolFactory,
    protocolSettings,
    capitalPool,
    insurancePoolBeacon,
    coverNFT,
    positionNFT,
    coverDescriptor,
    positionDescriptor,
    controlBoard,
  };
});

module.exports = InsuranceSetup;
