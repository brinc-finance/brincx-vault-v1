// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

interface IPriceFeed {
    function getAssetPrice(address) external view returns (uint256);
}