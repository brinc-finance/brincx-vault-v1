// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../interfaces/IPriceFeed.sol";

import "hardhat/console.sol";

contract ChainlinkPriceFeed is IPriceFeed {
    AggregatorV3Interface private _aggregator;

    constructor(AggregatorV3Interface aggregator) {
        _aggregator = AggregatorV3Interface(aggregator);
    }

   function getAssetPrice(address feedAddress) public view virtual returns (uint256) {
        console.log("feedAddress: ", feedAddress);
        AggregatorV3Interface priceFeed = AggregatorV3Interface(feedAddress);
         (
            /* uint80 roundID */,
            int256 price,
            /*uint256  startedAt*/,
            /*uint256  timeStamp*/,
            /*uint80 answeredInRound*/
        ) = priceFeed.latestRoundData();

        return uint256(price);
    }
}