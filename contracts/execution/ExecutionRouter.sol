// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AdapterRegistry} from "./AdapterRegistry.sol";

/// @notice Generic ERC20 atomic calldata executor.
///
/// Capital flow during execution:
///
///   CapitalVault
///        │
///        │ principal
///        ▼
///   ExecutionRouter
///        │
///        ├── optional principal forwarding ──> fundingTarget
///        │
///        └── execute calls
///
/// For strategies such as USDG depeg, the principal remains in the router
/// because USDGDepegAdapter.open() pulls the principal from msg.sender
/// (the router).
///
/// For direct-funded venues such as Notes, the router forwards the
/// principal to the venue before calling Notes.draw().
contract ExecutionRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct Plan {
        bytes32 callsHash;
        uint256 minReturn;
        uint256 deadline;
        address recipient;
    }

    AdapterRegistry public immutable registry;
    address public immutable owner;

    mapping(address => bool) public caller;
    mapping(address => bool) public globalTarget;

    error NotOwner();
    error NotCaller();
    error InvalidPlan();
    error InvalidCall();
    error CallFailed(uint256 index, bytes reason);
    error AssetLoss();
    error ReturnTooLow();
    error InvalidFundingTarget();

    event CallerSet(address indexed account, bool enabled);
    event GlobalTargetSet(address indexed target, bool enabled);

    event PrincipalForwarded(
        address indexed asset,
        address indexed target,
        uint256 amount
    );

    event MulticallExecuted(
        bytes32 indexed callsHash,
        uint256 callCount
    );

    event SettlementExecuted(
        bytes32 indexed callsHash,
        address indexed asset,
        uint256 returnedAmount,
        address indexed recipient
    );

    constructor(address registry_) {
        if (registry_ == address(0)) revert InvalidPlan();

        registry = AdapterRegistry(registry_);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCaller() {
        if (!caller[msg.sender]) revert NotCaller();
        _;
    }

    function setCaller(
        address account,
        bool enabled_
    ) external onlyOwner {
        if (account == address(0)) revert InvalidPlan();

        caller[account] = enabled_;

        emit CallerSet(account, enabled_);
    }

    function setGlobalTarget(
        address target,
        bool enabled_
    ) external onlyOwner {
        if (target == address(0)) revert InvalidPlan();

        globalTarget[target] = enabled_;

        emit GlobalTargetSet(target, enabled_);
    }

    function hashCalls(
        Call[] calldata calls
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(calls));
    }

    /// @notice Execute a position.
    ///
    /// If fundingTarget == address(0), principal remains in the router.
    ///
    /// If fundingTarget != address(0), exactly principal is transferred
    /// from the router to fundingTarget before executing the calls.
    ///
    /// This supports both:
    ///
    /// 1. Adapter-funded strategies:
    ///      fundingTarget = address(0)
    ///
    /// 2. Direct-funded venues such as Notes:
    ///      fundingTarget = Notes
    function executeAggregate(
        address asset,
        address venue,
        address adapter,
        address fundingTarget,
        Call[] calldata calls,
        bytes32 expectedHash,
        uint256 deadline,
        uint256 principal
    )
        external
        onlyCaller
        nonReentrant
        returns (bytes32)
    {
        if (
            block.timestamp > deadline ||
            calls.length == 0 ||
            expectedHash != hashCalls(calls) ||
            principal == 0
        ) {
            revert InvalidPlan();
        }

        _validateTargets(
            asset,
            venue,
            adapter,
            calls
        );

        uint256 beforeBal =
            IERC20(asset).balanceOf(address(this));

        if (beforeBal < principal)
            revert AssetLoss();

        uint256 preservedDust =
            beforeBal - principal;

        // ---------------------------------------------------------------
        // Optional direct funding.
        // ---------------------------------------------------------------

        if (fundingTarget != address(0)) {
            if (fundingTarget == address(this))
                revert InvalidFundingTarget();

            if (
                fundingTarget != venue &&
                fundingTarget != adapter &&
                !globalTarget[fundingTarget]
            ) {
                revert InvalidFundingTarget();
            }

            IERC20(asset).safeTransfer(
                fundingTarget,
                principal
            );

            emit PrincipalForwarded(
                asset,
                fundingTarget,
                principal
            );
        }

        // ---------------------------------------------------------------
        // Execute strategy calls.
        // ---------------------------------------------------------------

        _execute(calls);

        // ---------------------------------------------------------------
        // Execution invariant.
        //
        // Adapter-funded:
        //   router starts with principal
        //   strategy consumes principal
        //   router ends with preserved dust
        //
        // Direct-funded:
        //   router forwards principal
        //   router therefore also ends with preserved dust
        // ---------------------------------------------------------------

        uint256 afterBal =
            IERC20(asset).balanceOf(address(this));

        if (afterBal != preservedDust)
            revert AssetLoss();

        emit MulticallExecuted(
            expectedHash,
            calls.length
        );

        return expectedHash;
    }

    function settleAggregate(
        address asset,
        address venue,
        address adapter,
        Call[] calldata calls,
        Plan calldata plan
    )
        external
        onlyCaller
        nonReentrant
        returns (uint256)
    {
        return _settle(
            asset,
            venue,
            adapter,
            calls,
            plan
        );
    }

    function emergencyExitAggregate(
        address asset,
        address venue,
        address adapter,
        Call[] calldata calls,
        Plan calldata plan
    )
        external
        onlyCaller
        nonReentrant
        returns (uint256)
    {
        return _settle(
            asset,
            venue,
            adapter,
            calls,
            plan
        );
    }

    function _settle(
        address asset,
        address venue,
        address adapter,
        Call[] calldata calls,
        Plan calldata plan
    )
        internal
        returns (uint256 returnedAmount)
    {
        if (
            plan.recipient == address(0) ||
            calls.length == 0 ||
            block.timestamp > plan.deadline ||
            plan.callsHash != hashCalls(calls)
        ) {
            revert InvalidPlan();
        }

        _validateTargets(
            asset,
            venue,
            adapter,
            calls
        );

        uint256 beforeBal =
            IERC20(asset).balanceOf(address(this));

        _execute(calls);

        uint256 afterBal =
            IERC20(asset).balanceOf(address(this));

        if (afterBal < beforeBal)
            revert AssetLoss();

        returnedAmount =
            afterBal - beforeBal;

        if (returnedAmount < plan.minReturn)
            revert ReturnTooLow();

        IERC20(asset).safeTransfer(
            plan.recipient,
            returnedAmount
        );

        emit SettlementExecuted(
            plan.callsHash,
            asset,
            returnedAmount,
            plan.recipient
        );
    }

    function _execute(
        Call[] calldata calls
    ) internal {
        for (uint256 i; i < calls.length; ++i) {
            Call calldata c = calls[i];

            if (
                c.target == address(0) ||
                c.value != 0 ||
                c.data.length < 4
            ) {
                revert InvalidCall();
            }

            (bool ok, bytes memory reason) =
                c.target.call(c.data);

            if (!ok) {
                revert CallFailed(
                    i,
                    reason
                );
            }
        }
    }

    function _validateTargets(
        address asset,
        address venue,
        address adapter,
        Call[] calldata calls
    ) internal view {
        if (
            !registry.enabled(
                adapter,
                venue
            )
        ) {
            revert InvalidCall();
        }

        for (uint256 i; i < calls.length; ++i) {
            address target =
                calls[i].target;

            if (
                target != asset &&
                target != venue &&
                target != adapter &&
                !globalTarget[target]
            ) {
                revert InvalidCall();
            }

            if (calls[i].data.length < 4)
                revert InvalidCall();

            bytes4 selector =
                bytes4(calls[i].data);

            if (
                !registry.selectorEnabled(
                    adapter,
                    venue,
                    target,
                    selector
                )
            ) {
                revert InvalidCall();
            }
        }
    }
}
