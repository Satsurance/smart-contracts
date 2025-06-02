// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IPositionNFT is IERC721 {
    function mintPositionNFT(address to, uint64 poolId) external returns (uint);

    function burnPositionNFT(uint256 positionId) external returns (bool);
}
