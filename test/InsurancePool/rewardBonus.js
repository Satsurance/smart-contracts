const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode, expectAllowedUnderstaking, findClosestStakableEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { ALLOWED_UNDERSTAKING, SECS_IN_DAY } = require("../constants.js");

const { expect } = require("chai");

async function rewardBonusFixture() {
    return basicFixture({ bonusPerEpisodeStaked: 50n }); // 0.5% bonus per additional episode staked
}

describe("Reward Bonus for Longer Stakers", async function () {

    it("test longer stakers receive reward bonuses", async function () {
        const stakerAmount = ethers.parseUnits("10", "ether");
        const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
        const coverageAmountMultiplier = 10n;
        const underwriterFee = 1000n;
        const bonusPerEpisodeStaked = 50n; // 0.5% bonus per additional episode staked

        const shortEpisodeToStake = await findClosestStakableEpisode(5n);
        const longEpisodeToStake = await findClosestStakableEpisode(23n);
        const currentEpisode = await getCurrentEpisode()
        const shortEpisodeOffset = shortEpisodeToStake - currentEpisode;
        const longEpisodeOffset = longEpisodeToStake - currentEpisode;
        const coverageDuration = BigInt(SECS_IN_DAY * 30); // 30 days

        // Expected calculations
        const rewardPercentage = 85n; // 85% goes to0 stakers, 15% protocol fee
        const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier;


        // Calculate expected rewards
        const basisPoints = 10000n;
        const expectedShortRewardShares = stakerAmount + (stakerAmount * shortEpisodeOffset * bonusPerEpisodeStaked) / basisPoints;
        const expectedLongRewardShares = stakerAmount + (stakerAmount * longEpisodeOffset * bonusPerEpisodeStaked) / basisPoints;
        const rewardAmount = (coveragePurchaseAmount * rewardPercentage / 100n) * coverageDuration / BigInt(365 * SECS_IN_DAY);
        const expectedTotalRewardShares = expectedShortRewardShares + expectedLongRewardShares + (expectedShortRewardShares + expectedLongRewardShares) * underwriterFee / (10000n - underwriterFee);

        const expectedShortReward = rewardAmount * expectedShortRewardShares / expectedTotalRewardShares;
        const expectedLongReward = rewardAmount * expectedLongRewardShares / expectedTotalRewardShares;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(rewardBonusFixture);
        const { owner, poolUnderwriter } = accounts;


        // Create underwriter position (long duration for comparison)
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(stakerAmount, longEpisodeToStake);
        const longPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter, 0);

        // Create two user positions - one short, one long
        await insurancePool.connect(owner).joinPool(stakerAmount, shortEpisodeToStake);
        const shortPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);


        // Verify positions were created with same shares but different reward shares
        const shortPosition = await insurancePool.getPoolPosition(shortPositionId);
        const longPosition = await insurancePool.getPoolPosition(longPositionId);
        const totalRewardShares = await insurancePool.totalRewardShares();


        expect(shortPosition.rewardShares).to.equal(expectedShortRewardShares);
        expect(longPosition.rewardShares).to.equal(expectedLongRewardShares);
        expect(totalRewardShares).to.approximately(expectedTotalRewardShares, 1n);

        // Purchase coverage to generate rewards
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
            coverageDuration: coverageDuration,
        });

        // Wait for rewards to accumulate
        await time.increase(SECS_IN_DAY * 70);

        const shortStakerRewards = await insurancePool.earnedPosition.staticCall(shortPositionId);
        const longStakerRewards = await insurancePool.earnedPosition.staticCall(longPositionId);
        const underwriterBonusReward = await insurancePool.earnedPosition.staticCall(0);

        expectAllowedUnderstaking(shortStakerRewards, expectedShortReward, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(longStakerRewards, expectedLongReward, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(underwriterBonusReward + shortStakerRewards + longStakerRewards, rewardAmount, ALLOWED_UNDERSTAKING);
    });

});
