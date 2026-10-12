// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Shared custody and per-account accounting for one settlement asset.
contract CapitalVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Account {
        address owner;
        uint256 available;
        uint256 committed;
        uint256 deployed;
        uint256 collateralized;
        bool active;
    }

    address public immutable protocolOwner;
    IERC20 public immutable asset;
    uint256 public nextAccountId = 1;
    uint256 public totalLiabilities;
    uint256 public totalCommitted;
    uint256 public externalBacking;
    uint256 public totalAvailable;

    mapping(uint256 => Account) private _accounts;
    mapping(address => uint256[]) private _ownerAccounts;
    mapping(address => bool) public module;

    error NotOwner();
    error NotModule();
    error InvalidAmount();
    error InvalidAccount();
    error Insolvent();
    error DuplicateAccount();

    event AccountCreated(uint256 indexed accountId, address indexed owner);
    event Deposited(uint256 indexed accountId, uint256 amount);
    event Withdrawn(uint256 indexed accountId, uint256 amount);
    event Committed(uint256 indexed accountId, uint256 amount);
    event CommitmentReleased(uint256 indexed accountId, uint256 amount);
    event AggregateDeployed(uint256 amount, address indexed recipient);
    event SettlementReceived(
        uint256 indexed accountId,
        uint256 principal,
        uint256 returnedAmount
    );
    event ModuleSet(address indexed module, bool enabled);

    constructor(address asset_) {
        if (asset_ == address(0)) revert InvalidAccount();
        protocolOwner = msg.sender;
        asset = IERC20(asset_);
    }

    modifier onlyOwner() {
        if (msg.sender != protocolOwner) revert NotOwner();
        _;
    }

    modifier onlyModule() {
        if (!module[msg.sender]) revert NotModule();
        _;
    }

    function setModule(address m, bool enabled) external onlyOwner {
        if (m == address(0)) revert InvalidAccount();
        module[m] = enabled;
        emit ModuleSet(m, enabled);
    }

    function createAccount() external returns (uint256 id) {
        id = nextAccountId++;
        _accounts[id] = Account(msg.sender, 0, 0, 0, 0, true);
        _ownerAccounts[msg.sender].push(id);
        emit AccountCreated(id, msg.sender);
    }

    function ownerOf(uint256 accountId) external view returns (address) {
        return _accounts[accountId].owner;
    }

    function account(uint256 accountId) external view returns (Account memory) {
        return _accounts[accountId];
    }

    function accountsOf(
        address owner
    ) external view returns (uint256[] memory) {
        return _ownerAccounts[owner];
    }

    function deposit(uint256 accountId, uint256 amount) external nonReentrant {
        Account storage a = _accounts[accountId];
        if (!a.active || a.owner != msg.sender || amount == 0)
            revert InvalidAccount();
        uint256 before = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = asset.balanceOf(address(this)) - before;
        if (received == 0) revert InvalidAmount();
        a.available += received;
        totalAvailable += received;
        totalLiabilities += received;
        _assertSolvent();
        emit Deposited(accountId, received);
    }

    function withdraw(uint256 accountId, uint256 amount) external nonReentrant {
        Account storage a = _accounts[accountId];
        if (
            !a.active ||
            a.owner != msg.sender ||
            amount == 0 ||
            amount > a.available
        ) revert InvalidAmount();
        a.available -= amount;
        totalLiabilities -= amount;
        asset.safeTransfer(msg.sender, amount);
        _assertSolvent();
        emit Withdrawn(accountId, amount);
    }

    function commit(uint256 accountId, uint256 amount) external onlyModule {
        Account storage a = _accounts[accountId];
        if (!a.active || amount == 0 || amount > a.available)
            revert InvalidAmount();
        a.available -= amount;
        a.committed += amount;
        totalCommitted += amount;
        totalAvailable -= amount;
        emit Committed(accountId, amount);
    }

    function releaseCommitment(
        uint256 accountId,
        uint256 amount
    ) external onlyModule {
        Account storage a = _accounts[accountId];
        if (!a.active || amount == 0 || amount > a.committed)
            revert InvalidAmount();
        a.committed -= amount;
        a.available += amount;
        totalCommitted -= amount;
        totalAvailable += amount;
        emit CommitmentReleased(accountId, amount);
    }

    /// @notice Move committed principal from each named account into the external position.
    /// @dev Fixes C4: rejects duplicates, requires exact sum, and enforces global cap.
    function deployAggregate(
        uint256[] calldata accountIds,
        uint256[] calldata amounts,
        address recipient
    ) external onlyModule nonReentrant {
        uint256 len = accountIds.length;
        if (len == 0 || len != amounts.length || recipient == address(0))
            revert InvalidAmount();

        uint256 total;
        for (uint256 i; i < len; ++i) {
            // Duplicate check: O(n^2) but n is small and this only runs once per position.
            for (uint256 j = i + 1; j < len; ++j) {
                if (accountIds[i] == accountIds[j]) revert DuplicateAccount();
            }
            Account storage a = _accounts[accountIds[i]];
            uint256 amt = amounts[i];
            if (!a.active || amt == 0 || amt > a.committed)
                revert InvalidAmount();
            a.committed -= amt;
            a.deployed += amt;
            total += amt;
        }
        if (total == 0 || total > totalCommitted) revert InvalidAmount();
        totalCommitted -= total;
        externalBacking += total;
        asset.safeTransfer(recipient, total);
        _assertSolvent();
        emit AggregateDeployed(total, recipient);
    }

    function closeAggregateSettlement(uint256 principal) external onlyModule {
        if (principal == 0 || principal > externalBacking)
            revert InvalidAmount();
        externalBacking -= principal;
        _assertSolvent();
    }

    function settleAggregateParticipant(
        uint256 accountId,
        uint256 principal,
        uint256 returnedAmount
    ) external onlyModule nonReentrant {
        Account storage a = _accounts[accountId];
        if (!a.active || principal == 0 || principal > a.deployed)
            revert InvalidAmount();
        a.deployed -= principal;
        a.available += returnedAmount;
        totalAvailable += returnedAmount;
        if (returnedAmount > principal) {
            totalLiabilities += returnedAmount - principal;
        } else if (returnedAmount < principal) {
            totalLiabilities -= principal - returnedAmount;
        }
        _assertSolvent();
        emit SettlementReceived(accountId, principal, returnedAmount);
    }

    function _assertSolvent() internal view {
        if (asset.balanceOf(address(this)) + externalBacking < totalLiabilities)
            revert Insolvent();
    }
}
