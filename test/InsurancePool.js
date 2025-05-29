const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode } = require("./helpers.js");

const { expect } = require("chai");

const InsuranceSetup = require("../ignition/modules/Insurance.js");

const allowedUnderstaking = ethers.parseUnits("0.000000001", "ether"); // 0.01 cent if bitcoin costs 100k

describe("Insurance", async function () {
  async function basicFixture() {
    const deployment = await ignition.deploy(InsuranceSetup);

    // Get the poolUnderwriter account (account 1 from the deployment)
    const [owner, poolUnderwriter] = await ethers.getSigners();

    // Create a basic product using the poolUnderwriter account
    await deployment.insurancePool.connect(poolUnderwriter).createProduct(
      "Basic Coverage", // name
      1000, // annualPremium (10% annual premium)
      365 * 24 * 60 * 60, // maxCoverageDuration (1 year in seconds)
      10000 // maxPoolAllocation (100% of pool)
    );

    return deployment;
  }

  describe("InsurancePool", async function () {
    it("test basic", async function () {
      const { btcToken, sursToken, insurancePool, claimer } = await loadFixture(
        basicFixture
      );
      // Get accounts matching Ignition setup
      const [owner, poolUnderwriter, poolUnderwriterSigner, otherAccount] =
        await ethers.getSigners();

      // First, poolUnderwriter must stake to maintain the minimum percentage
      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("1000", "ether")
      );
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("1000", "ether"));

      // Calculate valid episode: currentEpisode + episodes where (episodes - currentEpisode) % 3 == 2
      const currentEpisode = await getCurrentEpisode();
      const episodeToStake = currentEpisode + 23; // 23 episodes from current, satisfies (23 - 0) % 3 == 2

      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), episodeToStake);

      // Now owner can make a position
      await btcToken.approve(insurancePool, ethers.parseUnits("2000", "ether"));
      await insurancePool.joinPool(
        ethers.parseUnits("10", "ether"), episodeToStake);

      const init_position = await insurancePool.getPoolPosition(owner, 0);
      const total_assets = await insurancePool.totalAssetsStaked();
      const total_shares = await insurancePool.totalPoolShares();
      expect(init_position.active).to.be.true;
      expect((init_position[1] * total_assets) / total_shares).to.equal(
        ethers.parseUnits("10", "ether")
      );

      // Check reward logic
      const minimumRewardAmount = ethers.parseUnits("0.0000001", "ether"); // 1 cent reward for 100k btc
      await btcToken.transfer(otherAccount, minimumRewardAmount); // Transfer tokens to buyer

      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: otherAccount,
        coveredAccount: otherAccount.address,
        coverageAmount: minimumRewardAmount * 10n,
      });

      // It is required some time to have all the rewards distributed.
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);
      const ownerPosition = await insurancePool.getPoolPosition(owner, 0);
      const earnedAmount = await insurancePool.earnedPosition.staticCall(owner, 0);
      // There are some precision errors
      expect(earnedAmount).to.approximately(
        (minimumRewardAmount * 10n) / 110n, // Adjust expected rewards based on share proportion
        allowedUnderstaking
      );

      // Setup for claim testing
      // Create and approve claim
      await claimer.createClaim(
        otherAccount.address,
        insurancePool.target,
        "Test claim",
        ethers.parseUnits("3", "ether")
      );
      await claimer.approveClaim(0); // Approve claim as the approver (owner)

      // Execute the approved claim
      await claimer.executeClaim(0);

      // Check slashing effect
      const new_total_assets = await insurancePool.totalAssetsStaked();
      const new_total_shares = await insurancePool.totalPoolShares();
      expect(
        (init_position[1] * new_total_assets) / new_total_shares
      ).to.approximately(
        ethers.parseUnits((((110 - 3) / 110) * 10).toString(), "ether"),
        allowedUnderstaking
      );


      const position = await insurancePool.getPoolPosition(owner, 0);
      const episodeDuration = await insurancePool.episodeDuration();
      const additionalTimeNeeded = episodeDuration * BigInt(24);

      // Get owner's balance before quitting the pool
      const balanceBeforeQuit = await btcToken.balanceOf(owner);

      // Calculate expected amount to receive (position value after slashing + rewards)
      const expectedPositionValue = ethers.parseUnits((((110 - 3) / 110) * 10).toString(), "ether");
      const ownerPositionBeforeQuit = await insurancePool.getPoolPosition(owner, 0);
      const earnedRewards = await insurancePool.earnedPosition.staticCall(owner, 0);
      const expectedTotalAmount = expectedPositionValue + earnedRewards;

      await time.increase(additionalTimeNeeded);
      await insurancePool.quitPoolPosition(0);

      // Get owner's balance after quitting the pool
      const balanceAfterQuit = await btcToken.balanceOf(owner);
      const actualReceivedAmount = balanceAfterQuit - balanceBeforeQuit;

      const finalPosition = await insurancePool.getPoolPosition(owner, 0);
      expect(finalPosition.active).to.be.false;

      // Check that the user received the expected amount
      expect(actualReceivedAmount).to.approximately(
        expectedTotalAmount,
        allowedUnderstaking
      );
    });

    it("test slashing during staking effects", async () => {
      const { btcToken, sursToken, insurancePool, claimer } = await loadFixture(
        basicFixture
      );
      const [owner, poolUnderwriter, poolUnderwriterSigner] =
        await ethers.getSigners();

      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("1000", "ether")
      );
      // Make a position as underwriter
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("100", "ether"));

      // Calculate valid episode for staking
      const episodeToStake = await getCurrentEpisode() + 23;

      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), episodeToStake);

      // Generate rewards through coverage purchase
      const purchaseAmount = ethers.parseUnits("1", "ether");
      await btcToken.transfer(poolUnderwriter, purchaseAmount);

      // Purchase coverage to generate rewards
      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: poolUnderwriter,
        coveredAccount: poolUnderwriter.address,
        coverageAmount: purchaseAmount * 10n,
      });

      // Distribute reward
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 400);

      // Create and approve claim
      await claimer.createClaim(
        poolUnderwriter.address,
        insurancePool.target,
        "Test claim",
        ethers.parseUnits("10", "ether")
      );
      await claimer.approveClaim(0); // Approve claim as the approver (owner)

      // Execute the approved claim
      await claimer.executeClaim(0);

      const underwriterPosition = await insurancePool.getPoolPosition(poolUnderwriter, 0);
      const earnedAmount = await insurancePool.earnedPosition.staticCall(poolUnderwriter, 0);

      // Should receive full rewards since underwriter is the only staker
      expect(earnedAmount).to.approximately(
        purchaseAmount,
        allowedUnderstaking
      );
    });

    it("test two stakers right proportion", async () => {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [owner, poolUnderwriter, poolUnderwriterSigner] =
        await ethers.getSigners();

      // Make a position
      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("21000000", "ether")
      );
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("51000000", "ether"));
      await btcToken.approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Calculate valid episode for staking
      const currentEpisode3 = await getCurrentEpisode();
      const episodeToStake3 = currentEpisode3 + 23; // 23 episodes from current, satisfies constraint

      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("21000000", "ether"), episodeToStake3);
      await insurancePool.joinPool(
        ethers.parseUnits("0.01", "ether"),
        episodeToStake3
      );

      const position_big = await insurancePool.getPoolPosition(
        poolUnderwriter,
        0
      );
      const position_small = await insurancePool.getPoolPosition(owner, 0);
      expect(position_big[1]).to.equal(
        ethers.parseUnits("21000000", "ether").toString()
      );
      expect(position_small[1]).to.equal(
        ethers.parseUnits("0.01", "ether").toString()
      );

      // Check if rewards distributed honestly
      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: owner,
        coveredAccount: poolUnderwriter.address,
        coverageAmount: ethers.parseUnits("1", "ether") * 10n,
      });

      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 600);
      const positionBig = await insurancePool.getPoolPosition(poolUnderwriter, 0);
      const earnedAmountBig = await insurancePool.earnedPosition.staticCall(poolUnderwriter, 0);
      const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(owner, 0);

      expect(earnedAmountBig).to.approximately(
        ethers.parseUnits("0.999999999523809606", "ether").toString(),
        allowedUnderstaking
      );
      expect(earnedAmountSmall).to.equal(
        ethers.parseUnits("0.000000000476190475", "ether").toString()
      );
      expect(earnedAmountBig + earnedAmountSmall).to.approximately(
        ethers.parseUnits("1", "ether").toString(),
        allowedUnderstaking
      );
    });

    it("test two stakers right proportion different rewards time", async () => {
      const { btcToken, insurancePool, claimer } = await loadFixture(basicFixture);
      const [owner, poolUnderwriter, poolUnderwriterSigner, buyer] =
        await ethers.getSigners();

      // Make initial positions with 21M : 0.01
      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("21000000", "ether")
      );
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("21000000", "ether"));
      await btcToken.approve(insurancePool, ethers.parseUnits("0.01", "ether"));

      // Create positions
      // Calculate valid episode for staking
      const currentEpisode4 = await getCurrentEpisode();
      const episodeToStake4 = currentEpisode4 + 23; // 23 episodes from current, satisfies constraint

      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("21000000", "ether"), episodeToStake4);
      await insurancePool.joinPool(
        ethers.parseUnits("0.01", "ether"),
        episodeToStake4
      );

      // Verify initial positions and shares
      const position_big = await insurancePool.getPoolPosition(
        poolUnderwriter,
        0
      );
      const position_small = await insurancePool.getPoolPosition(owner, 0);
      expect(position_big.shares).to.equal(
        ethers.parseUnits("21000000", "ether")
      );
      expect(position_small.shares).to.equal(
        ethers.parseUnits("0.01", "ether")
      );

      // Transfer tokens to buyer for coverage purchases
      await btcToken.transfer(buyer, ethers.parseUnits("1", "ether"));
      await btcToken
        .connect(buyer)
        .approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Make 10 coverage purchases over time to distribute rewards

      let totalSlashed = 0n;

      for (let i = 0; i < 10; i++) {
        await purchaseCoverage({
          insurancePool,
          poolAsset: btcToken,
          buyer: buyer,
          coveredAccount: buyer.address,
          coverageAmount: ethers.parseUnits("0.1", "ether") * 10n,
        });

        // Increase time between purchases
        await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 20); // 20 days

        // Add small slashing event after each coverage purchase
        const slashAmount = ethers.parseUnits("0.01", "ether"); // Small slash of 0.01 ETH
        totalSlashed += slashAmount;

        await claimer.createClaim(
          buyer.address,
          insurancePool.target,
          `Small slash claim ${i + 1}`,
          slashAmount
        );
        await claimer.approveClaim(i); // Approve claim as the approver (owner)
        await claimer.executeClaim(i); // Execute the approved claim
      }

      // Additional time increase to ensure all rewards are distributed
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 700);

      // Check earned rewards
      const positionBigDifferentTime = await insurancePool.getPoolPosition(poolUnderwriter, 0);
      const earnedAmountBig = await insurancePool.earnedPosition.staticCall(poolUnderwriter, 0);
      const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(owner, 0);

      // Calculate expected values after slashing
      const initialTotalAssets = ethers.parseUnits("21000000.01", "ether");
      const bigStakerProportion = ethers.parseUnits("21000000", "ether") / initialTotalAssets;
      const smallStakerProportion = ethers.parseUnits("0.01", "ether") / initialTotalAssets;

      // Verify proportions are maintained despite slashing
      // The exact amounts will be different due to slashing, but proportions should remain similar
      const totalEarned = earnedAmountBig + earnedAmountSmall;
      const bigStakerEarnedProportion = earnedAmountBig / totalEarned;
      const smallStakerEarnedProportion = earnedAmountSmall / totalEarned;

      // Check that proportions are approximately correct (within 1% tolerance due to slashing effects)
      expect(bigStakerEarnedProportion).to.be.equal(bigStakerProportion);
      expect(smallStakerEarnedProportion).to.be.equal(smallStakerProportion);

      // Verify total rewards match total coverage purchases
      expect(earnedAmountBig + earnedAmountSmall).to.approximately(
        ethers.parseUnits("1", "ether"),
        allowedUnderstaking
      );

      await insurancePool.quitPoolPosition(0);
      await insurancePool.connect(poolUnderwriter).quitPoolPosition(0);
    });


    it("test minimum stake amount edge cases", async function () {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [owner, poolUnderwriter] = await ethers.getSigners();

      // First, poolUnderwriter must stake to maintain the minimum percentage
      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("1000", "ether")
      );
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("1000", "ether"));

      // Calculate valid episode for staking
      const currentEpisode5 = await getCurrentEpisode();
      const episodeToStake5 = currentEpisode5 + 23; // 23 episodes from current, satisfies constraint

      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), episodeToStake5);

      // Get minimum stake amount from contract
      const minimumStakeAmount = await insurancePool.minimumStakeAmount();

      // Approve enough tokens for all tests
      await btcToken.approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Test amount 1 wei below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStakeAmount - 1n, episodeToStake5)
      ).to.be.revertedWith("Too small staking amount.");

      // Test exactly minimum amount - should succeed
      await expect(insurancePool.joinPool(minimumStakeAmount, episodeToStake5)).to
        .not.be.reverted;

      // Verify position was created correctly
      const position = await insurancePool.getPoolPosition(owner, 0);
      expect(position.shares).to.equal(minimumStakeAmount);
      expect(position.active).to.be.true;
    });
  });

  describe("Claimer", async function () {
    it("test claim approval and execution", async function () {
      const { btcToken, sursToken, insurancePool, claimer } = await loadFixture(
        basicFixture
      );
      const [owner, poolUnderwriter, otherAccount] = await ethers.getSigners();

      // Setup initial pool state
      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("1000", "ether")
      );
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("1000", "ether"));

      // Calculate valid episode for staking
      const currentEpisode6 = await getCurrentEpisode();
      const episodeToStake6 = currentEpisode6 + 23; // 23 episodes from current, satisfies constraint

      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), episodeToStake6);

      // Create claim
      await claimer.createClaim(
        otherAccount.address,
        insurancePool.target,
        "Test claim",
        ethers.parseUnits("10", "ether")
      );

      // Check claim details
      const claim = await claimer.getClaimDetails(0);
      expect(claim.proposer).to.equal(owner);
      expect(claim.description).to.equal("Test claim");
      expect(claim.receiver).to.equal(otherAccount.address);
      expect(claim.poolAddress).to.equal(insurancePool.target);
      expect(claim.amount).to.equal(ethers.parseUnits("10", "ether"));
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
});
