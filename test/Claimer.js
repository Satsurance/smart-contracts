const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode } = require("./helpers.js");
const { basicFixture } = require("./fixtures.js");

const { expect } = require("chai");

const ALLOWED_UNDERSTAKING = ethers.parseUnits("0.000000001", "ether"); // 0.01 cent if bitcoin costs 100k
const SECS_IN_DAY = 60 * 60 * 24;

describe("Claimer", async function () {

    it("test claim approval and execution", async function () {
        // Test Constants
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const claimAmount = ethers.parseUnits("10", "ether");
        const episodeOffset = 23;
        const claimDescription = "Test claim";

        const { btcToken, sursToken, insurancePool, claimer, accounts } = await loadFixture(
            basicFixture
        );
        const { owner, poolUnderwriter } = accounts;

        // Calculate valid episode for staking
        const currentEpisode6 = await getCurrentEpisode();
        const episodeToStake6 = currentEpisode6 + episodeOffset;

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake6);

        // Create claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            claimDescription,
            claimAmount
        );

        // Check claim details
        const claim = await claimer.getClaimDetails(0);
        expect(claim.proposer).to.equal(owner);
        expect(claim.description).to.equal(claimDescription);
        expect(claim.receiver).to.equal(owner.address);
        expect(claim.poolAddress).to.equal(insurancePool.target);
        expect(claim.amount).to.equal(claimAmount);
        expect(claim.approved).to.be.false;
        expect(claim.executed).to.be.false;

        // Try to execute before approval - should fail
        await expect(claimer.executeClaim(0)).to.be.revertedWith(
            "Claim not approved"
        );

        // Approve claim as the approver
        await claimer.approveClaim(0);

        // Check that claim is now approved
        const approvedClaim = await claimer.getClaimDetails(0);
        expect(approvedClaim.approved).to.be.true;

        // Execute claim
        await claimer.executeClaim(0);

        // Verify claim execution
        const executedClaim = await claimer.getClaimDetails(0);
        expect(executedClaim.executed).to.be.true;
    });
}); 