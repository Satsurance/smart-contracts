// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPoolFactory {
    // Events
    event BeaconUpdated(
        address indexed previousBeacon,
        address indexed newBeacon
    );
    event CapitalPoolUpdated(
        address indexed previousCapitalPool,
        address indexed newCapitalPool
    );
    event PositionNFTUpdated(
        address indexed previousPositionNFT,
        address indexed newPositionNFT
    );
    event GuardianUpdated(
        address indexed previousGuardian,
        address indexed newGuardian
    );
    event ProtocolFeeUpdated(uint256 previousFee, uint256 newFee);
    event PoolCreated(uint256 indexed poolId, address indexed poolAddress);

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
