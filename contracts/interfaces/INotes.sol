// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only view used by Confluence to verify the venue's actual maturity.
interface INotes {
    function maturityOf(uint256 noteId) external view returns (uint256);
    function noteAsset(uint256 noteId) external view returns (address);
}