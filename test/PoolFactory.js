const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { basicFixture } = require("./fixtures.js");
const { signCreatePool } = require("../utils/signatures.js");
const { createPoolInitData } = require("./helpers.js");
const { expect } = require("chai");

describe("PoolFactory", function () {
    it("should fail when non-operator tries to create pool", async function () {
        const { poolFactory, btcToken, claimer, accounts } = await loadFixture(basicFixture);
        const { poolUnderwriter } = accounts;

        const dummyInitData = createPoolInitData(
            poolUnderwriter.address,
            poolUnderwriter.address,
            btcToken.target,
            claimer.target
        );

        await expect(
            poolFactory.connect(poolUnderwriter).create(dummyInitData)
        ).to.be.revertedWith("Only operator can create pools");
    });

    it("should fail with expired signature", async function () {
        const { poolFactory, btcToken, claimer, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const initData = createPoolInitData(
            poolUnderwriter.address,
            owner.address,
            btcToken.target,
            claimer.target
        );

        // Create signature with past deadline
        const deadline = (await time.latest()) - 1; // 1 second ago
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
        const nonce = await poolFactory.poolCount() + 1n; // Expected next pool ID

        const signature = await signCreatePool(owner, poolFactory.target, {
            poolInitData: initData,
            deadline: deadline,
            nonce: nonce,
            chainId: chainId
        });

        await expect(
            poolFactory.connect(poolUnderwriter).createWithSignature(
                initData,
                deadline,
                nonce,
                signature.serialized
            )
        ).to.be.revertedWith("Signature expired");
    });

    it("should fail with invalid signature", async function () {
        const { poolFactory, btcToken, claimer, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const initData = createPoolInitData(
            poolUnderwriter.address,
            owner.address,
            btcToken.target,
            claimer.target
        );

        const deadline = (await time.latest()) + 3600;
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
        const nonce = await poolFactory.poolCount() + 1n; // Expected next pool ID

        // Sign with non-operator account
        const signature = await signCreatePool(poolUnderwriter, poolFactory.target, {
            poolInitData: initData,
            deadline: deadline,
            nonce: nonce,
            chainId: chainId
        });

        await expect(
            poolFactory.connect(poolUnderwriter).createWithSignature(
                initData,
                deadline,
                nonce,
                signature.serialized
            )
        ).to.be.revertedWith("Invalid operator signature");
    });

    it("should fail with invalid nonce", async function () {
        const { poolFactory, btcToken, claimer, accounts } = await loadFixture(basicFixture);
        const { owner, poolUnderwriter } = accounts;

        const initData = createPoolInitData(
            poolUnderwriter.address,
            owner.address,
            btcToken.target,
            claimer.target
        );

        const deadline = (await time.latest()) + 3600;
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
        const wrongNonce = 999; // Wrong nonce

        const signature = await signCreatePool(owner, poolFactory.target, {
            poolInitData: initData,
            deadline: deadline,
            nonce: wrongNonce,
            chainId: chainId
        });

        await expect(
            poolFactory.connect(poolUnderwriter).createWithSignature(
                initData,
                deadline,
                wrongNonce,
                signature.serialized
            )
        ).to.be.revertedWith("Invalid nonce");
    });
});
