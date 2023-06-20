import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { TestUniV3Pool, UniV3Pool } from "../../../typechain";
import chainConfig from "../../../chain.config";

describe("UniV3Pool", () => {
  async function setup(userTestCode: boolean = false) {
    const { uniV3Pool, routerAddress, poolAddress, positionManagerAddress } = await deployUniV3PoolFixture(userTestCode);

    const USDC = await ethers.getContractAt("ERC20", chainConfig.erc20.usdc.default);
    const WETH = await ethers.getContractAt("ERC20", chainConfig.erc20.weth.default);

    const WhaleAccountSigner1 = await ethers.getImpersonatedSigner(chainConfig.whales.ethereum.eth_usdc_1);
    const WhaleAccountSigner2 = await ethers.getImpersonatedSigner(chainConfig.whales.ethereum.eth_usdc_2);

    return { uniV3Pool, routerAddress, poolAddress, positionManagerAddress, USDC, WETH, WhaleAccountSigner1, WhaleAccountSigner2 };
  }

  async function deployUniV3PoolFixture(userTestCode: boolean) {
    const uniV3PoolFactory = await ethers.getContractFactory(userTestCode ? "TestUniV3Pool" : "UniV3Pool");
    const routerAddress = chainConfig.router.uniswapv3.default;
    const poolAddress = chainConfig.pool.uniswapv3.ethereum.usdc_eth;
    const positionManagerAddress = chainConfig.positionManager.uniswapv3.default;

    const WhaleAccountSigner1 = await ethers.getImpersonatedSigner(chainConfig.whales.ethereum.eth_usdc_1);

    const uniV3Pool = (await uniV3PoolFactory
      .connect(WhaleAccountSigner1)
      .deploy(routerAddress, poolAddress, positionManagerAddress)) as UniV3Pool;
    await uniV3Pool.deployed();

    return { uniV3Pool, routerAddress, poolAddress, positionManagerAddress };
  }

  before(async () => {
    const { USDC, WETH, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup();
    const USDCBalance1 = await USDC.balanceOf(WhaleAccountSigner1.address);
    const ETHBalance1 = await WETH.balanceOf(WhaleAccountSigner1.address);

    expect(USDCBalance1).to.gt(0);
    expect(ETHBalance1).to.gt(0);

    const USDCBalance2 = await USDC.balanceOf(WhaleAccountSigner2.address);
    const ETHBalance2 = await WETH.balanceOf(WhaleAccountSigner2.address);

    expect(USDCBalance2).to.gt(0);
    expect(ETHBalance2).to.gt(0);
  });

  describe("Deployment", () => {
    it("should deploy successfully", async () => {
      const { uniV3Pool } = await setup();
      expect(uniV3Pool.address).to.be.properAddress;
    });

    it("should have valid contracts regarding Uniswap V3", async () => {
      const { routerAddress, poolAddress, positionManagerAddress } = await setup();

      const routerCode = await ethers.provider.getCode(routerAddress);
      expect(routerCode).not.equal("0x");

      const poolCode = await ethers.provider.getCode(poolAddress);
      expect(poolCode).not.equal("0x");

      const positionManagerCode = await ethers.provider.getCode(positionManagerAddress);
      expect(positionManagerCode).not.equal("0x");
    });

    it("should assign the VAULT_ROLE to the deployer", async () => {
      const { uniV3Pool, WhaleAccountSigner1 } = await setup();

      // VAULT_ROLE constant should be defined in the contract
      const VAULT_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VAULT_ROLE"));

      expect(await uniV3Pool.hasRole(VAULT_ROLE, WhaleAccountSigner1.address)).to.be.true;
    });

    it("should correctly fetch and store the token addresses", async () => {
      const { uniV3Pool, USDC, WETH } = await setup();

      const tokens = await uniV3Pool.getTokens();

      expect(tokens[0]).to.equal(USDC.address);
      expect(tokens[1]).to.equal(WETH.address);
    });
  });

  describe("SwapExactInputSingle", () => {
    it("should revert if the contract is not approved to spend the 'from' token", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();
      const amountIn = ethers.utils.parseUnits("100.0", 6); // 100 USDC

      // User has not approved the contract to spend USDC
      await expect(uniV3Pool.connect(WhaleAccountSigner1).swapExactInputSingle(USDC.address, WETH.address, amountIn)).to.be.revertedWith(
        "STF"
      );
    });

    it("should swap tokens correctly when user has approved and has sufficient balance", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();
      const amountIn = ethers.utils.parseUnits("100.0", 6); // 100 USDC

      // User approves the contract to spend USDC
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amountIn);

      const USDCInitialBalance = await USDC.balanceOf(WhaleAccountSigner1.address);
      const WETHInitialBalance = await WETH.balanceOf(WhaleAccountSigner1.address);
      await expect(uniV3Pool.connect(WhaleAccountSigner1).swapExactInputSingle(USDC.address, WETH.address, amountIn))
        .to.emit(uniV3Pool, "Swap")
        .withArgs(USDC.address, WETH.address, amountIn, 0, WhaleAccountSigner1.address);

      const WETHFinalBalance = await WETH.balanceOf(WhaleAccountSigner1.address);
      expect(WETHFinalBalance).to.be.gt(WETHInitialBalance);

      const USDCFinalBalance = await USDC.balanceOf(WhaleAccountSigner1.address);
      expect(USDCFinalBalance).to.be.lt(USDCInitialBalance);
    });
  });

  describe("SwapExactOutputSingle", () => {
    it("should revert if the user has not approved the contract to spend the 'from' token", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();
      const amountOut = ethers.utils.parseUnits("0.01", 18); // 0.01 WETH

      // User has not approved the contract to spend USDC
      await expect(
        uniV3Pool.connect(WhaleAccountSigner1).swapExactOutputSingle(USDC.address, WETH.address, amountOut, ethers.constants.MaxUint256)
      ).to.be.revertedWith("STF");
    });

    it("should swap tokens correctly when user has approved and has sufficient balance", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      // Store initial balances
      const initialUSDCBalance = await USDC.balanceOf(WhaleAccountSigner1.address);
      const initialWETHBalance = await WETH.balanceOf(WhaleAccountSigner1.address);

      const amountOut = ethers.utils.parseUnits("0.01", 18); // 0.01 WETH

      // User approves the contract to spend USDC
      const amountInMaximum = ethers.utils.parseUnits("200.0", 6); // 200 USDC
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amountInMaximum);

      // Perform the swap
      const swapTx = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .swapExactOutputSingle(USDC.address, WETH.address, amountOut, amountInMaximum);

      // Wait for the transaction to be mined and get the transaction receipt
      const receipt = await swapTx.wait();

      // Extract the `amountIn` from the transaction's event logs
      const swapEvent = receipt.events?.filter((x) => x.event === "Swap")[0];
      const amountIn = swapEvent?.args?.amountIn;

      // Check that the USDC balance has decreased and the WETH balance has increased
      const finalUSDCBalance = await USDC.balanceOf(WhaleAccountSigner1.address);
      const finalWETHBalance = await WETH.balanceOf(WhaleAccountSigner1.address);
      expect(finalUSDCBalance).to.be.lt(initialUSDCBalance);
      expect(finalWETHBalance).to.be.eq(initialWETHBalance.add(amountOut));

      // Check that the input amount is less than or equal to the maximum input amount
      expect(amountIn).to.be.lte(amountInMaximum);
    });

    it("should swap tokens correctly when user has approved and has sufficient balance", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      // Store initial balances
      const initialUSDCBalance = await USDC.balanceOf(WhaleAccountSigner1.address);
      const initialWETHBalance = await WETH.balanceOf(WhaleAccountSigner1.address);

      const amountOut = ethers.utils.parseUnits("0.01", 18); // 0.01 WETH

      // User approves the contract to spend USDC
      const amountInMaximum = ethers.utils.parseUnits("500.0", 6); // 500 USDC
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amountInMaximum);

      // Perform the swap
      const swapTx = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .swapExactOutputSingle(USDC.address, WETH.address, amountOut, amountInMaximum);

      // Extract the `amountIn` from the transaction's event logs
      const receipt = await swapTx.wait();
      const swapEvent = receipt.events?.filter((x) => x.event === "Swap")[0];
      const amountIn = swapEvent?.args?.amountIn;

      // Check that the USDC balance has decreased by `amountIn` and the WETH balance has increased by `amountOut`
      const finalUSDCBalance = await USDC.balanceOf(WhaleAccountSigner1.address);
      const finalWETHBalance = await WETH.balanceOf(WhaleAccountSigner1.address);
      expect(finalUSDCBalance).to.be.lt(initialUSDCBalance);
      expect(finalWETHBalance).to.be.eq(initialWETHBalance.add(amountOut));

      // Check that the input amount is less than or equal to the maximum input amount
      expect(amountIn).to.be.lte(amountInMaximum);
    });

    it("should return correct pool price", async function () {
      const { uniV3Pool } = await setup(true);

      const sqrtPriceX96 = await (uniV3Pool as TestUniV3Pool).getSqrtX96(); // Something like "1855239188930116622830310562177214"
      const Q96 = BigInt("2") ** BigInt("96"); // Scaling factor

      // Compute the price ratio
      const price_ratio_raw = sqrtPriceX96.mul(sqrtPriceX96);
      const price_ratio = price_ratio_raw.div(Q96);

      // const decimals_token0 = 6;
      // const decimals_token1 = 18;
      // const decimal_adjustment = 10 ** (decimals_token1 - decimals_token0);
      // const actual_price = price_ratio.div(BigNumber.from(decimal_adjustment));
      // console.log(`Actual price of token1 in terms of token0: ${actual_price}`);

      // Call the getPrice function
      const price = await uniV3Pool.getPrice();

      // Compare the returned price against a known value
      expect(price).to.be.eq(price_ratio);
    });

    it("should return correct precision", async function () {
      const { uniV3Pool } = await setup();

      // Call the getPrecision function
      const precision = await uniV3Pool.getPrecision();

      // Check that the returned precision is correct
      expect(precision).to.equal(BigNumber.from("1000000000000000000000000000000000000")); // 10^38
    });
  });

  describe("getTotalLiquidity", () => {
    it("should return 0 when there's no position", async () => {
      const { uniV3Pool } = await setup();
      const totalLiquidity = await uniV3Pool.getTotalLiquidity();
      expect(totalLiquidity).to.equal(0);
    });

    it("should return the correct liquidity when there is some", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();
      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const totalLiquidity = await uniV3Pool.getTotalLiquidity();
      expect(totalLiquidity).to.gt(0);
    });
  });

  describe("getTokenAmounts", () => {
    it("should return 0 amounts when there's no liquidity", async () => {
      const { uniV3Pool } = await setup();
      const tokenAmounts = await uniV3Pool.getTokenAmounts(false);
      expect(tokenAmounts[0]).to.equal(0);
      expect(tokenAmounts[1]).to.equal(0);

      const tokenAmountsWithFees = await uniV3Pool.getTokenAmounts(true);
      expect(tokenAmountsWithFees[0]).to.equal(0);
      expect(tokenAmountsWithFees[1]).to.equal(0);
    });

    it("should return the correct amounts when there's some liquidity", async () => {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();
      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      const expectedAmounts = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .callStatic.mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      // Assuming addLiquidity is a function in your contract to add liquidity
      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const tokenAmounts = await uniV3Pool.getTokenAmounts(false);
      const acceptableDifference = ethers.BigNumber.from("10");

      // The actual amounts might not be exactly equal to this,
      // as the price may have moved since we minted the position,
      // and these amounts are also rounded to the nearest integer.
      expect(tokenAmounts[0]).to.be.closeTo(expectedAmounts.amount0, acceptableDifference);
      expect(tokenAmounts[1]).to.be.closeTo(expectedAmounts.amount1, acceptableDifference);
    });
  });

  describe("getTokens", () => {
    it("should correctly returns the addresses of the two tokens", async function () {
      const { uniV3Pool, USDC, WETH } = await setup();
      const tokens = await uniV3Pool.getTokens();

      expect(tokens[0].toLowerCase()).to.eq(USDC.address.toLowerCase());
      expect(tokens[1].toLowerCase()).to.eq(WETH.address.toLowerCase());
    });
  });

  describe("mintNewPosition", () => {
    it("should revert when the position is already minted", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      // Position is already minted previously.
      expect(
        uniV3Pool.connect(WhaleAccountSigner1).mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address)
      ).to.be.revertedWith("Liquidity position already exists");
    });

    it("should revert when called by non-operator", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner2 } = await setup();

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner2).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner2).approve(uniV3Pool.address, amount1ToMint);

      await expect(
        uniV3Pool.connect(WhaleAccountSigner2).mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner2.address)
      ).to.be.reverted;
    });

    it("should correctly add liquidity when called by operator", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const liquidityBefore = await uniV3Pool.getTotalLiquidity();

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const liquidityAfter = await uniV3Pool.getTotalLiquidity();
      expect(liquidityAfter).to.be.gt(liquidityBefore);
    });

    it("should correctly mint a new position", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      expect(await uniV3Pool.getTokenId()).not.to.eq(BigNumber.from(0));
    });

    it("should correctly refund excess tokens", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const initialBalanceUSDC = await USDC.balanceOf(WhaleAccountSigner1.address);
      const initialBalanceWETH = await WETH.balanceOf(WhaleAccountSigner1.address);

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      const expectedAmounts = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .callStatic.mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      // Assuming addLiquidity is a function in your contract to add liquidity
      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const afterBalanceUSDC = await USDC.balanceOf(WhaleAccountSigner1.address);
      expect(afterBalanceUSDC).to.eq(initialBalanceUSDC.sub(expectedAmounts.amount0));

      const afterBalanceWETH = await WETH.balanceOf(WhaleAccountSigner1.address);
      expect(afterBalanceWETH).to.eq(initialBalanceWETH.sub(expectedAmounts.amount1));
    });
  });

  describe("increaseLiquidity", function () {
    it("should revert if the position is not yet minted", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const amount0Desired = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1Desired = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0Desired);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1Desired);

      // try to call increaseLiquidity without minting a position
      await expect(
        uniV3Pool.connect(WhaleAccountSigner1).increaseLiquidity(amount0Desired, amount1Desired, WhaleAccountSigner1.address)
      ).to.be.revertedWith("No liquidity position exists");
    });

    it("should revert if called by someone who isn't the operator", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const amount0Desired = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1Desired = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0Desired);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1Desired);

      // try to call increaseLiquidity from an account without the operator role
      expect(uniV3Pool.connect(WhaleAccountSigner1).increaseLiquidity(amount0Desired, amount1Desired, WhaleAccountSigner1.address)).to.be
        .reverted;
    });

    it("should correctly increase liquidity when conditions are met", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const amount0Desired = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1Desired = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0Desired.mul(2));
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1Desired.mul(2));

      // mint a position
      await uniV3Pool.mintNewPosition(amount0Desired, amount1Desired, -887220, 887220, WhaleAccountSigner1.address);

      const liquidityBefore = await uniV3Pool.getTotalLiquidity();
      // call increaseLiquidity
      await uniV3Pool.increaseLiquidity(amount0Desired, amount1Desired, WhaleAccountSigner1.address);

      const liquidityAfter = await uniV3Pool.getTotalLiquidity();
      expect(liquidityAfter).to.be.gt(liquidityBefore);
    });

    it("should transfer and approve the correct amount of tokens", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const amount0Desired = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1Desired = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0Desired.mul(2));
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1Desired.mul(2));

      // mint a position
      await uniV3Pool.mintNewPosition(amount0Desired, amount1Desired, -887220, 887220, WhaleAccountSigner1.address);

      // get initial balances
      const initialTokenAmounts = await uniV3Pool.getTokenAmounts(true);

      // call increaseLiquidity
      await uniV3Pool.increaseLiquidity(amount0Desired, amount1Desired, WhaleAccountSigner1.address);

      // check final balances
      const finalTokenAmounts = await uniV3Pool.getTokenAmounts(true);

      expect(finalTokenAmounts[0]).to.gt(initialTokenAmounts[0]);
      expect(finalTokenAmounts[1]).to.gt(initialTokenAmounts[1]);
    });

    it("should correctly refund excess tokens", async function () {
      const { uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup();

      const initialBalanceUSDC = await USDC.balanceOf(WhaleAccountSigner1.address);
      const initialBalanceWETH = await WETH.balanceOf(WhaleAccountSigner1.address);

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint.mul(2));
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint.mul(2));

      const expectedAmountsFromMint = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .callStatic.mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const afterBalanceUSDC = await USDC.balanceOf(WhaleAccountSigner1.address);
      expect(afterBalanceUSDC).to.eq(initialBalanceUSDC.sub(expectedAmountsFromMint.amount0));

      const afterBalanceWETH = await WETH.balanceOf(WhaleAccountSigner1.address);
      expect(afterBalanceWETH).to.eq(initialBalanceWETH.sub(expectedAmountsFromMint.amount1));

      const expectedAmountsFromIncrease = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .callStatic.increaseLiquidity(amount0ToMint, amount1ToMint, WhaleAccountSigner1.address);

      // Actual call for increase liquidity
      await uniV3Pool.connect(WhaleAccountSigner1).increaseLiquidity(amount0ToMint, amount1ToMint, WhaleAccountSigner1.address);

      const finalBalanceUSDC = await USDC.balanceOf(WhaleAccountSigner1.address);
      expect(finalBalanceUSDC).to.eq(initialBalanceUSDC.sub(expectedAmountsFromMint.amount0).sub(expectedAmountsFromIncrease.amount0));

      const finalBalanceWETH = await WETH.balanceOf(WhaleAccountSigner1.address);
      expect(finalBalanceWETH).to.eq(initialBalanceWETH.sub(expectedAmountsFromMint.amount1).sub(expectedAmountsFromIncrease.amount1));
    });
  });

  describe("decreaseLiquidity", function () {
    it("should revert if the position is not yet minted", async function () {
      const { uniV3Pool } = await setup();

      // try to call decreaseLiquidity without minting a position
      await expect(uniV3Pool.decreaseLiquidity(BigNumber.from(1), BigNumber.from(0), BigNumber.from(0))).to.be.revertedWith(
        "No liquidity position exists"
      );
    });

    it("should revert if called by someone who isn't the operator", async function () {
      const { uniV3Pool, WhaleAccountSigner1, WhaleAccountSigner2, USDC, WETH } = await setup();

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint.mul(2));
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint.mul(2));

      // mint a position
      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      // try to call decreaseLiquidity from an account without the operator role
      await expect(
        uniV3Pool.connect(WhaleAccountSigner2).decreaseLiquidity(BigNumber.from(BigNumber.from(1)), BigNumber.from(0), BigNumber.from(0))
      ).to.be.reverted;
    });

    it("should revert when there's no liquidity", async function () {
      const { uniV3Pool, WhaleAccountSigner1, USDC, WETH } = await setup();

      const amount0ToMint = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint.mul(2));
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint.mul(2));

      // mint a position
      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const totalLiquidity = await uniV3Pool.getTotalLiquidity();

      // decrease all liquidity
      await uniV3Pool.decreaseLiquidity(totalLiquidity, BigNumber.from(0), BigNumber.from(0));

      // try to decrease liquidity again
      await expect(uniV3Pool.decreaseLiquidity(BigNumber.from(totalLiquidity.div(2)), BigNumber.from(0), BigNumber.from(0))).to.be.reverted;
    });

    it("should correctly decrease liquidity when conditions are met", async function () {
      const { uniV3Pool, WhaleAccountSigner1, USDC, WETH } = await setup();

      const amount0ToMint = ethers.utils.parseUnits("1000.0", 6); // 1000 USDC
      const amount1ToMint = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0ToMint);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1ToMint);

      const expectedAmountsFromMint = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .callStatic.mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      // mint a position
      await uniV3Pool
        .connect(WhaleAccountSigner1)
        .mintNewPosition(amount0ToMint, amount1ToMint, -887220, 887220, WhaleAccountSigner1.address);

      const liquidityBefore = await uniV3Pool.getTotalLiquidity();

      // call decreaseLiquidity (halve the liquidity)
      await uniV3Pool.decreaseLiquidity(BigNumber.from(liquidityBefore.div(2)), BigNumber.from(0), BigNumber.from(0));

      const liquidityAfter = await uniV3Pool.getTotalLiquidity();

      const acceptableDifference = ethers.BigNumber.from("1");
      expect(liquidityAfter).to.be.closeTo(liquidityBefore.div(2), acceptableDifference);
    });
  });

  describe("collect", function () {
    it("should revert if called by someone who isn't the operator", async function () {
      const { uniV3Pool, WhaleAccountSigner2 } = await setup();

      const amount0Max = ethers.utils.parseUnits("100.0", 6); // 100 USDC
      const amount1Max = ethers.utils.parseUnits("0.1", 18); // 0.1 WETH

      // try to call collect from an account without the operator role
      await expect(uniV3Pool.connect(WhaleAccountSigner2).collect(WhaleAccountSigner2.address, amount0Max, amount1Max)).to.be.reverted;
    });

    it("should correctly collect fees when conditions are met", async function () {
      const { uniV3Pool, WhaleAccountSigner1, WhaleAccountSigner2, USDC, WETH } = await setup();

      // mint a position to generate fees
      const amount0Max = ethers.utils.parseUnits("1000.0", 6);
      const amount1Max = ethers.utils.parseUnits("1", 18);

      // User approves the contract to spend USDC and WETH
      await USDC.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount0Max);
      await WETH.connect(WhaleAccountSigner1).approve(uniV3Pool.address, amount1Max);

      await uniV3Pool.connect(WhaleAccountSigner1).mintNewPosition(amount0Max, amount1Max, -887220, 887220, WhaleAccountSigner1.address);

      const VAULT_ROLE = await uniV3Pool.VAULT_ROLE();
      await uniV3Pool.connect(WhaleAccountSigner1).grantRole(VAULT_ROLE, WhaleAccountSigner2.address);

      // assume whale2 swaps and generate fees
      const amountInUSDC = ethers.utils.parseUnits("10000.0", 6); // 10000 USDC
      const amountInWETH = ethers.utils.parseUnits("100.0", 18); // 100 WETH

      // User approves the contract to swap USDC
      await USDC.connect(WhaleAccountSigner2).approve(uniV3Pool.address, amountInUSDC);
      await uniV3Pool.connect(WhaleAccountSigner2).swapExactInputSingle(USDC.address, WETH.address, amountInUSDC);

      // User approves the contract to swap WETH
      await WETH.connect(WhaleAccountSigner2).approve(uniV3Pool.address, amountInWETH);
      await uniV3Pool.connect(WhaleAccountSigner2).swapExactInputSingle(WETH.address, USDC.address, amountInWETH);

      // call collect function
      const expectedCollectionAmounts = await uniV3Pool
        .connect(WhaleAccountSigner1)
        .callStatic.collect(WhaleAccountSigner1.address, amount0Max, amount1Max);

      await uniV3Pool.connect(WhaleAccountSigner1).collect(WhaleAccountSigner1.address, amount0Max, amount1Max);

      // check if the collected amounts are correct
      expect(expectedCollectionAmounts.amount0).to.gt(BigNumber.from(0));
      expect(expectedCollectionAmounts.amount1).to.gt(BigNumber.from(0));
    });
  });
});

// function GetPrice(PoolInfo){
//   let sqrtPriceX96 = PoolInfo.SqrtX96;
//   let Decimal0 = PoolInfo.Decimal0;
//   let Decimal1 = PoolInfo.Decimal1;

//   const buyOneOfToken0 = ((sqrtPriceX96 / 2**96)**2) / (10**Decimal1 / 10**Decimal0).toFixed(Decimal1);

//   const buyOneOfToken1 = (1 / buyOneOfToken0).toFixed(Decimal0);
//   console.log("price of token0 in value of token1 : " + buyOneOfToken0.toString());
//   console.log("price of token1 in value of token0 : " + buyOneOfToken1.toString());
//   console.log("");
//       // Convert to wei
//   const buyOneOfToken0Wei =(Math.floor(buyOneOfToken0 * (10**Decimal1))).toLocaleString('fullwide', {useGrouping:false});
//   const buyOneOfToken1Wei =(Math.floor(buyOneOfToken1 * (10**Decimal0))).toLocaleString('fullwide', {useGrouping:false});
//   console.log("price of token0 in value of token1 in lowest decimal : " + buyOneOfToken0Wei);
//   console.log("price of token1 in value of token1 in lowest decimal : " + buyOneOfToken1Wei);
//   console.log("");
// }
