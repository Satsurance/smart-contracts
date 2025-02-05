const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

const { InsuranceSetup } = require("../ignition/modules/Insurance.js");

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
      const [ownerAccount, otherAccount] = await ethers.getSigners();

      // Make a position
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("2000", "ether").toString()
      );
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether").toString(),
        0
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
        otherAccount.address,
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
      await insurancePool.quitPool(0);
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
        0
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
        otherAccount.address,
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
        0
      );
      await insurancePool
        .connect(otherAccount)
        .joinPool(ethers.parseUnits("0.01", "ether").toString(), 0);

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
        0
      );
      await insurancePool
        .connect(otherAccount)
        .joinPool(ethers.parseUnits("0.01", "ether").toString(), 0);

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
      const ninetyDays = 60 * 60 * 24 * 90;
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
      await expect(insurancePool.quitPool(0)).to.be.revertedWith(
        "Funds are timelocked, first lock."
      );

      // Move to just after 90 days but outside timegap window (1 week + 1 day after period)
      await time.increaseTo(
        startDate + ninetyDays + 7 * 24 * 60 * 60 + 24 * 60 * 60
      );
      await expect(insurancePool.quitPool(0)).to.be.revertedWith(
        "Funds are timelocked, auto-restake lock."
      );

      // Move to within timegap window of second period (90 days * 2)
      await time.increaseTo(startDate + ninetyDays * 2 + 24 * 60 * 60); // 1 day into window
      // Should succeed now as we're in the withdrawal window
      await expect(insurancePool.quitPool(0)).to.not.be.reverted;
    });

    it("test minimum stake amount edge cases", async function () {
      const { btcToken, insurancePool } = await loadFixture(basicFixture);
      const [ownerAccount] = await ethers.getSigners();

      // Get minimum stake amount from contract
      const minimumStake = await insurancePool.minimumStakeAmount();

      // Approve enough tokens for all tests
      await btcToken.approve(insurancePool, ethers.parseUnits("1", "ether"));

      // Test exactly minimum amount - should succeed
      await expect(insurancePool.joinPool(minimumStake, 60 * 60 * 24 * 90)).to
        .not.be.reverted;

      // Verify position was created correctly
      const position = await insurancePool.getPoolPosition(ownerAccount, 0);
      expect(position.initialAmount).to.equal(minimumStake);
      expect(position.active).to.be.true;

      // Test amount 1 wei below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStake - 1n, 0)
      ).to.be.revertedWith("Too small staking amount.");

      // Test amount significantly below minimum - should fail
      await expect(
        insurancePool.joinPool(minimumStake / 2n, 0)
      ).to.be.revertedWith("Too small staking amount.");
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
        0
      );

      // Setup voting stakes
      await sursToken.approve(
        claimer,
        ethers.parseUnits("200", "ether").toString()
      );
      await claimer.stake(ethers.parseUnits("200", "ether").toString());

      // Create claim
      await claimer.createClaim(
        otherAccount.address,
        "Test claim",
        ethers.parseUnits("10", "ether").toString()
      );

      // Check claim details
      const claim = await claimer.getClaimDetails(0);
      expect(claim.proposer).to.equal(ownerAccount.address);
      expect(claim.description).to.equal("Test claim");
      expect(claim.receiver).to.equal(otherAccount.address);
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
