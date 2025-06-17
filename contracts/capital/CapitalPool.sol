// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IInsurancePool.sol";
import "../interfaces/IInvestAdapter.sol";
import "../interfaces/IProtocolSettings.sol";

enum DepositType {
    Position,
    Reward
}

struct PoolInvest {
    uint256 onHold;
    uint256 unpaidRewards;
    uint256 shares;
}

contract CapitalPool is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    IPoolFactory public poolFactory;
    address public guardian;

    // Pool investment tracking using struct
    mapping(uint256 => PoolInvest) public poolInvestments;

    // Share-based accounting per asset
    mapping(address => uint256) public totalShares;
    mapping(address => uint256) public totalAssets;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _poolFactory) public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();

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

    function updateGlobalSettings() public {
        IProtocolSettings settings = IProtocolSettings(poolFactory.settings());
        guardian = settings.guardian();
    }

    function pause() external {
        require(msg.sender == guardian, "CapitalPool: only guardian can call");
        _pause();
    }

    function unpause() external {
        require(msg.sender == guardian, "CapitalPool: only guardian can call");
        _unpause();
    }

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

    function getTotalCapitalPoolValue(
        address asset
    ) public view returns (uint256) {
        return totalAssets[asset];
    }

    function getPoolValue(uint poolId) public view returns (uint256) {
        address poolAddress = _getPoolAddress(poolId);
        address asset = address(_getPoolAsset(poolAddress));

        if (totalShares[asset] == 0) {
            return 0;
        }
        return
            (poolInvestments[poolId].shares * totalAssets[asset]) /
            totalShares[asset];
    }

    function getPoolShares(uint poolId) public view returns (uint256) {
        return poolInvestments[poolId].shares;
    }

    function deposit(
        uint poolId,
        uint amount,
        DepositType depositType
    ) public onlyValidPool(poolId) whenNotPaused {
        address poolAddress = _getPoolAddress(poolId);
        address asset = address(_getPoolAsset(poolAddress));

        if (depositType == DepositType.Position) {
            uint256 newShares = totalShares[asset] == 0
                ? amount
                : (amount * totalShares[asset]) / totalAssets[asset];

            poolInvestments[poolId].shares += newShares;

            totalShares[asset] += newShares;
            totalAssets[asset] += amount;
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
    ) public whenNotPaused {
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

    function claimWithdraw(
        uint poolId,
        uint amount,
        address receiver
    ) public whenNotPaused {
        address poolAddress = _getPoolAddress(poolId);
        require(
            poolAddress == msg.sender,
            "CapitalPool: caller is not the pool"
        );
        IERC20 poolAsset = _getPoolAsset(poolAddress);
        address asset = address(poolAsset);

        // Calculate shares to burn based on claim amount
        uint256 sharesToBurn = (amount * totalShares[asset]) /
            totalAssets[asset];
        poolInvestments[poolId].shares -= sharesToBurn;
        totalShares[asset] -= sharesToBurn;

        totalAssets[asset] -= amount;

        poolAsset.transfer(receiver, amount);
    }

    function onHold(
        uint poolId,
        uint amount
    ) public onlyValidPool(poolId) whenNotPaused {
        address poolAddress = _getPoolAddress(poolId);
        address asset = address(_getPoolAsset(poolAddress));

        poolInvestments[poolId].onHold += amount;

        uint256 sharesToBurn = (amount * totalShares[asset]) /
            totalAssets[asset];
        poolInvestments[poolId].shares -= sharesToBurn;
        totalShares[asset] -= sharesToBurn;
        totalAssets[asset] -= amount;
    }

    function reDeposit(
        uint poolId,
        uint amount
    ) public onlyValidPool(poolId) whenNotPaused {
        address poolAddress = _getPoolAddress(poolId);
        address asset = address(_getPoolAsset(poolAddress));

        poolInvestments[poolId].onHold -= amount;
        uint256 newShares = totalShares[asset] == 0
            ? amount
            : (amount * totalShares[asset]) / totalAssets[asset];

        poolInvestments[poolId].shares += newShares;

        totalShares[asset] += newShares;
        totalAssets[asset] += amount;
    }
}
