// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPoolFactory {
    // Events
    event PoolCreated(uint indexed poolId, address indexed poolAddress);
    event OperatorChanged(
        address indexed oldOperator,
        address indexed newOperator
    );
    event BeaconChanged(address indexed oldBeacon, address indexed newBeacon);

    // View functions
    function beacon() external view returns (address);

    function capitalPool() external view returns (address);

    function poolCount() external view returns (uint);

    function pools(uint poolId) external view returns (address);

    function setBeacon(address newBeacon) external;

    function create(
        bytes calldata initData
    ) external returns (uint poolId, address poolAddress);
}
