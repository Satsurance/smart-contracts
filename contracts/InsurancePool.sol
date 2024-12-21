// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

struct PoolStake {
    uint startDate;
    uint amount;
    uint initialAmount;
}

struct CaseClaim {
    address receiver;
    uint amount;
    uint created;
    string description;
    bool executed;
}

contract InsurancePool is OwnableUpgradeable, UUPSUpgradeable {
    address public governor;
    address public claimer;
    IERC20 public poolAsset;
    uint public SHARED_K;
    uint public minTimeStake;

    uint public totalAssetsStaked;
    mapping(address => PoolStake) public addressAssets;

    uint latestClaim;
    mapping(uint => CaseClaim) public claims;

    modifier onlyClaimer() {
        require(msg.sender == claimer, "Caller is not the claimer");
        _;
    }

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address _governor,
        address _poolAsset,
        address _owner,
        address _claimer
    ) public initializer {
        __Ownable_init(_owner);

        governor = _governor;
        claimer = _claimer;
        poolAsset = IERC20(_poolAsset);
        totalAssetsStaked = 0;
        // minTimeStake = 1 weeks;
        // Keep it simple for test purposes
        minTimeStake = 0;
        latestClaim = 0;
        // TODO calculate a better math
        SHARED_K = 100000 * 1e18; // initial koefficient * precision
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override(UUPSUpgradeable) onlyOwner {}

    function updateContractLogic(
        address newImplementation,
        bytes memory data
    ) external {
        require(msg.sender == governor, "not authorized update call.");
        upgradeToAndCall(newImplementation, data);
    }

    function updateClaimer(address newClaimer) external {
        require(msg.sender == governor, "not authorized update call.");
        require(newClaimer != address(0), "New claimer cannot be zero address");
        claimer = newClaimer;
    }

    function getPoolPosition(
        address account
    ) external view returns (PoolStake memory position) {
        return addressAssets[account];
    }

    function joinPool(uint amount) external returns (bool completed) {
        require(
            addressAssets[msg.sender].startDate == 0,
            "User has already joined the pool."
        );
        poolAsset.transferFrom(msg.sender, address(this), amount);
        addressAssets[msg.sender] = PoolStake(
            block.timestamp,
            amount * SHARED_K,
            amount
        );
        totalAssetsStaked += amount;
        return true;
    }

    function quitPool() external returns (bool completed) {
        require(
            addressAssets[msg.sender].startDate != 0,
            "User hasn't joined the pool."
        );
        require(
            addressAssets[msg.sender].startDate + minTimeStake <
                block.timestamp,
            "Funds are timelocked."
        );

        uint withdrawAmount = addressAssets[msg.sender].amount / SHARED_K;
        totalAssetsStaked -= withdrawAmount;
        delete addressAssets[msg.sender];
        poolAsset.transfer(msg.sender, withdrawAmount);
        return true;
    }

    function rewardPool(uint amount) external returns (bool completed) {
        poolAsset.transferFrom(msg.sender, address(this), amount);
        SHARED_K =
            (SHARED_K * totalAssetsStaked) /
            (totalAssetsStaked + amount);
        totalAssetsStaked += amount;
        return true;
    }

    function makeClaim(
        address receiver,
        uint amount,
        string memory description
    ) external {
        claims[++latestClaim] = CaseClaim(
            receiver,
            amount,
            block.timestamp,
            description,
            false
        );
    }

    function executeClaim(
        uint claimId
    ) external onlyClaimer returns (bool completed) {
        require(
            claims[claimId].executed == false,
            "Claim is already executed."
        );
        claims[claimId].executed = true;
        SHARED_K =
            (SHARED_K * totalAssetsStaked) /
            (totalAssetsStaked - claims[claimId].amount);
        totalAssetsStaked -= claims[claimId].amount;
        poolAsset.transfer(claims[claimId].receiver, claims[claimId].amount);
        return true;
    }
}
