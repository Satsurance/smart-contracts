// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

struct Cover {
    address coveredAccount;
    uint coveredAmount;
    uint64 productId;
    uint64 startDate;
    uint64 endDate;
    uint64 poolId;
}

contract UriDescriptor {
    using Strings for uint256;

    /**
     * @dev Generates the token URI for a cover NFT
     * @param tokenId The ID of the token
     * @param cover The cover data struct
     * @return The complete token URI as a base64-encoded JSON
     */
    function tokenURI(
        uint256 tokenId,
        Cover calldata cover
    ) external pure returns (string memory) {
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(_getBasicInfo(tokenId, cover))
                )
            );
    }

    /**
     * @dev Generate basic info (name, description)
     */
    function _getBasicInfo(
        uint256 tokenId,
        Cover calldata cover
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                "{",
                '"name": "Insurance Cover #',
                tokenId.toString(),
                '",',
                '"description": "Insurance cover NFT from Pool #',
                uint256(cover.poolId).toString(),
                '"}'
            );
    }
}
