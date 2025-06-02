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

    function guardian() external view returns (address);

    function coverNFT() external view returns (address);

    function positionNFT() external view returns (address);

    function protocolFee() external view returns (uint256);

    function poolCount() external view returns (uint);

    function pools(uint poolId) external view returns (address);

    function setBeacon(address newBeacon) external;

    function setCapitalPool(address newCapitalPool) external;

    function setProtocolFee(uint256 newProtocolFee) external;

    function create(
        bytes calldata initData
    ) external returns (uint poolId, address poolAddress);
}
