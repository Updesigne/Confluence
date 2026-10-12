// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OpportunityRegistry {
    enum Status { OPEN, EXECUTED, CLOSED, CANCELLED }

    struct Opportunity {
        uint256 id;
        address asset;
        address venue;
        address adapter;
        uint256 capacity;
        uint256 allocated;
        uint256 duration;
        uint256 liquidityBps;
        uint8 riskClass;
        bool usesLeverage;
        uint256 minReturn;
        uint256 deadline;
        Status status;
        bytes32 metadataHash;
        uint256 venueRefId;
    }

    /// @notice Bundled inputs for createOpportunity — collapses 12 params into one pointer.
    struct OpportunityInput {
        address asset;
        address venue;
        address adapter;
        uint256 capacity;
        uint256 duration;
        uint256 liquidityBps;
        uint8 riskClass;
        bool usesLeverage;
        uint256 minReturn;
        uint256 deadline;
        bytes32 metadataHash;
        uint256 venueRefId;
    }

    address public immutable protocolOwner;
    uint256 public nextOpportunityId = 1;
    mapping(uint256 => Opportunity) public opportunities;
    mapping(uint256 => uint256) public opportunityPosition;
    mapping(address => bool) public publisher;
    mapping(address => bool) public module;

    error NotOwner();
    error NotPublisher();
    error NotModule();
    error Invalid();
    error PositionAlreadyBound();

    event PublisherSet(address indexed account, bool enabled);
    event ModuleSet(address indexed account, bool enabled);
    event OpportunityCreated(
        uint256 indexed id,
        address indexed asset,
        address indexed venue,
        uint256 capacity,
        uint256 venueRefId
    );
    event Reserved(uint256 indexed id, uint256 amount);
    event StatusChanged(uint256 indexed id, Status status);
    event Released(uint256 indexed id, uint256 amount);
    event PositionBound(uint256 indexed id, uint256 indexed positionId);
    event PositionCleared(uint256 indexed id);

    constructor() {
        protocolOwner = msg.sender;
        publisher[msg.sender] = true;
    }

    modifier onlyOwner() { if (msg.sender != protocolOwner) revert NotOwner(); _; }
    modifier onlyPublisher() { if (!publisher[msg.sender]) revert NotPublisher(); _; }
    modifier onlyModule() { if (!module[msg.sender]) revert NotModule(); _; }

    function setPublisher(address p, bool value) external onlyOwner {
        if (p == address(0)) revert Invalid();
        publisher[p] = value;
        emit PublisherSet(p, value);
    }

    function setModule(address m, bool value) external onlyOwner {
        if (m == address(0)) revert Invalid();
        module[m] = value;
        emit ModuleSet(m, value);
    }

    function getOpportunity(uint256 id) external view returns (Opportunity memory) {
        return opportunities[id];
    }

    function createOpportunity(OpportunityInput calldata input)
        external
        onlyPublisher
        returns (uint256 id)
    {
        if (
            input.asset == address(0) ||
            input.venue == address(0) ||
            input.adapter == address(0) ||
            input.capacity == 0 ||
            input.duration == 0 ||
            input.liquidityBps > 10_000 ||
            input.minReturn > input.capacity ||
            input.deadline <= block.timestamp
        ) revert Invalid();

        id = nextOpportunityId++;
        opportunities[id] = Opportunity(
            id,
            input.asset,
            input.venue,
            input.adapter,
            input.capacity,
            0,
            input.duration,
            input.liquidityBps,
            input.riskClass,
            input.usesLeverage,
            input.minReturn,
            input.deadline,
            Status.OPEN,
            input.metadataHash,
            input.venueRefId
        );
        emit OpportunityCreated(id, input.asset, input.venue, input.capacity, input.venueRefId);
    }

    function setPosition(uint256 opportunityId, uint256 positionId) external onlyModule {
        if (opportunities[opportunityId].id == 0) revert Invalid();
        if (opportunityPosition[opportunityId] != 0) revert PositionAlreadyBound();
        opportunityPosition[opportunityId] = positionId;
        emit PositionBound(opportunityId, positionId);
    }

    function clearPosition(uint256 opportunityId) external onlyModule {
        if (opportunityPosition[opportunityId] == 0) revert Invalid();
        delete opportunityPosition[opportunityId];
        emit PositionCleared(opportunityId);
    }

    function reserve(uint256 id, uint256 amount) external onlyModule {
        Opportunity storage o = opportunities[id];
        if (
            o.id == 0 || o.status != Status.OPEN || amount == 0 ||
            o.allocated + amount > o.capacity || block.timestamp > o.deadline
        ) revert Invalid();
        o.allocated += amount;
        emit Reserved(id, amount);
    }

    function release(uint256 id, uint256 amount) external onlyModule {
        Opportunity storage o = opportunities[id];
        if (amount == 0 || amount > o.allocated) revert Invalid();
        o.allocated -= amount;
        emit Released(id, amount);
    }

    function setStatus(uint256 id, Status status) external onlyModule {
        Opportunity storage o = opportunities[id];
        if (o.id == 0) revert Invalid();

        Status cur = o.status;
        bool valid =
            (cur == Status.OPEN     && (status == Status.EXECUTED || status == Status.CANCELLED)) ||
            (cur == Status.EXECUTED &&  status == Status.CLOSED);

        if (!valid) revert Invalid();
        o.status = status;
        emit StatusChanged(id, status);
    }
}