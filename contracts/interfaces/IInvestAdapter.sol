// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInvestAdapter {
    /**
     * @dev Invests the specified amount
     * @param amount The amount to invest
     * @return The adapter asset got
     */
    function invest(uint256 amount) external returns (uint256);

    /**
     * @dev Collects the specified amount from investments
     * @param amount The amount to collect
     * @return The adapters asset spent
     */
    function collect(uint256 amount) external returns (uint256);

    /**
     * @dev Returns the current value of invested tokens
     * @param amount The amount to check the value for
     * @return The current value of the invested tokens
     */
    function getInvestedTokenValue(
        uint256 amount
    ) external view returns (uint256);
}
