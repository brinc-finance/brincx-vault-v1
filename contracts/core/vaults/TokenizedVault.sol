// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {FixedPointMathLib} from "../../utils/FixedPointMathLib.sol";

import "./interfaces/ITokenizedVault.sol";

import "hardhat/console.sol";

abstract contract TokenizedVault is
    ITokenizedVault,
    ERC20,
    AccessControl,
    Pausable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;
    using FixedPointMathLib for uint256;

    event Deposit(address indexed caller, uint256 amount, uint256 shares);
    event Withdraw(address indexed caller, uint256 shares, uint256 amount);

    IERC20 public depositableToken;
    uint256 public minimumDeposit;
    uint256 public maximumDeposit;

    // =============================================================
    //                        Modifiers
    // =============================================================
    modifier whenNoActiveDeposits() {
        require(totalSupply() == 0, "Active deposits exist");
        _;
    }

    // =============================================================
    //                        Initialize
    // =============================================================
    constructor(address _depostiableToken) ERC20("TokenizedVault", "TKNV") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        depositableToken = IERC20(_depostiableToken);

        // Set the default values for minimum and maximum deposits in the constructor
        uint8 decimals = ERC20(_depostiableToken).decimals();
        setMinimumDeposit(10**decimals); // Default: 1 token
        setMaximumDeposit(type(uint256).max); // Default: uint256 max
    }

    // =============================================================
    //                 Manager Functions
    // =============================================================
    function pauseVault() public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpauseVault() public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setDepositableToken(address _depositableToken)
        external
        virtual
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNoActiveDeposits
    {
        depositableToken = IERC20(_depositableToken);
    }

    // =============================================================
    //                 External Functions
    // =============================================================
    function deposit(uint256 depositAmount)
        external
        virtual
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        require(depositAmount >= minDeposit() && depositAmount <= maxDeposit(), "INVALID_DEPOSIT_AMOUNT");

        depositableToken.safeTransferFrom(msg.sender, address(this), depositAmount);

        require((shares = _convertToShares(_processDepositAmount(depositAmount))) != 0, "ZERO_SHARES");

        _mint(msg.sender, shares);

        emit Deposit(msg.sender, depositAmount, shares);
    }

    function withdraw(uint256 shares)
        external
        virtual
        whenNotPaused
        nonReentrant
        returns (uint256 amounts)
    {
        require(shares != 0, "ZERO_SHARES");
        require(balanceOf(msg.sender) >= shares, "INSUFFICIENT_SHARES");

        amounts = _processWithdrawAmount(_convertToAssets(shares));
        
        _burn(msg.sender, shares);

        emit Withdraw(msg.sender, shares, amounts);

        depositableToken.safeTransfer(msg.sender, amounts);
    }

    // =============================================================
    //                  Accounting Logic
    // =============================================================
    function totalValueLocked()
        public
        view
        virtual
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](1);
        amounts[0] = depositableToken.balanceOf(address(this));
    }

    function _convertToShares(uint256[] memory assets)
        internal
        view
        virtual
        returns (uint256)
    {
        require(address(depositableToken) != address(0), "depositableToken not set");

        uint256 totalShares = totalSupply();
        if (totalShares == 0) return assets[0];

        uint256[] memory tvl = totalValueLocked();
        require(tvl.length == 1, "TVL must return 1");

        return assets[0].mulDivDown(totalShares, tvl[0]);
    }

    function _convertToAssets(uint256 shares)
        internal
        view
        virtual
        returns (uint256[] memory assets)
    {
        require(shares != 0, "ZERO_SHARES");
        require(address(depositableToken) != address(0), "depositableToken not set");

        assets = new uint256[](1);

        uint256[] memory tvl = totalValueLocked();
        require(tvl.length == 1, "TVL must return 1");

        uint256 totalShares = totalSupply();
        assets[0] = totalShares <= shares ? tvl[0] : shares.mulDivDown(tvl[0], totalShares);
    }

    // =============================================================
    //               DEPOSIT/WITHDRAWAL LIMIT LOGIC
    // =============================================================
    function setMinimumDeposit(uint256 newMinimum)
        public
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        minimumDeposit = newMinimum;
    }

    function setMaximumDeposit(uint256 newMaximum)
        public
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        maximumDeposit = newMaximum;
    }

    function maxDeposit() public view virtual returns (uint256) {
        return maximumDeposit;
    }

    function minDeposit() public view virtual returns (uint256) {
        return minimumDeposit;
    }

    // =============================================================
    //                    INTERNAL HOOKS LOGIC
    // =============================================================
    function _processDepositAmount(uint256 depositAmount)
        internal
        virtual
        returns (uint256[] memory assets) 
    {
        assets = new uint256[](1);
        assets[0] = depositAmount;
    }

    function _processWithdrawAmount(uint256[] memory assets)
        internal
        virtual
        returns (uint256)
    {
        return assets[0];
    }
}
