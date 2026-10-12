// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock of a Uniswap V3 USDC/USDG pool for demo purposes.
/// @dev Admin can set the price to simulate a depeg. Swaps execute at that price.
///      Watchers read `quote()` to detect the signal.
contract MockUSDGPool {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdg;
    IERC20 public immutable usdc;
    address public immutable owner;

    /// @notice How many USDC units (1e6) per 1 USDG (1e6). Par = 1_000_000.
    uint256 public priceUsdcPerUsdgE6;

    /// @notice Depth in USDG, used to compute opportunity capacity.
    uint256 public depthUsdg;

    event PriceSet(uint256 usdcPerUsdgE6);
    event DepthSet(uint256 depthUsdg);
    event Swapped(address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    error NotOwner();
    error RateNotSet();

    constructor(address usdg_, address usdc_, uint256 initialPriceE6, uint256 depth_) {
        usdg = IERC20(usdg_);
        usdc = IERC20(usdc_);
        owner = msg.sender;
        priceUsdcPerUsdgE6 = initialPriceE6;
        depthUsdg = depth_;
    }

    /// @notice Simulate a depeg. `usdcPerUsdgE6 = 1_003_000` means USDC is 30bps cheap.
    function setPrice(uint256 usdcPerUsdgE6) external {
        if (msg.sender != owner) revert NotOwner();
        priceUsdcPerUsdgE6 = usdcPerUsdgE6;
        emit PriceSet(usdcPerUsdgE6);
    }

    function setDepth(uint256 depthUsdg_) external {
        if (msg.sender != owner) revert NotOwner();
        depthUsdg = depthUsdg_;
        emit DepthSet(depthUsdg_);
    }

    /// @notice Read-only quote the watcher polls.
    function quote() external view returns (uint256 usdcPerUsdgE6, uint256 depth) {
        return (priceUsdcPerUsdgE6, depthUsdg);
    }

    /// @notice Swap at the current price. Direction inferred from tokenIn.
    function swap(address tokenIn, uint256 amountIn, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (priceUsdcPerUsdgE6 == 0) revert RateNotSet();

        if (tokenIn == address(usdg)) {
            // USDG → USDC: amountOut = amountIn * price / 1e6
            amountOut = (amountIn * priceUsdcPerUsdgE6) / 1e6;
            usdg.safeTransferFrom(msg.sender, address(this), amountIn);
            usdc.safeTransfer(recipient, amountOut);
        } else if (tokenIn == address(usdc)) {
            // USDC → USDG: amountOut = amountIn * 1e6 / price
            amountOut = (amountIn * 1e6) / priceUsdcPerUsdgE6;
            usdc.safeTransferFrom(msg.sender, address(this), amountIn);
            usdg.safeTransfer(recipient, amountOut);
        } else {
            revert RateNotSet();
        }

        emit Swapped(tokenIn, amountIn, amountOut);
    }
}