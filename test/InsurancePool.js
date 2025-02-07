const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

const { InsuranceSetup } = require("../ignition/modules/Insurance.js");

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
      const [ownerAccount, otherAccount] = await ethers.getSigners();

      // Make a position
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("2000", "ether").toString()
      );
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether").toString(),
        ninetyDays
      );
      const init_position = await insurancePool.getPoolPosition(
        ownerAccount,
        0
      );
      const total_assets = await insurancePool.totalAssetsStaked();
      const total_shares = await insurancePool.totalPoolShares();
      expect(init_position[3]).to.equal(
        ethers.parseUnits("100", "ether").toString()
      );
      expect((init_position[2] * total_assets) / total_shares).to.equal(
        ethers.parseUnits("100", "ether").toString()
      );

      // Check reward logic
      const minimumRewardAmount = ethers.parseUnits("0.0000001", "ether"); // 1 cent reward for 100k btc
      await insurancePool.rewardPool(minimumRewardAmount.toString());
      // It is required some time to have all the rewards distributed.
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);
      const earnedAmount = await insurancePool.earned(ownerAccount);

      // There are some precision errors
      expect(earnedAmount).to.approximately(
        minimumRewardAmount,
        allowedUnderstaking
      );

      // Setup for claim testing
      // Approve and stake SURS tokens for voting
      await sursToken.approve(
        claimer,
        ethers.parseUnits("100", "ether").toString()
      );
      await claimer.stake(ethers.parseUnits("100", "ether").toString());

      // Create and vote on claim
      await claimer.createClaim(
        otherAccount,
        "Test claim",
        ethers.parseUnits("3", "ether").toString()
      );
      await claimer.vote(0, true); // Vote in favor of claim

      // Wait for voting period to end
      await time.increase(7 * 24 * 60 * 60 + 1); // 1 week + 1 second

      // Execute the approved claim
      await claimer.executeClaim(0);

      // Check slashing effect
      const new_total_assets = await insurancePool.totalAssetsStaked();
      const new_total_shares = await insurancePool.totalPoolShares();
      expect((init_position[2] * new_total_assets) / new_total_shares).to.equal(
        ethers.parseUnits("97", "ether").toString()
      );

      // Test quit pool
      await time.increase(33 * 24 * 60 * 60);
      await insurancePool.quitPoolPosition(0);
    });

    it("test slashing during staking effects", async () => {
      const { btcToken, sursToken, insurancePool, claimer } = await loadFixture(
        basicFixture
      );
      const [ownerAccount, otherAccount] = await ethers.getSigners();
      // Make a position
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("2000", "ether").toString()
      );
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether").toString(),
        ninetyDays
      );
      const rewardAmount = ethers.parseUnits("1", "ether");
      await insurancePool.rewardPool(rewardAmount.toString());

      // Setup for claim testing
      // Approve and stake SURS tokens for voting
      await sursToken.approve(
        claimer,
        ethers.parseUnits("100", "ether").toString()
      );
      await claimer.stake(ethers.parseUnits("100", "ether").toString());

      // Distribute reward after slashing
      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);

      // Create and vote on claim
      await claimer.createClaim(
        otherAccount,
        "Test claim",
        ethers.parseUnits("10", "ether").toString()
      );
      await claimer.vote(0, true); // Vote in favor of claim

      // Wait for voting period to end
      await time.increase(7 * 24 * 60 * 60 + 1); // 1 week + 1 second

      // Execute the approved claim
      await claimer.executeClaim(0);

      const earnedAmount = await insurancePool.earned(ownerAccount);
      // There are should be no rewards drop.
      expect(earnedAmount).to.approximately(rewardAmount, allowedUnderstaking);
    });

    it("test two stakers right proportion", async () => {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [ownerAccount, otherAccount] = await ethers.getSigners();

      // Make a position
      await btcToken.transfer(
        otherAccount,
        ethers.parseUnits("0.01", "ether").toString()
      );
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("51000000", "ether").toString()
      );
      await btcToken
        .connect(otherAccount)
        .approve(insurancePool, ethers.parseUnits("1", "ether").toString());
      await insurancePool.joinPool(
        ethers.parseUnits("21000000", "ether").toString(),
        ninetyDays
      );
      await insurancePool
        .connect(otherAccount)
        .joinPool(ethers.parseUnits("0.01", "ether").toString(), ninetyDays);

      const position_big = await insurancePool.getPoolPosition(ownerAccount, 0);
      const position_small = await insurancePool.getPoolPosition(
        otherAccount,
        0
      );
      expect(position_big[3]).to.equal(
        ethers.parseUnits("21000000", "ether").toString()
      );
      expect(position_small[3]).to.equal(
        ethers.parseUnits("0.01", "ether").toString()
      );

      // Check if rewards distributed honestly
      await insurancePool.rewardPool(
        ethers.parseUnits("1", "ether").toString()
      );

      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 600);
      const earnedAmountBig = await insurancePool.earned(ownerAccount);
      const earnedAmountSmall = await insurancePool.earned(otherAccount);

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

    it("test two stakers right proportion different rewards time.", async () => {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [ownerAccount, otherAccount] = await ethers.getSigners();

      // Make a position
      await btcToken.transfer(
        otherAccount,
        ethers.parseUnits("0.01", "ether").toString()
      );
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("51000000", "ether").toString()
      );
      await btcToken
        .connect(otherAccount)
        .approve(insurancePool, ethers.parseUnits("1", "ether").toString());
      await insurancePool.joinPool(
        ethers.parseUnits("21000000", "ether").toString(),
        ninetyDays
      );
      await insurancePool
        .connect(otherAccount)
        .joinPool(ethers.parseUnits("0.01", "ether").toString(), ninetyDays);

      const position_big = await insurancePool.getPoolPosition(ownerAccount, 0);
      const position_small = await insurancePool.getPoolPosition(
        otherAccount,
        0
      );
      expect(position_big[3]).to.equal(
        ethers.parseUnits("21000000", "ether").toString()
      );
      expect(position_small[3]).to.equal(
        ethers.parseUnits("0.01", "ether").toString()
      );

      for (let i = 0; i < 10; i++) {
        await insurancePool.rewardPool(
          ethers.parseUnits("0.1", "ether").toString()
        );
        await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 20);
      }

      await time.increaseTo((await time.latest()) + 60 * 60 * 24 * 500);

      const earnedAmountBig = await insurancePool.earned(ownerAccount);
      const earnedAmountSmall = await insurancePool.earned(otherAccount);

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

    it("test auto-restake mechanics", async function () {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [ownerAccount] = await ethers.getSigners();

      // Setup - create a 90-day staking position
      await btcToken.approve(insurancePool, ethers.parseUnits("100", "ether"));
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether"),
        ninetyDays
      );

      // Get initial position info
      const position = await insurancePool.getPoolPosition(ownerAccount, 0);
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

    it("test minimum stake amount edge cases", async function () {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [ownerAccount] = await ethers.getSigners();

      // Get minimum stake amount from contract
      const minimumStake = await insurancePool.minimumStakeAmount();

      // Approve enough tokens for all tests
      await btcToken.approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Test exactly minimum amount - should succeed
      await expect(insurancePool.joinPool(minimumStake, ninetyDays)).to.not.be
        .reverted;

      // Verify position was created correctly
      const position = await insurancePool.getPoolPosition(ownerAccount, 0);
      expect(position.initialAmount).to.equal(minimumStake);
      expect(position.active).to.be.true;

      // Test amount 1 wei below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStake - 1n, ninetyDays)
      ).to.be.revertedWith("Too small staking amount.");

      // Test amount significantly below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStake / 2n, ninetyDays)
      ).to.be.revertedWith("Too small staking amount.");
    });

    describe("Scheduled Unstake", async function () {
      it("test scheduled unstake with funds recovery and rewards", async function () {
        const { btcToken, insurancePool } = await loadFixture(basicFixture);
        const [ownerAccount, otherAccount, thirdAccount] =
          await ethers.getSigners();

        // Setup - Create positions for two users
        const stakeAmount = ethers.parseUnits("100", "ether");
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

        // Add reward to the pool
        const rewardAmount = ethers.parseUnits("1", "ether");
        await btcToken.approve(insurancePool, rewardAmount);
        await insurancePool.rewardPool(rewardAmount);

        // Wait for reward distribution
        await time.increase(60 * 60 * 24 * 540);

        // Generate signatures for unstaking
        const deadline = (await time.latest()) + 3600; // 1 hour from now
        const domain = {
          name: "Insurance Pool",
          version: "1",
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: insurancePool.target,
        };

        const types = {
          UnstakeRequest: [
            { name: "user", type: "address" },
            { name: "positionId", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "nonce", type: "uint256" },
          ],
        };

        console.log(ownerAccount.address);
        const sig1 = await ownerAccount.signTypedData(domain, types, {
          user: ownerAccount.address,
          positionId: 0,
          deadline: deadline,
          nonce: 0,
        });

        const sig2 = await otherAccount.signTypedData(domain, types, {
          user: otherAccount.address,
          positionId: 0,
          deadline: deadline,
          nonce: 0,
        });

        const { v: v1, r: r1, s: s1 } = ethers.Signature.from(sig1);
        const { v: v2, r: r2, s: s2 } = ethers.Signature.from(sig2);

        // Initial balances
        const initialBalance = await btcToken.balanceOf(thirdAccount);

        // Execute scheduled unstake
        await insurancePool
          .connect(thirdAccount)
          .scheduledUnstake(
            [ownerAccount.address, otherAccount.address],
            [0, 0],
            [deadline, deadline],
            [v1, v2],
            [r1, r2],
            [s1, s2]
          );

        // Verify fees sent to caller
        const fee = await insurancePool.scheduledUnstakeFee();
        const expectedFees = fee * 2n;
        const actualFees =
          (await btcToken.balanceOf(thirdAccount)) - initialBalance;
        expect(actualFees).to.equal(expectedFees);

        // Verify funds in addressUnstakedSchdl
        const user1Scheduled = await insurancePool.addressUnstakedSchdl(
          ownerAccount
        );
        const user2Scheduled = await insurancePool.addressUnstakedSchdl(
          otherAccount
        );
        expect(user1Scheduled).to.be.gt(0);
        expect(user2Scheduled).to.be.gt(0);

        // Get unstaked
        await insurancePool.getScheduledUnstaked();
        expect(await insurancePool.addressUnstakedSchdl(ownerAccount)).to.equal(
          0
        );
      });

      it("test mixed valid/invalid scheduled unstake", async function () {
        const { btcToken, insurancePool } = await loadFixture(basicFixture);
        const [ownerAccount, otherAccount, thirdAccount, fourthAccount] =
          await ethers.getSigners();

        // Setup - Create positions for three users
        const stakeAmount = ethers.parseUnits("100", "ether");
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

        // Move timeline
        await time.increase(ninetyDays);
        // Generate signatures
        const deadline = (await time.latest()) + 3600;
        const domain = {
          name: "Insurance Pool",
          version: "1",
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: insurancePool.target,
        };

        const types = {
          UnstakeRequest: [
            { name: "user", type: "address" },
            { name: "positionId", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "nonce", type: "uint256" },
          ],
        };

        // Two valid signatures
        const sig1 = await ownerAccount.signTypedData(domain, types, {
          user: ownerAccount.address,
          positionId: 0,
          deadline: deadline,
          nonce: 0,
        });

        const sig2 = await otherAccount.signTypedData(domain, types, {
          user: otherAccount.address,
          positionId: 0,
          deadline: deadline,
          nonce: 0,
        });

        // Invalid signature (signed by wrong account)
        const sig3 = await fourthAccount.signTypedData(domain, types, {
          user: thirdAccount.address,
          positionId: 0,
          deadline: deadline,
          nonce: 0,
        });

        const { v: v1, r: r1, s: s1 } = ethers.Signature.from(sig1);
        const { v: v2, r: r2, s: s2 } = ethers.Signature.from(sig2);
        const { v: v3, r: r3, s: s3 } = ethers.Signature.from(sig3);

        // Initial state
        const initialPoolShares = await insurancePool.totalPoolShares();
        const initialAssets = await insurancePool.totalAssetsStaked();

        // Attempt batch unstake with mixed signatures
        await expect(
          insurancePool.scheduledUnstake(
            [ownerAccount, otherAccount, thirdAccount],
            [0, 0, 0],
            [deadline, deadline, deadline],
            [v1, v2, v3],
            [r1, r2, r3],
            [s1, s2, s3]
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
        const position1 = await insurancePool.getPoolPosition(ownerAccount, 0);
        const position2 = await insurancePool.getPoolPosition(otherAccount, 0);
        const position3 = await insurancePool.getPoolPosition(thirdAccount, 0);

        expect(position1.active).to.be.true;
        expect(position2.active).to.be.true;
        expect(position3.active).to.be.true;
      });
    });
  });

  describe("Claimer", async function () {
    it("test claim voting and execution", async function () {
      const { btcToken, sursToken, insurancePool, claimer } = await loadFixture(
        basicFixture
      );
      const [ownerAccount, otherAccount] = await ethers.getSigners();

      // Setup initial pool state
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("1000", "ether").toString()
      );
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether").toString(),
        ninetyDays
      );

      // Setup voting stakes
      await sursToken.approve(
        claimer,
        ethers.parseUnits("200", "ether").toString()
      );
      await claimer.stake(ethers.parseUnits("200", "ether").toString());

      // Create claim
      await claimer.createClaim(
        otherAccount,
        "Test claim",
        ethers.parseUnits("10", "ether").toString()
      );

      // Check claim details
      const claim = await claimer.getClaimDetails(0);
      expect(claim.proposer).to.equal(ownerAccount);
      expect(claim.description).to.equal("Test claim");
      expect(claim.receiver).to.equal(otherAccount);
      expect(claim.amount).to.equal(ethers.parseUnits("10", "ether"));
      expect(claim.executed).to.be.false;

      // Vote on claim
      await claimer.vote(0, true);

      // Try to execute before voting period ends - should fail
      await expect(claimer.executeClaim(0)).to.be.revertedWith(
        "Voting period not ended"
      );

      // Wait for voting period to end
      await time.increase(7 * 24 * 60 * 60 + 1);

      // Execute claim
      await claimer.executeClaim(0);

      // Verify claim execution
      const executedClaim = await claimer.getClaimDetails(0);
      expect(executedClaim.executed).to.be.true;
    });
  });
});
