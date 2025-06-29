const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode, expectAllowedUnderstaking } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { ALLOWED_UNDERSTAKING, EPISODE_DURATION, SECS_IN_DAY, BASIS_POINTS } = require("../constants.js");

const { expect } = require("chai");


describe("Underwriter Fee", async function () {

    it("test underwriter fee accounts", async function () {
        const stakerAmount = ethers.parseUnits("10", "ether");
        const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
        const coverageAmountMultiplier = 10n;
        const underwriterFee = 1000n;
        const episodeOffset = 23n;

        // Expected calculations
        const rewardPercentage = 85n; // 85% goes to0 stakers, 15% protocol fee
        const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier;

        // Calculate expected rewards
        const expectedUserRewardShares = stakerAmount;
        const expectedUnderwriterRewardShares = stakerAmount;
        const expectedUnderwriterBonusRewardShares = (expectedUserRewardShares + expectedUnderwriterRewardShares) * underwriterFee / (BASIS_POINTS - underwriterFee);
        const expectedTotalRewardShares = expectedUserRewardShares + expectedUnderwriterRewardShares + expectedUnderwriterBonusRewardShares;

        const rewardAmount = coveragePurchaseAmount * rewardPercentage / 100n;
        const expectedUserReward = rewardAmount * expectedUserRewardShares / expectedTotalRewardShares;
        const expectedUnderwriterReward = rewardAmount * expectedUnderwriterRewardShares / expectedTotalRewardShares;
        const expectedUnderwriterBonusReward = rewardAmount * expectedUnderwriterBonusRewardShares / expectedTotalRewardShares;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;


        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Create underwriter position (long duration for comparison)
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(stakerAmount, episodeToStake);
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter, 0);

        // Create two user positions - one short, one long
        await insurancePool.connect(owner).joinPool(stakerAmount, episodeToStake);
        const userPositionId = await positionNFT.tokenOfOwnerByIndex(owner, 0);


        // Verify positions were created with same shares but different reward shares
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const userPosition = await insurancePool.getPoolPosition(userPositionId);
        const underwriterBonusPosition = await insurancePool.getPoolPosition(0);
        const totalRewardShares = await insurancePool.totalRewardShares();


        expect(underwriterPosition.rewardShares).to.equal(expectedUnderwriterRewardShares);
        expect(userPosition.rewardShares).to.equal(expectedUserRewardShares);
        expect(underwriterBonusPosition.rewardShares).to.equal(expectedUnderwriterBonusRewardShares);
        expect(totalRewardShares).to.equal(expectedTotalRewardShares);

        // Purchase coverage to generate rewards
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
        });

        // Wait for rewards to accumulate
        await time.increase(SECS_IN_DAY * 400);

        const userReward = await insurancePool.earnedPosition.staticCall(userPositionId);
        const underwriterReward = await insurancePool.earnedPosition.staticCall(underwriterPositionId);
        const underwriterBonusReward = await insurancePool.earnedPosition.staticCall(0);

        expectAllowedUnderstaking(userReward, expectedUserReward, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(underwriterReward, expectedUnderwriterReward, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(underwriterBonusReward, expectedUnderwriterBonusReward, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(userReward + underwriterReward + underwriterBonusReward, rewardAmount, ALLOWED_UNDERSTAKING);
    });

    it("test setting underwriter fee for empty pool", async function () {
        const initialUnderwriterFee = 1000n; // 10%
        const newUnderwriterFee = 500n; // 5%

        const { insurancePool, accounts } = await loadFixture(basicFixture);
        const { poolUnderwriter, owner } = accounts;

        // Verify initial underwriter fee
        const currentUnderwriterFee = await insurancePool.underwriterFee();
        expect(currentUnderwriterFee).to.equal(initialUnderwriterFee);

        await insurancePool.connect(poolUnderwriter).setUnderwriterFee(newUnderwriterFee);

        // Verify the fee was updated
        const updatedUnderwriterFee = await insurancePool.underwriterFee();
        expect(updatedUnderwriterFee).to.equal(newUnderwriterFee);
    });

    it("test changing underwriter fee with active rewards", async function () {
        const stakerAmount = ethers.parseUnits("10", "ether");
        const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
        const coverageAmountMultiplier = 10n;
        const initialUnderwriterFee = 1000n; // 10%
        const newUnderwriterFee = 500n; // 5%
        const episodeOffset = 23n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;
        const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier;
        const rewardPercentage = 85n; // 85% goes to stakers, 15% protocol fee
        const rewardAmount = coveragePurchaseAmount * rewardPercentage / 100n;

        // Create positions
        await insurancePool.connect(poolUnderwriter).joinPool(stakerAmount, episodeToStake);
        await insurancePool.connect(owner).joinPool(stakerAmount, episodeToStake);

        //  First verify initial stake
        const expectedUserRewardShares = stakerAmount;
        const expectedUnderwriterRewardShares = stakerAmount;
        const expectedUnderwriterBonusRewardShares = (expectedUserRewardShares + expectedUnderwriterRewardShares) * initialUnderwriterFee / (BASIS_POINTS - initialUnderwriterFee);
        const expectedTotalRewardShares = expectedUserRewardShares + expectedUnderwriterRewardShares + expectedUnderwriterBonusRewardShares;

        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter, 0);
        const userPositionId = await positionNFT.tokenOfOwnerByIndex(owner, 0);
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const userPosition = await insurancePool.getPoolPosition(userPositionId);
        let underwriterBonusPosition = await insurancePool.getPoolPosition(0);
        let totalRewardShares = await insurancePool.totalRewardShares();

        expect(underwriterPosition.rewardShares).to.equal(expectedUnderwriterRewardShares);
        expect(userPosition.rewardShares).to.equal(expectedUserRewardShares);
        expect(underwriterBonusPosition.rewardShares).to.equal(expectedUnderwriterBonusRewardShares);
        expect(totalRewardShares).to.equal(expectedTotalRewardShares);

        // Purchase coverage to generate rewards
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
        });
        // Wait for some rewards to accumulate
        const purchaseTime = await time.latest();
        await time.increase(SECS_IN_DAY * 200);
        const firstChuckTime = await time.latest();


        const rewardDuration = ((BigInt(purchaseTime) + 365n * BigInt(SECS_IN_DAY)) / EPISODE_DURATION + 1n) * EPISODE_DURATION - BigInt(purchaseTime);

        const expectedUserReward1Chunk = userPosition.rewardShares * rewardAmount * BigInt(firstChuckTime - purchaseTime) / (rewardDuration * totalRewardShares);
        const expectedUnderwriterReward1Chunk = underwriterPosition.rewardShares * rewardAmount * BigInt(firstChuckTime - purchaseTime) / (rewardDuration * totalRewardShares);
        const expectedUnderwriterBonusReward1Chunk = underwriterBonusPosition.rewardShares * rewardAmount * BigInt(firstChuckTime - purchaseTime) / (rewardDuration * totalRewardShares);

        const underwriterBonusReward1Chunk = await insurancePool.earnedPosition.staticCall(0);
        const userReward1Chunk = await insurancePool.earnedPosition.staticCall(userPositionId);
        const underwriterReward1Chunk = await insurancePool.earnedPosition.staticCall(underwriterPositionId);

        expectAllowedUnderstaking(userReward1Chunk, expectedUserReward1Chunk, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(underwriterReward1Chunk, expectedUnderwriterReward1Chunk, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(underwriterBonusReward1Chunk, expectedUnderwriterBonusReward1Chunk, ALLOWED_UNDERSTAKING);

        // Set new underwriter fee
        await insurancePool.connect(poolUnderwriter).setUnderwriterFee(newUnderwriterFee);

        // Wait for all rewards distributed
        await time.increase(SECS_IN_DAY * 400);

        underwriterBonusPosition = await insurancePool.getPoolPosition(0);
        totalRewardShares = await insurancePool.totalRewardShares();

        const expectedNewTotalRewardShares = 2n * stakerAmount + 2n * stakerAmount * newUnderwriterFee / (BASIS_POINTS - newUnderwriterFee);
        const expectedNewUnderwriterBonusRewardShares = 2n * stakerAmount * newUnderwriterFee / (BASIS_POINTS - newUnderwriterFee);

        expect(totalRewardShares).to.equal(expectedNewTotalRewardShares);
        expect(underwriterBonusPosition.rewardShares).to.equal(expectedNewUnderwriterBonusRewardShares);


        const expectedUserReward2Chunk = userPosition.rewardShares * rewardAmount * (rewardDuration - BigInt(firstChuckTime - purchaseTime)) / (rewardDuration * totalRewardShares);
        const expectedUnderwriterReward2Chunk = underwriterPosition.rewardShares * rewardAmount * (rewardDuration - BigInt(firstChuckTime - purchaseTime)) / (rewardDuration * totalRewardShares);
        const expectedUnderwriterBonusReward2Chunk = underwriterBonusPosition.rewardShares * rewardAmount * (rewardDuration - BigInt(firstChuckTime - purchaseTime)) / (rewardDuration * totalRewardShares);

        const userTotalReward = await insurancePool.earnedPosition.staticCall(userPositionId);
        const underwriterTotalReward = await insurancePool.earnedPosition.staticCall(underwriterPositionId);
        const underwriterBonusTotalReward = await insurancePool.earnedPosition.staticCall(0);


        expectAllowedUnderstaking(userTotalReward, expectedUserReward2Chunk + userReward1Chunk, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(underwriterTotalReward, expectedUnderwriterReward2Chunk + underwriterReward1Chunk, ALLOWED_UNDERSTAKING);
        expectAllowedUnderstaking(userTotalReward + underwriterTotalReward + underwriterBonusTotalReward, rewardAmount, ALLOWED_UNDERSTAKING);

        // There are some precision errors with timings for the small bonus rewards
        expect(underwriterBonusTotalReward).to.be.approximately(expectedUnderwriterBonusReward2Chunk + underwriterBonusReward1Chunk, ALLOWED_UNDERSTAKING * 4n / 3n);
    });

});
