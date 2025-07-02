const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { getCurrentEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");

const { expect } = require("chai");

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
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("100", "ether");
        const withdrawAmountToPass = ethers.parseUnits("90", "ether");
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
        )
    });
}); 