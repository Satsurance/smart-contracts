const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    signUnstakeRequest,
    signCoveragePurchase,
} = require("../utils/signatures");

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

/**
 * Get episode range for a position based on its start and end episodes
 * @param {Object} position - Position object from getPoolPosition
 * @returns {Array} Array of episode IDs
 */
function getEpisodeRangeForPosition(position) {
    const startEpisode = Number(position.startEpisode);
    const endEpisode = Number(position.endEpisode);
    const length = endEpisode - startEpisode + 1;
    return Array.from({ length }, (_, i) => startEpisode + i);
}

module.exports = {
    purchaseCoverage,
    getEpisodeRangeForPosition,
}; 