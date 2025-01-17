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
    mapping(address => UserCover[]) public covers;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function getUserCoversCount(address user) external view returns (uint) {
        return covers[user].length;
    }

    function getUserCovers(
        address user
    ) external view returns (UserCover[] memory) {
        UserCover[] memory userCovers = new UserCover[](covers[user].length);
        for (uint i = 0; i < covers[user].length; i++) {
            userCovers[i] = covers[user][i];
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
        covers[msg.sender].push(
            UserCover(msg.sender, protocol, startDate, endDate, coverAmount)
        );

        token.transferFrom(msg.sender, address(this), purchaseCost);
    }
}
