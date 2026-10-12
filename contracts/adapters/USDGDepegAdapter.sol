// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMockUSDGPool {
    function swap(address tokenIn, uint256 amountIn, address recipient) external returns (uint256);
}

contract USDGDepegAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Hedge {
        address opener;
        uint256 usdgIn;
        uint256 usdcHeld;
        uint256 openedAt;
        bool    closed;
    }

    IERC20         public immutable usdg;
    IERC20         public immutable usdc;
    IMockUSDGPool  public immutable pool;
    address        public immutable owner;

    uint256 public nextHedgeId = 1;
    mapping(uint256 => Hedge) public hedges;

    event HedgeOpened(uint256 indexed id, address indexed opener, uint256 usdgIn, uint256 usdcOut);
    event HedgeClosed(uint256 indexed id, uint256 usdcIn, uint256 usdgOut);

    error Invalid();
    error NotOpener();
    error AlreadyClosed();
    error NotOwner();
    error StillOpen();

    constructor(address usdg_, address usdc_, address pool_) {
        if (usdg_ == address(0) || usdc_ == address(0) || pool_ == address(0)) revert Invalid();
        usdg = IERC20(usdg_);
        usdc = IERC20(usdc_);
        pool = IMockUSDGPool(pool_);
        owner = msg.sender;
    }

    /// @notice Entry leg. Called by ExecutionRouter during `confluence.execute`.
    function open(uint256 usdgIn, uint256 minUsdcOut)
        external
        nonReentrant
        returns (uint256 hedgeId, uint256 usdcOut)
    {
        if (usdgIn == 0 || minUsdcOut == 0) revert Invalid();
        usdg.safeTransferFrom(msg.sender, address(this), usdgIn);
        usdg.forceApprove(address(pool), usdgIn);

        usdcOut = pool.swap(address(usdg), usdgIn, address(this));
        require(usdcOut >= minUsdcOut, "slippage");

        hedgeId = nextHedgeId++;
        hedges[hedgeId] = Hedge({
            opener:   msg.sender,
            usdgIn:   usdgIn,
            usdcHeld: usdcOut,
            openedAt: block.timestamp,
            closed:   false
        });

        emit HedgeOpened(hedgeId, msg.sender, usdgIn, usdcOut);
    }

    /// @notice Exit leg. Called by ExecutionRouter during `confluence.settle`.
    function close(uint256 hedgeId, uint256 minUsdgOut)
        external
        nonReentrant
        returns (uint256 usdgOut)
    {
        Hedge storage h = hedges[hedgeId];
        if (h.opener == address(0)) revert Invalid();
        if (h.closed) revert AlreadyClosed();
        if (msg.sender != h.opener) revert NotOpener();

        h.closed = true;

        usdc.forceApprove(address(pool), h.usdcHeld);
        usdgOut = pool.swap(address(usdc), h.usdcHeld, msg.sender);
        require(usdgOut >= minUsdgOut, "slippage");

        emit HedgeClosed(hedgeId, h.usdcHeld, usdgOut);
    }

    function forceClose(uint256 hedgeId) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        Hedge storage h = hedges[hedgeId];
        if (h.closed || block.timestamp < h.openedAt + 60 days) revert StillOpen();
        h.closed = true;
        usdc.safeTransfer(owner, h.usdcHeld);
    }
}