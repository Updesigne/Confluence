// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Tokenized representation of an assigned invoice receivable.
/// @dev    Minted only by the Notes contract (owner). Holds metadata
///         off-chain via `pdfUri`; on-chain stores the verification facts.
contract InvoiceNFT is ERC721, Ownable {
    struct InvoiceMetadata {
        bytes32 invoiceHash;
        uint256 invoiceAmount;
        uint256 advanceRateBps;
        uint256 riskScore;
        address debtor;
        uint256 dueDate;
        uint256 verifiedAt;
        string  pdfUri;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => InvoiceMetadata) public metadata;
    mapping(bytes32 => uint256) public tokenByHash;

    event InvoiceMinted(
        uint256 indexed tokenId,
        bytes32 indexed invoiceHash,
        address indexed borrower,
        uint256 invoiceAmount,
        uint256 advanceRateBps
    );

    constructor() ERC721("Confluence Invoice", "cINV") Ownable(msg.sender) {}

    function mint(
        address to,
        bytes32 invoiceHash,
        uint256 invoiceAmount,
        uint256 advanceRateBps,
        uint256 riskScore,
        address debtor,
        uint256 dueDate,
        string calldata pdfUri
    ) external onlyOwner returns (uint256 tokenId) {
        require(tokenByHash[invoiceHash] == 0, "InvoiceNFT: already minted");
        require(to != address(0), "InvoiceNFT: bad recipient");

        tokenId = nextTokenId++;
        tokenByHash[invoiceHash] = tokenId;

        metadata[tokenId] = InvoiceMetadata({
            invoiceHash: invoiceHash,
            invoiceAmount: invoiceAmount,
            advanceRateBps: advanceRateBps,
            riskScore: riskScore,
            debtor: debtor,
            dueDate: dueDate,
            verifiedAt: block.timestamp,
            pdfUri: pdfUri
        });

        _mint(to, tokenId);
        emit InvoiceMinted(tokenId, invoiceHash, to, invoiceAmount, advanceRateBps);
    }
}