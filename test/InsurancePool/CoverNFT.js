const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { getCurrentEpisode, purchaseCoverage, findClosestStakableEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { expect } = require("chai");

describe("CoverNFT", async function () {

    it("cover NFT is not transferable (soulbound)", async function () {
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const coverageAmount = ethers.parseUnits("10", "ether");

        const { btcToken, insurancePool, coverNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const signers = await ethers.getSigners();
        const addr1 = signers[2]; // Third signer for transfer attempt

        const episodeToStake = await findClosestStakableEpisode(23n);

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Purchase coverage to mint a CoverNFT
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
        });

        // Get the cover NFT token ID
        const coverTokenId = await coverNFT.tokenOfOwnerByIndex(owner.address, 0);
        expect(await coverNFT.ownerOf(coverTokenId)).to.equal(owner.address);

        // Try to transfer the CoverNFT and expect it to fail with soulbound error
        await expect(
            coverNFT.connect(owner).transferFrom(owner.address, addr1.address, coverTokenId)
        ).to.be.revertedWith("CoverNFT: Token is soulbound and cannot be transferred");

        // Test safeTransferFrom as well
        await expect(
            coverNFT.connect(owner).safeTransferFrom(owner.address, addr1.address, coverTokenId)
        ).to.be.revertedWith("CoverNFT: Token is soulbound and cannot be transferred");

        // Verify the NFT is still owned by the original owner
        expect(await coverNFT.ownerOf(coverTokenId)).to.equal(owner.address);
    });

});
