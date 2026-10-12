// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICapitalVault} from "../interfaces/ICapitalVault.sol";

/// @notice Stores user-authored policies ("mandates"). Each mandate constrains
///         the asset, venue allowlist, capital ceiling, duration window,
///         liquidity floor, risk class, and leverage posture under which
///         capital may be routed by Confluence.
/// @dev    A mandate with an empty venue allowlist permits any venue. Adding a
///         venue makes the mandate strict. The change is instantaneous and
///         applies to future reservations only; already-committed capital is
///         unaffected.
contract MandateRegistry {
    struct Mandate {
        uint256 id;
        uint256 accountId;
        address owner;
        address asset;
        // NOTE: the single `venue` field was replaced by a per-mandate
        // allowlist (`venueAllowed` + `_allowedVenues`).
        uint256 maxAllocation;
        uint256 minDuration;
        uint256 maxDuration;
        uint256 minLiquidityBps;
        uint8 maxRiskClass;
        bool leverageAllowed;
        bytes32 purposeHash;
        bytes32 policyHash;
        bool active;
        uint256 reserved;
    }

    /// @notice Bundled inputs for createMandate.
    /// @dev `initialVenues` may be empty (any venue) or a list of addresses
    ///      that will populate the allowlist. Duplicates are ignored.
    struct MandateInput {
        uint256 accountId;
        address asset;
        address[] initialVenues;
        uint256 maxAllocation;
        uint256 minDuration;
        uint256 maxDuration;
        uint256 minLiquidityBps;
        uint8 maxRiskClass;
        bool leverageAllowed;
        bytes32 purposeHash;
        bytes32 policyHash;
    }

    address public immutable protocolOwner;
    ICapitalVault public immutable vault;
    uint256 public nextMandateId = 1;
    mapping(uint256 => Mandate) public mandates;
    mapping(address => bool) public module;

    /// @notice mandateId => venue => allowed
    mapping(uint256 => mapping(address => bool)) public venueAllowed;

    /// @notice mandateId => list of allowlisted venues (source of truth for
    ///         "is the allowlist empty?"). Kept in sync with `venueAllowed`.
    mapping(uint256 => address[]) private _allowedVenues;

    error NotOwner();
    error NotModule();
    error InvalidMandate();
    error InvalidAmount();

    event ModuleSet(address indexed module, bool enabled);
    event MandateCreated(
        uint256 indexed mandateId,
        uint256 indexed accountId,
        address indexed owner
    );
    event Reserved(uint256 indexed mandateId, uint256 amount);
    event Released(uint256 indexed mandateId, uint256 amount);
    event ActiveSet(uint256 indexed mandateId, bool active);
    event VenueAdded(uint256 indexed mandateId, address indexed venue);
    event VenueRemoved(uint256 indexed mandateId, address indexed venue);

    constructor(address vault_) {
        protocolOwner = msg.sender;
        vault = ICapitalVault(vault_);
    }

    modifier onlyOwner() {
        if (msg.sender != protocolOwner) revert NotOwner();
        _;
    }

    modifier onlyModule() {
        if (!module[msg.sender]) revert NotModule();
        _;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setModule(address m, bool enabled) external onlyOwner {
        if (m == address(0)) revert InvalidMandate();
        module[m] = enabled;
        emit ModuleSet(m, enabled);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getMandate(uint256 id) external view returns (Mandate memory) {
        return mandates[id];
    }

    /// @notice Returns the number of venues on a mandate's allowlist.
    /// @dev An empty allowlist means any venue is permitted.
    function venueCount(uint256 id) external view returns (uint256) {
        return _allowedVenues[id].length;
    }

    /// @notice Returns the current allowlist for a mandate.
    ///         An empty array means "any venue is permitted".
    function allowedVenues(uint256 id) external view returns (address[] memory) {
        return _allowedVenues[id];
    }

    /// @notice Convenience view: is this venue currently routable under the mandate?
    function isVenueAllowed(uint256 id, address venue_) external view returns (bool) {
        return _allowedVenues[id].length == 0 || venueAllowed[id][venue_];
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    function createMandate(MandateInput calldata input) external returns (uint256 id) {
        if (
            vault.ownerOf(input.accountId) != msg.sender ||
            input.asset == address(0) ||
            input.maxAllocation == 0 ||
            input.minDuration > input.maxDuration ||
            input.minLiquidityBps > 10_000
        ) revert InvalidMandate();

        // Reject any zero address in the initial allowlist up front.
        // (Zero would be ambiguous with the "empty list means any" convention.)
        uint256 len = input.initialVenues.length;
        for (uint256 i; i < len; ++i) {
            if (input.initialVenues[i] == address(0)) revert InvalidMandate();
        }

        id = nextMandateId++;

        mandates[id] = Mandate(
            id,
            input.accountId,
            msg.sender,
            input.asset,
            input.maxAllocation,
            input.minDuration,
            input.maxDuration,
            input.minLiquidityBps,
            input.maxRiskClass,
            input.leverageAllowed,
            input.purposeHash,
            input.policyHash,
            true,
            0
        );

        // Populate the allowlist. Duplicates are silently ignored.
        for (uint256 i; i < len; ++i) {
            address v = input.initialVenues[i];
            if (!venueAllowed[id][v]) {
                venueAllowed[id][v] = true;
                _allowedVenues[id].push(v);
                emit VenueAdded(id, v);
            }
        }

        emit MandateCreated(id, input.accountId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Venue allowlist management
    // ------------------------------------------------------------------

    /// @notice Add a venue to the mandate's allowlist.
    /// @dev    Adding is idempotent. Only the mandate owner can call.
    ///         If the mandate currently has an empty allowlist (any venue),
    ///         the first call to `addVenue` narrows it to strict mode with
    ///         this single venue.
    function addVenue(uint256 id, address venue_) external {
        Mandate storage m = mandates[id];
        if (m.owner != msg.sender) revert InvalidMandate();
        if (venue_ == address(0)) revert InvalidMandate();
        if (venueAllowed[id][venue_]) return;

        venueAllowed[id][venue_] = true;
        _allowedVenues[id].push(venue_);
        emit VenueAdded(id, venue_);
    }

    /// @notice Remove a venue from the mandate's allowlist.
    /// @dev    Removing the last entry reverts the mandate back to
    ///         "any venue". Only the mandate owner can call.
    function removeVenue(uint256 id, address venue_) external {
        Mandate storage m = mandates[id];
        if (m.owner != msg.sender) revert InvalidMandate();
        if (!venueAllowed[id][venue_]) return;

        venueAllowed[id][venue_] = false;

        address[] storage list = _allowedVenues[id];
        uint256 len = list.length;
        for (uint256 i; i < len; ++i) {
            if (list[i] == venue_) {
                list[i] = list[len - 1];
                list.pop();
                break;
            }
        }

        emit VenueRemoved(id, venue_);
    }

    // ------------------------------------------------------------------
    // Active toggle
    // ------------------------------------------------------------------

    function setActive(uint256 id, bool active) external {
        Mandate storage m = mandates[id];
        if (m.owner != msg.sender) revert InvalidMandate();
        if (!active && m.reserved != 0) revert InvalidMandate();
        m.active = active;
        emit ActiveSet(id, active);
    }

    // ------------------------------------------------------------------
    // Compliance
    // ------------------------------------------------------------------

    function isCompliant(
        uint256 id,
        address asset_,
        address venue_,
        uint256 amount,
        uint256 duration,
        uint256 liquidityBps,
        uint8 riskClass,
        bool leverage
    ) external view returns (bool) {
        Mandate memory m = mandates[id];

        // Empty allowlist = any venue. Non-empty = strict membership check.
        address[] storage list = _allowedVenues[id];
        bool venueOk = list.length == 0 || venueAllowed[id][venue_];

        return
            m.active &&
            m.asset == asset_ &&
            venueOk &&
            amount > 0 &&
            m.reserved + amount <= m.maxAllocation &&
            duration >= m.minDuration &&
            duration <= m.maxDuration &&
            liquidityBps >= m.minLiquidityBps &&
            riskClass <= m.maxRiskClass &&
            (!leverage || m.leverageAllowed);
    }

    // ------------------------------------------------------------------
    // Reserve / release — called by Confluence
    // ------------------------------------------------------------------

    function reserve(uint256 id, uint256 amount) external onlyModule {
        Mandate storage m = mandates[id];
        if (!m.active || amount == 0 || m.reserved + amount > m.maxAllocation)
            revert InvalidAmount();
        m.reserved += amount;
        emit Reserved(id, amount);
    }

    function release(uint256 id, uint256 amount) external onlyModule {
        Mandate storage m = mandates[id];
        if (amount == 0 || amount > m.reserved) revert InvalidAmount();
        m.reserved -= amount;
        emit Released(id, amount);
    }
}