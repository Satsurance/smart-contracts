// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "../interfaces/IPositionUriDescriptor.sol";

contract PositionUriDescriptor is IPositionUriDescriptor {
    using Strings for uint256;

    /**
     * @dev Generates the token URI for a position NFT
     * @param positionId The ID of the position token
     * @param poolId The pool ID that issued this position
     * @return The complete token URI as a base64-encoded JSON
     */
    function tokenURI(
        uint256 positionId,
        uint256 poolId
    ) external pure returns (string memory) {
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        abi.encodePacked(
                            "{",
                            '"name": "Insurance Position #',
                            positionId.toString(),
                            '",',
                            '"description": "Insurance position NFT from Pool #',
                            poolId.toString(),
                            '"}'
                        )
                    )
                )
            );
    }
}
