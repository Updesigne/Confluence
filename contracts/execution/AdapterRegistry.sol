// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Venue/adapter and function-selector allowlist used by ExecutionRouter.
contract AdapterRegistry {
    address public immutable protocolOwner;
    mapping(address => mapping(address => bool)) public enabled; // adapter => venue
    mapping(address => mapping(address => mapping(address => mapping(bytes4 => bool)))) public selectorEnabled;

    error NotOwner();
    error Invalid();
    event AdapterSet(address indexed adapter, address indexed venue, bool enabled);
    event SelectorSet(address indexed adapter, address indexed venue, address indexed target, bytes4 selector, bool enabled);

    constructor() { protocolOwner = msg.sender; }

    modifier onlyOwner() {
        if (msg.sender != protocolOwner) revert NotOwner();
        _;
    }

    function setAdapter(address adapter, address venue, bool value) external onlyOwner {
        if (adapter == address(0) || venue == address(0)) revert Invalid();
        enabled[adapter][venue] = value;
        emit AdapterSet(adapter, venue, value);
    }

    function setSelector(address adapter, address venue, address target, bytes4 selector, bool value) external onlyOwner {
        if (adapter == address(0) || venue == address(0) || target == address(0)) revert Invalid();
        if (!enabled[adapter][venue]) revert Invalid();
        selectorEnabled[adapter][venue][target][selector] = value;
        emit SelectorSet(adapter, venue, target, selector, value);
    }

    function isEnabled(address adapter, address venue) external view returns (bool) {
        return enabled[adapter][venue];
    }

    function isSelectorEnabled(address adapter, address venue, address target, bytes4 selector) external view returns (bool) {
        return selectorEnabled[adapter][venue][target][selector];
    }
}