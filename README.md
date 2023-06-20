# BrincX Vault Contracts

A DeFi project that provides **highest real yields**

## Overview

TokenizedVault is a DeFi platform that allows users to deposit and withdraw assets, while providing liquidity and investment opportunities. The platform supports multiple assets and includes various components such as price feeds and swap pool handlers for efficient management.

## Components

### 1. TokenizedVault

A smart contract that handles user deposits and withdrawals of assets, as well as the minting and burning of corresponding shares. The TokenizedVault keeps track of the total value locked (TVL) and the total shares for each supported asset.

### 2. MultiAssetVault

An extension of the TokenizedVault that enables support for multiple assets. Users can deposit and withdraw various assets, and the MultiAssetVault automatically manages the conversion and distribution of shares.

### 3. PriceFeedConsumer

A component that interacts with external price feeds (e.g., Chainlink) to obtain accurate and up-to-date price information for supported assets. The PriceFeedConsumer is essential for calculating the correct amounts of assets and shares during deposits and withdrawals.

### 4. DEXPoolHandler

A utility that interacts with external liquidity pools (e.g., Uniswap, SushiSwap) to facilitate the swapping of assets. The DEXPoolHandler is crucial for converting user deposits into the desired assets and enabling the MultiAssetVault to manage multiple assets efficiently.

## Installation

### Pre-requisite

Ask `chain.config.ts` to admins.

1. Clone the repository:

```
git clone https://github.com/fysoul17/vault-contracts.git
```

2. Change the directory to the project folder:

```
cd vault-contracts
```

3. Install dependencies:

```
yarn install
```

## Testing

To run tests for the smart contracts, use the following command:

```
npx hardhat test
```

## Deployment

```
npx thirdweb deploy
```

**SwapRouter**: `0xE592427A0AEce92De3Edee1F18E0157C05861564`  
**PositionManager**: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`

**Pool(ARB/USDC 0.05%)**: `0x`  
**UniV3Pool**: `0x`  
**ConcentratedLPVault**: `0x`

## License

This project is licensed under the GNU General Public License v2.0 or later.
