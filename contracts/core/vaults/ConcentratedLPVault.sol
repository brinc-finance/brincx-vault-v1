// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

import "./TokenizedVault.sol";
import "../../extentions/dex/interfaces/IDEXPool.sol";
import "../../external/uniswap/libraries/FixedPoint96.sol";
import "../../external/uniswap/libraries/FullMath.sol";
import "../../external/uniswap/libraries/TickMath.sol";

import "hardhat/console.sol";

contract ConcentratedLPVault is TokenizedVault {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using FixedPointMathLib for uint256;

    IDEXPool pool;
    int24 private _initialTickLower;
    int24 private _initialTickUpper;

    // =============================================================
    //                        Initialize
    // =============================================================
    constructor(address depostiableToken_, address dexPoolAddress_, int24 initialTickLower_, int24 initialTickUpper_) 
        TokenizedVault(depostiableToken_)
    {
        pool = IDEXPool(dexPoolAddress_);

        setInitialTicks(initialTickLower_, initialTickUpper_);
    }   

    function setInitialTicks(int24 initialTickLower_, int24 initialTickUpper_) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _initialTickLower = initialTickLower_;
        _initialTickUpper = initialTickUpper_;
    }

    function setDepositableToken(address _depositableToken)
        external
        virtual
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNoActiveDeposits
    {
        // Since we need to set extra pool for swap if we use other tokens than the pairs, it is better restrict now.
        address[] memory tokens = pool.getTokens();
        require(_depositableToken == tokens[0] || _depositableToken == tokens[1], "Only pair tokens");

        depositableToken = IERC20(_depositableToken);
    }

    // =============================================================
    //                  Accounting Logic
    // =============================================================
    function totalValueLocked() public view override virtual returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        
        //IDEXPool pool = IDEXPool(sockets[0].getAttachables()[0]);
        uint256 totalLiquidity = pool.getTotalLiquidity();
        if (totalLiquidity == 0) return amounts;

        amounts = pool.getTokenAmounts(false);
    }

    function _convertToShares(uint256[] memory assets) internal view override returns (uint256 shares) {
        // assets = (0) amount0, (1) amount1, (2) tvl0 before deposit, (3) tvl1 before deposit

        // shares = liquidity provided / (tvl + fees) * totalShares
        // shares = (amountP0 + amountP1) / (tvlPlusFees0 + tvlPlusFees1) * totalShares
        // shares = (amountP0 + (amountP0 / token1PriceInTermsOfToken0)) / (tvlPlusFees0 + (tvlPlusFees0 / token1PriceInTermsOfToken0)) * totalShares
        // shares = contributionAmount0 / totalTvlPlusFees0 * totalShares


        uint256 price = pool.getPrice();
        uint256 contributionAmount0 = assets[0].add(FullMath.mulDiv(assets[1], FixedPoint96.Q96, price));
        uint256 tvlAmount0 = assets[2].add(FullMath.mulDiv(assets[3], FixedPoint96.Q96, price));

        (uint256 collectableFee0, uint256 collectableFee1) = pool.getFeesToCollect();
        uint256 feesAmount0 = collectableFee0.add(FullMath.mulDiv(collectableFee1, FixedPoint96.Q96, price));

        // First participant
        uint256 totalShares = totalSupply();
        if (totalShares == 0) return contributionAmount0;

        shares = contributionAmount0.mulDivDown(totalShares, tvlAmount0 + feesAmount0);
    }

    function _convertToAssets(uint256 shares) internal view override returns (uint256[] memory assets) {
        require(balanceOf(msg.sender) >= shares, "Insufficient balances");

        // assets = liquidity, fee0, fee1    
        assets = new uint256[](3);

        uint256 totalShares = totalSupply();
        if (totalShares == 0) return assets;

        uint256 proportionX96 = FullMath.mulDiv(shares, FixedPoint96.Q96, totalShares);
        uint256 totalLiquidity = uint256(pool.getTotalLiquidity());
        assets[0] = totalLiquidity.mulDivDown(proportionX96, FixedPoint96.Q96);
        
        (uint256 collectableFee0, uint256 collectableFee1) = pool.getFeesToCollect();
        assets[1] = collectableFee0.mulDivDown(proportionX96, FixedPoint96.Q96);
        assets[2] = collectableFee1.mulDivDown(proportionX96, FixedPoint96.Q96);
    }

    // Override withdraw function since we don't use assets but use liquidity directly
    // =============================================================
    //                    INTERNAL HOOKS LOGIC
    // =============================================================
    function _processDepositAmount(uint256 depositAmount) internal override returns (uint256[] memory assets) {
        //IDEXPool pool = IDEXPool(sockets[0].getAttachables()[0]);

        // Get the tokens from the pool
        address[] memory tokens = pool.getTokens();
        address depositableTokenAddress = address(depositableToken);

        // Calculate amounts of token0 and token1
        (uint256 amount0Desired, uint256 amount1Desired) = tokens[0] == depositableTokenAddress ? _divideToken0(depositAmount) : _divideToken1(depositAmount);

        // Approve the pool contract to spend tokens.
        TransferHelper.safeApprove(address(tokens[0]), address(pool), amount0Desired);
        TransferHelper.safeApprove(address(tokens[1]), address(pool), amount1Desired);

        assets = new uint256[](4);
        
        // Must store tvl before adding liquidity for share calculations.
        uint256[] memory tvl = totalValueLocked();
        assets[2] = tvl[0];
        assets[3] = tvl[1];

        // Increase the liquidity in the pool
        if (pool.getTokenId() == 0) {
            (, , assets[0], assets[1]) = pool.mintNewPosition(amount0Desired, amount1Desired, _initialTickLower, _initialTickUpper, msg.sender);
        }
        else {
            (, assets[0], assets[1]) = pool.increaseLiquidity(amount0Desired, amount1Desired, msg.sender);
        }

        // assets here = (0) amountAdded0, (1) amountAdded1, (2) liquidityAdded, (3) tvlBefore0, (4) tvlBefore1
        return assets;
    }

    function _divideToken0(uint256 amountDepositTokenAsToken0) private returns (uint256 amount0, uint256 amount1) {
        address[] memory tokens = pool.getTokens();

        (amount0, ) = _splitFunds(amountDepositTokenAsToken0, true);
        amount1 = _swap(address(depositableToken), tokens[1], amountDepositTokenAsToken0.sub(amount0));
    }

    function _divideToken1(uint256 amountDepositTokenAsToken1) private returns (uint256 amount0, uint256 amount1) {
        address[] memory tokens = pool.getTokens();

        (, amount1) = _splitFunds(amountDepositTokenAsToken1, false);
        amount0 = _swap(address(depositableToken), tokens[0], amountDepositTokenAsToken1.sub(amount1));
    }

    function _splitFunds(uint256 funds, bool isFundToken0) private view returns (uint256 amount0, uint256 amount1) {
        uint256 lowerPriceSqrtX96 = TickMath.getSqrtRatioAtTick(_initialTickLower);
        uint256 upperPriceSqrtX96 = TickMath.getSqrtRatioAtTick(_initialTickUpper);
        (amount0, amount1) = pool.splitFundsIntoTokens(lowerPriceSqrtX96, upperPriceSqrtX96, funds, isFundToken0);

        require(amount0 > 0 && amount1 > 0, "Outside of price range");
    }
    
    function _processWithdrawAmount(uint256[] memory assets) internal override returns (uint256 withdrawAmount) {
        // assets = liquidityToRemove, fee0, fee1    
        // withdrawAmount = proportion * (tvl + fees)
        // withdrawAmount = proportional liquidity + proportional fees

        //IDEXPool pool = IDEXPool(sockets[0].getAttachables()[0]);
        (uint256 amount0, uint256 amount1) = pool.decreaseLiquidity(uint128(assets[0]), 0, 0);

        uint256 collected0 = 0;
        uint256 collected1 = 0;
        if (assets[1] != 0 || assets[2] != 0) {
            (collected0, collected1) = pool.collect(address(this), uint128(assets[1]), uint128(assets[2]));
        }
        
        address[] memory tokens = pool.getTokens();
        address depositableTokenAddress = address(depositableToken);

        withdrawAmount += tokens[0] == depositableTokenAddress ? amount0 + collected0 : _swap(tokens[0], depositableTokenAddress, amount0 + collected0);
        withdrawAmount += tokens[1] == depositableTokenAddress ? amount1 + collected1 : _swap(tokens[1], depositableTokenAddress, amount1 + collected1);
    }

    function _swap(address from, address to, uint256 amountIn) private returns (uint256 amountOut) {
        TransferHelper.safeApprove(from, address(pool), amountIn);
        amountOut = pool.swapExactInputSingle(IERC20(from), IERC20(to), amountIn);
    }

    function rebalance() public onlyRole(DEFAULT_ADMIN_ROLE) {
        // Pause the vault
        _pause();

        // Withdraw all liquidity from the pool
        uint256[] memory assets = new uint256[](3);
        assets[0] = pool.getTotalLiquidity();
        (assets[1], assets[2]) = pool.getFeesToCollect();

        uint256 totalAmount = _processWithdrawAmount(assets);
        pool.resetPosition();
        require(pool.getTokenId() == 0, "Position exists");

        // Then add liquidity again with new set tick values.
        _processDepositAmount(totalAmount);

        // Resume
        _unpause();
    }
}