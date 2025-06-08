const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const InsuranceSetup = require("../ignition/modules/Insurance.js");

/**
 * Basic fixture that sets up the insurance deployment with common configurations
 * @returns {Object} The deployed contracts and configuration
 */
async function basicFixture() {
    return await parametrizedFixture();
}

/**
 * Parametrized fixture that allows customizing ignition module deployment parameters
 * @param {Object} deploymentParams - Parameters to pass to ignition module
 * @returns {Object} The deployed contracts and configuration
 */
async function parametrizedFixture(deploymentParams = {}) {
    // Default deployment parameters (can be overridden)
    const defaultDeploymentParams = {
        initialSupply: ethers.parseUnits("20000000000", "ether").toString(),
        wbtcInitialSupply: ethers.parseUnits("22000000", "ether").toString(),
        minTimelockDelay: 24 * 60 * 60, // 1 day
        protocolFee: 1500, // 15%
        underwriterFee: 1000, // 10%
        minimalUnderwriterStake: 1000,
        bonusPerEpisodeStaked: 0,
        claimDeposit: 0,
        approvalPeriod: 3 * 7 * 24 * 60 * 60, // 3 weeks
    };

    // Merge with provided parameters
    const finalDeploymentParams = { ...defaultDeploymentParams, ...deploymentParams };

    // Deploy with custom parameters
    const deployment = await ignition.deploy(InsuranceSetup, {
        parameters: {
            InsuranceContracts: finalDeploymentParams
        }
    });

    // Get accounts
    const [owner, poolUnderwriter] = await ethers.getSigners();

    // Setup common BTC transfers and approvals (same as basicFixture)
    const underwriterInitialBalance = ethers.parseUnits("21000000", "ether");
    const ownerApprovalAmount = ethers.parseUnits("2000", "ether");
    const underwriterApprovalAmount = ethers.parseUnits("51000000", "ether");

    // Transfer BTC to poolUnderwriter for all test cases
    await deployment.btcToken.transfer(poolUnderwriter, underwriterInitialBalance);

    // Setup approvals for common operations with large amounts to cover all tests
    await deployment.btcToken
        .connect(poolUnderwriter)
        .approve(deployment.insurancePool, underwriterApprovalAmount);

    await deployment.btcToken.approve(deployment.insurancePool, ownerApprovalAmount);

    // Create a basic product using the poolUnderwriter account
    await deployment.insurancePool.connect(poolUnderwriter).createProduct(
        "Basic Coverage", // name
        1000, // annualPremium (10% annual premium)
        365 * 24 * 60 * 60, // maxCoverageDuration (1 year in seconds)
        10000 // maxPoolAllocation (100% of pool)
    );

    return {
        ...deployment,
        accounts: {
            owner,
            poolUnderwriter
        },
        deploymentParams: finalDeploymentParams
    };
}

module.exports = {
    basicFixture,
    parametrizedFixture
}; 