// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IInsurancePool.sol";
import "../interfaces/IInvestAdapter.sol";

enum DepositType {
    Position,
    Reward
}

struct PoolInvest {
    uint256 activeDeposit;
    uint256 onHold;
    uint256 unpaidRewards;
}

contract CapitalPool is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable
{
    IPoolFactory public poolFactory;

    // Pool investment tracking using struct
    mapping(uint256 => PoolInvest) public poolInvestments;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _poolFactory) public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        poolFactory = IPoolFactory(_poolFactory);
    }

    modifier onlyValidPool(uint poolId) {
        require(
            msg.sender == poolFactory.pools(poolId),
            "CapitalPool: caller is not the valid pool"
        );
        _;
    }

    modifier onlyPoolUnderwriter(uint poolId) {
        address poolAddress = poolFactory.pools(poolId);
        require(poolAddress != address(0), "CapitalPool: invalid pool");

        IInsurancePool pool = IInsurancePool(poolAddress);
        require(
            msg.sender == pool.poolUnderwriter(),
            "CapitalPool: caller is not the pool underwriter"
        );
        _;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _getPoolAsset(address poolAddress) internal view returns (IERC20) {
        return IERC20(IInsurancePool(poolAddress).poolAsset());
    }

    function _getPoolAddress(uint poolId) internal view returns (address) {
        return poolFactory.pools(poolId);
    }

    function setPoolFactory(
        address _poolFactory
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            _poolFactory != address(0),
            "CapitalPool: poolFactory cannot be zero address"
        );
        poolFactory = IPoolFactory(_poolFactory);
    }

    function getTotalCapitalPoolValue() public view returns (uint256) {
        return 0;
    }

    function getPoolValue(uint poolId) public view returns (uint256) {
        return poolInvestments[poolId].activeDeposit;
    }

    function deposit(
        uint poolId,
        uint amount,
        DepositType depositType
    ) public onlyValidPool(poolId) {
        if (depositType == DepositType.Position) {
            poolInvestments[poolId].activeDeposit += amount;
        } else if (depositType == DepositType.Reward) {
            poolInvestments[poolId].unpaidRewards += amount;
        } else {
            revert("CapitalPool: invalid deposit type");
        }
    }

    function positionWithdraw(
        uint poolId,
        uint stakeAmount,
        uint rewardAmount, // rewards are calculated on the staking pool
        address receiver
    ) public {
        address poolAddress = _getPoolAddress(poolId);
        require(
            poolAddress == msg.sender,
            "CapitalPool: caller is not the pool"
        );
        IERC20 poolAsset = _getPoolAsset(poolAddress);

        poolInvestments[poolId].onHold -= stakeAmount;
        poolInvestments[poolId].unpaidRewards -= rewardAmount;
        poolAsset.transfer(receiver, stakeAmount + rewardAmount);
    }

    function claimWithdraw(uint poolId, uint amount, address receiver) public {
        address poolAddress = _getPoolAddress(poolId);
        require(
            poolAddress == msg.sender,
            "CapitalPool: caller is not the pool"
        );
        IERC20 poolAsset = _getPoolAsset(poolAddress);

        poolInvestments[poolId].activeDeposit -= amount;
        poolAsset.transfer(receiver, amount);
    }

    function onHold(uint poolId, uint amount) public onlyValidPool(poolId) {
        poolInvestments[poolId].activeDeposit -= amount;
        poolInvestments[poolId].onHold += amount;
    }

    function reDeposit(uint poolId, uint amount) public onlyValidPool(poolId) {
        poolInvestments[poolId].onHold -= amount;
        poolInvestments[poolId].activeDeposit += amount;
    }
}
