// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IInsurancePool.sol";
import "../interfaces/IInvestAdapter.sol";

struct PoolInvest {
    uint256 deposited;
}

contract CapitalPool is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable
{
    IERC20 public poolToken;
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
        return poolInvestments[poolId].deposited;
    }

    function deposit(uint poolId, uint amount) public onlyValidPool(poolId) {
        poolInvestments[poolId].deposited += amount;
    }

    function positionWithdraw(
        uint poolId,
        uint amount,
        address receiver
    ) public onlyValidPool(poolId) {
        poolInvestments[poolId].deposited -= amount;
        poolToken.transfer(receiver, amount);
    }

    function claimWithdraw(
        uint poolId,
        uint amount,
        address receiver
    ) public onlyValidPool(poolId) {
        poolInvestments[poolId].deposited -= amount;
        poolToken.transfer(receiver, amount);
    }
}
