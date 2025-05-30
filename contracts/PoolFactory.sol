// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "./IPoolFactory.sol";

contract PoolFactory is IPoolFactory, AccessControlEnumerable {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    address public beacon;
    address public capitalPool;
    uint256 public protocolFee;
    uint96 internal _poolCount;
    mapping(uint => address) public pools;

    constructor(
        address _owner,
        address _operator,
        address _capitalPool,
        address _beacon,
        uint256 _protocolFee
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(OWNER_ROLE, _owner);
        _grantRole(OPERATOR_ROLE, _operator);

        _setRoleAdmin(OWNER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, OPERATOR_ROLE);

        setBeacon(_beacon);
        setCapitalPool(_capitalPool);
        setProtocolFee(_protocolFee);
    }

    function setCapitalPool(
        address newCapitalPool
    ) public onlyRole(OPERATOR_ROLE) {
        require(
            newCapitalPool != address(0),
            "PoolFactory: Invalid capital pool"
        );
        capitalPool = newCapitalPool;
    }

    function setProtocolFee(
        uint256 newProtocolFee
    ) public onlyRole(OPERATOR_ROLE) {
        protocolFee = newProtocolFee;
    }

    function setBeacon(address newBeacon) public onlyRole(OWNER_ROLE) {
        require(newBeacon != address(0), "PoolFactory: Invalid beacon");

        address oldBeacon = beacon;
        beacon = newBeacon;

        emit BeaconChanged(oldBeacon, newBeacon);
    }

    function poolCount() external view returns (uint) {
        return _poolCount;
    }

    function create(
        bytes calldata initData
    ) external returns (uint poolId, address poolAddress) {
        require(beacon != address(0), "PoolFactory: Beacon not set");

        poolId = ++_poolCount;

        poolAddress = address(
            new BeaconProxy{salt: bytes32(poolId)}(beacon, initData)
        );
        pools[poolId] = poolAddress;

        emit PoolCreated(poolId, poolAddress);
    }
}
