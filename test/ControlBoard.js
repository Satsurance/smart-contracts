const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { signControlBoardTransaction } = require("../utils/signatures");
const { basicFixture } = require("./fixtures.js");

// Fixture for multi-sig ControlBoard testing (adds additional controllers)
async function multiSigControlBoardFixture() {
    // Start with basic fixture (single controller, threshold=1)
    const deployment = await basicFixture();

    // Get accounts
    const [controller1, controller2, controller3, nonController] = await ethers.getSigners();

    // Use the deployed ControlBoard and BTC token from ignition
    const controlBoard = deployment.controlBoard;
    const testContract = deployment.btcToken;

    // Get chain ID
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Add controller2 to the ControlBoard
    const addControllerData = controlBoard.interface.encodeFunctionData("addController", [
        controller2.address
    ]);

    const addControllerTxParams = {
        target: controlBoard.target,
        value: 0,
        data: addControllerData,
        chainId: chainId,
    };

    // Since ignition deploys with threshold=1 by default, we can add controller2 directly
    const addControllerSignature = await signControlBoardTransaction(
        controller1,
        controlBoard.target,
        addControllerTxParams
    );

    await controlBoard.executeTransaction(
        addControllerTxParams.target,
        addControllerTxParams.value,
        addControllerTxParams.data,
        [addControllerSignature]
    );

    // Now set threshold to 2 for multi-sig testing
    const setThresholdData = controlBoard.interface.encodeFunctionData("setThreshold", [2]);
    const setThresholdTxParams = {
        target: controlBoard.target,
        value: 0,
        data: setThresholdData,
        chainId: chainId,
    };

    const setThresholdSignature = await signControlBoardTransaction(
        controller1,
        controlBoard.target,
        setThresholdTxParams
    );

    await controlBoard.executeTransaction(
        setThresholdTxParams.target,
        setThresholdTxParams.value,
        setThresholdTxParams.data,
        [setThresholdSignature]
    );

    return {
        controlBoard,
        testContract,
        controller1,
        controller2,
        controller3,
        nonController,
        chainId
    };
}

describe("ControlBoard", function () {
    describe("Single Controller Tests", function () {
        let controlBoard;
        let testContract;
        let controller1, nonController;
        let chainId;

        beforeEach(async function () {
            const deployment = await loadFixture(basicFixture);
            controlBoard = deployment.controlBoard;
            testContract = deployment.btcToken;

            const [owner, poolUnderwriter, addr1, addr2] = await ethers.getSigners();
            controller1 = owner; // The deployer is the initial controller
            nonController = addr2;

            chainId = (await ethers.provider.getNetwork()).chainId;
        });

        it("Should be deployed with single controller and threshold 1", async function () {
            expect(await controlBoard.isController(controller1.address)).to.be.true;
            expect(await controlBoard.controllersCount()).to.equal(1);
            expect(await controlBoard.threshold()).to.equal(1);
        });

        it("Should execute a transaction with single signature", async function () {
            // Prepare transaction data - transfer some tokens to nonController
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // First, transfer some tokens to the ControlBoard so it can send them
            await testContract.transfer(controlBoard.target, transferAmount);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create signature from single controller
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );

            // Execute transaction
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1]
                )
            ).to.not.be.reverted;

            // Verify the transaction was executed
            expect(await testContract.balanceOf(nonController.address)).to.equal(transferAmount);
        });

        it("Should fail with invalid signature from non-controller", async function () {
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create signature from non-controller
            const invalidSignature = await signControlBoardTransaction(
                nonController,
                controlBoard.target,
                txParams
            );

            // Should fail with invalid signature
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [invalidSignature]
                )
            ).to.be.revertedWithCustomError(controlBoard, "InvalidSignature");
        });

        it("Should fail when attempting to execute the same transaction twice", async function () {
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // Transfer tokens to ControlBoard
            await testContract.transfer(controlBoard.target, transferAmount * 2n);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create signature
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );

            // Execute transaction first time
            await controlBoard.executeTransaction(
                txParams.target,
                txParams.value,
                txParams.data,
                [signature1]
            );

            // Try to execute the same transaction again - should fail with TransactionAlreadyExecuted
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1]
                )
            ).to.be.revertedWithCustomError(controlBoard, "TransactionAlreadyExecuted");
        });

        it("Should add a new controller through single signature", async function () {
            const [, , controller2] = await ethers.getSigners();

            // Create transaction to add controller2
            const addControllerData = controlBoard.interface.encodeFunctionData("addController", [
                controller2.address
            ]);

            const txParams = {
                target: controlBoard.target,
                value: 0,
                data: addControllerData,
                chainId: chainId,
            };

            // Create signature
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );

            // Execute transaction
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1]
                )
            ).to.emit(controlBoard, "ControllerAdded").withArgs(controller2.address);

            // Verify controller was added
            expect(await controlBoard.isController(controller2.address)).to.be.true;
            expect(await controlBoard.controllersCount()).to.equal(2);
        });

        it("Should approve transaction and auto-execute when threshold is met", async function () {
            // Prepare transaction data - transfer some tokens to nonController
            const transferAmount = ethers.parseEther("50");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // First, transfer some tokens to the ControlBoard so it can send them
            await testContract.transfer(controlBoard.target, transferAmount);

            // Approve the transaction - should auto-execute since threshold=1
            await expect(
                controlBoard.connect(controller1).approveTransaction(
                    testContract.target,
                    0,
                    transferData
                )
            ).to.emit(controlBoard, "TransactionApproved")
                .and.to.emit(controlBoard, "TransactionExecuted");

            // Verify the transaction was executed
            expect(await testContract.balanceOf(nonController.address)).to.equal(transferAmount);

            // Attempting to execute again should fail
            await expect(
                controlBoard.executeTransaction(
                    testContract.target,
                    0,
                    transferData,
                    []
                )
            ).to.be.revertedWithCustomError(controlBoard, "TransactionAlreadyExecuted");
        });
    });

    describe("Multi-Sig Controller Tests", function () {
        let controlBoard;
        let testContract;
        let controller1, controller2, controller3;
        let nonController;
        let chainId;

        beforeEach(async function () {
            const fixture = await loadFixture(multiSigControlBoardFixture);
            controlBoard = fixture.controlBoard;
            testContract = fixture.testContract;
            controller1 = fixture.controller1;
            controller2 = fixture.controller2;
            controller3 = fixture.controller3;
            nonController = fixture.nonController;
            chainId = fixture.chainId;
        });

        it("Should execute a transaction with sufficient signatures", async function () {
            // Prepare transaction data - transfer some tokens to nonController
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // First, transfer some tokens to the ControlBoard so it can send them
            await testContract.transfer(controlBoard.target, transferAmount);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create signatures from both controllers
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );
            const signature2 = await signControlBoardTransaction(
                controller2,
                controlBoard.target,
                txParams
            );

            // Execute transaction
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1, signature2]
                )
            ).to.not.be.reverted;

            // Verify the transaction was executed
            expect(await testContract.balanceOf(nonController.address)).to.equal(transferAmount);
        });

        it("Should fail with insufficient signatures", async function () {
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create signature from only one controller
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );

            // Should fail with insufficient signatures
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1]
                )
            ).to.be.revertedWithCustomError(controlBoard, "InsufficientSignatures");
        });

        it("Should fail with invalid signature from non-controller", async function () {
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create signatures - one valid, one from non-controller
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );
            const invalidSignature = await signControlBoardTransaction(
                nonController,
                controlBoard.target,
                txParams
            );

            // Should fail with invalid signature
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1, invalidSignature]
                )
            ).to.be.revertedWithCustomError(controlBoard, "InvalidSignature");
        });

        it("Should fail with duplicate signatures", async function () {
            const transferAmount = ethers.parseEther("100");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Create the same signature twice
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );

            // Should fail with duplicate signature
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1, signature1]
                )
            ).to.be.revertedWithCustomError(controlBoard, "DuplicateSignature");
        });

        it("Should add a new controller through multi-sig", async function () {
            // Create transaction to add controller3
            const addControllerData = controlBoard.interface.encodeFunctionData("addController", [
                controller3.address
            ]);

            const txParams = {
                target: controlBoard.target,
                value: 0,
                data: addControllerData,
                chainId: chainId,
            };

            // Create signatures
            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );
            const signature2 = await signControlBoardTransaction(
                controller2,
                controlBoard.target,
                txParams
            );

            // Execute transaction
            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature1, signature2]
                )
            ).to.emit(controlBoard, "ControllerAdded").withArgs(controller3.address);

            // Verify controller was added
            expect(await controlBoard.isController(controller3.address)).to.be.true;
            expect(await controlBoard.controllersCount()).to.equal(3);
        });

        it("Should approve transaction first, then execute with one signature", async function () {
            // Prepare transaction data - transfer some tokens to nonController
            const transferAmount = ethers.parseEther("75");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // First, transfer some tokens to the ControlBoard so it can send them
            await testContract.transfer(controlBoard.target, transferAmount);

            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            // Step 1: Controller1 approves the transaction (1 approval, threshold=2, no auto-execution)
            await expect(
                controlBoard.connect(controller1).approveTransaction(
                    testContract.target,
                    0,
                    transferData
                )
            ).to.emit(controlBoard, "TransactionApproved")
                .and.to.not.emit(controlBoard, "TransactionExecuted");

            // Step 2: Execute transaction with one signature from controller2
            // This should work because: 1 approval + 1 signature = 2 (meets threshold)
            const signature2 = await signControlBoardTransaction(
                controller2,
                controlBoard.target,
                txParams
            );

            await expect(
                controlBoard.executeTransaction(
                    txParams.target,
                    txParams.value,
                    txParams.data,
                    [signature2]
                )
            ).to.not.be.reverted;

            // Verify the transaction was executed
            expect(await testContract.balanceOf(nonController.address)).to.equal(transferAmount);
        });

        it("Should auto-execute when multiple approvals meet threshold", async function () {
            // Prepare transaction data - transfer some tokens to nonController  
            const transferAmount = ethers.parseEther("60");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // First, transfer some tokens to the ControlBoard so it can send them
            await testContract.transfer(controlBoard.target, transferAmount);

            // Step 1: Controller1 approves the transaction (1 approval, threshold=2, no auto-execution)
            await expect(
                controlBoard.connect(controller1).approveTransaction(
                    testContract.target,
                    0,
                    transferData
                )
            ).to.emit(controlBoard, "TransactionApproved")
                .and.to.not.emit(controlBoard, "TransactionExecuted");

            // Step 2: Controller2 approves the transaction (2 approvals = threshold, should auto-execute)
            await expect(
                controlBoard.connect(controller2).approveTransaction(
                    testContract.target,
                    0,
                    transferData
                )
            ).to.emit(controlBoard, "TransactionApproved")
                .and.to.emit(controlBoard, "TransactionExecuted");

            // Verify the transaction was executed
            expect(await testContract.balanceOf(nonController.address)).to.equal(transferAmount);

            // Attempting to execute again should fail
            await expect(
                controlBoard.executeTransaction(
                    testContract.target,
                    0,
                    transferData,
                    []
                )
            ).to.be.revertedWithCustomError(controlBoard, "TransactionAlreadyExecuted");
        });

        it("Should fail when trying to approve an already executed transaction", async function () {
            // Prepare transaction data - transfer some tokens to nonController  
            const transferAmount = ethers.parseEther("40");
            const transferData = testContract.interface.encodeFunctionData("transfer", [
                nonController.address,
                transferAmount
            ]);

            // First, transfer some tokens to the ControlBoard so it can send them
            await testContract.transfer(controlBoard.target, transferAmount);

            // Execute transaction with both signatures
            const txParams = {
                target: testContract.target,
                value: 0,
                data: transferData,
                chainId: chainId,
            };

            const signature1 = await signControlBoardTransaction(
                controller1,
                controlBoard.target,
                txParams
            );
            const signature2 = await signControlBoardTransaction(
                controller2,
                controlBoard.target,
                txParams
            );

            await controlBoard.executeTransaction(
                txParams.target,
                txParams.value,
                txParams.data,
                [signature1, signature2]
            );

            // Now trying to approve the same transaction should fail
            await expect(
                controlBoard.connect(controller1).approveTransaction(
                    testContract.target,
                    0,
                    transferData
                )
            ).to.be.revertedWithCustomError(controlBoard, "TransactionAlreadyExecuted");
        });
    });
});
