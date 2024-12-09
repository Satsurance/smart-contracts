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

contract InsurancePool is OwnableUpgradeable, UUPSUpgradeable {
    address public governor;
    IERC20 public poolAsset;
    uint public SHARED_K;
    uint public minTimeStake;

    uint public totalAssetsStaked;
    mapping(address => PoolStake) public addressAssets;

    constructor() payable {
        _disableInitializers();
    }

    function initialize(
        address _governor,
        address _poolAsset,
        address _owner
    ) public initializer {
        __Ownable_init(_owner);

        governor = _governor;
        poolAsset = IERC20(_poolAsset);
        totalAssetsStaked = 0;
        minTimeStake = 1 weeks;
        // TODO calculate a better math
        SHARED_K = 1000 * 1e18; // initial koefficient * precision
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override(UUPSUpgradeable) onlyOwner {}

    function updateContractLogic(
        address newImplementation,
        bytes memory data
    ) external onlyOwner {
        upgradeToAndCall(newImplementation, data);
    }

    function getPoolPosition()
        external
        view
        returns (address sender, PoolStake memory position)
    {
        return (msg.sender, addressAssets[msg.sender]);
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
            addressAssets[msg.sender].startDate == 0,
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

    // Some protocol do it
    function rewardPool(uint amount) external returns (bool completed) {
        poolAsset.transferFrom(msg.sender, address(this), amount);
        SHARED_K =
            (SHARED_K * totalAssetsStaked) /
            (totalAssetsStaked + amount);
        totalAssetsStaked += amount;
        return true;
    }

    // Is done by governance event
    function slash(uint amount, address receiver) external {
        require(msg.sender == governor, "Not authorized call.");
        SHARED_K =
            (SHARED_K * totalAssetsStaked) /
            (totalAssetsStaked - amount);
        totalAssetsStaked -= amount;
        poolAsset.transfer(receiver, amount);
    }
}
