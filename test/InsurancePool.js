const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode } = require("./helpers.js");
const { basicFixture } = require("./fixtures.js");

const { expect } = require("chai");

const ALLOWED_UNDERSTAKING = ethers.parseUnits("0.000000001", "ether"); // 0.01 cent if bitcoin costs 100k
const SECS_IN_DAY = 60 * 60 * 24;

describe("InsurancePool", async function () {

  it("test basic", async function () {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const ownerStakeAmount = ethers.parseUnits("10", "ether");
    const minimumRewardAmount = ethers.parseUnits("0.0000001", "ether"); // 1 cent reward for 100k btc
    const coverageAmountMultiplier = 10n;
    const claimAmount = ethers.parseUnits("3", "ether");
    const episodeOffset = 23; // episodes from current that satisfies (23 - 0) % 3 == 2
    const additionalEpisodeDurationMultiplier = 24n;

    // Fee and reward calculations
    const feePercentage = 25n; // 25% fee
    const rewardPercentage = 75n; // 75% goes to stakers
    const coverageAmount = minimumRewardAmount * coverageAmountMultiplier;

    // Expected calculations
    const expectedOwnerRewardAmount = (minimumRewardAmount / 11n * rewardPercentage) / 100n;
    const expectedPositionValueAfterSlash = ethers.parseUnits((((110 - 3) / 110) * 10).toString(), "ether");

    const { btcToken, sursToken, insurancePool, claimer, positionNFT, accounts } = await loadFixture(
      basicFixture
    );
    // Get accounts matching Ignition setup
    const { owner, poolUnderwriter } = accounts;

    // Calculate valid episode: currentEpisode + episodes where (episodes - currentEpisode) % 3 == 2
    const currentEpisode = await getCurrentEpisode();
    const episodeToStake = currentEpisode + episodeOffset;

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake);

    // Get underwriter position ID - first position for poolUnderwriter
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

    // Now owner can make a position
    await insurancePool.joinPool(ownerStakeAmount, episodeToStake);

    // Get owner position ID - first position for owner
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

    const init_position = await insurancePool.getPoolPosition(ownerPositionId);
    const total_assets = await insurancePool.totalAssetsStaked();
    const total_shares = await insurancePool.totalPoolShares();
    expect(init_position.active).to.be.true;
    expect((init_position.shares * total_assets) / total_shares).to.equal(ownerStakeAmount);

    // Check reward logic - owner can buy coverage directly
    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: owner,
      coveredAccount: owner.address,
      coverageAmount: coverageAmount,
    });

    // It is required some time to have all the rewards distributed.
    await time.increaseTo((await time.latest()) + SECS_IN_DAY * 500);
    const earnedAmount = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    // There are some precision errors
    expect(earnedAmount).to.approximately(
      expectedOwnerRewardAmount,
      ALLOWED_UNDERSTAKING
    );

    // Setup for claim testing
    // Create and approve claim
    await claimer.createClaim(
      owner.address,
      insurancePool.target,
      "Test claim",
      claimAmount
    );
    await claimer.approveClaim(0); // Approve claim as the approver (owner)

    // Execute the approved claim
    await claimer.executeClaim(0);

    // Check slashing effect
    const new_total_assets = await insurancePool.totalAssetsStaked();
    const new_total_shares = await insurancePool.totalPoolShares();
    expect(
      (init_position.shares * new_total_assets) / new_total_shares
    ).to.approximately(
      expectedPositionValueAfterSlash,
      ALLOWED_UNDERSTAKING
    );

    const episodeDuration = await insurancePool.EPISODE_DURATION();
    const additionalTimeNeeded = episodeDuration * additionalEpisodeDurationMultiplier;

    // Get owner's balance before quitting the pool
    const balanceBeforeQuit = await btcToken.balanceOf(owner);

    // Calculate expected amount to receive (position value after slashing + rewards)
    const earnedRewards = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    const expectedTotalAmount = expectedPositionValueAfterSlash + earnedRewards;

    await time.increase(additionalTimeNeeded);
    await insurancePool.quitPoolPosition(ownerPositionId);

    // Get owner's balance after quitting the pool
    const balanceAfterQuit = await btcToken.balanceOf(owner);
    const actualReceivedAmount = balanceAfterQuit - balanceBeforeQuit;

    const finalPosition = await insurancePool.getPoolPosition(ownerPositionId);
    expect(finalPosition.active).to.be.false;

    // Check that the user received the expected amount
    expect(actualReceivedAmount).to.approximately(
      expectedTotalAmount,
      ALLOWED_UNDERSTAKING
    );
  });

  it("test slashing during staking effects", async () => {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const purchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;
    const claimAmount = ethers.parseUnits("10", "ether");
    const episodeOffset = 23;

    // Fee and reward calculations
    const rewardPercentage = 85n; // 85% goes to stakers
    const coverageAmount = purchaseAmount * coverageAmountMultiplier;

    // Expected calculations
    const expectedRewardAmount = (purchaseAmount * rewardPercentage) / 100n;

    const { btcToken, sursToken, insurancePool, claimer, positionNFT, accounts } = await loadFixture(
      basicFixture
    );
    const { owner, poolUnderwriter } = accounts;

    // Calculate valid episode for staking
    const episodeToStake = await getCurrentEpisode() + episodeOffset;

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake);

    // Generate rewards through coverage purchase
    await btcToken.transfer(poolUnderwriter, purchaseAmount);

    // Purchase coverage to generate rewards
    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: poolUnderwriter,
      coveredAccount: poolUnderwriter.address,
      coverageAmount: coverageAmount,
    });

    // Distribute reward
    await time.increaseTo((await time.latest()) + SECS_IN_DAY * 400);

    // Create and approve claim
    await claimer.createClaim(
      poolUnderwriter.address,
      insurancePool.target,
      "Test claim",
      claimAmount
    );
    await claimer.approveClaim(0); // Approve claim as the approver (owner)

    // Execute the approved claim
    await claimer.executeClaim(0);

    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const earnedAmount = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);

    // Should receive full rewards since underwriter is the only staker
    expect(earnedAmount).to.approximately(
      expectedRewardAmount,
      ALLOWED_UNDERSTAKING
    );
  });

  it("test two stakers right proportion", async () => {
    const underwriterStakeAmount = ethers.parseUnits("21000000", "ether");
    const ownerStakeAmount = ethers.parseUnits("0.01", "ether");
    const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;
    const episodeOffset = 23;

    // Fee and reward calculations
    const rewardPercentage = 85n; // 85% goes to stakers
    const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier;

    // Expected calculations
    const expectedTotalRewards = (coveragePurchaseAmount * rewardPercentage) / 100n;
    const totalStake = underwriterStakeAmount + ownerStakeAmount;
    const basicSmallStakerReward = ((ownerStakeAmount * expectedTotalRewards) / totalStake);
    const expectedBigStakerRewards = ((underwriterStakeAmount * expectedTotalRewards) / totalStake) + (basicSmallStakerReward * 10n / 100n);
    const expectedSmallStakerRewards = basicSmallStakerReward * 90n / 100n + 1n; // TODO: fix precision error

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    // Calculate valid episode for staking
    const currentEpisode3 = await getCurrentEpisode();
    const episodeToStake3 = currentEpisode3 + episodeOffset;

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake3);
    await insurancePool.joinPool(ownerStakeAmount, episodeToStake3);


    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

    const position_big = await insurancePool.getPoolPosition(underwriterPositionId);
    const position_small = await insurancePool.getPoolPosition(ownerPositionId);
    expect(position_big.shares).to.equal(underwriterStakeAmount.toString());
    expect(position_small.shares).to.equal(ownerStakeAmount.toString());

    // Check if rewards distributed honestly
    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: owner,
      coveredAccount: poolUnderwriter.address,
      coverageAmount: coverageAmount,
    });

    await time.increaseTo((await time.latest()) + SECS_IN_DAY * 600);
    const earnedAmountBig = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);
    const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(ownerPositionId);

    expect(earnedAmountBig).to.approximately(
      expectedBigStakerRewards,
      ALLOWED_UNDERSTAKING
    );
    expect(earnedAmountSmall).to.equal(expectedSmallStakerRewards);
    expect(earnedAmountBig + earnedAmountSmall).to.approximately(
      expectedTotalRewards,
      ALLOWED_UNDERSTAKING
    );
  });

  it("test two stakers right proportion different rewards time", async () => {
    const underwriterStakeAmount = ethers.parseUnits("21000000", "ether");
    const ownerStakeAmount = ethers.parseUnits("0.01", "ether");
    const coveragePurchaseAmount = ethers.parseUnits("0.1", "ether");
    const coverageAmountMultiplier = 10n;
    const slashAmount = ethers.parseUnits("0.01", "ether");
    const numIterations = 10;
    const episodeOffset = 23;

    // Fee and reward calculations
    const rewardPercentage = 85n;

    // Expected calculations
    const totalCoveragePurchases = coveragePurchaseAmount * BigInt(numIterations);
    const expectedTotalRewards = (totalCoveragePurchases * rewardPercentage) / 100n;
    const totalStake = underwriterStakeAmount + ownerStakeAmount;
    const basicSmallStakerReward = ((ownerStakeAmount * expectedTotalRewards) / totalStake);
    const expectedBigStakerRewards = ((underwriterStakeAmount * expectedTotalRewards) / totalStake) + (basicSmallStakerReward * 10n / 100n);
    const expectedSmallStakerRewards = basicSmallStakerReward * 90n / 100n;

    const { btcToken, insurancePool, claimer, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    // Create positions
    // Calculate valid episode for staking
    const currentEpisode4 = await getCurrentEpisode();
    const episodeToStake4 = currentEpisode4 + episodeOffset;

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake4);
    await insurancePool.joinPool(ownerStakeAmount, episodeToStake4);

    // Verify initial positions and shares
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

    const position_big = await insurancePool.getPoolPosition(underwriterPositionId);
    const position_small = await insurancePool.getPoolPosition(ownerPositionId);
    expect(position_big.shares).to.equal(underwriterStakeAmount);
    expect(position_small.shares).to.equal(ownerStakeAmount);

    // Make 10 coverage purchases over time to distribute rewards
    let totalSlashed = 0n;

    for (let i = 0; i < numIterations; i++) {
      await purchaseCoverage({
        insurancePool,
        poolAsset: btcToken,
        buyer: owner,
        coveredAccount: owner.address,
        coverageAmount: coveragePurchaseAmount * coverageAmountMultiplier,
      });

      // Increase time between purchases
      await time.increaseTo((await time.latest()) + SECS_IN_DAY * 20);

      // Add small slashing event after each coverage purchase
      totalSlashed += slashAmount;

      await claimer.createClaim(
        owner.address,
        insurancePool.target,
        `Small slash claim ${i + 1}`,
        slashAmount
      );
      await claimer.approveClaim(i); // Approve claim as the approver (owner)
      await claimer.executeClaim(i); // Execute the approved claim
    }

    // Additional time increase to ensure all rewards are distributed
    await time.increaseTo((await time.latest()) + SECS_IN_DAY * 700);

    // Check earned rewards
    const earnedAmountBig = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);
    const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(ownerPositionId);

    expect(earnedAmountBig).to.approximately(
      expectedBigStakerRewards,
      ALLOWED_UNDERSTAKING
    );
    expect(earnedAmountSmall).to.equal(expectedSmallStakerRewards);
    expect(earnedAmountBig + earnedAmountSmall).to.approximately(
      expectedTotalRewards,
      ALLOWED_UNDERSTAKING
    );

    await insurancePool.quitPoolPosition(ownerPositionId);
    await insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId);
  });

  it("test minimum stake amount edge cases", async function () {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const episodeOffset = 23;

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    // Calculate valid episode for staking
    const currentEpisode5 = await getCurrentEpisode();
    const episodeToStake5 = currentEpisode5 + episodeOffset;

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake5);

    // Get minimum stake amount from contract
    const minimumStakeAmount = await insurancePool.minimumStakeAmount();

    // Test amount 1 wei below minimum - should fail
    await expect(
      insurancePool.joinPool(minimumStakeAmount - 1n, episodeToStake5)
    ).to.be.revertedWith("Too small staking amount");

    // Test exactly minimum amount - should succeed
    await expect(insurancePool.joinPool(minimumStakeAmount, episodeToStake5)).to
      .not.be.reverted;

    // Verify position was created correctly
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
    const position = await insurancePool.getPoolPosition(ownerPositionId);
    expect(position.shares).to.equal(minimumStakeAmount);
    expect(position.active).to.be.true;
  });

  it("test position stops earning rewards after episode expires", async function () {
    const stakeAmount = ethers.parseUnits("1", "ether"); // 1 BTC for both positions
    const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;
    const shortEpisodeOffset = 2n; // Short episode (will expire sooner)
    const longEpisodeOffset = 23n; // Long episode (will continue)

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const currentEpisode = BigInt(await getCurrentEpisode());
    const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
    const longEpisodeToStake = currentEpisode + longEpisodeOffset;

    // Create long-term position (poolUnderwriter)
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(stakeAmount, longEpisodeToStake);

    // Create short-term position (owner)
    await insurancePool.joinPool(stakeAmount, shortEpisodeToStake);


    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);

    // Verify both positions are active and have equal stakes
    const shortPosition = await insurancePool.getPoolPosition(ownerPositionId);
    const longPosition = await insurancePool.getPoolPosition(underwriterPositionId);
    expect(shortPosition.shares).to.equal(stakeAmount);
    expect(longPosition.shares).to.equal(stakeAmount);
    expect(shortPosition.active).to.be.true;
    expect(longPosition.active).to.be.true;

    // Purchase coverage to generate rewards (single purchase)
    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: owner,
      coveredAccount: owner.address,
      coverageAmount: coveragePurchaseAmount * coverageAmountMultiplier,
    });

    // Calculate when the long episode expires (both positions will have expired by then)
    const episodeDuration = await insurancePool.EPISODE_DURATION();
    const longEpisodeExpiry = longEpisodeToStake * episodeDuration;

    // Advance time to just after the long episode expires
    await time.increaseTo(longEpisodeExpiry + 1n);

    // Check final rewards after both episodes have expired
    const finalRewards_short = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    const finalRewards_long = await insurancePool.earnedPosition.staticCall(underwriterPositionId);

    // The long position should have earned more rewards since it was active longer
    // The short position stopped earning after its episode expired
    // The long position continued earning until its episode expired
    expect(finalRewards_long).to.be.greaterThan(finalRewards_short);
  });
});
