import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { MockTokenizedVault, MintableERC20 } from "../../typechain";
import { mintWithAllowance } from "../library/TokenHelpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { mock } from "../../typechain/contracts";

describe("TokenizedVault", () => {
  async function setup() {
    const { mockedTokenizedVault, depositToken } = await deployTokenizedVaultFixture();
    return { mockedTokenizedVault, depositToken };
  }

  async function deployTokenizedVaultFixture() {
    const MintableERC20Factory = await ethers.getContractFactory("MintableERC20");
    const depositToken = (await MintableERC20Factory.deploy("DepositToken", "DT")) as MintableERC20;
    await depositToken.deployed();

    const MockTokenizedVaultFactory = await ethers.getContractFactory("MockTokenizedVault");
    const mockedTokenizedVault = (await MockTokenizedVaultFactory.deploy(depositToken.address)) as MockTokenizedVault;
    await mockedTokenizedVault.deployed();

    return { mockedTokenizedVault, depositToken };
  }

  const deposit = async (vault: MockTokenizedVault, depositor: SignerWithAddress, depositToken: MintableERC20, depositAmount: string) => {
    const totalSupply = await vault.totalSupply();
    const tvl = await vault.totalValueLocked();

    const decimals = await depositToken.decimals();
    await mintWithAllowance(vault, depositToken, depositAmount, depositor);
    await vault.connect(depositor).deposit(ethers.utils.parseUnits(depositAmount, decimals));

    const shares = await vault.balanceOf(depositor.address);

    let expectedShares = ethers.utils.parseUnits(depositAmount, decimals);
    if (!tvl[0].eq(BigNumber.from(0))) expectedShares = expectedShares.mul(totalSupply).div(tvl[0]);

    expect(shares).to.be.eq(expectedShares);

    return shares;
  };

  const checkBalances = async (
    vault: MockTokenizedVault,
    depositToken: MintableERC20,
    depositor: SignerWithAddress,
    expectedVaultBalance: BigNumber,
    expectedWalletBalance: BigNumber
  ): Promise<void> => {
    const finalVaultTokenBalance = await vault.totalSupply();
    const finalDepositorTokenBalance = await depositToken.balanceOf(depositor.address);

    expect(finalVaultTokenBalance).to.eq(expectedVaultBalance);
    expect(finalDepositorTokenBalance).to.eq(expectedWalletBalance);
  };

  beforeEach(async () => {});

  describe("Deployment", () => {
    it("should deploy successfully", async () => {
      const { mockedTokenizedVault } = await setup();
      expect(mockedTokenizedVault.address).to.be.properAddress;
    });
  });

  describe("Deposit", () => {
    it("should success to deposit and get correct shares", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1, wallet2, wallet3, wallet4] = await ethers.getSigners();

      const wallets = [wallet1, wallet2, wallet3, wallet4];
      const deposits = ["1000", "1000", "450", "495"];
      const expectedShares = ["1000", "500", "150", "1650"];
      const decimals = await depositToken.decimals();

      // User A deposits 1000 tokens
      const shares1 = await deposit(mockedTokenizedVault, wallet1, depositToken, deposits[0]);
      expect(shares1).to.equal(ethers.utils.parseUnits(expectedShares[0], decimals));
      await checkBalances(
        mockedTokenizedVault,
        depositToken,
        wallets[0],
        shares1, // Vault should have 1000 shares
        ethers.utils.parseUnits("0", decimals) // 0 in the wallet
      );

      // NAV doubles, User B deposits 1000 tokens
      let currentNAV = parseInt(deposits[0]) * 2;
      await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits(currentNAV.toString(), decimals));

      const shares2 = await deposit(mockedTokenizedVault, wallet2, depositToken, deposits[1]);
      expect(shares2).to.equal(ethers.utils.parseUnits(expectedShares[1], decimals));
      await checkBalances(
        mockedTokenizedVault,
        depositToken,
        wallets[1],
        shares1.add(shares2), // Vault should have 2000 shares
        ethers.utils.parseUnits("0", decimals) // 0 in the wallet
      );

      // NAV increases by 50%, User C deposits 450 tokens
      currentNAV = (currentNAV + parseInt(deposits[1])) * 1.5;
      await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits(currentNAV.toString(), decimals));

      const shares3 = await deposit(mockedTokenizedVault, wallet3, depositToken, deposits[2]);
      expect(shares3).to.equal(ethers.utils.parseUnits(expectedShares[2], decimals));
      await checkBalances(
        mockedTokenizedVault,
        depositToken,
        wallets[2],
        shares1.add(shares2).add(shares3), // Vault should have 3000 shares
        ethers.utils.parseUnits("0", decimals) // 0 in the wallet
      );

      // NAV decreases by 90%, User D deposits 495 tokens
      currentNAV = (currentNAV + parseInt(deposits[2])) * 0.1;
      await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits(currentNAV.toString(), decimals));

      const shares4 = await deposit(mockedTokenizedVault, wallet4, depositToken, deposits[3]);
      expect(shares4).to.equal(ethers.utils.parseUnits(expectedShares[3], decimals));
      await checkBalances(
        mockedTokenizedVault,
        depositToken,
        wallets[3],
        shares1.add(shares2).add(shares3).add(shares4), // Vault should have 3500 shares
        ethers.utils.parseUnits("0", decimals) // 0 in the wallet
      );
    });

    it("should fail to deposit less than the minimum allowed amount", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1] = await ethers.getSigners();

      const amountToDeposit = "0.9"; // Just below the default minimum deposit
      await mintWithAllowance(mockedTokenizedVault, depositToken, amountToDeposit, wallet1);

      const decimals = await depositToken.decimals();
      await expect(mockedTokenizedVault.connect(wallet1).deposit(ethers.utils.parseUnits(amountToDeposit, decimals))).to.be.revertedWith(
        "INVALID_DEPOSIT_AMOUNT"
      );
    });

    it("should fail to deposit more than the maximum allowed amount", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1] = await ethers.getSigners();

      const decimals = await depositToken.decimals();
      await mockedTokenizedVault.setMaximumDeposit(ethers.utils.parseUnits("1000000000000", decimals));
      const maxDeposit = await mockedTokenizedVault.maxDeposit();

      const amountToDeposit = maxDeposit.add(1).toString(); // Exceeding the max deposit by 1
      await mintWithAllowance(mockedTokenizedVault, depositToken, amountToDeposit, wallet1);

      await expect(mockedTokenizedVault.connect(wallet1).deposit(ethers.utils.parseUnits(amountToDeposit, decimals))).to.be.revertedWith(
        "INVALID_DEPOSIT_AMOUNT"
      );
    });
  });

  describe("Withdraw", () => {
    it("should withdraw correct amount of shares", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1, wallet2, wallet3, wallet4] = await ethers.getSigners();

      // User deposits
      const deposits = [1000, 2000, 3000, 4000];
      const users = [wallet1, wallet2, wallet3, wallet4];

      // Users withdraw 50% of their shares
      for (let i = 0; i < users.length; i++) {
        const shares = await deposit(mockedTokenizedVault, users[i], depositToken, deposits[i].toString());
        expect(shares).to.equal(ethers.utils.parseUnits(deposits[i].toString(), 18));

        await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits(deposits[i].toString(), 18));

        const withdrawShares = shares.div(2);
        await mockedTokenizedVault.connect(users[i]).withdraw(withdrawShares);

        // Check if the new share balance is correct
        const newShares = await mockedTokenizedVault.balanceOf(users[i].address);
        expect(newShares).to.equal(shares.sub(withdrawShares));

        // Check if the tokens returned are correct (assuming constant NAV)
        const tokenBalance = await depositToken.balanceOf(users[i].address);
        const expectedTokenBalance = deposits[i] / 2;
        expect(tokenBalance).to.be.eq(ethers.utils.parseUnits(expectedTokenBalance.toString(), 18));

        // Burn all shares to reset total shares
        await mockedTokenizedVault.connect(users[i]).BurnShares();
        await mockedTokenizedVault.setMockTotalValueLocked(0);
      }
    });

    it("should revert if the user tries to withdraw more shares than they have", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1] = await ethers.getSigners();

      const amountToDeposit = "1000";
      const decimals = await depositToken.decimals();
      await mintWithAllowance(mockedTokenizedVault, depositToken, amountToDeposit, wallet1);

      await mockedTokenizedVault.connect(wallet1).deposit(BigNumber.from(10).pow(decimals).mul(amountToDeposit));

      await expect(mockedTokenizedVault.connect(wallet1).withdraw(ethers.utils.parseUnits("1001", decimals))).to.be.revertedWith(
        "INSUFFICIENT_SHARES"
      );
    });
  });

  describe("Conversion Functions", () => {
    it("should convert depositAmount to shares correctly", async () => {
      const { mockedTokenizedVault } = await setup();

      const tvls = ["1000", "5000", "7350", "11212110", "10000", "7500", "11000"];
      const totalShares = ["10000", "20000", "14700", "22424220", "20000", "15000", "22000"];
      const deposits = ["1000", "2500", "735", "1121211", "1234.56", "987.65", "456.78"];
      const expectedShares = ["10000", "10000", "1470", "2242422", "2469.12", "1975.3", "913.56"];

      for (let index = 0; index < tvls.length; index++) {
        await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits(tvls[index], 18));
        await mockedTokenizedVault.BurnShares();
        await mockedTokenizedVault.MintShares(ethers.utils.parseUnits(totalShares[index], 18));
        const shares = await mockedTokenizedVault.convertToShares([ethers.utils.parseUnits(deposits[index], 18)]);
        expect(shares).to.equal(ethers.utils.parseUnits(expectedShares[index], 18));
      }
    });

    it("should convert shares to withdrawAmount correctly", async () => {
      const { mockedTokenizedVault } = await setup();

      const tvls = ["1000", "5000", "2000", "1500", "2500", "7350", "11212110", "10000", "7500", "11000"];
      const totalShares = ["10000", "20000", "8000", "7500", "5000", "14700", "22424220", "20000", "15000", "22000"];
      const sharesToWithdraw = ["5000", "5000", "2000", "750", "500", "735", "1121211", "1234.56", "987.65", "456.78"];
      const expectedWithdrawAmounts = ["500", "1250", "500", "150", "250", "367.5", "560605.5", "617.28", "493.825", "228.39"];

      for (let index = 0; index < tvls.length; index++) {
        await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits(tvls[index], 18));
        await mockedTokenizedVault.BurnShares();
        await mockedTokenizedVault.MintShares(ethers.utils.parseUnits(totalShares[index], 18));
        const withdrawAmount = await mockedTokenizedVault.convertToAssets(ethers.utils.parseUnits(sharesToWithdraw[index], 18));
        expect(withdrawAmount[0]).to.equal(ethers.utils.parseUnits(expectedWithdrawAmounts[index], 18));
      }
    });
  });

  describe("Events", () => {
    it("should emit Deposit event when depositing tokens", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1] = await ethers.getSigners();

      const amountToDeposit = "1000";
      const decimals = await depositToken.decimals();
      await mintWithAllowance(mockedTokenizedVault, depositToken, amountToDeposit, wallet1);

      const sharesBeforeDeposit = await mockedTokenizedVault.totalSupply();

      await expect(mockedTokenizedVault.connect(wallet1).deposit(BigNumber.from(10).pow(decimals).mul(amountToDeposit)))
        .to.emit(mockedTokenizedVault, "Deposit")
        .withArgs(
          wallet1.address,
          ethers.utils.parseUnits(amountToDeposit, decimals),
          sharesBeforeDeposit.add(ethers.utils.parseUnits(amountToDeposit, decimals))
        );
    });

    it("should emit Withdraw event when withdrawing tokens", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [_, wallet1] = await ethers.getSigners();

      await deposit(mockedTokenizedVault, wallet1, depositToken, "1");
      await mockedTokenizedVault.setMockTotalValueLocked(ethers.utils.parseUnits("1", 18));

      await expect(mockedTokenizedVault.connect(wallet1).withdraw(ethers.utils.parseUnits("1", 18)))
        .to.emit(mockedTokenizedVault, "Withdraw")
        .withArgs(wallet1.address, ethers.utils.parseUnits("1", 18), ethers.utils.parseUnits("1", 18));
    });
  });

  describe("Admin functions", () => {
    it("should set minimum deposit correctly", async () => {
      const { mockedTokenizedVault } = await setup();
      const [admin] = await ethers.getSigners();

      const newMinimum = ethers.utils.parseUnits("100", 18);
      await mockedTokenizedVault.connect(admin).setMinimumDeposit(newMinimum);

      const minimumDeposit = await mockedTokenizedVault.minDeposit();
      expect(minimumDeposit).to.be.eq(newMinimum);
    });

    it("should set maximum deposit correctly", async () => {
      const { mockedTokenizedVault } = await setup();
      const [admin] = await ethers.getSigners();

      const newMaximum = ethers.utils.parseUnits("1000000000", 18);
      await mockedTokenizedVault.connect(admin).setMaximumDeposit(newMaximum);

      const maximumDeposit = await mockedTokenizedVault.maxDeposit();
      expect(maximumDeposit).to.be.eq(newMaximum);
    });

    it("should pause and unpause the vault correctly", async () => {
      const { mockedTokenizedVault } = await setup();
      const [admin] = await ethers.getSigners();

      await mockedTokenizedVault.connect(admin).pauseVault();
      expect(await mockedTokenizedVault.paused()).to.be.true;

      await mockedTokenizedVault.connect(admin).unpauseVault();
      expect(await mockedTokenizedVault.paused()).to.be.false;
    });

    it("should fail to deposit when the vault is paused", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [admin, wallet1] = await ethers.getSigners();

      await mockedTokenizedVault.connect(admin).pauseVault();

      const amountToDeposit = "1000";
      const decimals = await depositToken.decimals();
      await mintWithAllowance(mockedTokenizedVault, depositToken, amountToDeposit, wallet1);

      await expect(mockedTokenizedVault.connect(wallet1).deposit(BigNumber.from(10).pow(decimals).mul(amountToDeposit))).to.be.revertedWith(
        "Pausable: paused"
      );
    });

    it("should fail to withdraw when the vault is paused", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [admin, wallet1] = await ethers.getSigners();

      const amountToDeposit = "1000";
      const decimals = await depositToken.decimals();
      await mintWithAllowance(mockedTokenizedVault, depositToken, amountToDeposit, wallet1);

      await mockedTokenizedVault.connect(wallet1).deposit(BigNumber.from(10).pow(decimals).mul(amountToDeposit));

      await mockedTokenizedVault.connect(admin).pauseVault();

      await expect(mockedTokenizedVault.connect(wallet1).withdraw(BigNumber.from(10).pow(18).mul(500))).to.be.revertedWith(
        "Pausable: paused"
      );
    });

    it("should set depositableToken correctly", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [admin] = await ethers.getSigners();

      const MintableERC20Factory = await ethers.getContractFactory("MintableERC20");
      const depositToken2 = (await MintableERC20Factory.deploy("DepositToken2", "DT2")) as MintableERC20;
      await depositToken.deployed();

      await mockedTokenizedVault.connect(admin).setDepositableToken(depositToken2.address);
      const newDepositableToken = await mockedTokenizedVault.depositableToken();
      expect(newDepositableToken).to.equal(depositToken2.address);
    });

    it("should not be allowed to set depositableToken for non-admin role", async () => {
      const { mockedTokenizedVault, depositToken } = await setup();
      const [wallet1] = await ethers.getSigners();

      const MintableERC20Factory = await ethers.getContractFactory("MintableERC20");
      const depositToken2 = (await MintableERC20Factory.deploy("DepositToken2", "DT2")) as MintableERC20;
      await depositToken.deployed();

      expect(mockedTokenizedVault.connect(wallet1).setDepositableToken(depositToken2.address)).to.be.rejected;
    });
  });
});
