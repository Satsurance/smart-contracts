// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IPositionNFT.sol";

interface IPositionUriDescriptor {
    function tokenURI(
        uint positionId,
        uint poolId
    ) external view returns (string memory);
}
