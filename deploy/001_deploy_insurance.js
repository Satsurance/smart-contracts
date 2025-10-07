const { ethers } = require("hardhat");

// Import artifact ABIs instead of hardcoding interfaces
const CapitalPoolArtifact = require("../artifacts/contracts/capital/CapitalPool.sol/CapitalPool.json");
const CoverNFTArtifact = require("../artifacts/contracts/cover/CoverNFT.sol/CoverNFT.json");
const ProtocolSettingsArtifact = require("../artifacts/contracts/governance/ProtocolSettings.sol/ProtocolSettings.json");
const PoolFactoryArtifact = require("../artifacts/contracts/pool/PoolFactory.sol/PoolFactory.json");
const PositionNFTArtifact = require("../artifacts/contracts/pool/PositionNFT.sol/PositionNFT.json");
const ClaimerArtifact = require("../artifacts/contracts/governance/Claimer.sol/Claimer.json");
const InsurancePoolArtifact = require("../artifacts/contracts/pool/InsurancePool.sol/InsurancePool.json");

// Constants
const BTC_TOKEN_ADDRESS = "0xC726845d8b6f0586A12D31ec5075e47B28c8eC4A";

module.exports = async ({ midl }) => {
    await midl.initialize(2)
    const protocolRewardsAddress = midl.getEVMAddress();
    await midl.initialize(1)
    const poolUnderwriter = midl.getEVMAddress()
    await midl.initialize(0)
    const deployer = midl.getEVMAddress()

    console.log("Deployment accounts (from namedAccounts):");
    console.log("Deployer:", deployer);
    console.log("Pool Underwriter:", poolUnderwriter);
    console.log("Protocol Rewards:", protocolRewardsAddress);
    console.log("Using BTC Token:", BTC_TOKEN_ADDRESS);

    console.log("Deploying insurance contracts...");

    // Parameters - can be overridden via environment variables or hardhat config
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

    // Get provider and predict future addresses
    const provider = new ethers.JsonRpcProvider("https://rpc.regtest.midl.xyz");

    // Predict addresses for future deployments
    let nonce = await provider.getTransactionCount(midl.getEVMAddress());
    const predictedAddresses = {};
    predictedAddresses.ControlBoard = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce });
    nonce += 10;
    predictedAddresses.UpgradeableBeacon = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.CoverNFTProxy = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.PositionNFTProxy = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.ProtocolSettingsProxy = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.PoolFactoryProxy = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.CapitalPoolProxy = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.ClaimerLogic = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });
    predictedAddresses.ClaimerProxy = ethers.getCreateAddress({ from: midl.getEVMAddress(), nonce: nonce++ });

    // Batch 1: Deploy basic contracts 10 txs

    await midl.deploy("ControlBoard", {
        args: [
            [deployer], // array of initial controllers
            controlBoardThreshold,
        ],
    });

    // Deploy Timelock using predicted ControlBoard address
    await midl.deploy("Timelock", {
        args: [
            minTimelockDelay,
            [],
            [predictedAddresses.ControlBoard], // executors (predicted ControlBoard)
        ],
    });

    await midl.deploy("InsurancePool", {
        args: [],
    });

    await midl.deploy("CapitalPool", {
        args: [],
    });

    await midl.deploy("CoverNFT", {
        args: [],
    });

    await midl.deploy("ProtocolSettings", {
        args: [],
    });

    await midl.deploy("PoolFactory", {
        args: [],
    });

    await midl.deploy("PositionNFT", {
        args: [],
    });

    await midl.deploy("CoverDescriptor", {
        args: [],
    });

    await midl.deploy("PositionDescriptor", {
        args: [],
    });


    // Execute first batch
    await midl.execute();

    // Batch 2: 9 txs
    // Get actual deployed addresses
    const controlBoard = await midl.getDeployment("ControlBoard");
    const timelock = await midl.getDeployment("Timelock");
    const insurancePoolLogic = await midl.getDeployment("InsurancePool");

    const protocolSettingsLogic = await midl.getDeployment("ProtocolSettings");
    const poolFactoryLogic = await midl.getDeployment("PoolFactory");
    const coverNFTLogic = await midl.getDeployment("CoverNFT");
    const coverDescriptor = await midl.getDeployment("CoverDescriptor");
    const positionNFTLogic = await midl.getDeployment("PositionNFT");
    const positionDescriptor = await midl.getDeployment("PositionDescriptor");
    const capitalPoolLogic = await midl.getDeployment("CapitalPool");

    await midl.deploy("UpgradeableBeacon", {
        args: [insurancePoolLogic.address, timelock.address],
    });


    // Deploy CoverNFT Proxy
    const coverNFTInterface = new ethers.Interface(CoverNFTArtifact.abi);
    const coverNFTInitData = coverNFTInterface.encodeFunctionData("initialize", [
        timelock.address, // owner
        predictedAddresses.PoolFactoryProxy, // manager
        coverDescriptor.address,
    ]);

    await midl.deploy("CoverNFTProxy", {
        args: [coverNFTLogic.address, coverNFTInitData],
    });

    // Deploy PositionNFT Proxy
    const positionNFTInterface = new ethers.Interface(PositionNFTArtifact.abi);
    const positionNFTInitData = positionNFTInterface.encodeFunctionData("initialize", [
        predictedAddresses.PoolFactoryProxy,
        timelock.address, // owner
        predictedAddresses.PoolFactoryProxy, // manager
        positionDescriptor.address,
    ]);

    await midl.deploy("PositionNFTProxy", {
        args: [positionNFTLogic.address, positionNFTInitData],
    });

    // Deploy ProtocolSettings Proxy using predicted addresses
    const protocolSettingsInterface = new ethers.Interface(ProtocolSettingsArtifact.abi);
    const protocolSettingsInitData = protocolSettingsInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // operator
        protocolRewardsAddress, // protocolRewardsAddress
        predictedAddresses.CapitalPoolProxy,
        predictedAddresses.UpgradeableBeacon,
        predictedAddresses.CoverNFTProxy,
        predictedAddresses.PositionNFTProxy, // Use predicted PositionNFT address
        deployer, // guardian
        protocolFee,
    ]);

    await midl.deploy("ProtocolSettingsProxy", {
        args: [protocolSettingsLogic.address, protocolSettingsInitData],
    });

    // Deploy PoolFactory Proxy using predicted ProtocolSettings address
    const poolFactoryInterface = new ethers.Interface(PoolFactoryArtifact.abi);
    const poolFactoryInitData = poolFactoryInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // operator
        predictedAddresses.ProtocolSettingsProxy,
    ]);

    await midl.deploy("PoolFactoryProxy", {
        args: [poolFactoryLogic.address, poolFactoryInitData],
    });

    // Deploy CapitalPool Proxy
    const capitalPoolInterface = new ethers.Interface(CapitalPoolArtifact.abi);
    const capitalPoolInitData = capitalPoolInterface.encodeFunctionData("initialize", [
        predictedAddresses.PoolFactoryProxy // Use predicted PoolFactory address
    ]);

    await midl.deploy("CapitalPoolProxy", {
        args: [capitalPoolLogic.address, capitalPoolInitData],
    });


    await midl.deploy("Claimer", {
        args: [],
    });

    const claimerInterface = new ethers.Interface(ClaimerArtifact.abi);
    const claimerInitData = claimerInterface.encodeFunctionData("initialize", [
        deployer, // owner
        deployer, // operatorManager
        controlBoard.address, // operator
        claimDeposit,
        BTC_TOKEN_ADDRESS,
        approvalPeriod,
        executionTimeout,
        claimReduction,
    ]);

    await midl.deploy("ClaimerProxy", {
        args: [predictedAddresses.ClaimerLogic, claimerInitData],
    });

    await midl.execute();

    // Prepare initialization data for InsurancePool using predicted Claimer address
    const insurancePoolInterface = new ethers.Interface(InsurancePoolArtifact.abi);
    const insurancePoolInitData = insurancePoolInterface.encodeFunctionData("initialize", [
        poolUnderwriter, // poolUnderwriter
        timelock.address, // governor (owner)
        BTC_TOKEN_ADDRESS,
        predictedAddresses.ClaimerProxy,
        minimalUnderwriterStake,
        bonusPerEpisodeStaked,
        true, // acceptNewCovers
        underwriterFee,
        underwriterFirstLoss,
    ]);


    await midl.callContract("PoolFactory", "create", {
        args: [insurancePoolInitData],
        to: (
            await midl.getDeployment("PoolFactoryProxy")
        ).address
    });



    // Execute final batch
    await midl.execute();

    console.log("Insurance contracts deployment completed!");

    // Get deployed addresses for logging
    const claimerProxy = await midl.getDeployment("ClaimerProxy");
    const poolFactoryProxy = await midl.getDeployment("PoolFactoryProxy");
    const protocolSettingsProxy = await midl.getDeployment("ProtocolSettingsProxy");
    const capitalPoolProxy = await midl.getDeployment("CapitalPoolProxy");
    const upgradeableBeacon = await midl.getDeployment("UpgradeableBeacon");
    const coverNFTProxy = await midl.getDeployment("CoverNFTProxy");
    const positionNFTProxy = await midl.getDeployment("PositionNFTProxy");

    const deployments = {
        BTCToken: BTC_TOKEN_ADDRESS,
        Timelock: timelock.address,
        ClaimerProxy: claimerProxy.address,
        PoolFactoryProxy: poolFactoryProxy.address,
        ProtocolSettingsProxy: protocolSettingsProxy.address,
        CapitalPoolProxy: capitalPoolProxy.address,
        UpgradeableBeacon: upgradeableBeacon.address,
        CoverNFTProxy: coverNFTProxy.address,
        PositionNFTProxy: positionNFTProxy.address,
        CoverDescriptor: coverDescriptor.address,
        PositionDescriptor: positionDescriptor.address,
        ControlBoard: controlBoard.address,
    };

    console.log("Deployed contracts:", deployments);

    return deployments;
};

module.exports.tags = ["Insurance", "Complete"];
module.exports.dependencies = []; // Add any dependencies here if needed
