const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { getCurrentEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { EPISODE_DURATION } = require("../constants.js");

const { expect } = require("chai");

async function firstLoss10PercentFixture() {
    return basicFixture({ underwriterFirstLoss: 1000 }); // 10%
}


describe("Underwriter First Loss Slashing", function () {

    const testCases = [
        {
            name: "underwriter covers whole claim 5",
            underwriterStake: ethers.parseUnits("10", "ether"),
            userStake: ethers.parseUnits("90", "ether"),
            claimAmount: ethers.parseUnits("5", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("5", "ether"),
            userStakeAfterSlash: ethers.parseUnits("90", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("95", "ether"),
            underwriterEpisodeOffset: 23n,
        },
        {
            name: "underwriter covers whole claim 10",
            underwriterStake: ethers.parseUnits("10", "ether"),
            userStake: ethers.parseUnits("90", "ether"),
            claimAmount: ethers.parseUnits("10", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("0", "ether"),
            userStakeAfterSlash: ethers.parseUnits("90", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("90", "ether"),
            underwriterEpisodeOffset: 23n,
        },
        {
            name: "underwriter does not cover claim whole claim",
            underwriterStake: ethers.parseUnits("10", "ether"),
            userStake: ethers.parseUnits("90", "ether"),
            claimAmount: ethers.parseUnits("20", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("0", "ether"),
            userStakeAfterSlash: ethers.parseUnits("80", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("80", "ether"),
            underwriterEpisodeOffset: 23n,
        },
        {
            name: "underwriter doesn't cover whole claim, but has some stake left",
            underwriterStake: ethers.parseUnits("20", "ether"),
            userStake: ethers.parseUnits("80", "ether"),
            claimAmount: ethers.parseUnits("20", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("8.888888888888888888", "ether"),
            userStakeAfterSlash: ethers.parseUnits("71.111111111111111111", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("80", "ether"),
            underwriterEpisodeOffset: 23n,
        },
        // EXPIRED UNDERWRITER POSITION CASES
        {
            name: "expired underwriter covers whole claim 5",
            underwriterStake: ethers.parseUnits("10", "ether"),
            userStake: ethers.parseUnits("90", "ether"),
            claimAmount: ethers.parseUnits("5", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("5", "ether"),
            userStakeAfterSlash: ethers.parseUnits("90", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("90", "ether"),
            underwriterEpisodeOffset: 2n,
        },
        {
            name: "expired underwriter covers whole claim 10",
            underwriterStake: ethers.parseUnits("10", "ether"),
            userStake: ethers.parseUnits("90", "ether"),
            claimAmount: ethers.parseUnits("10", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("0", "ether"),
            userStakeAfterSlash: ethers.parseUnits("90", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("90", "ether"),
            underwriterEpisodeOffset: 2n,
        },
        {
            name: "expired underwriter does not cover claim whole claim",
            underwriterStake: ethers.parseUnits("10", "ether"),
            userStake: ethers.parseUnits("90", "ether"),
            claimAmount: ethers.parseUnits("20", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("0", "ether"),
            userStakeAfterSlash: ethers.parseUnits("80", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("80", "ether"),
            underwriterEpisodeOffset: 2n,
        },
        {
            name: "expired underwriter doesn't cover whole claim, but has some stake left",
            underwriterStake: ethers.parseUnits("20", "ether"),
            userStake: ethers.parseUnits("80", "ether"),
            claimAmount: ethers.parseUnits("20", "ether"),
            underwriterStakeAfterSlash: ethers.parseUnits("8.888888888888888888", "ether"),
            userStakeAfterSlash: ethers.parseUnits("71.111111111111111111", "ether"),
            totalAssetsAfterSlash: ethers.parseUnits("71.111111111111111111", "ether"),
            underwriterEpisodeOffset: 2n,
        }
    ];

    testCases.forEach(
        ({ name, underwriterStake, underwriterStakeAfterSlash, totalAssetsAfterSlash,
            userStakeAfterSlash, underwriterEpisodeOffset, userStake, claimAmount
        }) => {
            it(`test ${name}`, async function () {
                const episodeOffset = 23n;

                const { insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
                    firstLoss10PercentFixture
                );
                const { owner, poolUnderwriter } = accounts;

                const currentEpisode = await getCurrentEpisode();
                const userEpisodeToStake = currentEpisode + episodeOffset;
                const underwriterEpsisodeToStake = currentEpisode + underwriterEpisodeOffset;

                // Join pool
                await insurancePool
                    .connect(poolUnderwriter)
                    .joinPool(underwriterStake, underwriterEpsisodeToStake);
                await insurancePool.connect(owner).joinPool(userStake, userEpisodeToStake);

                await time.increaseTo(userEpisodeToStake * EPISODE_DURATION);

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

                const userPosition = await insurancePool.getPoolPosition(userPositionId);
                const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
                const finalUserStakeValue = (userPosition.shares * finalTotalAssets) / finalTotalShares;
                const finalUnderwriterStakeValue = (underwriterPosition.shares * finalTotalAssets) / finalTotalShares;

                expect(finalUserStakeValue).to.equal(userStakeAfterSlash);
                expect(finalUnderwriterStakeValue).to.equal(underwriterStakeAfterSlash);
                expect(finalTotalAssets).to.equal(totalAssetsAfterSlash);
            });
        });

});
