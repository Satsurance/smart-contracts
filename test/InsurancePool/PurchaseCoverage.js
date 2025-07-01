const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { SECS_IN_DAY, EPISODE_DURATION } = require("../constants.js");
const { expect } = require("chai");

describe("PurchaseCoverage", function () {
    it("should successfully purchase coverage", async function () {
        // Test parameters
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const coverageAmount = ethers.parseUnits("10", "ether");
        const episodeOffset = 23n;

        // Load fixture with all contracts deployed and configured
        const { btcToken, insurancePool, coverNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        // Calculate valid episode for staking (required before coverage can be purchased)
        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Underwriter must join pool first to provide liquidity
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Get initial states
        const initialCoverNFTSupply = await coverNFT.totalSupply();
        const initialTotalCoverAllocation = await insurancePool.totalCoverAllocation();

        expect(await insurancePool.totalCoverAllocation()).to.equal(0);
        const product = await insurancePool.products(0);
        expect(product.allocation).to.equal(0);
        expect(initialCoverNFTSupply).to.equal(0);

        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
        });

        // Verify balances and states changed correctly
        const finalCoverNFTSupply = await coverNFT.totalSupply();
        const finalTotalCoverAllocation = await insurancePool.totalCoverAllocation();

        // Check that a new cover NFT was minted
        expect(finalCoverNFTSupply).to.equal(1);

        // Verify the cover NFT details
        const coverTokenId = finalCoverNFTSupply;
        const coverDetails = await coverNFT.covers(coverTokenId);


        expect(await coverNFT.ownerOf(coverTokenId)).to.equal(owner);
        expect(coverDetails.coveredAmount).to.equal(coverageAmount);
        expect(coverDetails.productId).to.equal(0);
        expect(coverDetails.poolId).to.equal(await insurancePool.poolId());

        // Verify NFT ownership
        expect(await coverNFT.ownerOf(coverTokenId)).to.equal(owner);

        // Verify product allocation was updated
        const updatedProduct = await insurancePool.products(0);
        expect(updatedProduct.allocation).to.equal(coverageAmount);

        // Verify total cover allocation was updated
        expect(finalTotalCoverAllocation).to.equal(coverageAmount);
    });

    it("should fail to purchase coverage exceeding product allocation", async function () {
        // Test parameters
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const episodeOffset = 23n;

        // Load fixture
        const { btcToken, insurancePool, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        // Calculate valid episode for staking
        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Underwriter joins pool
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // First, purchase coverage for the exact staked amount, which should succeed
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: underwriterStakeAmount, // Purchase the entire allocation
        });

        // Now, attempt to purchase a tiny bit more coverage
        const smallExtraCoverage = ethers.parseUnits("1", "wei");

        // Expect this second purchase to fail
        await expect(purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: smallExtraCoverage,
        })).to.be.revertedWith("Not enough assets to cover");
    });

    it("should handle allocations for multiple products independently", async function () {
        // Test parameters
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const episodeOffset = 23n;

        // Load fixture
        const { btcToken, insurancePool, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        // Calculate valid episode for staking
        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;

        // Underwriter joins pool
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Create a second product with a 10% max allocation
        await insurancePool.connect(poolUnderwriter).createProduct(
            "Ten Percent Product", // name
            1000, // annualPremium (10%)
            365 * 24 * 60 * 60, // maxCoverageDuration (1 year)
            1000 // maxPoolAllocation (10%)
        );

        // Product 1 has 10% allocation. Max coverage is 10% of the staked amount.
        const product1MaxCoverage = (underwriterStakeAmount * 1000n) / 10000n;

        // Purchase up to the limit for the 10% product (Product 1)
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: product1MaxCoverage,
            productId: 1
        });

        // Try to purchase a little more for Product 1, which should fail
        await expect(purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: ethers.parseUnits("1", "wei"),
            productId: 1
        })).to.be.revertedWith("Not enough assets to cover");

        // The first product (100% allocation) should still be available up to its own limit
        const product0MaxCoverage = underwriterStakeAmount;
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: product0MaxCoverage,
            productId: 0
        });

        // Verify final allocations
        const product0 = await insurancePool.products(0);
        expect(product0.allocation).to.equal(product0MaxCoverage);

        const product1 = await insurancePool.products(1);
        expect(product1.allocation).to.equal(product1MaxCoverage);
    });

    it("should decrease product allocation over time as coverage expires", async function () {
        // Test parameters
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const coverageAmount = ethers.parseUnits("10", "ether");
        const episodeOffset = 11n; // Stake far enough in the future to cover all purchases

        // Load fixture
        const { btcToken, insurancePool, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        // Underwriter joins pool for a future episode
        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Purchase coverage for 90 days (~3 episodes)
        const coverageDuration = 90 * SECS_IN_DAY;
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
            productId: 0,
            coverageDuration: coverageDuration
        });

        // Verify initial allocation
        let product = await insurancePool.products(0);
        expect(product.allocation).to.equal(coverageAmount);

        // Advance time by 4 episodes (more than coverage duration) to ensure coverage has expired
        await time.increase(Number(EPISODE_DURATION) * 4);

        // Purchase a tiny amount of coverage to trigger the allocation update
        const tinyCoverage = ethers.parseUnits("1", "wei");
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: tinyCoverage,
            productId: 0,
            coverageDuration: coverageDuration // same duration
        });

        // The allocation for the expired coverage should be gone,
        // and the new allocation should be for the tiny coverage.
        product = await insurancePool.products(0);
        expect(product.allocation).to.equal(tinyCoverage);
    });

    it("should drop totalCoverAllocation and product allocation to zero after long waiting period", async function () {
        // Test parameters
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const coverageAmount = ethers.parseUnits("10", "ether");
        const episodeOffset = 11n; // Stake far enough in the future to cover all purchases

        // Load fixture
        const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        // Underwriter joins pool for a future episode
        const currentEpisode = await getCurrentEpisode();
        const episodeToStake = currentEpisode + episodeOffset;
        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Get the underwriter's position ID
        const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

        // Purchase coverage for 90 days (~3 episodes)
        const coverageDuration = 90 * SECS_IN_DAY;
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: coverageAmount,
            productId: 0,
            coverageDuration: coverageDuration
        });

        // Verify initial allocation
        let product = await insurancePool.products(0);
        expect(product.allocation).to.equal(coverageAmount);
        expect(await insurancePool.totalCoverAllocation()).to.equal(coverageAmount);

        // Advance time by 25 episodes (more than coverage duration) to ensure coverage has expired
        await time.increase(Number(EPISODE_DURATION) * 25);

        // Extend the underwriter's position to refresh the staked assets
        const newCurrentEpisode = await getCurrentEpisode();
        const newEpisodeToStake = newCurrentEpisode + 11n; // Extend to a future episode
        await insurancePool
            .connect(poolUnderwriter)
            .extendPoolPosition(
                underwriterPositionId,
                newEpisodeToStake,
                0, // withdrawAmount - no withdrawal
                0  // amountToDeposit - no additional deposit
            );

        // Purchase a tiny amount of coverage to trigger the allocation update
        const tinyCoverage = ethers.parseUnits("1", "wei");
        await purchaseCoverage({
            insurancePool,
            poolAsset: btcToken,
            buyer: owner,
            coveredAccount: owner.address,
            coverageAmount: tinyCoverage,
            productId: 0,
            coverageDuration: coverageDuration // same duration
        });

        // The allocation for the expired coverage should be gone
        product = await insurancePool.products(0);
        expect(product.allocation).to.equal(tinyCoverage);
        expect(await insurancePool.totalCoverAllocation()).to.equal(tinyCoverage);
    });
});