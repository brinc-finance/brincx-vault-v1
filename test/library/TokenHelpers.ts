import { ethers } from "hardhat";
import { TokenizedVault, MintableERC20 } from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export async function mintWithAllowance(vault: TokenizedVault, token: MintableERC20, amountToMint: string, to: SignerWithAddress) {
  const decimals = await token.decimals();
  const amountToMintBigNumber = ethers.utils.parseUnits(amountToMint, decimals);

  await token.mint(to.address, amountToMintBigNumber);
  await token.connect(to).approve(vault.address, amountToMintBigNumber);
}
