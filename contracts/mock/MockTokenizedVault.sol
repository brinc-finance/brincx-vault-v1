// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "../core/vaults/TokenizedVault.sol";

contract MockTokenizedVault is TokenizedVault {
    uint256 public mockTotalValueLocked;

    constructor(address _depostiableToken) TokenizedVault(_depostiableToken) {}

    function setMockTotalValueLocked(uint256 _mockTotalValueLocked) external {
        mockTotalValueLocked = _mockTotalValueLocked;
    }

    function totalValueLocked() public view override returns (uint256[] memory amounts) {
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = mockTotalValueLocked;
        return tokens;
    }

    function BurnShares() external {
        _burn(msg.sender, balanceOf(msg.sender));
    }

    function MintShares(uint256 shares) external {
        _mint(msg.sender, shares);
    }

    function convertToShares(uint256[] memory assets) external view virtual returns (uint256) {
        return _convertToShares(assets);
    }

    function convertToAssets(uint256 shares) external view virtual returns (uint256[] memory assets) {
        return _convertToAssets(shares);
    }
}
