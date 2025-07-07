const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode, findClosestStakableEpisode } = require("./helpers.js");
const { basicFixture } = require("./fixtures.js");

const { expect } = require("chai");

describe("Claimer", async function () {

    it("test claim approval and execution", async function () {
        // Test Constants
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const claimAmount = ethers.parseUnits("10", "ether");
        const claimDescription = "Test claim";

        const { insurancePool, claimer, accounts, deploymentParams } = await loadFixture(
            basicFixture
        );
        const { owner, poolUnderwriter } = accounts;

        // Calculate valid episode for staking
        const episodeToStake = await findClosestStakableEpisode(23n);

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Create claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            claimDescription,
            claimAmount
        );

        // Check claim details
        const claim = await claimer.claims(0);
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
        const approvedClaim = await claimer.claims(0);
        expect(approvedClaim.approved).to.be.true;

        await expect(claimer.executeClaim(0)).to.be.revertedWith(
            "Execution timeout has not expired"
        );

        const executionTimeout = deploymentParams.executionTimeout;
        await time.increase(executionTimeout + 1);

        // Execute claim after timeout
        await claimer.executeClaim(0);

        // Verify claim execution
        const executedClaim = await claimer.claims(0);
        expect(executedClaim.executed).to.be.true;
    });

    it("test claim reduction functionality", async function () {
        // Test Constants
        const underwriterStakeAmount = ethers.parseUnits("100", "ether");
        const claimAmount = ethers.parseUnits("10", "ether");
        const claimReductionBasisPoints = 500; // 5% reduction (maximum allowed)
        const claimDescription = "Test claim with reduction";

        const { insurancePool, claimer, btcToken, accounts, deploymentParams } = await loadFixture(
            basicFixture
        );
        const { owner, poolUnderwriter } = accounts;

        // Set claim reduction in the test instead of using custom fixture
        await claimer.setClaimReduction(claimReductionBasisPoints);

        // Verify the claim reduction is set correctly
        const actualClaimReduction = await claimer.claimReduction();
        expect(actualClaimReduction).to.equal(claimReductionBasisPoints);

        // Calculate expected reduced amount
        const expectedReductionAmount = (claimAmount * BigInt(claimReductionBasisPoints)) / 10000n;
        const expectedReducedAmount = claimAmount - expectedReductionAmount;

        // Calculate valid episode for staking
        const episodeToStake = await findClosestStakableEpisode(23n);

        await insurancePool
            .connect(poolUnderwriter)
            .joinPool(underwriterStakeAmount, episodeToStake);

        // Get initial receiver balance
        const initialReceiverBalance = await btcToken.balanceOf(owner.address);

        // Create claim
        await claimer.createClaim(
            owner.address,
            insurancePool.target,
            claimDescription,
            claimAmount
        );

        // Approve claim
        await claimer.approveClaim(0);

        // Wait for execution timeout
        const executionTimeout = deploymentParams.executionTimeout;
        await time.increase(executionTimeout + 1);

        // Execute claim
        await claimer.executeClaim(0);

        // Verify claim was executed
        const executedClaim = await claimer.claims(0);
        expect(executedClaim.executed).to.be.true;

        // Verify the reduced amount was received by the receiver
        const finalReceiverBalance = await btcToken.balanceOf(owner.address);
        const actualReceived = finalReceiverBalance - initialReceiverBalance;

        expect(actualReceived).to.equal(expectedReducedAmount);

        // Verify the reduction was applied correctly
        expect(actualReceived).to.be.lessThan(claimAmount);
        expect(actualReceived).to.equal(claimAmount - expectedReductionAmount);
    });

    it("test claim reduction parameter modification", async function () {
        const { claimer, accounts } = await loadFixture(basicFixture);
        const { owner } = accounts;

        // Initial claim reduction should be 0
        const initialReduction = await claimer.claimReduction();
        expect(initialReduction).to.equal(0);

        // Set new claim reduction (3% = 300 basis points)
        const newReduction = 300;
        await claimer.setClaimReduction(newReduction);

        // Verify the reduction was updated
        const updatedReduction = await claimer.claimReduction();
        expect(updatedReduction).to.equal(newReduction);

        // Try to set reduction above 5% - should fail
        await expect(claimer.setClaimReduction(501)).to.be.revertedWith(
            "Claim reduction cannot exceed 5%"
        );

        // Set reduction to maximum (5% = 500 basis points)
        await claimer.setClaimReduction(500);
        const maxReduction = await claimer.claimReduction();
        expect(maxReduction).to.equal(500);
    });
}); 