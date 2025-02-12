const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
  signUnstakeRequest,
  signCoveragePurchase,
} = require("../utils/signatures");

async function purchaseCoverage({
  insurancePool,
  poolAsset,
  buyer,
  underwriterSigner,
  coveredAccount,
  purchaseAmount,
  coverageAmount,
  duration,
  description,
}) {
  // Get chainId for signature
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Generate unique coverId using timestamp and random number
  const coverId = ethers.toBigInt(
    ethers.solidityPackedKeccak256(
      ["uint256"],
      [Math.floor(Math.random() * 1000000)]
    )
  );

  // Setup coverage dates
  const startDate = await time.latest();
  const endDate = startDate + duration;

  // Set deadline 1 hour in the future
  const deadline = startDate + 3600;

  // Prepare signature parameters
  const params = {
    coverId,
    account: coveredAccount,
    coverAmount: coverageAmount,
    purchaseAmount,
    startDate,
    endDate,
    description,
    deadline,
    chainId,
  };

  // Get signature from underwriter
  const { v, r, s } = await signCoveragePurchase(
    underwriterSigner,
    insurancePool.target,
    params
  );

  // Approve token transfer if needed
  const buyerAddress = await buyer.getAddress();
  const allowance = await poolAsset.allowance(
    buyerAddress,
    insurancePool.target
  );
  if (allowance < purchaseAmount) {
    await poolAsset
      .connect(buyer)
      .approve(insurancePool.target, purchaseAmount);
  }

  // Execute purchase
  await insurancePool
    .connect(buyer)
    .purchaseCover(
      coverId,
      coveredAccount,
      coverageAmount,
      purchaseAmount,
      startDate,
      endDate,
      description,
      deadline,
      v,
      r,
      s
    );
}

module.exports = {
  purchaseCoverage,
};
