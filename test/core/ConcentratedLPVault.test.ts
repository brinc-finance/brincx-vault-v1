import { expect } from "chai";
import { ethers } from "hardhat";
import { ConcentratedLPVault, ERC20, MockConcentratedLPVault, UniV3Pool } from "../../typechain";
import chainConfig from "./../../chain.config";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

describe("ConcentratedLPVault", () => {
  async function setup(useMock?: boolean) {
    const USDC = await ethers.getContractAt("ERC20", chainConfig.erc20.usdc.default);
    const WETH = await ethers.getContractAt("ERC20", chainConfig.erc20.weth.default);
    const DAI = await ethers.getContractAt("ERC20", chainConfig.erc20.dai.default);

    const WhaleAccountSigner1 = await ethers.getImpersonatedSigner(chainConfig.whales.ethereum.eth_usdc_1);
    const WhaleAccountSigner2 = await ethers.getImpersonatedSigner(chainConfig.whales.ethereum.eth_usdc_2);

    const WhaleAccountSigner3 = await ethers.getImpersonatedSigner(chainConfig.whales.ethereum.eth_dai_1);
    const { concentratedLPVault, uniV3Pool } = await deployConcentratedLPVaultFixture(WhaleAccountSigner1, useMock);

    return { concentratedLPVault, uniV3Pool, USDC, WETH, DAI, WhaleAccountSigner1, WhaleAccountSigner2, WhaleAccountSigner3 };
  }

  async function deployConcentratedLPVaultFixture(creator: SignerWithAddress, useMock?: boolean) {
    const uniV3PoolFactory = await ethers.getContractFactory("UniV3Pool");
    const routerAddress = chainConfig.router.uniswapv3.default;
    const poolAddress = chainConfig.pool.uniswapv3.ethereum.usdc_eth;
    const positionManagerAddress = chainConfig.positionManager.uniswapv3.default;
    const uniV3Pool = (await uniV3PoolFactory.connect(creator).deploy(routerAddress, poolAddress, positionManagerAddress)) as UniV3Pool;
    await uniV3Pool.deployed();

    const ConcentratedLPVaultFactory = await ethers.getContractFactory(useMock ? "MockConcentratedLPVault" : "ConcentratedLPVault");
    const concentratedLPVault = (await ConcentratedLPVaultFactory.connect(creator).deploy(
      chainConfig.erc20.usdc.default,
      uniV3Pool.address,
      100000,
      // current tick around 201708
      300000
    )) as ConcentratedLPVault | MockConcentratedLPVault;
    await concentratedLPVault.deployed();

    const VAULT_ROLE = await uniV3Pool.VAULT_ROLE();
    await uniV3Pool.connect(creator).grantRole(VAULT_ROLE, concentratedLPVault.address);

    return { concentratedLPVault, uniV3Pool };
  }

  async function deposit(vault: ConcentratedLPVault, tokenToDeposit: ERC20, amount: BigNumber, signer: SignerWithAddress) {
    await tokenToDeposit.connect(signer).approve(vault.address, amount);
    await vault.connect(signer).deposit(amount);
  }

  async function callstaticDeposit(vault: ConcentratedLPVault, tokenToDeposit: ERC20, amount: BigNumber, signer: SignerWithAddress) {
    await tokenToDeposit.connect(signer).approve(vault.address, amount);
    return await vault.connect(signer).callStatic.deposit(amount);
  }

  async function testProcessDeposit1(
    mock: MockConcentratedLPVault,
    uniV3Pool: UniV3Pool,
    whaleAccount: SignerWithAddress,
    depositAmount: BigNumber
  ) {
    const assets = await mock.connect(whaleAccount).callStatic.processDepositAmount(depositAmount);
    await mock.connect(whaleAccount).processDepositAmount(depositAmount);
    // asset = (0) amountAdded0, (1) amountAdded1, (2) liquidityAdded, (3) tvlBefore0, (4) tvlBefore1

    // Check amount of token added
    const tokens = await uniV3Pool.getTokenAmounts(false);
    const acceptableTokenDifference = ethers.BigNumber.from(10).toString();
    expect(assets[0]).to.closeTo(tokens[0], acceptableTokenDifference);
    expect(assets[1]).to.closeTo(tokens[1], acceptableTokenDifference);

    // TVL should be 0 since this is the first deposit.
    expect(assets[2]).to.equal(ethers.BigNumber.from(0));
    expect(assets[3]).to.equal(ethers.BigNumber.from(0));
  }

  async function testProcessDeposit2(
    mock: MockConcentratedLPVault,
    uniV3Pool: UniV3Pool,
    whaleAccount: SignerWithAddress,
    depositAmount: BigNumber
  ) {
    const acceptableToken0Difference = ethers.BigNumber.from(1e4).toString();
    const acceptableToken1Difference = ethers.BigNumber.from(1e13).toString();

    const tokensBeforeProcess = await uniV3Pool.getTokenAmounts(false);
    const assets2 = await mock.connect(whaleAccount).callStatic.processDepositAmount(depositAmount);
    // asset2 = (0) amountAdded0, (1) amountAdded1, (2) liquidityAdded, (3) tvlBefore0, (4) tvlBefore1

    const liquidityAddedBeforeProcess = await uniV3Pool.getTotalLiquidity();
    const tvlBeforeProcess = await mock.totalValueLocked();
    await mock.connect(whaleAccount).processDepositAmount(depositAmount);

    // Check amount of token added
    const tokensAfterProcess = await uniV3Pool.getTokenAmounts(false);
    expect(assets2[0]).to.closeTo(tokensAfterProcess[0].sub(tokensBeforeProcess[0]), acceptableToken0Difference);
    expect(assets2[1]).to.closeTo(tokensAfterProcess[1].sub(tokensBeforeProcess[1]), acceptableToken1Difference);

    // Check tvl
    expect(assets2[2]).to.closeTo(tvlBeforeProcess[0], acceptableToken0Difference);
    expect(assets2[3]).to.closeTo(tvlBeforeProcess[1], acceptableToken1Difference);
  }

  async function generateFees(
    vault: MockConcentratedLPVault,
    USDC: ERC20,
    WETH: ERC20,
    whaleAccount: SignerWithAddress,
    uniV3Pool: UniV3Pool
  ) {
    const numberOfSwaps = 5;
    const amountToSwap0 = ethers.utils.parseUnits("18000", 6);
    const amountToSwap1 = ethers.utils.parseUnits("10", 18);

    await USDC.connect(whaleAccount).transfer(vault.address, amountToSwap0.mul(numberOfSwaps));
    await WETH.connect(whaleAccount).transfer(vault.address, amountToSwap1.mul(numberOfSwaps));

    const tokens = await uniV3Pool.getTokens();
    for (let index = 0; index < numberOfSwaps; index++) {
      await vault.swapExactInputSingle(tokens[0], tokens[1], amountToSwap0);
      await vault.swapExactInputSingle(tokens[1], tokens[0], amountToSwap1);
    }
  }

  beforeEach(async () => {});

  describe("Deployment", () => {
    it("should deploy successfully", async () => {
      const { concentratedLPVault } = await setup();
      expect(concentratedLPVault.address).to.be.properAddress;
    });
  });

  describe("deposit", function () {
    it("should deposit token successfully and assign shares correctly - first deposit", async function () {
      const { concentratedLPVault, USDC, WhaleAccountSigner1 } = await setup();

      // Get initial shares
      const initialShares = await concentratedLPVault.balanceOf(WhaleAccountSigner1.address);

      const amountToDeposit = ethers.utils.parseUnits("1000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);

      // Check shares after deposit
      const finalShares = await concentratedLPVault.balanceOf(WhaleAccountSigner1.address);

      // Assert that shares have been assigned correctly
      const acceptableDifference = ethers.BigNumber.from((10 ** 6).toString());
      expect(finalShares.sub(initialShares)).to.closeTo(amountToDeposit, acceptableDifference);
    });

    it("should deposit token successfully and assign shares correctly - multiple cases", async function () {
      const { concentratedLPVault, USDC, WETH, uniV3Pool, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup(true);

      const amountToDeposit = ethers.utils.parseUnits("1000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);

      // Check shares after deposit for whale1
      const shares1 = await concentratedLPVault.balanceOf(WhaleAccountSigner1.address);

      const acceptableDifference = ethers.BigNumber.from((10 ** 6).toString());
      expect(shares1).to.closeTo(amountToDeposit, acceptableDifference);

      // Another deposits
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner2);

      // Check shares after deposit for whale2
      const shares2 = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);

      // Assert that shares have been assigned correctly
      expect(shares2).to.closeTo(shares1, acceptableDifference);

      // Another deposits
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner2);

      // Check shares after deposit for whale2
      const shares3 = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);

      // Assert that shares have been assigned correctly
      expect(shares3).to.closeTo(shares1.add(shares2), acceptableDifference);

      // Make some fees now
      const mock = concentratedLPVault as MockConcentratedLPVault;

      await generateFees(mock, USDC, WETH, WhaleAccountSigner1, uniV3Pool);

      const actualShares2 = await callstaticDeposit(mock, USDC, amountToDeposit, WhaleAccountSigner1); // Assume above share1 holder actually deposited to generate fees for the vault

      await deposit(mock, USDC, amountToDeposit, WhaleAccountSigner1); // Assume above share1 holder actually deposited to generate fees for the vault

      const actualShares3 = await callstaticDeposit(mock, USDC, amountToDeposit, WhaleAccountSigner1); // Assume above share1 holder actually deposited to generate fees for the vault

      expect(actualShares2).to.closeTo(actualShares3, acceptableDifference);
      expect(actualShares3).lessThan(shares1);
    });

    it("should revert if the deposit is 0", async function () {
      const { concentratedLPVault, WhaleAccountSigner1 } = await setup();

      // Deposit USDC into vault
      expect(concentratedLPVault.connect(WhaleAccountSigner1).deposit("0")).to.be.rejectedWith("INVALID_DEPOSIT_AMOUNT");
    });

    it("should revert if the deposit amount is greater than the balance of the user", async function () {
      const { concentratedLPVault, USDC, WhaleAccountSigner1 } = await setup();

      const balanceOfTheUser = await USDC.balanceOf(WhaleAccountSigner1.address);
      const deposit = balanceOfTheUser.add(1).toString();

      await USDC.connect(WhaleAccountSigner1).approve(concentratedLPVault.address, deposit);

      // Deposit USDC into vault
      expect(concentratedLPVault.connect(WhaleAccountSigner1).deposit(deposit)).to.be.rejectedWith("STF");
    });
  });

  describe("deposit (_processDepositAmount)", function () {
    it("should process correctly when deposit token is token0 of pair in uniswap pool - no prev deposits", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WhaleAccountSigner2 } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;

      const depositAmount = ethers.utils.parseUnits("1000", 6);
      await USDC.connect(WhaleAccountSigner2).approve(mock.address, depositAmount.mul(10));
      await USDC.connect(WhaleAccountSigner2).transfer(mock.address, depositAmount.mul(10));

      await testProcessDeposit1(mock, uniV3Pool, WhaleAccountSigner2, depositAmount);
    });

    it("should process correctly when deposit token is token0 of pair in uniswap pool - with deposits", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;

      const depositAmount = ethers.utils.parseUnits("1000", 6);

      await deposit(mock, USDC, depositAmount, WhaleAccountSigner1);
      await deposit(mock, USDC, depositAmount, WhaleAccountSigner1);
      await deposit(mock, USDC, depositAmount, WhaleAccountSigner2);

      await USDC.connect(WhaleAccountSigner2).approve(mock.address, depositAmount.mul(10));
      await USDC.connect(WhaleAccountSigner2).transfer(mock.address, depositAmount.mul(10));

      await testProcessDeposit2(mock, uniV3Pool, WhaleAccountSigner2, depositAmount);
    });

    it("should process correctly when deposit token is token1 of pair in uniswap pool - no prev deposits", async function () {
      const { concentratedLPVault, uniV3Pool, WETH, WhaleAccountSigner2 } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;

      // Set WETH as depositableToken
      await concentratedLPVault.setDepositableToken(WETH.address);
      const newDepositableToken = await concentratedLPVault.depositableToken();
      expect(newDepositableToken).to.equal(WETH.address);

      const depositAmount = ethers.utils.parseUnits("0.1", 18);
      await WETH.connect(WhaleAccountSigner2).approve(mock.address, depositAmount.mul(10));
      await WETH.connect(WhaleAccountSigner2).transfer(mock.address, depositAmount.mul(10));

      await testProcessDeposit1(mock, uniV3Pool, WhaleAccountSigner2, depositAmount);
    });

    it("should process correctly when deposit token is token1 of pair in uniswap pool - with deposits", async function () {
      const { concentratedLPVault, uniV3Pool, WETH, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;

      // Set WETH as depositableToken
      await concentratedLPVault.setDepositableToken(WETH.address);
      const newDepositableToken = await concentratedLPVault.depositableToken();
      expect(newDepositableToken).to.equal(WETH.address);

      const depositAmount = ethers.utils.parseUnits("0.1", 18);

      await deposit(mock, WETH, depositAmount, WhaleAccountSigner1);
      await deposit(mock, WETH, depositAmount, WhaleAccountSigner1);
      await deposit(mock, WETH, depositAmount, WhaleAccountSigner2);

      await WETH.connect(WhaleAccountSigner2).approve(mock.address, depositAmount.mul(10));
      await WETH.connect(WhaleAccountSigner2).transfer(mock.address, depositAmount.mul(10));

      await testProcessDeposit2(mock, uniV3Pool, WhaleAccountSigner2, depositAmount);
    });
  });

  describe("convertToShares", function () {
    it("should accurately convert amounts of liquidity to shares", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;

      expect(await mock.totalSupply()).to.equal(BigNumber.from("0"));

      const actualAmountDeposit = ethers.utils.parseUnits("1000", 6);
      const amount0 = ethers.utils.parseUnits("499.540869", 6);
      const amount1 = ethers.utils.parseUnits("0.274140101550375550", 18);

      const price = await uniV3Pool.getPrice();
      const Q96 = BigInt("2") ** BigInt("96"); // Scaling factor
      const contributionAmount0 = amount0.add(amount1.mul(Q96).div(price));

      // Calculate shares
      // assets = (0) amount0, (1) amount1, (2) tvl0, (3) tvl1
      const shares1 = await mock.convertToShares([amount0, amount1, BigNumber.from("0"), BigNumber.from("0")]);

      // shares caluclation must be equal to amount0 + amount1 when there is no supply (= first deposit)
      expect(shares1).to.equal(contributionAmount0);

      const actualShares1 = await callstaticDeposit(mock, USDC, actualAmountDeposit, WhaleAccountSigner1); // Assume above share1 holder actually deposited to generate fees for the vault
      const acceptableDifference1 = ethers.BigNumber.from(1e3).toString();
      expect(actualShares1).to.closeTo(shares1, acceptableDifference1);

      await deposit(mock, USDC, actualAmountDeposit, WhaleAccountSigner1); // Assume above share1 holder actually deposited to generate fees for the vault

      // assets = (0) amount0, (1) amount1, (2) tvl0, (3) tvl1
      const tvl = await mock.totalValueLocked();
      const shares2 = await mock.convertToShares([amount0, amount1, tvl[0], tvl[1]]);

      // calculate shares when there is previous deposit & fees
      const acceptableDifference2 = ethers.BigNumber.from(1e6).toString();
      expect(shares2).to.closeTo(contributionAmount0, acceptableDifference2);
    });

    it("should handle conversion with 0 liquidity", async function () {
      const { concentratedLPVault } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;
      const zero = BigNumber.from("0");

      // Calculate shares for 0 liquidity
      const shares = await mock.convertToShares([zero, zero, zero, zero]);

      // Expect the shares to be 0 when there's no liquidity
      expect(shares).to.equal(zero);
    });
  });

  describe("convertToAssets", function () {
    it("should accurately convert amounts of shares to liquidity (assets)", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WETH, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;

      const amountToDeposit = ethers.utils.parseUnits("1000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);
      const shares1 = await mock.totalSupply();
      const liqudity1 = await uniV3Pool.getTotalLiquidity();

      // Calculate assets
      // assets = liquidity, fee0, fee1
      const assets1 = await mock.convertToAssets(shares1);
      expect(assets1[0]).to.equal(liqudity1);
      expect(assets1[1]).to.equal(BigNumber.from("0"));
      expect(assets1[2]).to.equal(BigNumber.from("0"));

      // Make another deposit
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner2);

      const shares2 = (await mock.totalSupply()).sub(shares1);
      const liqudity2 = (await uniV3Pool.getTotalLiquidity()).sub(liqudity1);

      const assets2 = await mock.convertToAssets(shares2);
      const acceptableDifference = ethers.BigNumber.from(1e5).toString();
      expect(assets2[0]).to.closeTo(liqudity2, acceptableDifference);
      expect(assets2[1]).to.equal(BigNumber.from("0"));
      expect(assets2[2]).to.equal(BigNumber.from("0"));

      // Make some fee
      await generateFees(mock, USDC, WETH, WhaleAccountSigner1, uniV3Pool);

      const assets2_withFees = await mock.convertToAssets(shares2);
      expect(assets2_withFees[0]).to.closeTo(liqudity2, acceptableDifference);
      expect(assets2_withFees[1]).to.greaterThan(BigNumber.from("0"));
      expect(assets2_withFees[2]).to.greaterThan(BigNumber.from("0"));
    });

    it("should handle conversion with 0 shares", async function () {
      const { concentratedLPVault } = await setup(true); // Using mock.
      const mock = concentratedLPVault as MockConcentratedLPVault;
      const zero = BigNumber.from("0");

      // Calculate assets for 0 shares
      const assets = await mock.convertToAssets(zero);

      // Expect the shares to be 0 when there's no liquidity
      // assets = liquidity, fee0, fee1
      for (let index = 0; index < assets.length; index++) {
        expect(assets[index]).to.equal(zero);
      }
    });
  });

  describe("withdraw", function () {
    it("should withdraw tokens successfully and assign shares correctly - simple case (deposit token0)", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WETH, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup(true);
      const mock = concentratedLPVault as MockConcentratedLPVault;

      const initialUSDCBalance = await USDC.balanceOf(WhaleAccountSigner2.address);

      const amountToDeposit = ethers.utils.parseUnits("10000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner2);
      await generateFees(mock, USDC, WETH, WhaleAccountSigner1, uniV3Pool);
      const shares = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);

      // 0.1%
      const acceptableBalanceDifference_0_1 = amountToDeposit.mul(ethers.BigNumber.from("1")).div(ethers.BigNumber.from("1000"));

      // Perform withdrawal
      await concentratedLPVault.connect(WhaleAccountSigner2).withdraw(shares);
      const sharesLeft = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);
      expect(sharesLeft).to.equal(BigNumber.from("0"));

      const afterWithdrawUSDCBalance = await USDC.balanceOf(WhaleAccountSigner2.address);
      expect(afterWithdrawUSDCBalance).to.closeTo(initialUSDCBalance, acceptableBalanceDifference_0_1);
    });

    it("should withdraw tokens successfully and assign shares correctly - simple case (deposit token1)", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WETH, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup(true);
      const mock = concentratedLPVault as MockConcentratedLPVault;

      await concentratedLPVault.setDepositableToken(WETH.address);

      const initialUSDCBalance = await WETH.balanceOf(WhaleAccountSigner2.address);

      const amountToDeposit = ethers.utils.parseUnits("1", 18);
      await deposit(concentratedLPVault, WETH, amountToDeposit, WhaleAccountSigner2);
      await generateFees(mock, USDC, WETH, WhaleAccountSigner1, uniV3Pool);
      const shares = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);

      // 0.15%
      const acceptableBalanceDifference_0_15 = amountToDeposit.mul(ethers.BigNumber.from("15")).div(ethers.BigNumber.from("1000"));

      // Perform withdrawal
      await concentratedLPVault.connect(WhaleAccountSigner2).withdraw(shares);

      const afterWithdrawUSDCBalance = await WETH.balanceOf(WhaleAccountSigner2.address);
      expect(afterWithdrawUSDCBalance).to.closeTo(initialUSDCBalance, acceptableBalanceDifference_0_15);
    });

    it("should withdraw tokens successfully and correctly - multiple cases", async function () {
      const { concentratedLPVault, USDC, WETH, WhaleAccountSigner1, WhaleAccountSigner2 } = await setup();

      const USDCBalanceBeforeWhale1 = await USDC.balanceOf(WhaleAccountSigner1.address);

      const amountToDeposit = ethers.utils.parseUnits("10000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner2);

      const whale1Shares = await concentratedLPVault.balanceOf(WhaleAccountSigner1.address);
      const whale2Shares = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);

      const acceptableDifference = ethers.BigNumber.from(1e7).toString();

      const amount1 = await concentratedLPVault.connect(WhaleAccountSigner1).callStatic.withdraw(whale1Shares.div(2));
      expect(amount1).to.closeTo(amountToDeposit, acceptableDifference);
      await concentratedLPVault.connect(WhaleAccountSigner1).withdraw(whale1Shares.div(2));

      const amount2 = await concentratedLPVault.connect(WhaleAccountSigner2).callStatic.withdraw(whale2Shares);
      expect(amount2).to.closeTo(amountToDeposit, acceptableDifference);
      expect(amount2).to.closeTo(amount1, acceptableDifference);
      await concentratedLPVault.connect(WhaleAccountSigner2).withdraw(whale2Shares);

      const amount3 = await concentratedLPVault.connect(WhaleAccountSigner1).callStatic.withdraw(whale1Shares.div(2));
      expect(amount3).to.closeTo(amountToDeposit, acceptableDifference);
      expect(amount3).to.closeTo(amount1, acceptableDifference);
      await concentratedLPVault.connect(WhaleAccountSigner1).withdraw(whale1Shares.div(2));

      const tvl = await concentratedLPVault.totalValueLocked();
      expect(tvl[0]).to.equal(BigNumber.from("0"));
      expect(tvl[1]).to.equal(BigNumber.from("0"));

      // No shares should be left when withdrawn all
      const whale1Shares_after = await concentratedLPVault.balanceOf(WhaleAccountSigner1.address);
      const whale2Shares_after = await concentratedLPVault.balanceOf(WhaleAccountSigner2.address);
      expect(whale1Shares_after).to.equal(BigNumber.from("0"));
      expect(whale2Shares_after).to.equal(BigNumber.from("0"));

      // Vault should not have any leftovers
      const vaultToken0Left = await USDC.balanceOf(concentratedLPVault.address);
      const vaultToken1Left = await WETH.balanceOf(concentratedLPVault.address);
      expect(vaultToken0Left).to.equal(BigNumber.from("0"));
      expect(vaultToken1Left).to.equal(BigNumber.from("0"));

      // when deposit and withdraw immediately, the loss should be less then 0.1%
      const acceptableBalanceDifference_0_1 = USDCBalanceBeforeWhale1.mul(ethers.BigNumber.from("1")).div(ethers.BigNumber.from("1000"));
      const USDCBalanceAfterWhale1 = await USDC.balanceOf(WhaleAccountSigner1.address);
      expect(USDCBalanceBeforeWhale1).to.closeTo(USDCBalanceAfterWhale1, acceptableBalanceDifference_0_1);
    });

    it("should revert if the withdraw is 0", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup(true);
      const mock = concentratedLPVault as MockConcentratedLPVault;

      const amountToDeposit = ethers.utils.parseUnits("10000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);
      await generateFees(mock, USDC, WETH, WhaleAccountSigner1, uniV3Pool);

      // Perform withdrawal
      expect(concentratedLPVault.connect(WhaleAccountSigner1).withdraw(0)).to.be.revertedWith("ZERO_SHARES");
    });

    it("should revert if the withdraw amount is greater than the shares of the user", async function () {
      const { concentratedLPVault, uniV3Pool, USDC, WETH, WhaleAccountSigner1 } = await setup(true);
      const mock = concentratedLPVault as MockConcentratedLPVault;

      const amountToDeposit = ethers.utils.parseUnits("10000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);
      await generateFees(mock, USDC, WETH, WhaleAccountSigner1, uniV3Pool);
      const shares = await concentratedLPVault.balanceOf(WhaleAccountSigner1.address);

      // Perform withdrawal
      expect(concentratedLPVault.connect(WhaleAccountSigner1).withdraw(shares.add(BigNumber.from("1")))).to.be.reverted;
    });
  });

  describe("DepositableToken", function () {
    it("should only allow pair tokens to be depositable token", async function () {
      const { concentratedLPVault, USDC, WETH, DAI, WhaleAccountSigner1 } = await setup();

      expect(concentratedLPVault.setDepositableToken(USDC.address)).not.to.be.rejected;
      expect(concentratedLPVault.setDepositableToken(WETH.address)).not.to.be.rejected;
      expect(concentratedLPVault.setDepositableToken(DAI.address)).to.be.rejectedWith("Only pair tokens");
    });
  });

  describe("rebalance", function () {
    it("should call the function only right role", async () => {
      const { concentratedLPVault, uniV3Pool, WhaleAccountSigner1, WhaleAccountSigner2} = await setup();
      const VAULT_ROLE = await uniV3Pool.VAULT_ROLE();

      await concentratedLPVault.connect(WhaleAccountSigner1).hasRole(VAULT_ROLE, WhaleAccountSigner1.address);
      
      await concentratedLPVault.grantRole(VAULT_ROLE, WhaleAccountSigner2.address);

      expect(concentratedLPVault.connect(WhaleAccountSigner1).rebalance()).to.be.rejectedWith("INVALID_ACCOUNT");
      expect(concentratedLPVault.connect(WhaleAccountSigner2).rebalance()).to.emit(concentratedLPVault, "rebalance");
    });

    it("should change the _tokenId to the zero address", async () => {
      const { uniV3Pool, WhaleAccountSigner1} = await setup();
      const VAULT_ROLE = await uniV3Pool.VAULT_ROLE();

      await uniV3Pool.grantRole(VAULT_ROLE, WhaleAccountSigner1.address);

      uniV3Pool.connect(WhaleAccountSigner1).resetPosition();
      const test2 = await uniV3Pool.getTokenId();

      expect(await uniV3Pool.getTokenId()).to.eq(BigNumber.from(0));
    });

    it("should burns the token only if there is no liquidity", async () => {
      const { concentratedLPVault, uniV3Pool, WhaleAccountSigner1, USDC} = await setup();
      const VAULT_ROLE = await uniV3Pool.VAULT_ROLE();

      await uniV3Pool.grantRole(VAULT_ROLE, WhaleAccountSigner1.address);

      const amountToDeposit = ethers.utils.parseUnits("1000", 6);
      await deposit(concentratedLPVault, USDC, amountToDeposit, WhaleAccountSigner1);

      expect(uniV3Pool.connect(WhaleAccountSigner1).resetPosition()).to.be.reverted;
    });

    it("should reverts when there is no position yet", async () => {
      const { concentratedLPVault, uniV3Pool, WhaleAccountSigner1} = await setup();
      const VAULT_ROLE = await uniV3Pool.VAULT_ROLE();

      await uniV3Pool.grantRole(VAULT_ROLE, WhaleAccountSigner1.address);
      await uniV3Pool.getTokenId();

      expect(concentratedLPVault.connect(WhaleAccountSigner1).rebalance()).to.be.reverted;
    });
  })
});
