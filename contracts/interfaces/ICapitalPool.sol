// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICapitalPool {
    /**
     * @dev Deposits tokens into a specific pool
     * @param poolId The ID of the pool to deposit into
     * @param amount The amount of tokens to deposit
     */
    function deposit(uint poolId, uint amount) external;

    /**
     * @dev Withdraws tokens from a specific pool position
     * @param poolId The ID of the pool to withdraw from
     * @param amount The amount of tokens to withdraw
     * @param receiver The address to receive the withdrawn tokens
     */
    function positionWithdraw(
        uint poolId,
        uint amount,
        address receiver
    ) external;

    /**
     * @dev Withdraws tokens from a specific pool by claiming from adapters
     * @param poolId The ID of the pool to withdraw from
     * @param amount The amount of tokens to withdraw
     * @param receiver The address to receive the withdrawn tokens
     */
    function claimWithdraw(uint poolId, uint amount, address receiver) external;

    /**
     * @dev Prepares the pool for quitting the position on episode expire
     * @param poolId The ID of the pool to put on hold
     * @param amount The amount of tokens to collect from adapters
     */
    function onHold(uint poolId, uint amount) external;

    /**
     * @dev Gets the total value of a specific pool
     * @param poolId The ID of the pool
     * @return The total value of the pool
     */
    function getPoolValue(uint poolId) external view returns (uint256);
}
