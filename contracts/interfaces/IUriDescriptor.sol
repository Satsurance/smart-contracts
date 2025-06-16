// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ICoverNFT.sol";

interface IUriDescriptor {
    function tokenURI(
        uint256 tokenId,
        bytes calldata metadata
    ) external view returns (string memory);
}
