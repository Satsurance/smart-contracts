// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IInsurancePool.sol";

struct Claim {
    address proposer;
    address receiver;
    address poolAddress;
    string description;
    uint256 amount;
    uint256 depositAmount;
    uint256 startTime;
    uint256 approvalTime;
    bool approved;
    bool executed;
    bool exists;
    bool spam;
}

contract Claimer is Initializable, UUPSUpgradeable, AccessControlUpgradeable {
    // Constants
    uint256 public constant BASIS_POINTS = 10000; // 100% = 10000 basis points
    uint256 public constant MAX_CLAIM_REDUCTION = 500; // Maximum 5% reduction

    // Role definitions
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant OPERATOR_MANAGER_ROLE =
        keccak256("OPERATOR_MANAGER_ROLE");

    // State variables
    uint256 public claimDeposit;
    uint256 public approvalPeriod;
    uint256 public executionTimeout;
    uint256 public claimReduction; // In basis points (0-10000, where 10000 = 100%)
    IERC20 public depositToken;

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
        uint256 depositAmount,
        uint256 timestamp
    );
    event ClaimApproved(uint256 indexed claimId, address indexed approver);
    event ClaimExecuted(uint256 indexed claimId);
    event ClaimMarkedAsSpam(uint256 indexed claimId, address indexed approver);
    event DepositWithdrawn(
        uint256 indexed claimId,
        address indexed proposer,
        uint256 amount
    );
    event ClaimDepositChanged(uint256 oldDeposit, uint256 newDeposit);
    event ApprovalPeriodChanged(uint256 oldPeriod, uint256 newPeriod);
    event ExecutionTimeoutChanged(uint256 oldTimeout, uint256 newTimeout);
    event ClaimReductionChanged(uint256 oldReduction, uint256 newReduction);

    /**
     * @dev Storage gap to allow for future upgrades
     * This reserves storage slots for future variables
     */
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address operatorManager_,
        address operator_,
        uint256 claimDeposit_,
        address depositToken_,
        uint256 approvalPeriod_,
        uint256 executionTimeout_,
        uint256 claimReduction_
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(OPERATOR_MANAGER_ROLE, owner_);
        _grantRole(OPERATOR_MANAGER_ROLE, operatorManager_);
        _grantRole(OPERATOR_ROLE, operator_);
        _setRoleAdmin(OPERATOR_MANAGER_ROLE, OPERATOR_MANAGER_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, OPERATOR_MANAGER_ROLE);

        claimDeposit = claimDeposit_;
        approvalPeriod = approvalPeriod_;
        executionTimeout = executionTimeout_;
        require(
            claimReduction_ <= MAX_CLAIM_REDUCTION,
            "Claim reduction cannot exceed 5%"
        );
        claimReduction = claimReduction_;
        depositToken = IERC20(depositToken_);
    }

    function setClaimDeposit(
        uint256 newClaimDeposit
    ) external onlyRole(OPERATOR_MANAGER_ROLE) {
        uint256 oldDeposit = claimDeposit;
        claimDeposit = newClaimDeposit;
        emit ClaimDepositChanged(oldDeposit, newClaimDeposit);
    }

    function setApprovalPeriod(
        uint256 newApprovalPeriod
    ) external onlyRole(OPERATOR_MANAGER_ROLE) {
        uint256 oldPeriod = approvalPeriod;
        approvalPeriod = newApprovalPeriod;
        emit ApprovalPeriodChanged(oldPeriod, newApprovalPeriod);
    }

    function setExecutionTimeout(
        uint256 newExecutionTimeout
    ) external onlyRole(OPERATOR_MANAGER_ROLE) {
        uint256 oldTimeout = executionTimeout;
        executionTimeout = newExecutionTimeout;
        emit ExecutionTimeoutChanged(oldTimeout, newExecutionTimeout);
    }

    function setClaimReduction(
        uint256 newClaimReduction
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            newClaimReduction <= MAX_CLAIM_REDUCTION,
            "Claim reduction cannot exceed 5%"
        );
        uint256 oldReduction = claimReduction;
        claimReduction = newClaimReduction;
        emit ClaimReductionChanged(oldReduction, newClaimReduction);
    }

    function createClaim(
        address receiver,
        address poolAddress,
        string calldata description,
        uint256 amount
    ) external {
        require(receiver != address(0), "Invalid receiver address");
        require(poolAddress != address(0), "Invalid pool address");

        if (claimDeposit > 0) {
            depositToken.transferFrom(msg.sender, address(this), claimDeposit);
        }
        uint256 claimId = claimCounter++;
        claims[claimId] = Claim({
            proposer: msg.sender,
            receiver: receiver,
            poolAddress: poolAddress,
            description: description,
            amount: amount,
            depositAmount: claimDeposit,
            startTime: block.timestamp,
            approvalTime: 0,
            approved: false,
            executed: false,
            exists: true,
            spam: false
        });

        emit ClaimCreated(
            claimId,
            msg.sender,
            receiver,
            poolAddress,
            description,
            amount,
            claimDeposit,
            block.timestamp
        );
    }

    function approveClaim(uint256 claimId) external onlyRole(OPERATOR_ROLE) {
        Claim storage claim = claims[claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Claim already executed");
        require(!claim.approved, "Claim already approved");
        require(
            block.timestamp <= claim.startTime + approvalPeriod,
            "Approval period has expired"
        );

        claim.approved = true;
        claim.approvalTime = block.timestamp;

        if (claim.depositAmount > 0) {
            depositToken.transfer(claim.proposer, claim.depositAmount);
        }

        emit ClaimApproved(claimId, msg.sender);
    }

    function markAsSpam(uint256 claimId) external onlyRole(OPERATOR_ROLE) {
        Claim storage claim = claims[claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Cannot mark executed claim as spam");
        require(!claim.approved, "Cannot mark approved claim as spam");
        require(!claim.spam, "Claim already marked as spam");

        claim.spam = true;

        emit ClaimMarkedAsSpam(claimId, msg.sender);
    }

    function executeClaim(uint256 claimId) external {
        Claim storage claim = claims[claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Claim already executed");
        require(claim.approved, "Claim not approved");
        require(
            block.timestamp > claim.approvalTime + executionTimeout,
            "Execution timeout has not expired"
        );

        claim.executed = true;

        // Apply claim reduction
        uint256 reducedAmount = (claim.amount *
            (BASIS_POINTS - claimReduction)) / BASIS_POINTS;

        IInsurancePool(claim.poolAddress).executeClaim(
            claim.receiver,
            reducedAmount
        );

        emit ClaimExecuted(claimId);
    }

    function withdrawDeposit(uint256 claimId) external {
        Claim storage claim = claims[claimId];
        require(
            msg.sender == claim.proposer,
            "Only claim proposer can withdraw deposit"
        );
        require(!claim.approved, "Cannot withdraw deposit for approved claim");
        require(!claim.spam, "Cannot withdraw deposit for spam claim");
        require(
            block.timestamp > claim.startTime + approvalPeriod,
            "Approval period has not expired yet"
        );
        require(claim.depositAmount > 0, "No deposit to withdraw");

        uint256 depositToWithdraw = claim.depositAmount;
        claim.depositAmount = 0;
        depositToken.transfer(claim.proposer, depositToWithdraw);

        emit DepositWithdrawn(claimId, claim.proposer, depositToWithdraw);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
