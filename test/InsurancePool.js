const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { signUnstakeRequest } = require("../utils/signatures");
const { purchaseCoverage } = require("./helpers.js");

const { expect } = require("chai");

const InsuranceSetup = require("../ignition/modules/Insurance.js");

const allowedUnderstaking = ethers.parseUnits("0.000000001", "ether"); // 0.01 cent if bitcoin costs 100k
const ninetyDays = 60 * 60 * 24 * 90;

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
      const currentEpisode = await insurancePool.getCurrentEpisode();
      console.log("currentEpisode", currentEpisode);
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), ninetyDays, 8);

      // Now owner can make a position
      await btcToken.approve(insurancePool, ethers.parseUnits("2000", "ether"));
      await insurancePool.joinPool(
        ethers.parseUnits("10", "ether"),
        ninetyDays, 8
      );

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
        duration: 99999999,
        description: "",
      });

      // It is required some time to have all the rewards distributed.
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);
      const earnedAmount = await insurancePool.earnedPosition.staticCall(owner, 0, [0, 1, 2, 3, 4, 5, 6, 7], false);
      console.log("earnedAmount", earnedAmount);
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

      // Test quit pool - we need to be in a withdrawal window
      // Withdrawal is allowed when (current_time - start_date) % 90_days <= 1_week
      // Get position details to calculate the correct timing
      const position = await insurancePool.getPoolPosition(owner, 0);
      const startDate = Number(position.startDate);
      const currentTime = await time.latest();

      // Calculate how much time has passed since position start
      const timeSinceStart = currentTime - startDate;

      // Find the next withdrawal window  
      // We want (timeSinceStart + additionalTime) % ninetyDays <= 7 days
      const timeInCurrentCycle = timeSinceStart % ninetyDays;
      let additionalTimeNeeded;

      if (timeInCurrentCycle <= 7 * 24 * 60 * 60) {
        // We're already in a withdrawal window
        additionalTimeNeeded = 0;
      } else {
        // Move to the next withdrawal window
        additionalTimeNeeded = ninetyDays - timeInCurrentCycle + 1; // +1 to be safely in window
      }

      await time.increase(additionalTimeNeeded);
      await insurancePool.quitPoolPosition(0);
      const finalPosition = await insurancePool.getPoolPosition(owner, 0);
      expect(finalPosition.active).to.be.false;
    });

    it.skip("test slashing during staking effects", async () => {
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
        .joinPool(ethers.parseUnits("100", "ether"), ninetyDays);

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
        duration: 99999999,
        description: "Test coverage",
      });

      // Setup for claim testing - no need for staking anymore

      // Distribute reward after slashing
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);

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

      const earnedAmount = await insurancePool.earned(poolUnderwriter.address);

      // Should receive full rewards since underwriter is the only staker
      expect(earnedAmount).to.approximately(
        purchaseAmount,
        allowedUnderstaking
      );
    });

    it.skip("test two stakers right proportion", async () => {
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
        .joinPool(ethers.parseUnits("21000000", "ether"), ninetyDays);
      await insurancePool.joinPool(
        ethers.parseUnits("0.01", "ether"),
        ninetyDays
      );

      const position_big = await insurancePool.getPoolPosition(
        poolUnderwriter,
        0
      );
      const position_small = await insurancePool.getPoolPosition(owner, 0);
      expect(position_big[2]).to.equal(
        ethers.parseUnits("21000000", "ether").toString()
      );
      expect(position_small[2]).to.equal(
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
        duration: 99999999,
        description: "Test coverage",
      });

      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 600);
      const earnedAmountBig = await insurancePool.earned(poolUnderwriter);
      const earnedAmountSmall = await insurancePool.earned(owner);

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

    it.skip("test two stakers right proportion different rewards time", async () => {
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
        .joinPool(ethers.parseUnits("21000000", "ether"), ninetyDays);
      await insurancePool.joinPool(
        ethers.parseUnits("0.01", "ether"),
        ninetyDays
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
          duration: 99999999,
          description: `Coverage purchase ${i + 1}`,
        });

        // Increase time between purchases
        await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 20); // 20 days
      }

      // Additional time increase to ensure all rewards are distributed
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);

      // Check earned rewards
      const earnedAmountBig = await insurancePool.earned(poolUnderwriter);
      const earnedAmountSmall = await insurancePool.earned(owner);

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

    it.skip("test auto-restake mechanics", async function () {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [owner, poolUnderwriter] = await ethers.getSigners();

      await btcToken.transfer(
        poolUnderwriter,
        ethers.parseUnits("1000", "ether")
      );
      await btcToken
        .connect(poolUnderwriter)
        .approve(insurancePool, ethers.parseUnits("1000", "ether"));
      await insurancePool
        .connect(poolUnderwriter)
        .joinPool(ethers.parseUnits("100", "ether"), ninetyDays);

      // Setup - create a 90-day staking position
      await btcToken.approve(insurancePool, ethers.parseUnits("100", "ether"));
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether"),
        ninetyDays
      );

      // Get initial position info
      const position = await insurancePool.getPoolPosition(owner, 0);
      const startDate = Number(position.startDate);

      // Try to quit before first period - should fail
      await time.increaseTo(startDate + ninetyDays - 1);
      await expect(insurancePool.quitPoolPosition(0)).to.be.revertedWith(
        "Funds are timelocked, first lock."
      );

      // Move to just after 90 days but outside timegap window (1 week + 1 day after period)
      await time.increaseTo(
        startDate + ninetyDays + 7 * 24 * 60 * 60 + 24 * 60 * 60
      );
      await expect(insurancePool.quitPoolPosition(0)).to.be.revertedWith(
        "Funds are timelocked, auto-restake lock."
      );

      // Move to within timegap window of second period (90 days * 2)
      await time.increaseTo(startDate + ninetyDays * 2 + 24 * 60 * 60); // 1 day into window
      // Should succeed now as we're in the withdrawal window
      await expect(insurancePool.quitPoolPosition(0)).to.not.be.reverted;
    });

    it.skip("test minimum stake amount edge cases", async function () {
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
        .joinPool(ethers.parseUnits("100", "ether"), ninetyDays);

      // Get minimum stake amount from contract
      const minimumStakeAmount = await insurancePool.minimumStakeAmount();

      // Approve enough tokens for all tests
      await btcToken.approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Test amount 1 wei below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStakeAmount - 1n, ninetyDays)
      ).to.be.revertedWith("Too small staking amount.");

      // Test exactly minimum amount - should succeed
      await expect(insurancePool.joinPool(minimumStakeAmount, ninetyDays)).to
        .not.be.reverted;

      // Verify position was created correctly
      const position = await insurancePool.getPoolPosition(owner, 0);
      expect(position.shares).to.equal(minimumStakeAmount);
      expect(position.active).to.be.true;
    });

    describe("Scheduled Unstake", async function () {
      it.skip("test scheduled unstake with funds recovery and rewards", async function () {
        const { btcToken, insurancePool } = await loadFixture(basicFixture);
        const [
          owner,
          poolUnderwriter,
          poolUnderwriterSigner,
          otherAccount,
          scheduledExecutor,
        ] = await ethers.getSigners();

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
          .joinPool(ethers.parseUnits("100", "ether"), ninetyDays);

        // Setup - Create positions for two users
        const stakeAmount = ethers.parseUnits("10", "ether"); // Smaller than underwriter to maintain ratio
        await btcToken.transfer(otherAccount, stakeAmount);

        // Approve and stake for both users
        await btcToken.approve(insurancePool, stakeAmount);
        await btcToken
          .connect(otherAccount)
          .approve(insurancePool, stakeAmount);

        await insurancePool.joinPool(stakeAmount, ninetyDays);
        await insurancePool
          .connect(otherAccount)
          .joinPool(stakeAmount, ninetyDays);

        // Generate rewards through coverage purchase
        await purchaseCoverage({
          insurancePool,
          poolAsset: btcToken,
          buyer: owner,
          underwriterSigner: poolUnderwriterSigner,
          coveredAccount: owner.address,
          purchaseAmount: ethers.parseUnits("1", "ether"),
          coverageAmount: ethers.parseUnits("100", "ether"),
          duration: 99999999,
          description: "Test coverage",
        });

        // Wait for reward distribution and staking period
        await time.increaseTo((await time.latest()) + ninetyDays + 1);

        const deadline = (await time.latest()) + 3600; // 1 hour from now
        const chainId = (await ethers.provider.getNetwork()).chainId;

        // Generate signatures using helper function
        const sig1 = await signUnstakeRequest(owner, insurancePool.target, {
          user: owner.address,
          positionId: 0,
          deadline: deadline,
          chainId: chainId,
        });

        const sig2 = await signUnstakeRequest(
          otherAccount,
          insurancePool.target,
          {
            user: otherAccount.address,
            positionId: 0,
            deadline: deadline,
            chainId: chainId,
          }
        );

        // Get initial balances and state
        const initialBalance = await btcToken.balanceOf(scheduledExecutor);

        // Execute scheduled unstake
        await insurancePool
          .connect(scheduledExecutor)
          .scheduledUnstake(
            [owner.address, otherAccount.address],
            [0, 0],
            [deadline, deadline],
            [sig1.v, sig2.v],
            [sig1.r, sig2.r],
            [sig1.s, sig2.s]
          );

        // Verify fees sent to caller
        const fee = await insurancePool.scheduledUnstakeFee();
        const expectedFees = fee * 2n;
        const actualFees =
          (await btcToken.balanceOf(scheduledExecutor)) - initialBalance;
        expect(actualFees).to.equal(expectedFees);

        // Verify funds in addressUnstakedSchdl
        const user1Scheduled = await insurancePool.addressUnstakedSchdl(owner);
        const user2Scheduled = await insurancePool.addressUnstakedSchdl(
          otherAccount
        );
        expect(user1Scheduled).to.be.gt(0);
        expect(user2Scheduled).to.be.gt(0);

        // Get unstaked
        await insurancePool.getScheduledUnstaked();
        expect(await insurancePool.addressUnstakedSchdl(owner)).to.equal(0);
      });

      it.skip("test mixed valid/invalid scheduled unstake", async function () {
        const { btcToken, insurancePool } = await loadFixture(basicFixture);
        const [
          owner,
          poolUnderwriter,
          otherAccount,
          thirdAccount,
          fourthAccount,
        ] = await ethers.getSigners();

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
          .joinPool(ethers.parseUnits("100", "ether"), ninetyDays);

        // Setup - Create positions for three users
        const stakeAmount = ethers.parseUnits("10", "ether"); // Smaller amount to maintain underwriter proportion
        await btcToken.transfer(otherAccount, stakeAmount);
        await btcToken.transfer(thirdAccount, stakeAmount);

        // Approve and stake for all users
        await btcToken.approve(insurancePool, stakeAmount);
        await btcToken
          .connect(otherAccount)
          .approve(insurancePool, stakeAmount);
        await btcToken
          .connect(thirdAccount)
          .approve(insurancePool, stakeAmount);

        await insurancePool.joinPool(stakeAmount, ninetyDays);
        await insurancePool
          .connect(otherAccount)
          .joinPool(stakeAmount, ninetyDays);
        await insurancePool
          .connect(thirdAccount)
          .joinPool(stakeAmount, ninetyDays);

        // Move timeline past minimum stake time
        await time.increase(ninetyDays);

        // Get deadline and chainId
        const deadline = (await time.latest()) + 3600; // 1 hour from now
        const chainId = (await ethers.provider.getNetwork()).chainId;

        // Generate two valid signatures and one invalid
        const sig1 = await signUnstakeRequest(owner, insurancePool.target, {
          user: owner.address,
          positionId: 0,
          deadline: deadline,
          chainId: chainId,
        });
        const sig2 = await signUnstakeRequest(
          otherAccount,
          insurancePool.target,
          {
            user: otherAccount.address,
            positionId: 0,
            deadline: deadline,
            chainId: chainId,
          }
        );
        // Invalid signature - fourthAccount signing for thirdAccount's position
        const invalidSig = await signUnstakeRequest(
          fourthAccount,
          insurancePool.target,
          {
            user: thirdAccount.address,
            positionId: 0,
            deadline: deadline,
            chainId: chainId,
          }
        );

        // Initial state
        const initialPoolShares = await insurancePool.totalPoolShares();
        const initialAssets = await insurancePool.totalAssetsStaked();

        // Attempt batch unstake with mixed signatures
        await expect(
          insurancePool.scheduledUnstake(
            [owner.address, otherAccount.address, thirdAccount.address],
            [0, 0, 0],
            [deadline, deadline, deadline],
            [sig1.v, sig2.v, invalidSig.v],
            [sig1.r, sig2.r, invalidSig.r],
            [sig1.s, sig2.s, invalidSig.s]
          )
        )
          .to.be.revertedWithCustomError(insurancePool, "InvalidSignature")
          .withArgs(2);

        // Verify state remains unchanged
        const finalPoolShares = await insurancePool.totalPoolShares();
        const finalAssets = await insurancePool.totalAssetsStaked();

        expect(finalPoolShares).to.equal(initialPoolShares);
        expect(finalAssets).to.equal(initialAssets);

        // Verify all positions still active
        const position1 = await insurancePool.getPoolPosition(owner.address, 0);
        const position2 = await insurancePool.getPoolPosition(
          otherAccount.address,
          0
        );
        const position3 = await insurancePool.getPoolPosition(
          thirdAccount.address,
          0
        );

        expect(position1.active).to.be.true;
        expect(position2.active).to.be.true;
        expect(position3.active).to.be.true;
      });
    });
  });

  describe("Claimer", async function () {
    it.skip("test claim approval and execution", async function () {
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
        .joinPool(ethers.parseUnits("100", "ether"), ninetyDays);

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
