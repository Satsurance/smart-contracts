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
    underwriterSigner,
    coveredAccount,
    purchaseAmount,
    coverageAmount,
    description,
}) {
    // Get chainId for signature
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Generate unique coverId using timestamp and random number
    const coverId = ethers.toBigInt(
        ethers.solidityPackedKeccak256(
            ["uint256"],
            [Math.floor(Math.random() * 1000000)]
        )
    );

    // Setup coverage dates
    const startDate = await time.latest();
    const endDate = startDate + 1000;

    // Set deadline 1 hour in the future
    const deadline = startDate + 3600;

    // Prepare signature parameters
    const params = {
        coverId,
        account: coveredAccount,
        coverAmount: coverageAmount,
        purchaseAmount,
        startDate,
        endDate,
        description,
        deadline,
        chainId,
    };


    // Approve token transfer if needed
    const buyerAddress = await buyer.getAddress();
    const allowance = await poolAsset.allowance(
        buyerAddress,
        insurancePool.target
    );
    if (allowance < purchaseAmount) {
        await poolAsset
            .connect(buyer)
            .approve(insurancePool.target, purchaseAmount);
    }

    // Execute purchase
    await insurancePool
        .connect(buyer)
        .purchaseCover(
            coverId,
            coveredAccount,
            coverageAmount,
            purchaseAmount,
            startDate,
            endDate,
            description,
        );
}

module.exports = {
    purchaseCoverage,
    getCurrentEpisode,
    getEpisodeStartTime,
    getEpisodeFinishTime,
    EPISODE_DURATION,
}; 