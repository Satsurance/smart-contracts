// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IInsurancePool.sol";
import "../interfaces/IInvestAdapter.sol";

contract CapitalPool is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable
{
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant PRECISION = 100000000;

    struct PoolInvest {
        uint256 deposited;
        uint256 notInvested;
        mapping(uint256 => uint256) adapterInvested;
        mapping(uint256 => uint256) adapterAssets;
    }

    IERC20 public poolToken;
    IERC20[] public tokens;
    IPoolFactory public poolFactory;
    IInvestAdapter[] public investAdapters;

    // Pool investment tracking using struct
    mapping(uint256 => PoolInvest) public poolInvestments; // poolId => PoolInvest struct

    // Limits storage
    mapping(uint256 => mapping(uint256 => uint256)) public poolAdapterLimits; // poolId => adapterId => limit

    // Track allowed adapters for each pool
    mapping(uint256 => uint256[]) public poolAllowedAdapters; // poolId => array of adapter IDs

    // Global totals across all pools
    uint256 public totalDeposited;
    uint256 public totalNotInvested;
    mapping(uint256 => uint256) public totalAdapterInvested; // adapterId => total invested across all pools
    mapping(uint256 => uint256) public totalAdapterAssets; // adapterId => total assets across all pools

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

    function getTotalPoolValue() public view returns (uint256) {
        uint256 poolValue = totalNotInvested;
        // Add value from adapter investments
        for (uint256 i = 0; i < investAdapters.length; i++) {
            uint256 adapterAssets = totalAdapterAssets[i];
            if (adapterAssets > 0) {
                poolValue += investAdapters[i].getInvestedTokenValue(
                    adapterAssets
                );
            }
        }

        return poolValue;
    }

    function getPoolValue(uint poolId) public view returns (uint256) {
        uint256 poolValue = poolInvestments[poolId].notInvested;
        // Add value from adapter investments for this specific pool
        for (uint256 i = 0; i < investAdapters.length; i++) {
            uint256 adapterAssets = poolInvestments[poolId].adapterAssets[i];
            if (adapterAssets > 0) {
                poolValue += investAdapters[i].getInvestedTokenValue(
                    adapterAssets
                );
            }
        }

        return poolValue;
    }

    function setLimits(
        uint poolId,
        uint256[] memory adapterIds,
        uint256[] memory limits
    ) public onlyPoolUnderwriter(poolId) {
        require(
            adapterIds.length == limits.length,
            "CapitalPool: arrays length mismatch"
        );

        delete poolAllowedAdapters[poolId];
        uint256 totalLimits = 0;
        for (uint256 i = 0; i < adapterIds.length; i++) {
            poolAdapterLimits[poolId][adapterIds[i]] = limits[i];
            poolAllowedAdapters[poolId].push(adapterIds[i]);
            totalLimits += limits[i];
        }

        // Validate that total limits don't exceed BASIS_POINTS
        require(
            totalLimits <= BASIS_POINTS,
            "CapitalPool: total adapter limits exceed BASIS_POINTS"
        );
    }

    function deposit(
        uint poolId,
        uint amount
    ) public onlyValidPool(poolId) returns (uint) {
        // Update pool investment totals
        poolInvestments[poolId].deposited += amount;
        uint256 totalInvested = 0;

        // Iterate through adapter limits and invest
        for (uint256 i = 0; i < investAdapters.length; i++) {
            uint256 limit = poolAdapterLimits[poolId][i];
            if (limit > 0) {
                uint256 investAmount = (limit * amount) / BASIS_POINTS;
                if (investAmount > 0) {
                    poolToken.transfer(
                        address(investAdapters[i]),
                        investAmount
                    );
                    uint256 returnedAmount = investAdapters[i].invest(
                        investAmount
                    );

                    poolInvestments[poolId].adapterInvested[i] += investAmount;
                    poolInvestments[poolId].adapterAssets[i] += returnedAmount;

                    // Update global adapter totals
                    totalAdapterInvested[i] += investAmount;
                    totalAdapterAssets[i] += returnedAmount;

                    totalInvested += investAmount;
                }
            }
        }

        poolInvestments[poolId].notInvested += amount - totalInvested;

        // Update global totals
        totalDeposited += amount;
        totalNotInvested += amount - totalInvested;

        return (amount * PRECISION) / getPoolValue(poolId);
    }

    function withdraw(uint poolId, uint shares) public onlyValidPool(poolId) {
        // poolToken.transfer(msg.sender, amount);
    }

    function addInvestAdapter(
        address adapter
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(adapter != address(0), "CapitalPool: invalid adapter address");
        investAdapters.push(IInvestAdapter(adapter));
    }

    function getInvestAdaptersCount() public view returns (uint256) {
        return investAdapters.length;
    }
}
