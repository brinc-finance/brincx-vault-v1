import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";
import { encodePriceSqrt } from "@uniswap/v3-sdk";

export const addLiquidity = async (uniswapV3Factory: string, tokenA: Contract, tokenB: Contract, tokenA_tokenB_priceRatio: number) => {
  const [owner] = await ethers.getSigners();

  // Deploy NonfungiblePositionManager
  const NonfungiblePositionManagerFactory = await ethers.getContractFactory("NonfungiblePositionManager");
  const nonfungiblePositionManager = await NonfungiblePositionManagerFactory.deploy(uniswapV3Factory, tokenA.address, tokenB.address);

  const amountTokenA = BigNumber.from("1000000000000000000"); // 1 tokenA
  const amountTokenB = BigNumber.from("2000000000000000000"); // 2 tokenB

  // Approve the NonfungiblePositionManager to spend tokens on behalf of the deployer
  await tokenA.connect(owner).approve(nonfungiblePositionManager.address, amountTokenA);
  await tokenB.connect(owner).approve(nonfungiblePositionManager.address, amountTokenB);

  const priceSqrtX96 = encodePriceSqrt(tokenA_tokenB_priceRatio, 1);
  const currentTick = Math.floor(Math.log2(priceSqrtX96 / 1e6) * 64);
  const tickSpacing = 10;
  const tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing;
  const tickUpper = tickLower + tickSpacing;

  // Add liquidity to the pool
  const addLiquidityTx = await nonfungiblePositionManager.connect(owner).mint({
    token0: tokenA.address,
    token1: tokenB.address,
    fee: 500,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: amountTokenA,
    amount1Desired: amountTokenB,
    amount0Min: 0,
    amount1Min: 0,
    recipient: owner.address,
    deadline: BigNumber.from(Math.floor(Date.now() / 1000) + 86400), // Deadline set to 24 hours from now
    sqrtPriceX96: 0,
  });

  // Wait for the transaction to complete
  await addLiquidityTx.wait();
};
