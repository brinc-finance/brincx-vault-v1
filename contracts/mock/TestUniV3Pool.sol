// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "../../contracts/extentions/dex/pools/UniV3Pool.sol";

contract TestUniV3Pool is UniV3Pool {
    constructor(
        address routerAddress,
        address poolAddress,
        address positionManagerAddress
    ) UniV3Pool(routerAddress, poolAddress, positionManagerAddress) {}

    function getSqrtX96() public view returns (uint160) {
        (uint160 sqrtPriceX96, , , , , , ) = _swapPool.slot0();
        return sqrtPriceX96;
    }
}