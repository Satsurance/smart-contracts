const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { getCurrentEpisode, findClosestStakableEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { expect } = require("chai");

describe("PositionNFT", async function () {

    it("regular stakers can transfer NFT", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const signers = await ethers.getSigners();
        const addr1 = signers[2]; // Third signer

        const episodeToStake = await findClosestStakableEpisode(23n);

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);
        await insurancePool
            .connect(owner)
            .joinPool(userStakeAmount, episodeToStake);


        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
        expect(await positionNFT.ownerOf(ownerPositionId)).to.equal(owner.address);

        await positionNFT.connect(owner).transferFrom(owner.address, addr1.address, ownerPositionId);
        expect(await positionNFT.ownerOf(ownerPositionId)).to.equal(addr1.address);

        await positionNFT.connect(addr1).safeTransferFrom(addr1.address, owner.address, ownerPositionId);
        expect(await positionNFT.ownerOf(ownerPositionId)).to.equal(owner.address);
    });

    it("underwriter cannot transfer NFT (as sender)", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const episodeToStake = await findClosestStakableEpisode(23n);

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
        expect(await positionNFT.ownerOf(underwriterPositionId)).to.equal(poolUnderwriter.address);

        // Underwriter should NOT be able to transfer NFT (as sender)
        await expect(
            positionNFT.connect(poolUnderwriter).transferFrom(poolUnderwriter.address, owner.address, underwriterPositionId)
        ).to.be.revertedWithCustomError(positionNFT, "UnauthorizedTransfer");

        // Test safeTransferFrom as well
        await expect(
            positionNFT.connect(poolUnderwriter).safeTransferFrom(poolUnderwriter.address, owner.address, underwriterPositionId)
        ).to.be.revertedWithCustomError(positionNFT, "UnauthorizedTransfer");
    });

    it("underwriter cannot receive NFT (as receiver)", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");

        const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        // Calculate valid episode for staking
        const episodeToStake = await findClosestStakableEpisode(23n);

        // Create underwriter position first (required for pool to function)
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Create regular user position
        await insurancePool
            .connect(owner)
            .joinPool(userStakeAmount, episodeToStake);


        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
        expect(await positionNFT.ownerOf(ownerPositionId)).to.equal(owner.address);

        // Regular user should NOT be able to transfer NFT to underwriter (as receiver)
        await expect(
            positionNFT.connect(owner).transferFrom(owner.address, poolUnderwriter.address, ownerPositionId)
        ).to.be.revertedWithCustomError(positionNFT, "UnauthorizedTransfer");

        // Test safeTransferFrom as well
        await expect(
            positionNFT.connect(owner).safeTransferFrom(owner.address, poolUnderwriter.address, ownerPositionId)
        ).to.be.revertedWithCustomError(positionNFT, "UnauthorizedTransfer");
    });

    it("new NFT owner can quit pool after transfer", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const userStakeAmount = ethers.parseUnits("10", "ether");

        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const signers = await ethers.getSigners();
        const newOwner = signers[2]; // Third signer

        const episodeToStake = await findClosestStakableEpisode(23n);

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        await insurancePool
            .connect(owner)
            .joinPool(userStakeAmount, episodeToStake);


        const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
        await positionNFT.connect(owner).transferFrom(owner.address, newOwner.address, ownerPositionId);
        expect(await positionNFT.ownerOf(ownerPositionId)).to.equal(newOwner.address);

        const episodeDuration = await insurancePool.EPISODE_DURATION();
        const positionExpiryTime = (episodeToStake + 1n) * episodeDuration;
        await time.increaseTo(positionExpiryTime + 1n);


        // Original owner should NOT be able to quit the position anymore
        await expect(
            insurancePool.connect(owner).quitPoolPosition(ownerPositionId)
        ).to.be.revertedWith("Only position owner can remove");

        // New owner should be able to quit the position
        await insurancePool.connect(newOwner).quitPoolPosition(ownerPositionId);
    });
});
