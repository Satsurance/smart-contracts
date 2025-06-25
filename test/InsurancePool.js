const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode, expectAllowedUnderstaking } = require("./helpers.js");
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
    const rewardPercentage = 85n;
    const coverageAmount = minimumRewardAmount * coverageAmountMultiplier;

    // Expected calculations
    const expectedOwnerRewardAmount = (minimumRewardAmount / 11n * rewardPercentage) / 100n;
    const expectedPositionValueAfterSlash = ethers.parseUnits((((110 - 3) / 110) * 10).toString(), "ether");

    const { btcToken, sursToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
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

    await insurancePool.joinPool(ownerStakeAmount, episodeToStake);
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

    const init_position = await insurancePool.getPoolPosition(ownerPositionId);
    const total_assets = await insurancePool.totalAssetsStaked();
    const total_shares = await insurancePool.totalPoolShares();
    expect(init_position.active).to.be.true;
    expect((init_position.shares * total_assets) / total_shares).to.equal(ownerStakeAmount);

    // Purchase coverage to generate rewards
    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: owner,
      coveredAccount: owner.address,
      coverageAmount: coverageAmount,
    });

    // Wait for rewards to be distributed
    await time.increaseTo((await time.latest()) + SECS_IN_DAY * 500);
    const earnedAmount = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    expectAllowedUnderstaking(earnedAmount, expectedOwnerRewardAmount, ALLOWED_UNDERSTAKING);

    // TEST SLASHING

    await claimer.createClaim(
      owner.address,
      insurancePool.target,
      "Test claim",
      claimAmount
    );
    await claimer.approveClaim(0);
    await time.increase(deploymentParams.executionTimeout + 1);
    await claimer.executeClaim(0);

    const new_total_assets = await insurancePool.totalAssetsStaked();
    const new_total_shares = await insurancePool.totalPoolShares();
    expectAllowedUnderstaking((init_position.shares * new_total_assets) / new_total_shares, expectedPositionValueAfterSlash, ALLOWED_UNDERSTAKING);

    const episodeDuration = await insurancePool.EPISODE_DURATION();
    const additionalTimeNeeded = episodeDuration * additionalEpisodeDurationMultiplier;

    const balanceBeforeQuit = await btcToken.balanceOf(owner);

    const earnedRewards = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    const expectedTotalAmount = expectedPositionValueAfterSlash + earnedRewards;

    await time.increase(additionalTimeNeeded);
    await insurancePool.quitPoolPosition(ownerPositionId);

    const balanceAfterQuit = await btcToken.balanceOf(owner);
    const actualReceivedAmount = balanceAfterQuit - balanceBeforeQuit;

    const finalPosition = await insurancePool.getPoolPosition(ownerPositionId);
    expect(finalPosition.active).to.be.false;

    expectAllowedUnderstaking(actualReceivedAmount, expectedTotalAmount, ALLOWED_UNDERSTAKING);
  });

  it("test slashing during staking effects", async () => {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const purchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;
    const claimAmount = ethers.parseUnits("10", "ether");
    const episodeOffset = 23;

    const rewardPercentage = 85n; // 85% goes to stakers
    const coverageAmount = purchaseAmount * coverageAmountMultiplier;

    const expectedRewardAmount = (purchaseAmount * rewardPercentage) / 100n;

    const { btcToken, sursToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
      basicFixture
    );
    const { owner, poolUnderwriter } = accounts;

    const episodeToStake = await getCurrentEpisode() + episodeOffset;
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake);

    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: poolUnderwriter,
      coveredAccount: poolUnderwriter.address,
      coverageAmount: coverageAmount,
    });

    await time.increaseTo((await time.latest()) + SECS_IN_DAY * 400);

    await claimer.createClaim(
      poolUnderwriter.address,
      insurancePool.target,
      "Test claim",
      claimAmount
    );
    await claimer.approveClaim(0);
    await time.increase(deploymentParams.executionTimeout + 1);
    await claimer.executeClaim(0);

    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const earnedAmount = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);

    expectAllowedUnderstaking(earnedAmount, expectedRewardAmount, ALLOWED_UNDERSTAKING);
  });

  it("test two stakers right proportion", async () => {
    const underwriterStakeAmount = ethers.parseUnits("21000000", "ether");
    const ownerStakeAmount = ethers.parseUnits("0.01", "ether");
    const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;
    const episodeOffset = 14;

    const rewardPercentage = 85n;
    const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier;
    const expectedTotalRewards = (coveragePurchaseAmount * rewardPercentage) / 100n;
    const totalStake = underwriterStakeAmount + ownerStakeAmount;
    const basicSmallStakerReward = ((ownerStakeAmount * expectedTotalRewards) / totalStake);
    const expectedBigStakerRewards = ((underwriterStakeAmount * expectedTotalRewards) / totalStake) + (basicSmallStakerReward * 10n / 100n);
    const expectedSmallStakerRewards = basicSmallStakerReward * 90n / 100n;

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

    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: owner,
      coveredAccount: poolUnderwriter.address,
      coverageAmount: coverageAmount,
    });

    await time.increase(SECS_IN_DAY * 601);
    const earnedAmountBig = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);
    const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(ownerPositionId);

    expectAllowedUnderstaking(earnedAmountBig, expectedBigStakerRewards, ALLOWED_UNDERSTAKING);
    expect(earnedAmountSmall).to.approximately(expectedSmallStakerRewards, 1n);
    expectAllowedUnderstaking(earnedAmountBig + earnedAmountSmall, expectedTotalRewards, ALLOWED_UNDERSTAKING);

    await insurancePool.quitPoolPosition(ownerPositionId);
    await insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId);
  });

  it("test two stakers right proportion different rewards time", async () => {
    const underwriterStakeAmount = ethers.parseUnits("21000000", "ether");
    const ownerStakeAmount = ethers.parseUnits("0.01", "ether");
    const coveragePurchaseAmount = ethers.parseUnits("0.1", "ether");
    const coverageAmountMultiplier = 10n;
    const slashAmount = ethers.parseUnits("0.01", "ether");
    const numIterations = 10;
    const episodeOffset = 23;

    const rewardPercentage = 85n;
    const totalCoveragePurchases = coveragePurchaseAmount * BigInt(numIterations);
    const expectedTotalRewards = (totalCoveragePurchases * rewardPercentage) / 100n;
    const totalStake = underwriterStakeAmount + ownerStakeAmount;
    const basicSmallStakerReward = ((ownerStakeAmount * expectedTotalRewards) / totalStake);
    const expectedBigStakerRewards = ((underwriterStakeAmount * expectedTotalRewards) / totalStake) + (basicSmallStakerReward * 10n / 100n);
    const expectedSmallStakerRewards = basicSmallStakerReward * 90n / 100n;

    const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const currentEpisode4 = await getCurrentEpisode();
    const episodeToStake4 = currentEpisode4 + episodeOffset;
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake4);
    await insurancePool.joinPool(ownerStakeAmount, episodeToStake4);

    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

    const position_big = await insurancePool.getPoolPosition(underwriterPositionId);
    const position_small = await insurancePool.getPoolPosition(ownerPositionId);
    expect(position_big.shares).to.equal(underwriterStakeAmount);
    expect(position_small.shares).to.equal(ownerStakeAmount);

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
      await time.increase(SECS_IN_DAY * 20);

      // Add small slashing event after each coverage purchase
      totalSlashed += slashAmount;

      await claimer.createClaim(
        owner.address,
        insurancePool.target,
        `Small slash claim ${i + 1}`,
        slashAmount
      );
      await claimer.approveClaim(i);
      await time.increase(deploymentParams.executionTimeout + 1);
      await claimer.executeClaim(i);
    }

    await time.increase(SECS_IN_DAY * 700);

    const earnedAmountBig = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);
    const earnedAmountSmall = await insurancePool.earnedPosition.staticCall(ownerPositionId);

    expectAllowedUnderstaking(earnedAmountBig, expectedBigStakerRewards, ALLOWED_UNDERSTAKING);
    expect(earnedAmountSmall).to.equal(expectedSmallStakerRewards);
    expectAllowedUnderstaking(earnedAmountBig + earnedAmountSmall, expectedTotalRewards, ALLOWED_UNDERSTAKING);

    await insurancePool.quitPoolPosition(ownerPositionId);
    await insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId);
  });

  it("test minimum stake amount edge cases", async function () {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const episodeOffset = 23;

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const currentEpisode5 = await getCurrentEpisode();
    const episodeToStake5 = currentEpisode5 + episodeOffset;

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake5);

    const minimumStakeAmount = await insurancePool.minimumStakeAmount();

    // Test amount 1 wei below minimum - should fail
    await expect(
      insurancePool.joinPool(minimumStakeAmount - 1n, episodeToStake5)
    ).to.be.revertedWith("Too small staking amount");

    // Test exactly minimum amount
    await expect(insurancePool.joinPool(minimumStakeAmount, episodeToStake5)).to
      .not.be.reverted;

    // Verify position was created correctly
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
    const position = await insurancePool.getPoolPosition(ownerPositionId);
    expect(position.shares).to.equal(minimumStakeAmount);
    expect(position.active).to.be.true;
  });

  it("test position stops earning rewards after episode expires", async function () {
    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const stakeAmount = ethers.parseUnits("1", "ether"); // 1 BTC for both positions
    const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;
    const shortEpisodeOffset = 2n; // Short episode
    const longEpisodeOffset = 23n; // Long episode

    // Expected reward calculations
    const protocolFee = 1500n; // 15%
    const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier; // 10 BTC
    const annualPercent = 1000n; // 10%
    const basisPoints = 10000n;
    const coverageDuration = 365n * 24n * 60n * 60n; // 1 year in seconds

    // Premium = (duration * annualPercent * coverageAmount) / (365 days * BASIS_POINTS)
    const premiumAmount = (coverageDuration * annualPercent * coverageAmount) / (365n * 24n * 60n * 60n * basisPoints);
    const protocolFeeAmount = (premiumAmount * protocolFee) / basisPoints;
    const rewardAmount = premiumAmount - protocolFeeAmount;


    const episodeDuration = await insurancePool.EPISODE_DURATION();
    const currentEpisode = BigInt(await getCurrentEpisode());

    const shortEpisodeToStake = currentEpisode + shortEpisodeOffset;
    const longEpisodeToStake = currentEpisode + longEpisodeOffset;
    const shortEpisodeFinishTime = (shortEpisodeToStake + 1n) * episodeDuration;
    const longEpisodeFinishTime = (longEpisodeToStake + 1n) * episodeDuration;

    // Create long-term position
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(stakeAmount, longEpisodeToStake);

    // Create short-term position
    await insurancePool.joinPool(stakeAmount, shortEpisodeToStake);

    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);


    await purchaseCoverage({
      insurancePool,
      poolAsset: btcToken,
      buyer: owner,
      coveredAccount: owner.address,
      coverageAmount: coverageAmount,
    });
    const purchaseTime = BigInt(await time.latest());
    const coverageFinishTime = ((purchaseTime + coverageDuration) / episodeDuration + 1n) * episodeDuration;

    const expectedLongReward = rewardAmount * (shortEpisodeFinishTime - purchaseTime) * 1222222222222222222n / ((coverageFinishTime - purchaseTime) * 2222222222222222222n) +
      rewardAmount * (coverageFinishTime - shortEpisodeFinishTime) / (coverageFinishTime - purchaseTime);
    const expectedShortReward = rewardAmount - expectedLongReward;

    await time.increaseTo(shortEpisodeFinishTime + 1n);
    const rewardsShort = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    expectAllowedUnderstaking(rewardsShort, expectedShortReward, ALLOWED_UNDERSTAKING);


    await time.increaseTo(longEpisodeFinishTime + 1n);
    const finalRewards_short = await insurancePool.earnedPosition.staticCall(ownerPositionId);
    const finalRewards_long = await insurancePool.earnedPositions.staticCall([underwriterPositionId, 0]);

    expectAllowedUnderstaking(finalRewards_long, expectedLongReward, ALLOWED_UNDERSTAKING);
    expectAllowedUnderstaking(finalRewards_short, expectedShortReward, ALLOWED_UNDERSTAKING);
    expectAllowedUnderstaking(finalRewards_long + finalRewards_short, rewardAmount, ALLOWED_UNDERSTAKING);
  });

  it("test isNewDepositAccepted functionality", async function () {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const userStakeAmount = ethers.parseUnits("10", "ether");
    const extendDepositAmount = ethers.parseUnits("5", "ether");
    const episodeOffset = 23n;

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const currentEpisode = BigInt(await getCurrentEpisode());
    const episodeToStake = currentEpisode + episodeOffset;
    const extendEpisodeToStake = currentEpisode + episodeOffset + 3n;

    // Initially, isNewDepositAccepted should be true (from fixture)
    expect(await insurancePool.isNewDepositAccepted()).to.be.true;

    // Underwriter should always be able to join regardless of flag
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake);

    // Regular user should be able to join when flag is true
    await insurancePool.connect(owner).joinPool(userStakeAmount, episodeToStake);
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

    // Test setNewDepositsFlag - only underwriter should be able to call it
    await expect(
      insurancePool.connect(owner).setNewDepositsFlag(false)
    ).to.be.revertedWith("Access check failed");

    // Underwriter sets flag to false
    await insurancePool.connect(poolUnderwriter).setNewDepositsFlag(false);
    expect(await insurancePool.isNewDepositAccepted()).to.be.false;

    // Underwriter should still be able to join (but can't have multiple positions)
    // This should fail because underwriter already has a position
    await expect(
      insurancePool.connect(poolUnderwriter).joinPool(userStakeAmount, episodeToStake)
    ).to.be.revertedWith("Underwriter can't have multiple positions");

    // Test extendPoolPosition when flag is false
    // First, wait for position to expire so we can extend it
    const episodeDuration = await insurancePool.EPISODE_DURATION();
    await time.increaseTo((episodeToStake + 1n) * episodeDuration + 1n);

    // Regular user should not be able to extend when flag is false
    await expect(
      insurancePool.connect(owner).extendPoolPosition(
        ownerPositionId,
        extendEpisodeToStake,
        0, // no withdrawal
        extendDepositAmount
      )
    ).to.be.revertedWith("Extended deposits are not allowed");
  });
});
