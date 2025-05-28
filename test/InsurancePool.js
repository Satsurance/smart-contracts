const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { signUnstakeRequest } = require("../utils/signatures");
const { purchaseCoverage, getEpisodeRangeForPosition } = require("./helpers.js");

const { expect } = require("chai");

const InsuranceSetup = require("../ignition/modules/Insurance.js");

const allowedUnderstaking = ethers.parseUnits("0.000000001", "ether"); // 0.01 cent if bitcoin costs 100k

describe("Insurance", async function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function basicFixture() {
    return ignition.deploy(InsuranceSetup);
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
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), 24);

      // Now owner can make a position
      await btcToken.approve(insurancePool, ethers.parseUnits("2000", "ether"));
      await insurancePool.joinPool(
        ethers.parseUnits("10", "ether"), 24);

      const init_position = await insurancePool.getPoolPosition(owner, 0);
      const total_assets = await insurancePool.totalAssetsStaked();
      const total_shares = await insurancePool.totalPoolShares();
      expect(init_position.active).to.be.true;
      expect((init_position[3] * total_assets) / total_shares).to.equal(
        ethers.parseUnits("10", "ether")
      );

      // Check reward logic
      const minimumRewardAmount = ethers.parseUnits("0.0000001", "ether"); // 1 cent reward for 100k btc
      await btcToken.transfer(otherAccount, minimumRewardAmount); // Transfer tokens to buyer

      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: otherAccount,
        underwriterSigner: poolUnderwriterSigner,
        coveredAccount: otherAccount.address,
        purchaseAmount: minimumRewardAmount,
        coverageAmount: minimumRewardAmount * 100n,
        description: "",
      });

      // It is required some time to have all the rewards distributed.
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);
      const ownerPosition = await insurancePool.getPoolPosition(owner, 0);
      const episodeRange = getEpisodeRangeForPosition(ownerPosition);
      const earnedAmount = await insurancePool.earnedPosition.staticCall(owner, 0, episodeRange, false);
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
        (init_position[3] * new_total_assets) / new_total_shares
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
      const episodeRangeBeforeQuit = getEpisodeRangeForPosition(ownerPositionBeforeQuit);
      const earnedRewards = await insurancePool.earnedPosition.staticCall(owner, 0, episodeRangeBeforeQuit, false);
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
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), 24);

      // Generate rewards through coverage purchase
      const purchaseAmount = ethers.parseUnits("1", "ether");
      await btcToken.transfer(poolUnderwriter, purchaseAmount);

      // Purchase coverage to generate rewards
      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: poolUnderwriter,
        underwriterSigner: poolUnderwriterSigner,
        coveredAccount: poolUnderwriter.address,
        purchaseAmount: purchaseAmount,
        coverageAmount: purchaseAmount * 100n,
        description: "Test coverage",
      });

      // Setup for claim testing - no need for staking anymore

      // Distribute reward after slashing
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 800);

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
      const episodeRangeForRewards = getEpisodeRangeForPosition(underwriterPosition);
      const earnedAmount = await insurancePool.earnedPosition.staticCall(poolUnderwriter, 0, episodeRangeForRewards, false);

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
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("21000000", "ether"), 24);
      await insurancePool.joinPool(
        ethers.parseUnits("0.01", "ether"),
        24
      );

      const position_big = await insurancePool.getPoolPosition(
        poolUnderwriter,
        0
      );
      const position_small = await insurancePool.getPoolPosition(owner, 0);
      expect(position_big[3]).to.equal(
        ethers.parseUnits("21000000", "ether").toString()
      );
      expect(position_small[3]).to.equal(
        ethers.parseUnits("0.01", "ether").toString()
      );

      // Check if rewards distributed honestly
      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: owner,
        underwriterSigner: poolUnderwriterSigner,
        coveredAccount: poolUnderwriter.address,
        purchaseAmount: ethers.parseUnits("1", "ether"),
        coverageAmount: ethers.parseUnits("1", "ether") * 100n,
        description: "Test coverage",
      });

      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 600);
      const positionBig = await insurancePool.getPoolPosition(poolUnderwriter, 0);
      const episodeRange = getEpisodeRangeForPosition(positionBig); // Both positions created at same time, same episode range
      const earnedAmountBig = await insurancePool.earnedPosition.staticCall(poolUnderwriter, 0, episodeRange, false);
      const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(owner, 0, episodeRange, false);

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
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
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
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("21000000", "ether"), 24);
      await insurancePool.joinPool(
        ethers.parseUnits("0.01", "ether"),
        24
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
      const purchaseAmount = ethers.parseUnits("0.1", "ether"); // 0.1 ETH each, total 1 ETH

      for (let i = 0; i < 10; i++) {
        await purchaseCoverage({
          insurancePool,
          poolAsset: btcToken,
          buyer: buyer,
          underwriterSigner: poolUnderwriterSigner,
          coveredAccount: buyer.address,
          purchaseAmount: purchaseAmount,
          coverageAmount: purchaseAmount * 100n,
          description: `Coverage purchase ${i + 1}`,
        });

        // Increase time between purchases
        await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 20); // 20 days
      }

      // Additional time increase to ensure all rewards are distributed
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);

      // Check earned rewards
      const positionBigDifferentTime = await insurancePool.getPoolPosition(poolUnderwriter, 0);
      const episodeRange = getEpisodeRangeForPosition(positionBigDifferentTime); // Both positions created at same time, same episode range
      const earnedAmountBig = await insurancePool.earnedPosition.staticCall(poolUnderwriter, 0, episodeRange, false);
      const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(owner, 0, episodeRange, false);

      // Verify proportions match the share ratio
      expect(earnedAmountBig).to.approximately(
        ethers.parseUnits("0.999999999523809606", "ether"),
        allowedUnderstaking
      );
      expect(earnedAmountSmall).to.equal(
        ethers.parseUnits("0.000000000476190475", "ether")
      );

      // Verify total rewards match total coverage purchases
      expect(earnedAmountBig + earnedAmountSmall).to.approximately(
        ethers.parseUnits("1", "ether"),
        allowedUnderstaking
      );
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
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), 24);

      // Get minimum stake amount from contract
      const minimumStakeAmount = await insurancePool.minimumStakeAmount();

      // Approve enough tokens for all tests
      await btcToken.approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Test amount 1 wei below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStakeAmount - 1n, 24)
      ).to.be.revertedWith("Too small staking amount.");

      // Test exactly minimum amount - should succeed
      await expect(insurancePool.joinPool(minimumStakeAmount, 24)).to
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
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), 24);

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
