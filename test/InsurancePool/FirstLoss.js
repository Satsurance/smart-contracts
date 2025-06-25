const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode, expectAllowedUnderstaking } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { ALLOWED_UNDERSTAKING, MINIMUM_STAKE_AMOUNT_BTC } = require("../constants.js");

const { expect } = require("chai");

async function firstLoss10PercentFixture() {
    return basicFixture({ underwriterFirstLoss: 1000 }); // 10%
}


describe("Underwriter First Loss Slashing", async function () {

    it("test underwriter first loss covers entire claim", async function () {
        const underwriterStakeAmount = ethers.parseUnits("10", "ether");
        const userStakeAmount = ethers.parseUnits("90", "ether");
        const claimAmount = ethers.parseUnits("5", "ether"); // Small claim that should be covered by first loss
        const episodeOffset = 23;

        // Set underwriter first loss to 10% (1000 basis points)
        const underwriterFirstLoss = 1000; // 10%

        const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
            firstLoss10PercentFixture
        );
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Join pool with underwriter first
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Join pool with regular user
        await insurancePool.connect(owner).joinPool(userStakeAmount, episodeToStake);

        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        const userPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial positions
        const initialUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const initialUserPosition = await insurancePool.getPoolPosition(userPositionId);
        const initialTotalAssets = await insurancePool.totalAssetsStaked();
        const initialTotalShares = await insurancePool.totalPoolShares();

        // Calculate expected underwriter stake value
        const initialUnderwriterStakeValue = (initialUnderwriterPosition.shares * initialTotalAssets) / initialTotalShares;

        // Create and execute claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            "Test underwriter first loss claim",
            claimAmount
        );
        await claimer.approveClaim(0);
        await time.increase(deploymentParams.executionTimeout + 1);
        await claimer.executeClaim(0);

        // Get positions after slashing
        const finalUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const finalUserPosition = await insurancePool.getPoolPosition(userPositionId);
        const finalTotalAssets = await insurancePool.totalAssetsStaked();
        const finalTotalShares = await insurancePool.totalPoolShares();

        // Calculate final underwriter stake value
        const finalUnderwriterStakeValue = (finalUnderwriterPosition.shares * finalTotalAssets) / finalTotalShares;

        // Verify underwriter position was reduced by claim amount
        expect(initialUnderwriterStakeValue - claimAmount).equal(finalUnderwriterStakeValue);

        // Verify user position value was NOT affected
        const finalUserStakeValue = (finalUserPosition.shares * finalTotalAssets) / finalTotalShares;
        expect(finalUserStakeValue).equal(userStakeAmount);

        // Verify total assets decreased by claim amount
        expect(initialTotalAssets - finalTotalAssets).to.equal(claimAmount);
    });

    it("test claim exceeds underwriter first loss - remainder slashed proportionally", async function () {
        const underwriterStakeAmount = ethers.parseUnits("10", "ether");
        const userStakeAmount = ethers.parseUnits("90", "ether");
        const claimAmount = ethers.parseUnits("20", "ether"); // Large claim that exceeds first loss
        const episodeOffset = 23;

        // Set underwriter first loss to 10% (1000 basis points)
        const underwriterFirstLoss = 1000; // 10%

        const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
            firstLoss10PercentFixture
        );
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Join pool
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);
        await insurancePool.connect(owner).joinPool(userStakeAmount, episodeToStake);

        const initialTotalAssets = await insurancePool.totalAssetsStaked();

        // Calculate expected values
        const maxUnderwriterBurn = (BigInt(underwriterFirstLoss) * initialTotalAssets) / 10000n;
        const leftToSlash = claimAmount - maxUnderwriterBurn;

        // Create and execute claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            "Test large claim exceeding first loss",
            claimAmount
        );
        await claimer.approveClaim(0);
        await time.increase(deploymentParams.executionTimeout + 1);
        await claimer.executeClaim(0);

        // Get final state
        const finalTotalAssets = await insurancePool.totalAssetsStaked();
        const finalTotalShares = await insurancePool.totalPoolShares();
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        const userPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial state
        const userPosition = await insurancePool.getPoolPosition(userPositionId);

        // Verify total assets decreased by full claim amount
        expect(initialTotalAssets - finalTotalAssets).to.equal(claimAmount);

        const finalUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        expect(finalUnderwriterPosition.shares).to.equal(0);
        expect(userPosition.shares * finalTotalAssets / finalTotalShares).to.equal(userStakeAmount - leftToSlash);


    });


    it("test multiple claims with underwriter first loss", async function () {
        const underwriterStakeAmount = ethers.parseUnits("10", "ether");
        const userStakeAmount = ethers.parseUnits("90", "ether");
        const claim1Amount = ethers.parseUnits("3", "ether");
        const claim2Amount = ethers.parseUnits("5", "ether");
        const episodeOffset = 23;

        // Set underwriter first loss to 10%
        const underwriterFirstLoss = 1000; // 10%

        const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
            firstLoss10PercentFixture
        );
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Join pool
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);
        await insurancePool.connect(owner).joinPool(userStakeAmount, episodeToStake);

        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        const userPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial state
        const initialTotalAssets = await insurancePool.totalAssetsStaked();
        const initialUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const initialTotalShares = await insurancePool.totalPoolShares();
        const initialUnderwriterStakeValue = (initialUnderwriterPosition.shares * initialTotalAssets) / initialTotalShares;

        // First claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            "First claim",
            claim1Amount
        );
        await claimer.approveClaim(0);
        await time.increase(deploymentParams.executionTimeout + 1);
        await claimer.executeClaim(0);


        // Second claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            "Second claim",
            claim2Amount
        );
        await claimer.approveClaim(1);
        await time.increase(deploymentParams.executionTimeout + 1);
        await claimer.executeClaim(1);

        // Get final state
        const finalTotalAssets = await insurancePool.totalAssetsStaked();
        const finalUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const finalUserPosition = await insurancePool.getPoolPosition(userPositionId);
        const finalTotalShares = await insurancePool.totalPoolShares();

        const finalUnderwriterStakeValue = (finalUnderwriterPosition.shares * finalTotalAssets) / finalTotalShares;
        const finalUserStakeValue = (finalUserPosition.shares * finalTotalAssets) / finalTotalShares;

        // Verify second claim was also absorbed by underwriter (total should be both claims)
        expect(finalUnderwriterStakeValue).to.equal(initialUnderwriterStakeValue - claim1Amount - claim2Amount);
        expect(finalUserStakeValue).to.equal(userStakeAmount);

        // Verify total pool reduction equals both claims
        expect(initialTotalAssets - finalTotalAssets).to.equal(claim1Amount + claim2Amount);
    });

});
