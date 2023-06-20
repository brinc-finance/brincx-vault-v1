// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "../core/vaults/ConcentratedLPVault.sol";

contract MockConcentratedLPVault is ConcentratedLPVault {
    constructor(address depostiableToken_, address dexPoolAddress_, int24 initialTickLower_, int24 initialTickUpper_) 
    ConcentratedLPVault(depostiableToken_, dexPoolAddress_, initialTickLower_, initialTickUpper_) {}

    function processDepositAmount(uint256 depositAmount) external returns (uint256[] memory assets) {
        return _processDepositAmount(depositAmount);
    }

    function convertToShares(uint256[] memory assets) external view returns (uint256 shares) {
        return _convertToShares(assets);
    }

    function convertToAssets(uint256 shares) external view returns (uint256[] memory assets) {
        return _convertToAssets(shares);
    }

    function swapExactInputSingle(IERC20 from, IERC20 to, uint256 amountIn) external returns (uint256 amountOut) {
        TransferHelper.safeApprove(address(from), address(pool), amountIn);
        return pool.swapExactInputSingle(from, to, amountIn);
    }

    function collect(address recipient, uint128 amount0Max, uint128 amount1Max) external returns (uint256 amount0, uint256 amount1)  {
        return pool.collect(recipient, amount0Max, amount1Max);
    }

    function mintShares(uint256 shares) external {
        return _mint(msg.sender, shares);
    }
}
