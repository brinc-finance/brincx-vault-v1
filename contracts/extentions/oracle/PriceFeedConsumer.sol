// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IPriceFeed.sol";

abstract contract PriceFeedConsumer {
    IPriceFeed internal priceFeed;

    constructor(address priceFeedAddress) {
        priceFeed = IPriceFeed(priceFeedAddress);
    }
}