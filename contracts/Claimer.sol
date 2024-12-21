// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Claimer is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    // State variables
    IERC20 public daoToken;
    uint256 public minimumStake;
    uint256 public votingPeriod;

    struct Claim {
        address proposer;
        string description;
        uint256 amount;
        uint256 startTime;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool exists;
    }

    struct Stake {
        uint256 amount;
        uint256 lastVoteTime;
    }

    mapping(uint256 => Claim) public claims;
    mapping(address => Stake) public stakes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    uint256 public claimCounter;

    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event ClaimCreated(uint256 indexed claimId, address proposer, string description, uint256 amount);
    event Voted(uint256 indexed claimId, address indexed voter, bool support, uint256 weight);
    event ClaimExecuted(uint256 indexed claimId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _daoToken,
        uint256 _minimumStake,
        uint256 _votingPeriod
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        daoToken = IERC20(_daoToken);
        minimumStake = _minimumStake;
        votingPeriod = _votingPeriod;
    }

    // Stake DAO tokens to participate in voting
    function stake(uint256 _amount) external {
        require(_amount >= minimumStake, "Amount below minimum stake");
        require(daoToken.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        stakes[msg.sender].amount += _amount;
        emit Staked(msg.sender, _amount);
    }

    // Unstake tokens if user hasn't voted recently
    function unstake(uint256 _amount) external {
        Stake storage userStake = stakes[msg.sender];
        require(userStake.amount >= _amount, "Insufficient stake");
        require(
            block.timestamp >= userStake.lastVoteTime + votingPeriod,
            "Cannot unstake during active votes"
        );

        userStake.amount -= _amount;
        require(daoToken.transfer(msg.sender, _amount), "Transfer failed");
        emit Unstaked(msg.sender, _amount);
    }

    // Create a new claim
    function createClaim(string calldata _description, uint256 _amount) external {
        require(stakes[msg.sender].amount >= minimumStake, "Must have minimum stake");

        uint256 claimId = claimCounter++;
        claims[claimId] = Claim({
            proposer: msg.sender,
            description: _description,
            amount: _amount,
            startTime: block.timestamp,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            exists: true
        });

        emit ClaimCreated(claimId, msg.sender, _description, _amount);
    }

    // Vote on a claim
    function vote(uint256 _claimId, bool _support) external {
        Claim storage claim = claims[_claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Claim already executed");
        require(
            block.timestamp <= claim.startTime + votingPeriod,
            "Voting period ended"
        );
        require(!hasVoted[_claimId][msg.sender], "Already voted");

        uint256 weight = stakes[msg.sender].amount;
        require(weight > 0, "Must have stake to vote");

        if (_support) {
            claim.forVotes += weight;
        } else {
            claim.againstVotes += weight;
        }

        hasVoted[_claimId][msg.sender] = true;
        stakes[msg.sender].lastVoteTime = block.timestamp;

        emit Voted(_claimId, msg.sender, _support, weight);
    }

    // Execute a successful claim
    function executeClaim(uint256 _claimId) external {
        Claim storage claim = claims[_claimId];
        require(claim.exists, "Claim does not exist");
        require(!claim.executed, "Claim already executed");
        require(
            block.timestamp > claim.startTime + votingPeriod,
            "Voting period not ended"
        );
        require(claim.forVotes > claim.againstVotes, "Vote failed");

        claim.executed = true;
        require(daoToken.transfer(claim.proposer, claim.amount), "Transfer failed");

        emit ClaimExecuted(_claimId);
    }

    // View function to get claim details
    function getClaimDetails(uint256 _claimId) external view returns (
        address proposer,
        string memory description,
        uint256 amount,
        uint256 startTime,
        uint256 forVotes,
        uint256 againstVotes,
        bool executed,
        bool exists
    ) {
        Claim storage claim = claims[_claimId];
        return (
            claim.proposer,
            claim.description,
            claim.amount,
            claim.startTime,
            claim.forVotes,
            claim.againstVotes,
            claim.executed,
            claim.exists
        );
    }

    // Required override for UUPS proxy
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
