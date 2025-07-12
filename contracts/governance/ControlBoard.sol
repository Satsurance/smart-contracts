// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ControlBoard is EIP712 {
    using ECDSA for bytes32;

    // EIP712 constants
    bytes32 public constant TRANSACTION_TYPEHASH =
        keccak256("Transaction(address target,uint256 value,bytes data)");

    // State variables
    mapping(address => bool) public isController;
    uint256 public controllersCount;
    uint256 public threshold;

    // Transaction tracking
    mapping(bytes32 => bool) public executedTransactions;

    // Events
    event ControllerAdded(address indexed controller);
    event ControllerRemoved(address indexed controller);
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);
    event TransactionExecuted(
        bytes32 indexed txHash,
        address indexed target,
        uint256 value,
        bytes data
    );

    // Errors
    error InvalidController(address controller);
    error InvalidThreshold(uint256 threshold);
    error TransactionAlreadyExecuted(bytes32 txHash);
    error InvalidSignature(address signer);
    error InvalidControllerCount();
    error InsufficientSignatures(uint256 provided, uint256 required);
    error TransactionFailed();
    error DuplicateSignature(address signer);
    error Unauthorized();

    constructor(
        address[] memory initialControllers_,
        uint256 threshold_
    ) EIP712("ControlBoard", "1") {
        require(
            initialControllers_.length > 0,
            "At least one controller required"
        );
        require(
            threshold_ > 0 && threshold_ <= initialControllers_.length,
            "Invalid threshold"
        );

        for (uint256 i = 0; i < initialControllers_.length; i++) {
            address controller = initialControllers_[i];
            require(controller != address(0), "Invalid controller address");
            require(!isController[controller], "Duplicate controller");
            isController[controller] = true;
        }

        controllersCount = initialControllers_.length;
        threshold = threshold_;
    }

    /**
     * @dev Add a new controller - only callable by the contract itself
     * @param controller Address of the new controller
     */
    function addController(address controller) external {
        if (msg.sender != address(this)) revert Unauthorized();
        if (controller == address(0)) revert InvalidController(controller);
        if (isController[controller]) revert InvalidController(controller);

        isController[controller] = true;
        controllersCount++;

        emit ControllerAdded(controller);
    }

    /**
     * @dev Remove a controller - only callable by the contract itself
     * @param controller Address of the controller to remove
     */
    function removeController(address controller) external {
        if (msg.sender != address(this)) revert Unauthorized();
        if (!isController[controller]) revert InvalidController(controller);
        if (controllersCount - 1 < threshold)
            revert InvalidThreshold(threshold);
        if (controllersCount - 1 == 0) revert InvalidControllerCount();

        isController[controller] = false;
        controllersCount--;

        emit ControllerRemoved(controller);
    }

    /**
     * @dev Set the threshold for required signatures - only callable by the contract itself
     * @param newThreshold New threshold value
     */
    function setThreshold(uint256 newThreshold) external {
        if (msg.sender != address(this)) revert Unauthorized();
        if (newThreshold == 0 || newThreshold > controllersCount) {
            revert InvalidThreshold(newThreshold);
        }

        uint256 oldThreshold = threshold;
        threshold = newThreshold;
        emit ThresholdChanged(oldThreshold, newThreshold);
    }

    /**
     * @dev Execute a transaction with multiple signatures
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Transaction data
     * @param signatures Array of signatures from controllers
     */
    function executeTransaction(
        address target,
        uint256 value,
        bytes calldata data,
        bytes[] calldata signatures
    ) external {
        // Create transaction hash
        bytes32 txHash = keccak256(
            abi.encodePacked(address(this), target, value, data)
        );

        // Check if transaction was already executed
        if (executedTransactions[txHash]) {
            revert TransactionAlreadyExecuted(txHash);
        }

        // Verify signatures using EIP712
        _verifySignatures(target, value, data, signatures);

        // Mark transaction as executed
        executedTransactions[txHash] = true;

        // Execute the transaction
        (bool success, ) = target.call{value: value}(data);
        if (!success) revert TransactionFailed();

        emit TransactionExecuted(txHash, target, value, data);
    }

    /**
     * @dev Verify that signatures meet the threshold requirement
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Transaction data
     * @param signatures Array of signatures
     */
    function _verifySignatures(
        address target,
        uint256 value,
        bytes calldata data,
        bytes[] calldata signatures
    ) internal view {
        if (signatures.length < threshold) {
            revert InsufficientSignatures(signatures.length, threshold);
        }

        // Create EIP712 structured data hash
        bytes32 structHash = keccak256(
            abi.encode(TRANSACTION_TYPEHASH, target, value, keccak256(data))
        );
        bytes32 messageHash = _hashTypedDataV4(structHash);

        address[] memory signers = new address[](signatures.length);
        uint256 validSignatures = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = messageHash.recover(signatures[i]);

            if (!isController[signer]) {
                revert InvalidSignature(signer);
            }

            // Check for duplicate signers
            for (uint256 j = 0; j < validSignatures; j++) {
                if (signers[j] == signer) {
                    revert DuplicateSignature(signer);
                }
            }

            signers[validSignatures] = signer;
            validSignatures++;
        }
    }
}
