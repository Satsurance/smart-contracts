// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPool {
    /**
     * @notice Executes an insurance claim with the given ID
     * @param receiver Claim receiver
     * @param amount Claim amount
     * @return completed Boolean indicating if the claim execution was successful
     */
    function executeClaim(
        address receiver,
        uint amount
    ) external returns (bool completed);
}
