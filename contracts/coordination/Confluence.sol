// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICapitalVault} from "../interfaces/ICapitalVault.sol";
import {MandateRegistry} from "../core/MandateRegistry.sol";
import {OpportunityRegistry} from "../core/OpportunityRegistry.sol";
import {ExecutionRouter} from "../execution/ExecutionRouter.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Coordinates multiple mandate-compliant vault accounts into one aggregate position.
/// @dev Execution and both unwind call hashes are locked BEFORE capital is deployed.
///      Refactored for viaIR-free compilation: struct-bundled plan inputs, block-scoped
///      temporaries, and extracted helpers to keep every function under 16 stack slots.
contract Confluence is ReentrancyGuard {
    enum Status {
        FORMING,
        PLAN_LOCKED,
        EXECUTED,
        SETTLED,
        EMERGENCY_EXIT,
        CANCELLED
    }

    struct Position {
        uint256 id;
        uint256 opportunityId;
        address creator;
        address asset;
        address venue;
        address adapter;
        uint256 target;
        uint256 totalPrincipal;
        uint256 totalShares;
        uint256 maturity;
        uint256 returnedTotal;
        uint256 minReturn;
        uint256 emergencyMinReturn;
        uint256 executionDeadline;
        uint256 settlementDeadline;
        uint256 nonce;
        bytes32 executionHash;
        bytes32 settlementHash;
        bytes32 emergencySettlementHash;
        bytes32 positionMetadataHash;
        Status status;
    }

    struct Participant {
        uint256 accountId;
        uint256 mandateId;
        uint256 principal;
        uint256 shares;
        bool realized;
    }

    struct ParticipantInput {
        uint256 accountId;
        uint256 mandateId;
        uint256 amount;
    }

    /// @notice Bundled inputs for lockPlan / relockPlan — collapses six stack
    ///         parameters into a single calldata pointer.
    struct PlanInput {
        bytes32 executionHash;
        bytes32 settlementHash;
        bytes32 emergencySettlementHash;
        bytes32 positionMetadataHash;
        uint256 maturity;
        uint256 emergencyMinReturn;
    }

    ICapitalVault public immutable vault;
    MandateRegistry public immutable mandates;
    OpportunityRegistry public immutable opportunities;
    ExecutionRouter public immutable router;
    address public immutable protocolOwner;
    uint256 public nextId = 1;

    mapping(address => bool) public aggregator;
    mapping(address => bool) public emergencyOperator;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => mapping(uint256 => Participant)) public participants;
    mapping(uint256 => uint256[]) private _accounts;
    mapping(uint256 => uint256) public planNonce;

    error Invalid();
    error NotReady();
    error NotDue();
    error BadReturn();
    error NotOwner();
    error NotAggregator();
    error SumMismatch();
    error InvalidState();
    error InvalidPlan();
    error DeadlinePassed();
    error InvalidAmount();
    
    

    event AggregatorSet(address indexed account, bool enabled);
    event EmergencyOperatorSet(address indexed account, bool enabled);
    event Created(
        uint256 indexed id,
        uint256 indexed opportunityId,
        address indexed creator,
        uint256 target
    );
    event ParticipantAdded(uint256 indexed id, uint256 indexed accountId, uint256 amount);
    event ParticipantRemoved(uint256 indexed id, uint256 indexed accountId, uint256 amount);
    event PlanLocked(
        uint256 indexed id,
        bytes32 executionHash,
        bytes32 settlementHash,
        bytes32 emergencyHash,
        uint256 nonce
    );
    event PlanRelocked(uint256 indexed id, uint256 nonce);
    event Executed(uint256 indexed id, bytes32 executionHash, uint256 maturity);
    event Settled(uint256 indexed id, uint256 returnedAmount, bool emergency);
    event Realized(uint256 indexed id, uint256 indexed accountId, uint256 returnedAmount);
    event Cancelled(uint256 indexed id);
    event Swept(uint256 indexed id, uint256 participants);

    modifier onlyOwner() {
        if (msg.sender != protocolOwner) revert NotOwner();
        _;
    }
    modifier onlyAggregator() {
        if (!aggregator[msg.sender]) revert NotAggregator();
        _;
    }

    constructor(
        address vault_,
        address mandates_,
        address opportunities_,
        address router_
    ) {
        if (
            vault_ == address(0) ||
            mandates_ == address(0) ||
            opportunities_ == address(0) ||
            router_ == address(0)
        ) revert Invalid();
        vault = ICapitalVault(vault_);
        mandates = MandateRegistry(mandates_);
        opportunities = OpportunityRegistry(opportunities_);
        router = ExecutionRouter(router_);
        protocolOwner = msg.sender;
        aggregator[msg.sender] = true;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setAggregator(address a, bool enabled) external onlyOwner {
        if (a == address(0)) revert Invalid();
        aggregator[a] = enabled;
        emit AggregatorSet(a, enabled);
    }

    function setEmergencyOperator(address account, bool enabled) external onlyOwner {
        if (account == address(0)) revert Invalid();
        emergencyOperator[account] = enabled;
        emit EmergencyOperatorSet(account, enabled);
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    function create(
        uint256 opportunityId,
        uint256 target,
        uint256 minReturn,
        uint256 executionDeadline,
        uint256 settlementDeadline
    ) external onlyAggregator returns (uint256 id) {
        OpportunityRegistry.Opportunity memory o = opportunities.getOpportunity(opportunityId);

        if (
            o.id == 0 ||
            o.status != OpportunityRegistry.Status.OPEN ||
            target == 0 ||
            target > o.capacity ||
            minReturn == 0 ||
            executionDeadline > o.deadline ||
            executionDeadline <= block.timestamp ||
            settlementDeadline < executionDeadline ||
            minReturn < o.minReturn
        ) revert Invalid();
        if (vault.asset() != o.asset) revert Invalid();
        if (o.allocated + target > o.capacity) revert Invalid();
        if (opportunities.opportunityPosition(opportunityId) != 0) revert Invalid();

        id = nextId++;

        {
            Position storage p = positions[id];
            p.id = id;
            p.opportunityId = opportunityId;
            p.creator = msg.sender;
            p.asset = o.asset;
            p.venue = o.venue;
            p.adapter = o.adapter;
            p.target = target;
            p.minReturn = minReturn;
            p.executionDeadline = executionDeadline;
            p.settlementDeadline = settlementDeadline;
            p.status = Status.FORMING;
        }

        opportunities.setPosition(opportunityId, id);
        emit Created(id, opportunityId, msg.sender, target);
    }

    // ------------------------------------------------------------------
    // Participants
    // ------------------------------------------------------------------

    /// @notice Aggregator-only: participants are curated off-chain.
    function addParticipant(
        uint256 id,
        uint256 accountId,
        uint256 mandateId,
        uint256 amount
    ) external onlyAggregator nonReentrant {
        _addParticipant(id, accountId, mandateId, amount);
    }

    function addParticipants(
        uint256 id,
        ParticipantInput[] calldata inputs
    ) external onlyAggregator nonReentrant {
        for (uint256 i; i < inputs.length; ++i) {
            ParticipantInput calldata input = inputs[i];
            _addParticipant(id, input.accountId, input.mandateId, input.amount);
        }
    }

    function _addParticipant(
        uint256 id,
        uint256 accountId,
        uint256 mandateId,
        uint256 amount
    ) internal {
        Position storage p = positions[id];

        if (
            p.id == 0 ||
            p.status != Status.FORMING ||
            amount == 0 ||
            p.totalPrincipal + amount > p.target ||
            participants[id][accountId].accountId != 0
        ) revert Invalid();

        {
            MandateRegistry.Mandate memory m = mandates.getMandate(mandateId);
            if (
                m.accountId != accountId ||
                m.asset != p.asset ||
                m.owner != vault.ownerOf(accountId)
            ) revert Invalid();
        }

        {
            OpportunityRegistry.Opportunity memory o = opportunities.getOpportunity(p.opportunityId);
            if (
                !mandates.isCompliant(
                    mandateId,
                    p.asset,
                    p.venue,
                    amount,
                    o.duration,
                    o.liquidityBps,
                    o.riskClass,
                    o.usesLeverage
                )
            ) revert Invalid();
        }

        opportunities.reserve(p.opportunityId, amount);
        mandates.reserve(mandateId, amount);
        vault.commit(accountId, amount);

        participants[id][accountId] = Participant(accountId, mandateId, amount, amount, false);
        _accounts[id].push(accountId);
        p.totalPrincipal += amount;
        p.totalShares += amount;
        emit ParticipantAdded(id, accountId, amount);
    }

    /// @notice Aggregator can drop a participant before lockPlan if the duration
    ///         re-check would fail.
    function removeParticipant(uint256 id, uint256 accountId) external onlyAggregator nonReentrant {
        Position storage p = positions[id];
        if (p.status != Status.FORMING) revert Invalid();

        Participant storage q = participants[id][accountId];
        if (q.accountId == 0) revert Invalid();

        uint256 principal = q.principal;
        uint256 shares = q.shares;
        uint256 mandateId = q.mandateId;

        opportunities.release(p.opportunityId, principal);
        mandates.release(mandateId, principal);
        vault.releaseCommitment(accountId, principal);

        p.totalPrincipal -= principal;
        p.totalShares -= shares;
        delete participants[id][accountId];

        // Compact _accounts array.
        {
            uint256[] storage accts = _accounts[id];
            uint256 len = accts.length;
            for (uint256 i; i < len; ++i) {
                if (accts[i] == accountId) {
                    accts[i] = accts[len - 1];
                    accts.pop();
                    break;
                }
            }
        }

        emit ParticipantRemoved(id, accountId, principal);
    }

    // ------------------------------------------------------------------
    // Plan
    // ------------------------------------------------------------------

    function lockPlan(uint256 id, PlanInput calldata plan)
        external
        onlyAggregator
        nonReentrant
    {
        Position storage p = positions[id];

        if (
            p.id == 0 ||
            p.status != Status.FORMING ||
            p.totalPrincipal != p.target ||
            plan.executionHash == bytes32(0) ||
            plan.settlementHash == bytes32(0) ||
            plan.emergencySettlementHash == bytes32(0) ||
            plan.maturity < block.timestamp ||
            plan.maturity > p.settlementDeadline ||
            plan.emergencyMinReturn == 0 ||
            plan.emergencyMinReturn > p.minReturn ||
            block.timestamp > p.executionDeadline
        ) revert Invalid();

        _recheckMandateWindows(p, plan.maturity);

        p.executionHash = plan.executionHash;
        p.settlementHash = plan.settlementHash;
        p.emergencySettlementHash = plan.emergencySettlementHash;
        p.positionMetadataHash = plan.positionMetadataHash;
        p.maturity = plan.maturity;
        p.emergencyMinReturn = plan.emergencyMinReturn;
        p.nonce = ++planNonce[id];
        p.status = Status.PLAN_LOCKED;

        emit PlanLocked(
            id,
            plan.executionHash,
            plan.settlementHash,
            plan.emergencySettlementHash,
            p.nonce
        );
    }

    /// @notice Aggregator may re-lock a plan while still within the execution window.
    function relockPlan(uint256 id, PlanInput calldata plan)
        external
        onlyAggregator
        nonReentrant
    {
        Position storage p = positions[id];

        if (
            p.status != Status.PLAN_LOCKED ||
            block.timestamp > p.executionDeadline ||
            plan.executionHash == bytes32(0) ||
            plan.settlementHash == bytes32(0) ||
            plan.emergencySettlementHash == bytes32(0) ||
            plan.maturity < block.timestamp ||
            plan.maturity > p.settlementDeadline ||
            plan.emergencyMinReturn == 0 ||
            plan.emergencyMinReturn > p.minReturn
        ) revert Invalid();

        _recheckMandateWindows(p, plan.maturity);

        p.executionHash = plan.executionHash;
        p.settlementHash = plan.settlementHash;
        p.emergencySettlementHash = plan.emergencySettlementHash;
        p.positionMetadataHash = plan.positionMetadataHash;
        p.maturity = plan.maturity;
        p.emergencyMinReturn = plan.emergencyMinReturn;
        p.nonce = ++planNonce[id];

        emit PlanRelocked(id, p.nonce);
    }

    function _recheckMandateWindows(Position storage p, uint256 maturity) internal view {
        uint256[] storage accts = _accounts[p.id];
        uint256 len = accts.length;
        for (uint256 i; i < len; ++i) {
            Participant storage q = participants[p.id][accts[i]];
            MandateRegistry.Mandate memory m = mandates.getMandate(q.mandateId);
            if (maturity < p.executionDeadline + m.minDuration) revert Invalid();
            if (maturity > block.timestamp + m.maxDuration) revert Invalid();
        }
    }

    // ------------------------------------------------------------------
    // Execution
    // ------------------------------------------------------------------

function execute(
    uint256 id,
    ExecutionRouter.Call[] calldata calls
)
    external
    nonReentrant
{
    Position storage p = positions[id];

    if (p.status != Status.PLAN_LOCKED)
        revert InvalidState();

    if (block.timestamp > p.executionDeadline)
        revert DeadlinePassed();

    if (
        router.hashCalls(calls) !=
        p.executionHash
    ) {
        revert InvalidPlan();
    }

    OpportunityRegistry.Opportunity memory opportunity =
        opportunities.getOpportunity(
            p.opportunityId
        );

    if (
        opportunity.status !=
        OpportunityRegistry.Status.OPEN
    ) {
        revert InvalidState();
    }

    

uint256 len = _accounts[id].length;

uint256[] memory accountIds = new uint256[](len);
uint256[] memory amounts = new uint256[](len);

uint256 total;

for (uint256 i; i < len; ++i) {
    uint256 accountId = _accounts[id][i];
    Participant memory participant = participants[id][accountId];

    if (participant.accountId != accountId || participant.principal == 0) {
        revert InvalidAmount();
    }

    accountIds[i] = accountId;
    amounts[i] = participant.principal;

    total += participant.principal;
}

if (total != p.totalPrincipal) {
    revert InvalidAmount();
}

    // ---------------------------------------------------------------
    // CapitalVault -> ExecutionRouter
    // ---------------------------------------------------------------

    vault.deployAggregate(
        accountIds,
        amounts,
        address(router)
    );

    // ---------------------------------------------------------------
    // Router:
    //
    // USDG:
    //   Router retains principal and adapter pulls it.
    //
    // Notes:
    //   Router forwards principal to Notes before draw().
    // ---------------------------------------------------------------

    router.executeAggregate(
        p.asset,
        p.venue,
        p.adapter,
        _executionFundingTarget(p),
        calls,
        p.executionHash,
        p.executionDeadline,
        p.totalPrincipal
    );

    p.status = Status.EXECUTED;

    opportunities.setStatus(
        p.opportunityId,
        OpportunityRegistry.Status.EXECUTED
    );

    emit Executed(
        id,
        p.executionHash,
        p.maturity
    );
}

function _executionFundingTarget(
    Position storage p
)
    internal
    view
    returns (address)
{
    // Forward principal to the venue for Notes execution.
    if (p.venue == p.adapter) {
        return p.venue;
    }

    // Keep the existing adapter-based execution flow.
    return address(0);
}


    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    function settle(uint256 id, ExecutionRouter.Call[] calldata settlementCalls)
        external
        nonReentrant
    {
        Position storage p = positions[id];
        if (p.status != Status.EXECUTED || block.timestamp < p.maturity) revert NotDue();
        if (
            block.timestamp > p.settlementDeadline ||
            router.hashCalls(settlementCalls) != p.settlementHash
        ) revert Invalid();

        uint256 returned;
        {
            ExecutionRouter.Plan memory plan = ExecutionRouter.Plan(
                p.settlementHash,
                p.minReturn,
                p.settlementDeadline,
                address(vault)
            );
            returned = router.settleAggregate(
                p.asset,
                p.venue,
                p.adapter,
                settlementCalls,
                plan
            );
        }
        if (returned < p.minReturn) revert BadReturn();

        p.returnedTotal = returned;
        p.status = Status.SETTLED;
        _distribute(id);
        vault.closeAggregateSettlement(p.totalPrincipal);
        opportunities.setStatus(p.opportunityId, OpportunityRegistry.Status.CLOSED);
        opportunities.release(p.opportunityId, p.totalPrincipal);
        emit Settled(id, returned, false);
    }

    function emergencyExit(uint256 id, ExecutionRouter.Call[] calldata calls)
        external
        nonReentrant
    {
        Position storage p = positions[id];
        if (p.status != Status.EXECUTED) revert Invalid();
        if (msg.sender != protocolOwner && !emergencyOperator[msg.sender]) revert NotOwner();
        if (router.hashCalls(calls) != p.emergencySettlementHash) revert Invalid();

        uint256 returned;
        {
            ExecutionRouter.Plan memory plan = ExecutionRouter.Plan(
                p.emergencySettlementHash,
                p.emergencyMinReturn,
                type(uint256).max, // no deadline on the emergency path
                address(vault)
            );
            returned = router.emergencyExitAggregate(
                p.asset,
                p.venue,
                p.adapter,
                calls,
                plan
            );
        }
        if (returned < p.emergencyMinReturn) revert BadReturn();

        p.returnedTotal = returned;
        p.status = Status.EMERGENCY_EXIT;
        _distribute(id);
        vault.closeAggregateSettlement(p.totalPrincipal);
        opportunities.setStatus(p.opportunityId, OpportunityRegistry.Status.CLOSED);
        opportunities.release(p.opportunityId, p.totalPrincipal);
        emit Settled(id, returned, true);
    }

    // ------------------------------------------------------------------
    // Cancel / Sweep
    // ------------------------------------------------------------------

    function cancel(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        if (msg.sender != p.creator) revert Invalid();

        bool forming = p.status == Status.FORMING;
        bool staleLock =
            p.status == Status.PLAN_LOCKED && block.timestamp > p.executionDeadline;
        if (!forming && !staleLock) revert Invalid();

        p.status = Status.CANCELLED;
        if (p.totalPrincipal != 0) {
            opportunities.release(p.opportunityId, p.totalPrincipal);
        }
        opportunities.clearPosition(p.opportunityId);
        emit Cancelled(id);
    }

    /// @notice Anyone can release remaining commitments after cancellation.
    ///         Funds always go to the vault account owner.
    function sweepCancelled(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        if (p.status != Status.CANCELLED) revert Invalid();

        uint256[] storage accts = _accounts[id];
        uint256 len = accts.length;
        uint256 count;
        for (uint256 i; i < len; ++i) {
            uint256 accountId = accts[i];
            Participant storage q = participants[id][accountId];
            if (q.accountId == 0 || q.realized) continue;
            q.realized = true;
            uint256 principal = q.principal;
            uint256 mandateId = q.mandateId;
            vault.releaseCommitment(accountId, principal);
            mandates.release(mandateId, principal);
            count++;
        }
        emit Swept(id, count);
    }

    // ------------------------------------------------------------------
    // Distribution
    // ------------------------------------------------------------------

    /// @dev Extracted to keep `_distribute` under the stack limit.
    function _lastUnrealizedIndex(uint256 id) internal view returns (uint256) {
        uint256[] storage accts = _accounts[id];
        for (uint256 i = accts.length; i > 0; --i) {
            if (!participants[id][accts[i - 1]].realized) return i - 1;
        }
        return type(uint256).max;
    }

/// @dev The last unrealized participant receives `total - allocated`.
///      Each earlier term is a rounded-down proportional share, so
///      `allocated <= total` always holds.
function _distribute(uint256 id) internal {
    Position storage p = positions[id];
    uint256[] storage accts = _accounts[id];
    uint256 total = p.returnedTotal;
    uint256 totalShares_ = p.totalShares;
    uint256 allocated;
    uint256 lastIdx = _lastUnrealizedIndex(id);
    uint256 len = accts.length;

    for (uint256 i; i < len; ++i) {
        uint256 accountId = accts[i];
        Participant storage q = participants[id][accountId];
        if (q.accountId == 0 || q.realized) continue;

        uint256 returned;
        if (i == lastIdx) {
            returned = total > allocated ? total - allocated : 0;
        } else {
            returned = (q.shares * total) / totalShares_;
            allocated += returned;
            if (allocated > total) allocated = total;
        }

        q.realized = true;
        vault.settleAggregateParticipant(accountId, q.principal, returned);
        mandates.release(q.mandateId, q.principal);
        emit Realized(id, accountId, returned);
    }
}

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function participantAccounts(uint256 id) external view returns (uint256[] memory) {
        return _accounts[id];
    }
}