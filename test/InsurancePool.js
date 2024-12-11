const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

const { InsuranceSetup } = require("../ignition/modules/Insurance.js");

describe("Insurance", async function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function basicFixture() {
    return ignition.deploy(InsuranceSetup);
  }

  describe("InsurancePool", async function () {
    it("test basic", async function () {
      const { btcToken, sursToken, insurancePool, governor_c, timelock } =
        await loadFixture(basicFixture);
      const [ownerAccount, otherAccount] = await ethers.getSigners();
      // Init check
      let init_k = await insurancePool.SHARED_K();
      expect(init_k).to.equal(ethers.parseUnits("100000", "ether").toString());

      // Make a position
      await btcToken.approve(
        insurancePool,
        ethers.parseUnits("2000", "ether").toString()
      );
      await insurancePool.joinPool(
        ethers.parseUnits("100", "ether").toString()
      );
      const init_position = await insurancePool.getPoolPosition(ownerAccount);
      expect(init_position[2]).to.equal(
        ethers.parseUnits("100", "ether").toString()
      );
      expect(init_position[1]).to.equal(
        init_k * BigInt(ethers.parseUnits("100", "ether").toString())
      );

      // Check reward logic
      await insurancePool.rewardPool(
        ethers.parseUnits("1", "ether").toString()
      );
      let new_k = await insurancePool.SHARED_K();
      expect(init_position[1] / new_k).to.equal(
        ethers.parseUnits("101", "ether").toString()
      );

      // Check slashing logic
      await insurancePool.makeClaim(
        otherAccount,
        ethers.parseUnits("3", "ether").toString(),
        ""
      );
      await insurancePool.executeClaim(1);
      new_k = await insurancePool.SHARED_K();
      expect(init_position[1] / new_k).to.equal(
        ethers.parseUnits("98", "ether").toString()
      );
    });
    it("test math on bigger scale", async () => {
      const { btcToken, sursToken, insurancePool, governor_c, timelock } =
        await loadFixture(basicFixture);
      const [ownerAccount, otherAccount] = await ethers.getSigners();
      // Init check
      let init_k = await insurancePool.SHARED_K();
      expect(init_k).to.equal(ethers.parseUnits("100000", "ether").toString());

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
        ethers.parseUnits("21000000", "ether").toString()
      );
      await insurancePool
        .connect(otherAccount)
        .joinPool(ethers.parseUnits("0.01", "ether").toString());

      const position_big = await insurancePool.getPoolPosition(ownerAccount);
      const position_small = await insurancePool.getPoolPosition(otherAccount);
      expect(position_big[2]).to.equal(
        ethers.parseUnits("21000000", "ether").toString()
      );
      expect(position_small[2]).to.equal(
        ethers.parseUnits("0.01", "ether").toString()
      );

      // Check if rewards distributed honestly
      await insurancePool.rewardPool(
        ethers.parseUnits("1", "ether").toString()
      );
      let new_k = await insurancePool.SHARED_K();
      expect(position_big[1] / new_k).to.equal(
        ethers.parseUnits("21000000.999999999523809606", "ether").toString()
      );
      expect(position_small[1] / new_k).to.equal(
        ethers.parseUnits("0.010000000476190475", "ether").toString()
      );
      expect(position_big[1] / new_k + position_small[1] / new_k).to.eq(
        ethers.parseUnits("21000001.010000000000000081", "ether").toString()
      ); // TODO make precision limits
    });
  });
});
