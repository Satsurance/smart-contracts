// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

interface IPoolFactory {
    event PoolCreated(uint indexed poolId, address indexed poolAddress);
    event OperatorChanged(
        address indexed oldOperator,
        address indexed newOperator
    );
    event BeaconChanged(address indexed oldBeacon, address indexed newBeacon);
}

contract PoolFactory is IPoolFactory {
    address public operator;
    address public beacon;
    uint96 internal _poolCount;
    mapping(uint => address) public pools;

    constructor(address _operator) {
        operator = _operator;
    }

    function changeOperator(address newOperator) public {
        require(msg.sender == operator, "PoolFactory: Not operator");
        require(newOperator != address(0), "PoolFactory: Invalid operator");

        address oldOperator = operator;
        operator = newOperator;

        emit OperatorChanged(oldOperator, newOperator);
    }

    function setBeacon(address newBeacon) external {
        require(msg.sender == operator, "PoolFactory: Not operator");
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
        require(msg.sender == operator, "PoolFactory: Not operator");
        require(beacon != address(0), "PoolFactory: Beacon not set");

        poolId = ++_poolCount;

        poolAddress = address(
            new BeaconProxy{salt: bytes32(poolId)}(beacon, initData)
        );
        pools[poolId] = poolAddress;

        emit PoolCreated(poolId, poolAddress);
    }
}
