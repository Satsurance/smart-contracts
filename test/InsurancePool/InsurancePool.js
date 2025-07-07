const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { purchaseCoverage, getCurrentEpisode, expectAllowedUnderstaking, findClosestStakableEpisode } = require("../helpers.js");
const { basicFixture } = require("../fixtures.js");
const { ALLOWED_UNDERSTAKING, SECS_IN_DAY, EPISODE_DURATION, MINIMUM_STAKE_AMOUNT_BTC, BASIS_POINTS } = require("../constants.js");

const { expect } = require("chai");

describe("InsurancePool", async function () {

  it("test basic", async function () {
    const underwriterStakeAmount = ethers.parseUnits("100", "ether");
    const ownerStakeAmount = ethers.parseUnits("10", "ether");
    const minimumRewardAmount = ethers.parseUnits("0.0000001", "ether"); // 1 cent reward for 100k btc
    const coverageAmountMultiplier = 10n;
    const claimAmount = ethers.parseUnits("3", "ether");
    const additionalEpisodeDurationMultiplier = 24n;

    // Fee and reward calculations
    const rewardPercentage = 85n;
    const coverageAmount = minimumRewardAmount * coverageAmountMultiplier;

    // Expected calculations
    const expectedOwnerRewardAmount = (minimumRewardAmount / 11n * rewardPercentage) / 100n;
    const expectedPositionValueAfterSlash = ethers.parseUnits((((110 - 3) / 110) * 10).toString(), "ether");

    const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
      basicFixture
    );
    // Get accounts matching Ignition setup
    const { owner, poolUnderwriter } = accounts;

    // Find closest stakable episode
    const episodeToStake = await findClosestStakableEpisode(23n);

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

    const additionalTimeNeeded = EPISODE_DURATION * additionalEpisodeDurationMultiplier;

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

    const rewardPercentage = 85n; // 85% goes to stakers
    const coverageAmount = purchaseAmount * coverageAmountMultiplier;

    const expectedRewardAmount = (purchaseAmount * rewardPercentage) / 100n;

    const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(
      basicFixture
    );
    const { poolUnderwriter } = accounts;

    const episodeToStake = await findClosestStakableEpisode(23n);
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

    const rewardPercentage = 85n;
    const coverageAmount = coveragePurchaseAmount * coverageAmountMultiplier;
    const expectedTotalRewards = (coveragePurchaseAmount * rewardPercentage) / 100n;
    const totalStake = underwriterStakeAmount + ownerStakeAmount;
    const basicSmallStakerReward = ((ownerStakeAmount * expectedTotalRewards) / totalStake);
    const expectedBigStakerRewards = ((underwriterStakeAmount * expectedTotalRewards) / totalStake) + (basicSmallStakerReward * 10n / 100n);
    const expectedSmallStakerRewards = basicSmallStakerReward * 90n / 100n;

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    // Find closest stakable episode
    const episodeToStake3 = await findClosestStakableEpisode(14n);

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

    const rewardPercentage = 85n;
    const totalCoveragePurchases = coveragePurchaseAmount * BigInt(numIterations);
    const expectedTotalRewards = (totalCoveragePurchases * rewardPercentage) / 100n;
    const totalStake = underwriterStakeAmount + ownerStakeAmount;
    const basicSmallStakerReward = ((ownerStakeAmount * expectedTotalRewards) / totalStake);
    const expectedBigStakerRewards = ((underwriterStakeAmount * expectedTotalRewards) / totalStake) + (basicSmallStakerReward * 10n / 100n);
    const expectedSmallStakerRewards = basicSmallStakerReward * 90n / 100n;

    const { btcToken, insurancePool, claimer, positionNFT, accounts, deploymentParams } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const episodeToStake4 = await findClosestStakableEpisode(23n);
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

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const episodeToStake5 = await findClosestStakableEpisode(23n);

    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake5);

    // Test amount 1 wei below minimum - should fail
    await expect(
      insurancePool.joinPool(MINIMUM_STAKE_AMOUNT_BTC - 1n, episodeToStake5)
    ).to.be.revertedWith("Too small staking amount");

    // Test exactly minimum amount
    await expect(insurancePool.joinPool(MINIMUM_STAKE_AMOUNT_BTC, episodeToStake5)).to
      .not.be.reverted;

    // Verify position was created correctly
    const ownerPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);
    const position = await insurancePool.getPoolPosition(ownerPositionId);
    expect(position.shares).to.equal(MINIMUM_STAKE_AMOUNT_BTC);
    expect(position.active).to.be.true;
  });

  it("test position stops earning rewards after episode expires", async function () {
    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const stakeAmount = ethers.parseUnits("10", "ether"); // 1 BTC for both positions
    const coveragePurchaseAmount = ethers.parseUnits("1", "ether");
    const coverageAmountMultiplier = 10n;

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

    const shortEpisodeToStake = await findClosestStakableEpisode(2n); // Short episode
    const longEpisodeToStake = await findClosestStakableEpisode(23n); // Long episode
    const shortEpisodeFinishTime = (shortEpisodeToStake + 1n) * EPISODE_DURATION;
    const longEpisodeFinishTime = (longEpisodeToStake + 1n) * EPISODE_DURATION;

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
    const coverageFinishTime = ((purchaseTime + coverageDuration) / EPISODE_DURATION + 1n) * EPISODE_DURATION;

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

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const episodeToStake = await findClosestStakableEpisode(23n);

    // Test setNewDepositsFlag - only underwriter should be able to call it
    await expect(
      insurancePool.connect(owner).setNewDepositsFlag(false)
    ).to.be.revertedWith("Access check failed");

    // Underwriter sets flag to false
    await insurancePool.connect(poolUnderwriter).setNewDepositsFlag(false);
    expect(await insurancePool.isNewDepositAccepted()).to.be.false;

    // Underwriter should always be able to join even when flag is false
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake);

    // Regular user should not be able to join when flag is false
    await expect(
      insurancePool.connect(owner).joinPool(userStakeAmount, episodeToStake)
    ).to.be.revertedWith("New deposits are not allowed");
  });

  it("test underwriter minimum stake enforcement with active position", async function () {
    const underwriterStakeAmount = ethers.parseUnits("10", "ether");

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const episodeToStake = await findClosestStakableEpisode(23n);

    // Underwriter joins pool with a relatively small stake
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, episodeToStake);

    // Get the minimum underwriter percentage (should be 1000 basis points = 10%)
    const minUnderwriterPercentage = await insurancePool.minUnderwriterPercentage();
    const basisPoints = 10000n;

    // Calculate the exact maximum allowed user stake
    const totalPoolShares = await insurancePool.totalPoolShares();
    const maxAllowedUserStake = (underwriterStakeAmount * basisPoints) / minUnderwriterPercentage - totalPoolShares;

    // Verify our calculation matches the contract's calculation
    const contractMaxShares = await insurancePool.maxSharesUserToStake();
    expect(contractMaxShares).to.equal(maxAllowedUserStake);

    // Test that 1 wei more fails
    const excessiveStake = maxAllowedUserStake + 1n;
    await expect(
      insurancePool.connect(owner).joinPool(excessiveStake, episodeToStake)
    ).to.be.revertedWith("Underwriter position can't be less than allowed");

    // Test that exactly the maximum allowed amount succeeds
    await expect(
      insurancePool.connect(owner).joinPool(maxAllowedUserStake, episodeToStake)
    ).to.not.be.reverted;

    // Verify the underwriter percentage is exactly at the minimum after successful stake
    const poolStats = await insurancePool.poolStatsLatest.staticCall();
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
    const underwriterPercentage = (underwriterPosition.shares * basisPoints) / poolStats.totalPoolShares_;
    expect(underwriterPercentage).to.equal(minUnderwriterPercentage);
  });

  it("test underwriter minimum stake enforcement with expired position", async function () {
    const underwriterStakeAmount = ethers.parseUnits("10", "ether");

    const { btcToken, insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const underwriterEpisodeToStake = await findClosestStakableEpisode(2n); // Short episode that will expire soon
    const userEpisodeToStake = await findClosestStakableEpisode(23n); // Long episode for user

    // Underwriter joins pool with a short episode
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, underwriterEpisodeToStake);

    // Wait for the underwriter's episode to expire
    const underwriterEpisodeFinishTime = (underwriterEpisodeToStake + 1n) * EPISODE_DURATION;
    await time.increaseTo(underwriterEpisodeFinishTime + 1n);

    // Verify the underwriter position is now expired
    const currentEpisodeAfterWait = BigInt(await getCurrentEpisode());
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);
    expect(underwriterPosition.episode).to.be.lessThan(currentEpisodeAfterWait);

    // Get the minimum underwriter percentage (should be 1000 basis points = 10%)
    const minUnderwriterPercentage = await insurancePool.minUnderwriterPercentage();
    const basisPoints = 10000n;

    // Calculate the exact maximum allowed user stake for expired underwriter position
    const poolStats = await insurancePool.poolStatsLatest.staticCall();
    const expectedAllowedUserStake = (underwriterStakeAmount * basisPoints) / minUnderwriterPercentage - poolStats.totalPoolShares_ - underwriterStakeAmount;

    // Verify our calculation matches the contract's calculation
    const contractMaxShares = poolStats.maxSharesUserToStake_;
    expect(contractMaxShares).to.equal(expectedAllowedUserStake);


    // Test that 1 wei more fails
    const excessiveStake = expectedAllowedUserStake + 1n;
    await expect(
      insurancePool.connect(owner).joinPool(excessiveStake, userEpisodeToStake)
    ).to.be.revertedWith("Underwriter position can't be less than allowed");

    // Test that exactly the maximum allowed amount succeeds
    await expect(
      insurancePool.connect(owner).joinPool(expectedAllowedUserStake, userEpisodeToStake)
    ).to.not.be.reverted;


    // Verify the underwriter percentage is at least the minimum after successful stake
    // For expired positions, the underwriter shares are added to totalPoolShares for percentage calculation
    const finalTotalPoolShares = await insurancePool.totalPoolShares();
    const effectiveTotalShares = finalTotalPoolShares + underwriterStakeAmount; // Add expired underwriter shares
    const underwriterPercentage = (underwriterStakeAmount * basisPoints) / effectiveTotalShares;

    // The actual percentage should be at least the minimum (can be higher due to discrete stake amounts)
    expect(underwriterPercentage).to.be.at.least(minUnderwriterPercentage);
  });

  it("test underwriter cannot quit pool if it exceeds minUnderwriterPercentage", async function () {
    const underwriterStakeAmount = ethers.parseUnits("10", "ether");
    const userStakeAmount = ethers.parseUnits("80", "ether"); // Large user stake
    const expectedMaxSharesToUnstake = ethers.parseUnits("1.111111111111111111", "ether");

    const { insurancePool, positionNFT, accounts } = await loadFixture(basicFixture);
    const { owner, poolUnderwriter } = accounts;

    const longEpisodeToStake = await findClosestStakableEpisode(23n);
    const shortEpisodeToStake = await findClosestStakableEpisode(2n);

    // Underwriter joins with relatively small stake
    await insurancePool
      .connect(poolUnderwriter)
      .joinPool(underwriterStakeAmount, shortEpisodeToStake);

    // User joins with large stake that makes underwriter percentage close to minimum
    await insurancePool.connect(owner).joinPool(userStakeAmount, longEpisodeToStake);

    // Wait for episodes to expire so positions can be quit
    const episodeFinishTime = (shortEpisodeToStake + 1n) * EPISODE_DURATION;
    await time.increaseTo(episodeFinishTime + 1n);

    // Get position IDs
    const underwriterPositionId = await positionNFT.tokenOfOwnerByIndex(poolUnderwriter.address, 0);
    const userPositionId = await positionNFT.tokenOfOwnerByIndex(owner.address, 0);

    // Verify the underwriter percentage is at/near the minimum
    const poolStats = await insurancePool.poolStatsLatest.staticCall();
    const underwriterPosition = await insurancePool.getPoolPosition(underwriterPositionId);


    // Verify that maxUnderwriterSharesToUnstake is 0 (can't unstake anything)
    expect(poolStats.maxUnderwriterSharesToUnstake_).to.equal(expectedMaxSharesToUnstake);

    // Attempt to quit underwriter position should fail
    await expect(
      insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId)
    ).to.be.revertedWith("Underwriter position can't be less than allowed");


    const longEpisodeFinishTime = (longEpisodeToStake + 1n) * EPISODE_DURATION;
    await time.increaseTo(longEpisodeFinishTime + 1n);

    // User should still be able to quit their position
    await expect(
      insurancePool.connect(owner).quitPoolPosition(userPositionId)
    ).to.not.be.reverted;

    // After user quits, underwriter should be able to quit since they're the only one left
    await expect(
      insurancePool.connect(poolUnderwriter).quitPoolPosition(underwriterPositionId)
    ).to.not.be.reverted;
  });

});


