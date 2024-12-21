// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IPool.sol";

contract Claimer is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    // State variables
    IERC20 public daoToken;
    IPool public insurancePool;
    uint256 public minimumStake;
    uint256 public votingPeriod;

    struct Claim {
        address proposer;
        address receiver;
        string description;
        uint256 amount;
        uint256 startTime;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool exists;
    }

    struct StakeSnapshot {
        uint256 amount;
        uint256 timestamp;
    }

    struct UserStake {
        uint256 currentAmount;
        uint256 lastVoteTime;
        StakeSnapshot[] history;
    }

    mapping(uint256 => Claim) public claims;
    mapping(address => UserStake) public stakes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    uint256 public claimCounter;

    // Events
    event Staked(address indexed user, uint256 amount, uint256 timestamp);
    event Unstaked(address indexed user, uint256 amount, uint256 timestamp);
    event ClaimCreated(
        uint256 indexed claimId,
        address proposer,
        address receiver,
        string description,
        uint256 amount,
        uint256 timestamp
    );
    event Voted(
        uint256 indexed claimId,
        address indexed voter,
        bool support,
        uint256 weight
    );
    event ClaimExecuted(uint256 indexed claimId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _daoToken,
        address _insurancePool,
        uint256 _minimumStake,
        uint256 _votingPeriod
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        daoToken = IERC20(_daoToken);
        insurancePool = IPool(_insurancePool);
        minimumStake = _minimumStake;
        votingPeriod = _votingPeriod;
    }

    // Helper function to get stake amount at a specific timestamp
    function getStakeAtTime(
        address _user,
        uint256 _timestamp
    ) public view returns (uint256) {
        UserStake storage userStake = stakes[_user];

        // If no stake history, return 0
        if (userStake.history.length == 0) return 0;

        // Find the most recent stake before the timestamp
        for (uint256 i = userStake.history.length; i > 0; i--) {
            if (userStake.history[i - 1].timestamp <= _timestamp) {
                return userStake.history[i - 1].amount;
            }
        }

        return 0;
    }

    // Stake DAO tokens to participate in voting
    function stake(uint256 _amount) external {
        require(_amount >= minimumStake, "Amount below minimum stake");
        require(
            daoToken.transferFrom(msg.sender, address(this), _amount),
            "Transfer failed"
        );

        UserStake storage userStake = stakes[msg.sender];

        // Update current amount
        userStake.currentAmount += _amount;

        // Create new stake snapshot
        userStake.history.push(
            StakeSnapshot({
                amount: userStake.currentAmount,
                timestamp: block.timestamp
            })
        );

        emit Staked(msg.sender, _amount, block.timestamp);
    }

    // Unstake tokens if user hasn't voted recently
    function unstake(uint256 _amount) external {
        UserStake storage userStake = stakes[msg.sender];
        require(userStake.currentAmount >= _amount, "Insufficient stake");
        require(
            block.timestamp >= userStake.lastVoteTime + votingPeriod,
            "Cannot unstake during active votes"
        );

        userStake.currentAmount -= _amount;

        // Create new stake snapshot
        userStake.history.push(
            StakeSnapshot({
                amount: userStake.currentAmount,
                timestamp: block.timestamp
            })
        );

        require(daoToken.transfer(msg.sender, _amount), "Transfer failed");
        emit Unstaked(msg.sender, _amount, block.timestamp);
    }

    // Create a new claim
    function createClaim(
        address _receiver,
        string calldata _description,
        uint256 _amount
    ) external {
        require(
            stakes[msg.sender].currentAmount >= minimumStake,
            "Must have minimum stake"
        );
        require(_receiver != address(0), "Invalid receiver address");

        uint256 claimId = claimCounter++;
        claims[claimId] = Claim({
            proposer: msg.sender,
            receiver: _receiver,
            description: _description,
            amount: _amount,
            startTime: block.timestamp,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            exists: true
        });

        emit ClaimCreated(
            claimId,
            msg.sender,
            _receiver,
            _description,
            _amount,
            block.timestamp
        );
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

        // Get stake amount at claim creation time
        uint256 weight = getStakeAtTime(msg.sender, claim.startTime);
        require(weight > 0, "Must have had stake before claim creation");

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

        insurancePool.executeClaim(claim.receiver, claim.amount);

        emit ClaimExecuted(_claimId);
    }

    // View function to get claim details
    function getClaimDetails(
        uint256 _claimId
    )
        external
        view
        returns (
            address proposer,
            address receiver,
            string memory description,
            uint256 amount,
            uint256 startTime,
            uint256 forVotes,
            uint256 againstVotes,
            bool executed,
            bool exists
        )
    {
        Claim storage claim = claims[_claimId];
        return (
            claim.proposer,
            claim.receiver,
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
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
