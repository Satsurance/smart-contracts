// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct UserCover {
    address user;
    string protocol;
    uint startDate;
    uint endDate;
    uint coverAmount;
}

// This is a not optimised contract for demo only
contract CoverPurchaser {
    IERC20 public token;
    uint public coverCounter;
    mapping(address => uint[]) public userCoverIds;
    mapping(uint => UserCover) public covers;

    function getUserCovers(
        address user
    ) external view returns (UserCover[] memory) {
        uint[] memory coverIds = userCoverIds[user];
        UserCover[] memory userCovers = new UserCover[](coverIds.length);
        for (uint i = 0; i < coverIds.length; i++) {
            userCovers[i] = covers[coverIds[i]];
        }
        return userCovers;
    }

    function purchaseCover(
        string calldata protocol,
        uint startDate,
        uint endDate,
        uint coverAmount,
        uint purchaseCost
    ) external {
        covers[coverCounter++] = UserCover(
            msg.sender,
            protocol,
            startDate,
            endDate,
            coverAmount
        );
        token.transferFrom(msg.sender, address(this), purchaseCost);
    }
}
