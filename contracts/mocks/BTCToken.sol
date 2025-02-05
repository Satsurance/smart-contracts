// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BTCToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("WrappedBTC", "WBTC") {
        _mint(msg.sender, initialSupply);
    }
}
