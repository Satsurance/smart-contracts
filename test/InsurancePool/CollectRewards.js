const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { purchaseCoverage, getCurrentEpisode, expectAllowedUnderstaking } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { ALLOWED_UNDERSTAKING, SECS_IN_DAY, EPISODE_DURATION } = require("../constants.js");

describe("InsurancePool", function () {
    it("should collect rewards for a single position", async function () {
        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const ownerStakeAmount = ethers.parseUnits("10", "ether");
        const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
        const coverageAmountMultiplier = 10n;
        const episodeOffset = 23n;

        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        await insurancePool.connect(poolUnderwriter).joinPool(underwriterStakeAmount, episodeToStake);
        await insurancePool.joinPool(ownerStakeAmount, episodeToStake);

        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner,
            coverageAmount: coveragePurchaseAmount * coverageAmountMultiplier,
        });

        await time.increase(SECS_IN_DAY * 400);

        const balanceBefore = await btcToken.balanceOf(owner.address);

        // Expect earnedPosition function to be well tested in other tests
        const earnedAmount = await insurancePool.earnedPosition.staticCall(ownerPositionId);
        await insurancePool.connect(owner).collectRewards([ownerPositionId]);
        const balanceAfter = await btcToken.balanceOf(owner.address);
        const collectedAmount = balanceAfter - balanceBefore;

        expectAllowedUnderstaking(collectedAmount, earnedAmount, ALLOWED_UNDERSTAKING);
    });

    it("should earn same rewards for two identical positions with cyclic collection every 10 days", async function () {
        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const ownerStakeAmount = ethers.parseUnits("10", "ether");
        const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
        const coverageAmountMultiplier = 10n;
        const episodeOffset = 23n;
        const collectionCycles = 20;

        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Create underwriter position
        await insurancePool.connect(poolUnderwriter).joinPool(underwriterStakeAmount, episodeToStake);

        // Create two identical positions for owner
        await insurancePool.joinPool(ownerStakeAmount, episodeToStake);
        await insurancePool.joinPool(ownerStakeAmount, episodeToStake);

        const ownerPositionId1 = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
        const ownerPositionId2 = await positionNFT.tokenOfOwnerByIndex(owner.address, 1);

        // Purchase coverage
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner,
            coverageAmount: coveragePurchaseAmount * coverageAmountMultiplier,
        });

        let totalCollected1 = 0n;

        // Collect rewards every 10 days in a cycle for first position only
        for (let cycle = 0; cycle < collectionCycles; cycle++) {
            // Wait 10 days
            await time.increase(SECS_IN_DAY * 20);

            // Collect rewards from first position only
            const balanceBefore1 = await btcToken.balanceOf(owner.address);
            await insurancePool.connect(owner).collectRewards([ownerPositionId1]);
            const balanceAfter1 = await btcToken.balanceOf(owner.address);
            const collectedAmount1 = balanceAfter1 - balanceBefore1;
            totalCollected1 += collectedAmount1;
        }

        // Get total earned amount from second position (etalon) - this accumulated over the entire period
        const totalEarnedPosition2 = await insurancePool.earnedPosition.staticCall(ownerPositionId2);
        expect(totalCollected1).to.be.equal(totalEarnedPosition2);

    });
});
