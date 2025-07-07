const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    signUnstakeRequest,
    signCoveragePurchase,
} = require("../utils/signatures");
const { expect } = require("chai");
const { EPISODE_DURATION } = require("./constants.js");

/**
 * Calculate the current episode locally using the same logic as the contract
 * @param {number} timestamp - Optional timestamp to calculate episode for. If not provided, uses current time
 * @returns {Promise<number>} The current episode number
 */
async function getCurrentEpisode(timestamp = null) {
    const currentTime = BigInt(timestamp || await time.latest());
    return currentTime / EPISODE_DURATION;
}

/**
 * Calculate the start time of a given episode
 * @param {number} episodeId - The episode ID
 * @returns {number} The start timestamp of the episode
 */
function getEpisodeStartTime(episodeId) {
    return episodeId * EPISODE_DURATION;
}

/**
 * Calculate the finish time of a given episode
 * @param {number} episodeId - The episode ID
 * @returns {number} The finish timestamp of the episode
 */
function getEpisodeFinishTime(episodeId) {
    return (episodeId + 1) * EPISODE_DURATION;
}

async function purchaseCoverage({
    insurancePool,
    poolAsset,
    buyer,
    coveredAccount,
    coverageAmount,
    coverageDuration = 365 * 24 * 60 * 60, // 1 year in seconds (default)
    productId = 0,
}) {
    // Approve token transfer if needed
    const buyerAddress = await buyer.getAddress();

    // Get the product to calculate the actual premium amount
    const product = await insurancePool.products(productId);
    const premiumAmount = (BigInt(coverageDuration) * BigInt(product.annualPercent) * BigInt(coverageAmount)) / BigInt(365 * 24 * 60 * 60 * 10000);

    const allowance = await poolAsset.allowance(
        buyerAddress,
        insurancePool.target
    );
    if (allowance < premiumAmount) {
        await poolAsset
            .connect(buyer)
            .approve(insurancePool.target, premiumAmount);
    }

    // Execute purchase with the new method signature
    await insurancePool
        .connect(buyer)
        .purchaseCover(
            productId,
            coveredAccount,
            coverageDuration,
            coverageAmount
        );
}

/**
 * Check that actual value is equal to or less than expected value within allowed error tolerance
 * @param {BigInt|number} actual - The actual value to check
 * @param {BigInt|number} expected - The expected maximum value
 * @param {BigInt|number} allowedError - The allowed understaking/error tolerance
 */
function expectAllowedUnderstaking(actual, expected, allowedError) {
    expect(actual).to.be.approximately(expected, allowedError);
    expect(actual).to.be.at.most(expected);
}

/**
 * Helper function to create initialization data for InsurancePool
 * @param {string} poolUnderwriter - Address of the pool underwriter
 * @param {string} governor - Address of the governor
 * @param {string} poolAsset - Address of the pool asset token
 * @param {string} claimer - Address of the claimer contract
 * @param {number} minUnderwriterPercentage - Minimum underwriter percentage (default: 1000)
 * @param {number} bonusPerEpisodeStaked - Bonus per episode staked (default: 0)
 * @param {boolean} isNewDepositAccepted - Whether new deposits are accepted (default: true)
 * @param {number} underwriterFee - Underwriter fee (default: 1000)
 * @param {number} underwriterFirstLoss - Underwriter first loss (default: 0)
 * @returns {string} Encoded initialization data
 */
function createPoolInitData(poolUnderwriter, governor, poolAsset, claimer, minUnderwriterPercentage = 1000, bonusPerEpisodeStaked = 0, isNewDepositAccepted = true, underwriterFee = 1000, underwriterFirstLoss = 0) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "uint256", "uint256", "bool", "uint256", "uint256"],
        [
            poolUnderwriter,
            governor,
            poolAsset,
            claimer,
            minUnderwriterPercentage,
            bonusPerEpisodeStaked,
            isNewDepositAccepted,
            underwriterFee,
            underwriterFirstLoss
        ]
    );
}

async function findClosestStakableEpisode(episodeOffset) {
    const currentEpisode = await getCurrentEpisode();
    if ((currentEpisode + episodeOffset) % 3n == 2n) {
        return currentEpisode + episodeOffset;
    }
    if ((currentEpisode + episodeOffset) % 3n == 0n) {
        return currentEpisode + episodeOffset - 1n;
    }
    if ((currentEpisode + episodeOffset) % 3n == 1n) {
        return currentEpisode + episodeOffset - 2n;
    }
}

module.exports = {
    purchaseCoverage,
    getCurrentEpisode,
    getEpisodeStartTime,
    getEpisodeFinishTime,
    expectAllowedUnderstaking,
    createPoolInitData,
    findClosestStakableEpisode
};
