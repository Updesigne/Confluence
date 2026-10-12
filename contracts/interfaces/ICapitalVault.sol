// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICapitalVault {
    function asset() external view returns (address);
    function ownerOf(uint256 accountId) external view returns (address);
    function commit(uint256 accountId, uint256 amount) external;
    function releaseCommitment(uint256 accountId, uint256 amount) external;
    function deployAggregate(
        uint256[] calldata accountIds,
        uint256[] calldata amounts,
        address recipient
    ) external;
    function settleAggregateParticipant(
        uint256 accountId,
        uint256 principal,
        uint256 returnedAmount
    ) external;
    function closeAggregateSettlement(uint256 principal) external;
}