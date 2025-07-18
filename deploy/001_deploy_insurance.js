const { ethers } = require("hardhat");

// Import artifact ABIs instead of hardcoding interfaces
const CapitalPoolArtifact = require("../artifacts/contracts/capital/CapitalPool.sol/CapitalPool.json");
const CoverNFTArtifact = require("../artifacts/contracts/cover/CoverNFT.sol/CoverNFT.json");
const ProtocolSettingsArtifact = require("../artifacts/contracts/governance/ProtocolSettings.sol/ProtocolSettings.json");
const PoolFactoryArtifact = require("../artifacts/contracts/pool/PoolFactory.sol/PoolFactory.json");
const PositionNFTArtifact = require("../artifacts/contracts/pool/PositionNFT.sol/PositionNFT.json");
const ClaimerArtifact = require("../artifacts/contracts/governance/Claimer.sol/Claimer.json");
const InsurancePoolArtifact = require("../artifacts/contracts/pool/InsurancePool.sol/InsurancePool.json");

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
    const { deploy, execute, read, get } = deployments;
    const { deployer, poolUnderwriter, protocolRewardsAddress } = await getNamedAccounts();

    console.log("Deploying insurance contracts...");

    // Parameters - can be overridden via environment variables or hardhat config
    const wbtcInitialSupply = process.env.WBTC_INITIAL_SUPPLY || ethers.parseUnits("22000000", "ether").toString();
    const minTimelockDelay = process.env.MIN_TIMELOCK_DELAY || 24 * 60 * 60; // 1 day
    const protocolFee = process.env.PROTOCOL_FEE || 1500; // 15%
    const underwriterFee = process.env.UNDERWRITER_FEE || 1000; // 10%
    const minimalUnderwriterStake = process.env.MINIMAL_UNDERWRITER_STAKE || 1000;
    const underwriterFirstLoss = process.env.UNDERWRITER_FIRST_LOSS || 0;
    const bonusPerEpisodeStaked = process.env.BONUS_PER_EPISODE_STAKED || 0;
    const claimDeposit = process.env.CLAIM_DEPOSIT || 0;
    const approvalPeriod = process.env.APPROVAL_PERIOD || 3 * 7 * 24 * 60 * 60; // 3 weeks
    const executionTimeout = process.env.EXECUTION_TIMEOUT || 7 * 24 * 60 * 60; // 1 week
    const claimReduction = process.env.CLAIM_REDUCTION || 0;
    const controlBoardThreshold = process.env.CONTROL_BOARD_THRESHOLD || 1;

    // Deploy Mock BTC Token
    const btcToken = await deploy("BTCToken", {
        from: deployer,
        args: [wbtcInitialSupply],
        log: true,
    });

    // Deploy ControlBoard first (needed for Timelock executor)
    const controlBoard = await deploy("ControlBoard", {
        from: deployer,
        args: [
            [deployer], // array of initial controllers
            controlBoardThreshold,
        ],
        log: true,
    });

    // Deploy Timelock with ControlBoard as executor
    const timelock = await deploy("Timelock", {
        from: deployer,
        args: [
            minTimelockDelay,
            [],
            [controlBoard.address], // executors (ControlBoard)
        ],
        log: true,
    });

    // Deploy InsurancePool Logic
    const insurancePoolLogic = await deploy("InsurancePoolLogic", {
        contract: "InsurancePool",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy InsurancePool Beacon
    const insurancePoolBeacon = await deploy("InsurancePoolBeacon", {
        contract: "UpgradeableBeacon",
        from: deployer,
        args: [insurancePoolLogic.address, timelock.address],
        log: true,
    });

    // Deploy URI Descriptors
    const coverDescriptor = await deploy("CoverDescriptor", {
        from: deployer,
        args: [],
        log: true,
    });

    const positionDescriptor = await deploy("PositionDescriptor", {
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy CapitalPool Logic
    const capitalPoolLogic = await deploy("CapitalPoolLogic", {
        contract: "CapitalPool",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy CapitalPool Proxy (with placeholder poolFactory)
    const capitalPoolInterface = new ethers.Interface(CapitalPoolArtifact.abi);
    const capitalPoolInitData = capitalPoolInterface.encodeFunctionData("initialize", [
        "0x0000000000000000000000000000000000000000"
    ]);

    const capitalPoolProxy = await deploy("CapitalPoolProxy", {
        contract: "ERC1967Proxy",
        from: deployer,
        args: [capitalPoolLogic.address, capitalPoolInitData],
        log: true,
    });

    // Deploy CoverNFT Logic
    const coverNFTLogic = await deploy("CoverNFTLogic", {
        contract: "CoverNFT",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy CoverNFT Proxy
    const coverNFTInterface = new ethers.Interface(CoverNFTArtifact.abi);
    const coverNFTInitData = coverNFTInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // manager
        coverDescriptor.address,
    ]);

    const coverNFTProxy = await deploy("CoverNFTProxy", {
        contract: "ERC1967Proxy",
        from: deployer,
        args: [coverNFTLogic.address, coverNFTInitData],
        log: true,
    });

    // Deploy ProtocolSettings Logic
    const protocolSettingsLogic = await deploy("ProtocolSettingsLogic", {
        contract: "ProtocolSettings",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy ProtocolSettings Proxy (without positionNFT initially)
    const protocolSettingsInterface = new ethers.Interface(ProtocolSettingsArtifact.abi);
    const protocolSettingsInitData = protocolSettingsInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // operator
        protocolRewardsAddress || deployer, // protocolRewardsAddress
        capitalPoolProxy.address,
        insurancePoolBeacon.address,
        coverNFTProxy.address,
        "0x0000000000000000000000000000000000000000", // positionNFT placeholder
        deployer, // guardian
        protocolFee,
    ]);

    const protocolSettingsProxy = await deploy("ProtocolSettingsProxy", {
        contract: "ERC1967Proxy",
        from: deployer,
        args: [protocolSettingsLogic.address, protocolSettingsInitData],
        log: true,
    });

    // Deploy PoolFactory Logic
    const poolFactoryLogic = await deploy("PoolFactoryLogic", {
        contract: "PoolFactory",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy PoolFactory Proxy
    const poolFactoryInterface = new ethers.Interface(PoolFactoryArtifact.abi);
    const poolFactoryInitData = poolFactoryInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // operator
        protocolSettingsProxy.address,
    ]);

    const poolFactoryProxy = await deploy("PoolFactoryProxy", {
        contract: "ERC1967Proxy",
        from: deployer,
        args: [poolFactoryLogic.address, poolFactoryInitData],
        log: true,
    });

    // Update CapitalPool with actual PoolFactory address
    // Need to get the contract instance with proper ABI since proxy only has ERC1967Proxy ABI
    const signer = await ethers.getSigner(deployer);
    const capitalPoolContract = await ethers.getContractAt("CapitalPool", capitalPoolProxy.address);
    await capitalPoolContract.connect(signer).setPoolFactory(poolFactoryProxy.address);
    await capitalPoolContract.connect(signer).updateGlobalSettings();

    // Deploy PositionNFT Logic
    const positionNFTLogic = await deploy("PositionNFTLogic", {
        contract: "PositionNFT",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy PositionNFT Proxy
    const positionNFTInterface = new ethers.Interface(PositionNFTArtifact.abi);
    const positionNFTInitData = positionNFTInterface.encodeFunctionData("initialize", [
        poolFactoryProxy.address,
        deployer, // owner
        deployer, // manager
        positionDescriptor.address,
    ]);

    const positionNFTProxy = await deploy("PositionNFTProxy", {
        contract: "ERC1967Proxy",
        from: deployer,
        args: [positionNFTLogic.address, positionNFTInitData],
        log: true,
    });

    // Update ProtocolSettings with PositionNFT address
    const protocolSettingsContract = await ethers.getContractAt("ProtocolSettings", protocolSettingsProxy.address);
    await protocolSettingsContract.connect(await ethers.getSigner(deployer)).setPositionNFT(positionNFTProxy.address);

    // Grant roles on CoverNFT
    const coverNFTContract = await ethers.getContractAt("CoverNFT", coverNFTProxy.address);
    const MANAGER_ROLE = await coverNFTContract.MANAGER_ROLE();
    const DEFAULT_ADMIN_ROLE = await coverNFTContract.DEFAULT_ADMIN_ROLE();

    await coverNFTContract.connect(signer).grantRole(MANAGER_ROLE, poolFactoryProxy.address);
    await coverNFTContract.connect(signer).grantRole(DEFAULT_ADMIN_ROLE, timelock.address);
    await coverNFTContract.connect(signer).revokeRole(MANAGER_ROLE, deployer);
    await coverNFTContract.connect(signer).revokeRole(DEFAULT_ADMIN_ROLE, deployer);

    // Grant roles on PositionNFT
    const positionNFTContract = await ethers.getContractAt("PositionNFT", positionNFTProxy.address);
    const POSITION_MANAGER_ROLE = await positionNFTContract.MANAGER_ROLE();
    const POSITION_DEFAULT_ADMIN_ROLE = await positionNFTContract.DEFAULT_ADMIN_ROLE();

    await positionNFTContract.connect(signer).grantRole(POSITION_MANAGER_ROLE, poolFactoryProxy.address);
    await positionNFTContract.connect(signer).grantRole(POSITION_DEFAULT_ADMIN_ROLE, timelock.address);
    await positionNFTContract.connect(signer).revokeRole(POSITION_MANAGER_ROLE, deployer);
    await positionNFTContract.connect(signer).revokeRole(POSITION_DEFAULT_ADMIN_ROLE, deployer);

    // Deploy Claimer Logic
    const claimerLogic = await deploy("ClaimerLogic", {
        contract: "Claimer",
        from: deployer,
        args: [],
        log: true,
    });

    // Deploy Claimer Proxy
    const claimerInterface = new ethers.Interface(ClaimerArtifact.abi);
    const claimerInitData = claimerInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // operatorManager
        deployer, // operator
        claimDeposit,
        btcToken.address,
        approvalPeriod,
        executionTimeout,
        claimReduction,
    ]);

    const claimerProxy = await deploy("ClaimerProxy", {
        contract: "ERC1967Proxy",
        from: deployer,
        args: [claimerLogic.address, claimerInitData],
        log: true,
    });

    // Prepare initialization data for InsurancePool
    const insurancePoolInterface = new ethers.Interface(InsurancePoolArtifact.abi);
    const insurancePoolInitData = insurancePoolInterface.encodeFunctionData("initialize", [
        poolUnderwriter || deployer, // poolUnderwriter
        timelock.address, // governor (owner)
        btcToken.address,
        claimerProxy.address,
        minimalUnderwriterStake,
        bonusPerEpisodeStaked,
        true, // acceptNewCovers
        underwriterFee,
        underwriterFirstLoss,
    ]);

    // Create InsurancePool through factory
    const poolFactoryContract = await ethers.getContractAt("PoolFactory", poolFactoryProxy.address);
    const createPoolTx = await poolFactoryContract.connect(signer).create(insurancePoolInitData);

    // Get the created pool address from event logs
    const receipt = await createPoolTx.wait();
    const events = receipt.logs.map(log => {
        try {
            return poolFactoryContract.interface.parseLog(log);
        } catch (e) {
            return null;
        }
    }).filter(Boolean);

    const poolCreatedEvent = events.find(event => event.name === "PoolCreated");
    const insurancePoolAddress = poolCreatedEvent?.args?.poolAddress;

    if (!insurancePoolAddress) {
        throw new Error("Failed to get insurance pool address from PoolCreated event");
    }

    console.log(`InsurancePool created at: ${insurancePoolAddress}`);

    // Grant ControlBoard OPERATOR_ROLE in Claimer
    const claimerContract = await ethers.getContractAt("Claimer", claimerProxy.address);
    const OPERATOR_ROLE = await claimerContract.OPERATOR_ROLE();
    await claimerContract.connect(signer).grantRole(OPERATOR_ROLE, controlBoard.address);

    console.log("Insurance contracts deployment completed!");
    console.log(`InsurancePool: ${insurancePoolAddress}`);
    console.log(`BTC Token: ${btcToken.address}`);
    console.log(`PoolFactory: ${poolFactoryProxy.address}`);
    console.log(`ProtocolSettings: ${protocolSettingsProxy.address}`);
    console.log(`CapitalPool: ${capitalPoolProxy.address}`);
    console.log(`CoverNFT: ${coverNFTProxy.address}`);
    console.log(`PositionNFT: ${positionNFTProxy.address}`);
    console.log(`Claimer: ${claimerProxy.address}`);
    console.log(`Timelock: ${timelock.address}`);
    console.log(`ControlBoard: ${controlBoard.address}`);

    // Tag deployments for easy reference
    return {
        BTCToken: btcToken.address,
        InsurancePool: insurancePoolAddress,
        Timelock: timelock.address,
        Claimer: claimerProxy.address,
        PoolFactory: poolFactoryProxy.address,
        ProtocolSettings: protocolSettingsProxy.address,
        CapitalPool: capitalPoolProxy.address,
        InsurancePoolBeacon: insurancePoolBeacon.address,
        CoverNFT: coverNFTProxy.address,
        PositionNFT: positionNFTProxy.address,
        CoverDescriptor: coverDescriptor.address,
        PositionDescriptor: positionDescriptor.address,
        ControlBoard: controlBoard.address,
    };
};

module.exports.tags = ["Insurance", "Complete"];
module.exports.dependencies = []; // Add any dependencies here if needed 