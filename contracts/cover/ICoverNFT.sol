// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICoverNFT {
    /**
     * @dev Mint a cover NFT
     * @param to The address to mint the NFT to
     * @param coveredAccount The account that is covered
     * @param coveredAmount The amount covered
     * @param productId The product ID
     * @param startDate The start date of coverage
     * @param endDate The end date of coverage
     * @param poolId The pool ID that issued this cover
     */
    function mintCoverNFT(
        address to,
        address coveredAccount,
        uint256 coveredAmount,
        uint64 productId,
        uint64 startDate,
        uint64 endDate,
        uint64 poolId
    ) external;
}
