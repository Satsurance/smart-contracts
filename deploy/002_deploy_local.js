const { ethers } = require("hardhat");
const { EPISODE_DURATION } = require("../test/constants");
const { findClosestStakableEpisodeParams } = require("../test/helpers");

const BIG_STAKER_ADDR = "0xe63b611C72e046e5FA05C3EaA972F2bbD6E9a1CB";
const POOL_OWNER_ADDR = "0xe1a5328f489C261410563a08a92f1FFdfF045407";
const FAUCET_ADDR = "0x7F21b4286ed33a09dD44e3068b524e759511dA76";

module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
    const { deployer } = await getNamedAccounts();
    const { get } = deployments;

    console.log("Setting up local development environment...");

    // Get deployed contract addresses
    const btcToken = await get("BTCToken");
    const poolFactoryProxy = await get("PoolFactoryProxy");

    // Get the insurance pool address from the previous deployment
    // We need to read it from the PoolFactory's created pools
    const poolFactoryContract = await ethers.getContractAt("PoolFactory", poolFactoryProxy.address);
    const poolCount = await poolFactoryContract.poolCount();

    if (poolCount === 0n) {
        throw new Error("No insurance pools found. Run the first deployment script first.");
    }

    // Get the most recently created pool (pool IDs start from 1)
    const insurancePoolAddress = await poolFactoryContract.pools(poolCount);
    console.log(`Using InsurancePool at: ${insurancePoolAddress}`);

    // Get contract instances
    const btcTokenContract = await ethers.getContractAt("BTCToken", btcToken.address);
    const insurancePoolContract = await ethers.getContractAt("InsurancePool", insurancePoolAddress);

    // Get signers
    const deployerSigner = await ethers.getSigner(deployer);
    const [, account1, account2] = await ethers.getSigners();

    console.log("Setting up token approvals and transfers...");

    // Approve BTC tokens for the insurance pool (deployer)
    await btcTokenContract.connect(deployerSigner).approve(
        insurancePoolAddress,
        ethers.parseUnits("200", "ether")
    );

    // Transfer BTC tokens to account1 and account2
    await btcTokenContract.connect(deployerSigner).transfer(
        account1.address,
        ethers.parseUnits("100", "ether")
    );

    await btcTokenContract.connect(deployerSigner).transfer(
        account2.address,
        ethers.parseUnits("100", "ether")
    );

    // Account1 approves the insurance pool
    await btcTokenContract.connect(account1).approve(
        insurancePoolAddress,
        ethers.parseUnits("100", "ether")
    );

    console.log("Creating product...");

    // Account1 creates a product
    await insurancePoolContract.connect(account1).createProduct(
        "Basic Coverage",
        1000, // premium rate
        365 * 24 * 60 * 60, // max duration (1 year)
        10000 // max coverage
    );

    console.log("Setting up pool staking...");

    // Calculate episode parameters for staking
    const stakeEpisodeOffset = 23n;
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const currentEpisode = currentTime / EPISODE_DURATION;
    const episodeToStake = findClosestStakableEpisodeParams(currentEpisode, stakeEpisodeOffset);

    // Account1 joins the pool
    await insurancePoolContract.connect(account1).joinPool(
        ethers.parseUnits("10", "ether"),
        episodeToStake
    );

    console.log("Purchasing coverage...");

    // Deployer purchases coverage
    await insurancePoolContract.connect(deployerSigner).purchaseCover(
        0, // productId
        deployer, // beneficiary
        365 * 24 * 60 * 60, // duration (1 year)
        ethers.parseUnits("9", "ether") // coverage amount
    );

    console.log("Distributing tokens to development addresses...");

    // Transfer tokens to specific development addresses
    await btcTokenContract.connect(deployerSigner).transfer(
        BIG_STAKER_ADDR,
        ethers.parseUnits("200", "ether")
    );

    await btcTokenContract.connect(deployerSigner).transfer(
        POOL_OWNER_ADDR,
        ethers.parseUnits("10", "ether")
    );

    await btcTokenContract.connect(deployerSigner).transfer(
        FAUCET_ADDR,
        ethers.parseUnits("200", "ether")
    );

    console.log("Sending ETH to development addresses...");

    // Send ETH to development addresses
    await deployerSigner.sendTransaction({
        to: BIG_STAKER_ADDR,
        value: ethers.parseUnits("10", "ether")
    });

    await deployerSigner.sendTransaction({
        to: POOL_OWNER_ADDR,
        value: ethers.parseUnits("10", "ether")
    });

    await deployerSigner.sendTransaction({
        to: FAUCET_ADDR,
        value: ethers.parseUnits("10", "ether")
    });

    console.log("Local development setup completed!");
    console.log(`InsurancePool: ${insurancePoolAddress}`);
    console.log(`Account1 (underwriter): ${account1.address}`);
    console.log(`Account2: ${account2.address}`);
    console.log(`Big Staker: ${BIG_STAKER_ADDR}`);
    console.log(`Pool Owner: ${POOL_OWNER_ADDR}`);
    console.log(`Faucet: ${FAUCET_ADDR}`);

    return {
        insurancePool: insurancePoolAddress,
        account1: account1.address,
        account2: account2.address,
        bigStaker: BIG_STAKER_ADDR,
        poolOwner: POOL_OWNER_ADDR,
        faucet: FAUCET_ADDR,
    };
};

module.exports.tags = ["LocalSetup", "Development"];
module.exports.dependencies = ["Insurance"]; // Depends on the main insurance deployment 