// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Cover {
    uint coveredAmount;
    uint64 productId;
    uint64 startDate;
    uint64 endDate;
    uint64 poolId;
}

interface ICoverNFT {
    /**
     * @dev Mint a cover NFT
     * @param to The address to mint the NFT to and the account that is covered
     * @param coveredAmount The amount covered
     * @param productId The product ID
     * @param startDate The start date of coverage
     * @param endDate The end date of coverage
     * @param poolId The pool ID that issued this cover
     */
    function mintCoverNFT(
        address to,
        uint256 coveredAmount,
        uint64 productId,
        uint64 startDate,
        uint64 endDate,
        uint64 poolId
    ) external;
}
