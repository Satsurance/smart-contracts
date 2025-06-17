// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPoolFactory {
    event PoolCreated(uint256 indexed poolId, address indexed poolAddress);

    function settings() external view returns (address);
    function poolCount() external view returns (uint256);
    function pools(uint256 poolId) external view returns (address);

    function create(bytes calldata initData)
        external
        returns (uint256 poolId, address poolAddress);
}
