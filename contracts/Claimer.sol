// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./IPool.sol";

struct Claim {
    address proposer;
    address receiver;
    address poolAddress;
    string description;
    uint256 amount;
    uint256 startTime;
    bool approved;
    bool executed;
    bool exists;
}

contract Claimer is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    // State variables
    address public approver;

    mapping(uint256 => Claim) public claims;
    uint256 public claimCounter;

    // Events
    event ClaimCreated(
        uint256 indexed claimId,
        address proposer,
        address receiver,
        address poolAddress,
        string description,
        uint256 amount,
        uint256 timestamp
    );
    event ClaimApproved(uint256 indexed claimId, address indexed approver);
    event ClaimExecuted(uint256 indexed claimId);
    event ApproverChanged(
        address indexed oldApprover,
        address indexed newApprover
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address approver_) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        approver = approver_;
    }

    // Set the approver address (only owner)
    function setApprover(address newApprover) external onlyOwner {
        require(newApprover != address(0), "Invalid approver address");
        address oldApprover = approver;
        approver = newApprover;
        emit ApproverChanged(oldApprover, newApprover);
    }

    // Create a new claim
    function createClaim(
        address receiver,
        address poolAddress,
        string calldata description,
        uint256 amount
    ) external {
        require(receiver != address(0), "Invalid receiver address");
        require(poolAddress != address(0), "Invalid pool address");

        uint256 claimId = claimCounter++;
        claims[claimId] = Claim({
            proposer: msg.sender,
            receiver: receiver,
            poolAddress: poolAddress,
            description: description,
            amount: amount,
            startTime: block.timestamp,
            approved: false,
            executed: false,
            exists: true
        });

        emit ClaimCreated(
            claimId,
            msg.sender,
            receiver,
            poolAddress,
            description,
            amount,
            block.timestamp
        );
    }

    // Approve a claim (only approver)
    function approveClaim(uint256 claimId) external {
        require(msg.sender == approver, "Only approver can approve claims");

        Claim storage claim = claims[claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Claim already executed");
        require(!claim.approved, "Claim already approved");

        claim.approved = true;
        emit ClaimApproved(claimId, msg.sender);
    }

    // Execute an approved claim
    function executeClaim(uint256 claimId) external {
        Claim storage claim = claims[claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Claim already executed");
        require(claim.approved, "Claim not approved");

        claim.executed = true;

        IPool(claim.poolAddress).executeClaim(claim.receiver, claim.amount);

        emit ClaimExecuted(claimId);
    }

    // View function to get claim details
    function getClaimDetails(
        uint256 claimId
    )
        external
        view
        returns (
            address proposer,
            address receiver,
            address poolAddress,
            string memory description,
            uint256 amount,
            uint256 startTime,
            bool approved,
            bool executed,
            bool exists
        )
    {
        Claim storage claim = claims[claimId];
        return (
            claim.proposer,
            claim.receiver,
            claim.poolAddress,
            claim.description,
            claim.amount,
            claim.startTime,
            claim.approved,
            claim.executed,
            claim.exists
        );
    }

    // Required override for UUPS proxy
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
