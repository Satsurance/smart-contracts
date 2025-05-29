const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    signUnstakeRequest,
    signCoveragePurchase,
} = require("../utils/signatures");

// Episode duration matches the contract: 91 days / 3 = ~30.33 days
const EPISODE_DURATION = Math.floor((91 * 24 * 60 * 60) / 3); // 91 days / 3 in seconds

/**
 * Calculate the current episode locally using the same logic as the contract
 * @param {number} timestamp - Optional timestamp to calculate episode for. If not provided, uses current time
 * @returns {Promise<number>} The current episode number
 */
async function getCurrentEpisode(timestamp = null) {
    const currentTime = timestamp || await time.latest();
    return Math.floor(currentTime / EPISODE_DURATION);
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
}) {
    // Default to product ID 0 (the basic product created in tests)
    const productId = 0;

    // Calculate coverage duration from purchaseAmount and coverageAmount
    // This is a simplified calculation - in practice you might want to pass duration directly
    const coverageDuration = 365 * 24 * 60 * 60; // 1 year in seconds (default)

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

module.exports = {
    purchaseCoverage,
    getCurrentEpisode,
    getEpisodeStartTime,
    getEpisodeFinishTime,
    EPISODE_DURATION,
}; 