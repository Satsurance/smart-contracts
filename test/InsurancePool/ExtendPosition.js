const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { getCurrentEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");

const { expect } = require("chai");
const { BASIS_POINTS, EPISODE_DURATION } = require("../constants.js");

describe("ExtendPosition", async function () {
    it("test extend active position", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const additionalDeposit = ethers.parseUnits("5", "ether");
        const initialEpisodeOffset = 5n;
        const extendedEpisodeOffset = 23n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const initialEpisodeToStake = currentEpisode + initialEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create underwriter position first
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, initialEpisodeToStake);

        // Create user position
        await insurancePool.connect(owner).joinPool(userStakeAmount, initialEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial position state
        const initialPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(initialPosition.episode).to.equal(initialEpisodeToStake);
        expect(initialPosition.shares).to.equal(userStakeAmount);
        expect(initialPosition.active).to.be.true;

        // Get initial episode state before extension
        const initialEpisodeState = await insurancePool.episodes(initialEpisodeToStake);

        // Test that only position owner can extend
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                underwriterPositionId,
                extendedEpisodeToStake,
                0,
                ethers.parseUnits("1", "ether")
            )
        ).to.be.revertedWith("Only position owner can extend");

        // Test that both deposit and withdraw cannot be done at the same time
        const anotherValidEpisode = currentEpisode + 20n; // Another valid episode within limits
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                ownerPositionId,
                anotherValidEpisode,
                ethers.parseUnits("1", "ether"),
                ethers.parseUnits("1", "ether")
            )
        ).to.be.revertedWith("It is only possible to deposit or withdraw, not both");

        // Test extending to earlier episode should fail
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                ownerPositionId,
                initialEpisodeToStake - 3n,
                0,
                0
            )
        ).to.be.revertedWith("It is not allowed to extend into a earlier episode");

        // Test that withdrawal is not allowed during extension from active position
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                ownerPositionId,
                extendedEpisodeToStake,
                ethers.parseUnits("1", "ether"), // Trying to withdraw from active position
                0 // No deposit
            )
        ).to.be.revertedWith("It is possible to withdraw on extend only for the expired positions");

        // Test extending position with additional deposit
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            additionalDeposit // amountToDeposit
        );

        // Verify position was extended correctly
        const extendedPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(extendedPosition.episode).to.equal(extendedEpisodeToStake);
        expect(extendedPosition.active).to.be.true;

        // Verify exact share amounts - should be initial stake + additional deposit
        const expectedTotalShares = userStakeAmount + additionalDeposit;
        expect(extendedPosition.shares).to.equal(expectedTotalShares);

        // Verify the position value is correct based on total pool assets
        const totalAssets = await insurancePool.totalAssetsStaked();
        const totalShares = await insurancePool.totalPoolShares();
        const expectedPositionValue = (extendedPosition.shares * totalAssets) / totalShares;
        expect(expectedPositionValue).to.equal(expectedTotalShares);

        // Verify episode was updated correctly
        expect(extendedPosition.episode).to.be.greaterThan(initialPosition.episode);
        expect(extendedPosition.episode).to.equal(extendedEpisodeToStake);

        // Verify that the original episode was cleaned up correctly
        const initialEpisodeStateAfter = await insurancePool.episodes(initialEpisodeToStake);

        // Calculate expected values for verification
        // For active position extension, the position's shares should be removed from original episode
        const expectedSharesReduction = userStakeAmount;
        const expectedRewardSharesReduction = initialPosition.rewardShares;

        // The assets reduction should be proportional to the position's share of the episode
        const totalAssetsAfterExtension = await insurancePool.totalAssetsStaked();
        const totalSharesAfterExtension = await insurancePool.totalPoolShares();
        const episodeAssetsAfterExtension = initialEpisodeStateAfter.episodeShares * totalAssetsAfterExtension / totalSharesAfterExtension;
        const expectedAssetsReduction = userStakeAmount; // For active positions, asset reduction equals original shares

        // Verify the cleanup
        expect(initialEpisodeStateAfter.episodeShares).to.equal(
            initialEpisodeState.episodeShares - expectedSharesReduction,
            "Original episode shares should be reduced by position shares"
        );

        expect(initialEpisodeStateAfter.rewardShares).to.equal(
            initialEpisodeState.rewardShares - expectedRewardSharesReduction,
            "Original episode reward shares should be reduced by position reward shares"
        );

        expect(initialEpisodeStateAfter.assetsStaked).to.equal(
            initialEpisodeState.assetsStaked - expectedAssetsReduction,
            "Original episode assets should be reduced by position assets"
        );

        expect(episodeAssetsAfterExtension).to.equal(
            initialEpisodeState.assetsStaked - expectedAssetsReduction,
            "Original episode assets should be reduced by position assets"
        );
    });

    it("test expired position extension basic", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create underwriter position first with longer duration
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, extendedEpisodeToStake);

        // Create user position that will expire soon
        await insurancePool.connect(owner).joinPool(userStakeAmount, shortEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial position state
        const initialPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(initialPosition.episode).to.equal(shortEpisodeToStake);
        expect(initialPosition.shares).to.equal(userStakeAmount);
        expect(initialPosition.active).to.be.true;

        // Advance time to make the position expire
        const episodeDuration = await insurancePool.EPISODE_DURATION();
        const positionExpiryTime = (shortEpisodeToStake + 1n) * episodeDuration;
        await time.increaseTo(positionExpiryTime + 1n);

        // Test basic extension of expired position without withdrawal or deposit
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            0  // amountToDeposit
        );

        // Verify position was extended correctly with same shares
        const extendedPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(extendedPosition.episode).to.equal(extendedEpisodeToStake);
        expect(extendedPosition.active).to.be.true;
        expect(extendedPosition.shares).to.equal(userStakeAmount);
    });

    it("test expired position extension with withdraw amount", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const withdrawAmount = ethers.parseUnits("3", "ether");
        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create underwriter position first with longer duration
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, extendedEpisodeToStake);

        // Create user position that will expire soon
        await insurancePool.connect(owner).joinPool(userStakeAmount, shortEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial position state
        const initialPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(initialPosition.episode).to.equal(shortEpisodeToStake);
        expect(initialPosition.shares).to.equal(userStakeAmount);
        expect(initialPosition.active).to.be.true;

        // Advance time to make the position expire
        const episodeDuration = await insurancePool.EPISODE_DURATION();
        const positionExpiryTime = (shortEpisodeToStake + 1n) * episodeDuration;
        await time.increaseTo(positionExpiryTime + 1n);

        // Test that trying to withdraw more than staked should fail
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                ownerPositionId,
                extendedEpisodeToStake,
                userStakeAmount + ethers.parseUnits("1", "ether"), // Try to withdraw more than staked
                0
            )
        ).to.be.reverted;

        // Test extending expired position with withdrawal only
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            extendedEpisodeToStake,
            withdrawAmount, // withdrawAmount - should be allowed for expired positions
            0 // amountToDeposit
        );

        // Verify position was extended correctly with reduced shares
        const extendedPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(extendedPosition.episode).to.equal(extendedEpisodeToStake);
        expect(extendedPosition.active).to.be.true;
        expect(extendedPosition.shares).to.equal(userStakeAmount - withdrawAmount);
    });

    it("test expired position extension with deposit amount", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const additionalDeposit = ethers.parseUnits("2", "ether");
        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create underwriter position first with longer duration
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, extendedEpisodeToStake);
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter, 0);

        // Create user position that will expire soon
        await insurancePool.connect(owner).joinPool(userStakeAmount, shortEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner, 0);

        // Get initial position state
        const initialPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(initialPosition.episode).to.equal(shortEpisodeToStake);
        expect(initialPosition.shares).to.equal(userStakeAmount);
        expect(initialPosition.active).to.be.true;

        // Advance time to make the position expire
        const episodeDuration = await insurancePool.EPISODE_DURATION();
        const positionExpiryTime = (shortEpisodeToStake + 1n) * episodeDuration;
        await time.increaseTo(positionExpiryTime + 1n);

        // Test extending expired position with deposit only
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            additionalDeposit // amountToDeposit
        );

        // Verify position was extended correctly with increased shares
        const extendedPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(extendedPosition.episode).to.equal(extendedEpisodeToStake);
        expect(extendedPosition.active).to.be.true;
        expect(extendedPosition.shares).to.equal(userStakeAmount + additionalDeposit);

        // Verify assets accounted correctly
        const totalAssets = await insurancePool.totalAssetsStaked();
        const totalShares = await insurancePool.totalPoolShares();
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const underwriterPositionAmount = (underwriterPosition.shares * totalAssets) / totalShares;
        const userPositionAmount = (extendedPosition.shares * totalAssets) / totalShares;
        expect(userPositionAmount).to.equal(userStakeAmount + additionalDeposit);
        expect(underwriterPositionAmount).to.equal(underwriterStakeAmount);
        expect(totalAssets).to.equal(userStakeAmount + underwriterStakeAmount + additionalDeposit);
    });

    it("should be possible to extend to the same position by adding new shares", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const additionalDeposit = ethers.parseUnits("5", "ether");
        const initialEpisodeOffset = 2n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const initialEpisodeToStake = currentEpisode + initialEpisodeOffset;

        // Create underwriter position first
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, initialEpisodeToStake);

        // Create user position
        await insurancePool.connect(owner).joinPool(userStakeAmount, initialEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Get initial position state
        const initialPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(initialPosition.episode).to.equal(initialEpisodeToStake);
        expect(initialPosition.shares).to.equal(userStakeAmount);
        expect(initialPosition.active).to.be.true;

        // Test extending position with additional deposit to the same episode
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            initialEpisodeToStake,
            0, // withdrawAmount
            additionalDeposit // amountToDeposit
        );

        // Verify position was extended correctly
        const extendedPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(extendedPosition.episode).to.equal(initialEpisodeToStake);
        expect(extendedPosition.active).to.be.true;

        // Verify exact share amounts - should be initial stake + additional deposit
        const expectedTotalShares = userStakeAmount + additionalDeposit;
        expect(extendedPosition.shares).to.equal(expectedTotalShares);

        // Verify assets accounted correctly
        const totalAssets = await insurancePool.totalAssetsStaked();
        const totalShares = await insurancePool.totalPoolShares();
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const underwriterPositionAmount = (underwriterPosition.shares * totalAssets) / totalShares;
        const userPositionAmount = (extendedPosition.shares * totalAssets) / totalShares;
        expect(userPositionAmount).to.equal(userStakeAmount + additionalDeposit);
        expect(underwriterPositionAmount).to.equal(underwriterStakeAmount);
        expect(totalAssets).to.equal(userStakeAmount + underwriterStakeAmount + additionalDeposit);
    });

    it("should not be possible to extend with too small underwriter shares with withdraw amount", async function () {
        const underwriterStakeAmount = ethers.parseUnits("20", "ether");
        const userStakeAmount = ethers.parseUnits("90", "ether");
        const withdrawAmountToPass = ethers.parseUnits("10", "ether");
        const withdrawAmountToFail = withdrawAmountToPass + 1n;

        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create underwriter position first, this one will expire
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, shortEpisodeToStake);

        // Create user position that will not expire
        await insurancePool.connect(owner).joinPool(userStakeAmount, extendedEpisodeToStake);

        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

        // Advance time to make the underwriter's position expire
        const episodeDuration = await insurancePool.EPISODE_DURATION();
        const positionExpiryTime = (shortEpisodeToStake + 1n) * episodeDuration;
        await time.increaseTo(positionExpiryTime + 1n);

        // Test extending expired position with withdrawal that makes stake too small
        await expect(insurancePool.connect(poolUnderwriter).extendPoolPosition(
            underwriterPositionId,
            extendedEpisodeToStake,
            withdrawAmountToFail,
            0 // amountToDeposit
        )).to.be.revertedWith("Underwriter position can't be less than allowed");

        // Test extending expired position will not fail if underwriter shares are enough
        await insurancePool.connect(poolUnderwriter).extendPoolPosition(
            underwriterPositionId,
            extendedEpisodeToStake,
            withdrawAmountToPass,
            0 // amountToDeposit
        );
    });

    it("should not be possible to extend with more deposit that allowed by underwriter limits", async function () {
        const underwriterStakeAmount = ethers.parseUnits("10", "ether"); // Small underwriter stake
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const initialEpisodeOffset = 5n;
        const extendedEpisodeOffset = 23n;

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const minUnderwriterPercentage = await insurancePool.minUnderwriterPercentage();
        const initialEpisodeToStake = currentEpisode + initialEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create small underwriter position first
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, initialEpisodeToStake);

        // Create user position
        await insurancePool.connect(owner).joinPool(userStakeAmount, initialEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Calculate the maximum additional deposit allowed
        let totalPoolShares = await insurancePool.totalPoolShares();
        const additionalDepositToPass = await insurancePool.maxSharesUserToStake();
        const additionalDepositToFail = additionalDepositToPass + 1n;

        const expectedMaximumAdditionalDeposit = (underwriterStakeAmount * BASIS_POINTS / minUnderwriterPercentage) - totalPoolShares;
        expect(additionalDepositToPass).to.equal(expectedMaximumAdditionalDeposit);

        // Test that extending with too many additional shares fails
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                ownerPositionId,
                extendedEpisodeToStake,
                0, // withdrawAmount
                additionalDepositToFail
            )
        ).to.be.revertedWith("Underwriter position can't be less than allowed");

        // Test that extending with the maximum allowed additional shares succeeds
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            additionalDepositToPass // This should be exactly at the limit
        );

        // Verify that the underwriter percentage constraint is satisfied
        totalPoolShares = await insurancePool.totalPoolShares();
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const underwriterPercentage = (underwriterPosition.shares * 10000n) / totalPoolShares;
        expect(underwriterPercentage).to.be.equals(minUnderwriterPercentage);
    });

    it("should not be possible to extend user position with more deposit that allowed by underwriter limits", async function () {
        const underwriterStakeAmount = ethers.parseUnits("10", "ether"); // Small underwriter stake
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const minUnderwriterPercentage = await insurancePool.minUnderwriterPercentage();
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // Create small underwriter position that will expire soon
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, shortEpisodeToStake);

        // Create user position with longer duration
        await insurancePool.connect(owner).joinPool(userStakeAmount, extendedEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

        // Advance time to make the underwriter position expire
        const episodeDuration = await insurancePool.EPISODE_DURATION();
        const positionExpiryTime = (shortEpisodeToStake + 1n) * episodeDuration;
        // Calculate the maximum additional deposit allowed
        let totalPoolShares = await insurancePool.totalPoolShares();
        const additionalDepositToPass = await insurancePool.maxSharesUserToStake();
        const additionalDepositToFail = additionalDepositToPass + 1n;

        const expectedMaximumAdditionalDeposit = (underwriterStakeAmount * BASIS_POINTS / minUnderwriterPercentage) - totalPoolShares;
        expect(additionalDepositToPass).to.equal(expectedMaximumAdditionalDeposit);

        await time.increaseTo(positionExpiryTime + 1n);

        // Test that extending expired underwriter position with too many additional shares fails
        await expect(
            insurancePool.connect(owner).extendPoolPosition(
                ownerPositionId,
                extendedEpisodeToStake,
                0, // withdrawAmount
                additionalDepositToFail
            )
        ).to.be.revertedWith("Underwriter position can't be less than allowed");

        // Test that extending with the maximum allowed additional shares succeeds
        await insurancePool.connect(owner).extendPoolPosition(
            ownerPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            additionalDepositToPass // This should be exactly at the limit
        );

        // Verify that the underwriter percentage constraint is satisfied
        totalPoolShares = await insurancePool.totalPoolShares();
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const underwriterPercentage = (underwriterPosition.shares * 10000n) / (totalPoolShares + underwriterPosition.shares);
        expect(underwriterPercentage).to.be.equals(minUnderwriterPercentage);
    });

    it("should allow user to quit position after underwriter extends from same expired episode", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const additionalDeposit = ethers.parseUnits("1", "ether");
        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // 1. Both underwriter and user deposit to the same episode
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, shortEpisodeToStake);
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

        await insurancePool.connect(owner).joinPool(userStakeAmount, shortEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner, 0);

        // Also create user position at the target episode (where underwriter will extend to)
        await insurancePool.connect(owner).joinPool(userStakeAmount, extendedEpisodeToStake);
        const ownerAdditionalPositionId = await positionNFT.tokenOfOwnerByIndex(owner, 1);

        // 2. Advance time to make both positions expire
        await time.increaseTo((shortEpisodeToStake + 1n) * EPISODE_DURATION + 1n);

        // 3. Underwriter extends their position to a new episode
        await insurancePool.connect(poolUnderwriter).extendPoolPosition(
            underwriterPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            additionalDeposit // amountToDeposit
        );

        // 4. User successfully quits their position from the expired episode
        const userPosition = await insurancePool.getPoolPosition(ownerPositionId);
        let totalAssets = await insurancePool.totalAssetsStaked();
        let totalShares = await insurancePool.totalPoolShares();
        const userPositionAmount = (userPosition.shares * totalAssets) / totalShares;
        expect(userPositionAmount).to.equal(userStakeAmount);

        await insurancePool.connect(owner).quitPoolPosition(ownerPositionId);


        // Verify the original episode was cleaned up properly
        const finalEpisodeState = await insurancePool.episodes(shortEpisodeToStake);
        expect(finalEpisodeState.episodeShares).to.equal(0); // All shares removed
        expect(finalEpisodeState.assetsStaked).to.equal(0); // All assets removed

        // 5. Advance time to make the extended episode expire
        await time.increaseTo((extendedEpisodeToStake + 1n) * EPISODE_DURATION + 1n);

        // 6. Underwriter quits their position from the expired episode
        const latestEpisode = await insurancePool.episodes(extendedEpisodeToStake);
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);

        const underwriterPositionAmount = (underwriterPosition.shares * latestEpisode.assetsStaked) / latestEpisode.episodeShares;
        expect(underwriterPositionAmount).to.equal(underwriterStakeAmount + additionalDeposit);

        await insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId);

        // 7. User quits their additional position from the expired extended episode
        const userAdditionalPosition = await insurancePool.getPoolPosition(ownerAdditionalPositionId);
        totalAssets = await insurancePool.totalAssetsStaked();
        totalShares = await insurancePool.totalPoolShares();
        const userAdditionalPositionAmount = (userAdditionalPosition.shares * latestEpisode.assetsStaked) / latestEpisode.episodeShares;
        expect(userAdditionalPositionAmount).to.equal(userStakeAmount);

        await insurancePool.connect(owner).quitPoolPosition(ownerAdditionalPositionId);
    });

    it("should allow user to quit position after underwriter extends from same active episode", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");
        const additionalDeposit = ethers.parseUnits("1", "ether");
        const shortEpisodeOffset = 2n;
        const extendedEpisodeOffset = 23n;

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const currentEpisode = BigInt(await getCurrentEpisode());
        const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
        const extendedEpisodeToStake = currentEpisode + extendedEpisodeOffset;

        // 1. Both underwriter and user deposit to the same episode
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, shortEpisodeToStake);
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

        await insurancePool.connect(owner).joinPool(userStakeAmount, shortEpisodeToStake);
        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

        // Also create user position at the target episode (where underwriter will extend to)
        await insurancePool.connect(owner).joinPool(userStakeAmount, extendedEpisodeToStake);
        const ownerAdditionalPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 1);

        // Verify both positions are in the same episode
        const initialUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const initialUserPosition = await insurancePool.getPoolPosition(ownerPositionId);
        expect(initialUnderwriterPosition.episode).to.equal(shortEpisodeToStake);
        expect(initialUserPosition.episode).to.equal(shortEpisodeToStake);
        expect(initialUnderwriterPosition.active).to.be.true;
        expect(initialUserPosition.active).to.be.true;

        // 2. Underwriter extends their position to a new episode BEFORE the episode expires
        await insurancePool.connect(poolUnderwriter).extendPoolPosition(
            underwriterPositionId,
            extendedEpisodeToStake,
            0, // withdrawAmount
            additionalDeposit // amountToDeposit
        );

        // Verify underwriter position was extended
        const extendedUnderwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        expect(extendedUnderwriterPosition.episode).to.equal(extendedEpisodeToStake);
        expect(extendedUnderwriterPosition.active).to.be.true;

        // 3. Advance time to make the original episode expire (but not the extended one)
        await time.increaseTo((shortEpisodeToStake + 1n) * EPISODE_DURATION + 1n);

        // 4. User successfully quits their position from the expired episode
        const userPosition = await insurancePool.getPoolPosition(ownerPositionId);
        const userEpisode = await insurancePool.episodes(shortEpisodeToStake);
        const userPositionAmount = (userPosition.shares * userEpisode.assetsStaked) / userEpisode.episodeShares;
        expect(userPositionAmount).to.equal(userStakeAmount);

        await insurancePool.connect(owner).quitPoolPosition(ownerPositionId);

        // Verify the original episode was cleaned up properly
        const finalEpisodeState = await insurancePool.episodes(shortEpisodeToStake);
        expect(finalEpisodeState.episodeShares).to.equal(0); // All shares removed
        expect(finalEpisodeState.assetsStaked).to.equal(0); // All assets removed

        // 5. Advance time to make the extended episode expire
        await time.increaseTo((extendedEpisodeToStake + 1n) * EPISODE_DURATION + 1n);

        // 6. Underwriter quits their position from the expired episode
        const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
        const latestEpisode = await insurancePool.episodes(extendedEpisodeToStake);

        const underwriterPositionAmount = (underwriterPosition.shares * latestEpisode.assetsStaked) / latestEpisode.episodeShares;
        expect(underwriterPositionAmount).to.equal(underwriterStakeAmount + additionalDeposit);

        await insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId);

        // 7. User quits their additional position from the expired extended episode
        const userAdditionalPosition = await insurancePool.getPoolPosition(ownerAdditionalPositionId);
        const userAdditionalPositionAmount = (userAdditionalPosition.shares * latestEpisode.assetsStaked) / latestEpisode.episodeShares;
        expect(userAdditionalPositionAmount).to.equal(userStakeAmount);

        await insurancePool.connect(owner).quitPoolPosition(ownerAdditionalPositionId);
    });
}); 