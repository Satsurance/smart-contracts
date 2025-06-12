// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "../interfaces/IUriDescriptor.sol";
import "../interfaces/ICoverNFT.sol";

contract CoverDescriptor is IUriDescriptor {
    using Strings for uint256;

    /**
     * @dev Generates the token URI for a cover NFT
     * @param tokenId The ID of the token
     * @param metadata The encoded cover data as bytes
     * @return The complete token URI as a base64-encoded JSON
     */
    function tokenURI(
        uint256 tokenId,
        bytes calldata metadata
    ) external pure returns (string memory) {
        // Decode the metadata bytes into a Cover struct
        Cover memory cover = abi.decode(metadata, (Cover));

        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        abi.encodePacked(
                            "{",
                            '"name": "Insurance Cover #',
                            tokenId.toString(),
                            '",',
                            '"description": "Insurance cover NFT from Pool #',
                            uint256(cover.poolId).toString(),
                            '"}'
                        )
                    )
                )
            );
    }
}
