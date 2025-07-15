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

    // Transaction approvals
    mapping(bytes32 => mapping(address => bool)) public transactionApprovals;
    mapping(bytes32 => uint256) public approvalCount;

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
    event TransactionApproved(
        bytes32 indexed txHash,
        address indexed controller
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
    error TransactionAlreadyApproved(address controller);

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
     * @dev Approve a transaction - only callable by controllers
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Transaction data
     */
    function approveTransaction(
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        if (!isController[msg.sender]) revert Unauthorized();

        bytes32 txHash = keccak256(
            abi.encodePacked(address(this), target, value, data)
        );

        // Check if transaction was already executed
        if (executedTransactions[txHash]) {
            revert TransactionAlreadyExecuted(txHash);
        }

        if (transactionApprovals[txHash][msg.sender]) {
            revert TransactionAlreadyApproved(msg.sender);
        }

        transactionApprovals[txHash][msg.sender] = true;
        approvalCount[txHash]++;

        emit TransactionApproved(txHash, msg.sender);

        if (approvalCount[txHash] >= threshold) {
            _executeTransaction(txHash, target, value, data);
        }
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
    ) public {
        // Get existing approvals count
        bytes32 txHash = keccak256(
            abi.encodePacked(address(this), target, value, data)
        );

        // Check if transaction was already executed
        if (executedTransactions[txHash]) {
            revert TransactionAlreadyExecuted(txHash);
        }

        uint256 existingApprovals = approvalCount[txHash];

        // Verify signatures using EIP712, accounting for existing approvals
        _verifySignatures(target, value, data, signatures, existingApprovals);

        // Execute the transaction using internal function
        _executeTransaction(txHash, target, value, data);
    }

    /**
     * @dev Verify that signatures meet the threshold requirement
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Transaction data
     * @param signatures Array of signatures
     * @param existingApprovals Number of existing approvals
     */
    function _verifySignatures(
        address target,
        uint256 value,
        bytes calldata data,
        bytes[] calldata signatures,
        uint256 existingApprovals
    ) internal view {
        // Calculate required signatures after accounting for existing approvals
        uint256 requiredSignatures = threshold > existingApprovals
            ? threshold - existingApprovals
            : 0;

        if (signatures.length < requiredSignatures) {
            revert InsufficientSignatures(
                signatures.length,
                requiredSignatures
            );
        }

        // Create EIP712 structured data hash
        bytes32 structHash = keccak256(
            abi.encode(TRANSACTION_TYPEHASH, target, value, keccak256(data))
        );
        bytes32 messageHash = _hashTypedDataV4(structHash);

        // Create transaction hash to check approvals
        bytes32 txHash = keccak256(
            abi.encodePacked(address(this), target, value, data)
        );

        address[] memory signers = new address[](signatures.length);
        uint256 validSignatures = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = messageHash.recover(signatures[i]);

            if (!isController[signer]) {
                revert InvalidSignature(signer);
            }

            // Check if this controller already approved the transaction
            if (transactionApprovals[txHash][signer]) {
                revert DuplicateSignature(signer);
            }

            // Check for duplicate signers in current signatures
            for (uint256 j = 0; j < validSignatures; j++) {
                if (signers[j] == signer) {
                    revert DuplicateSignature(signer);
                }
            }

            signers[validSignatures] = signer;
            validSignatures++;
        }
    }

    /**
     * @dev Internal function to execute a transaction when threshold is already met through approvals
     * @param txHash Pre-computed transaction hash
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Transaction data
     */
    function _executeTransaction(
        bytes32 txHash,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        // Mark transaction as executed
        executedTransactions[txHash] = true;

        // Execute the transaction
        (bool success, ) = target.call{value: value}(data);
        if (!success) revert TransactionFailed();

        emit TransactionExecuted(txHash, target, value, data);
    }
}
