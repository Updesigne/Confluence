// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {InvoiceNFT} from "../nft/InvoiceNFT.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract Notes is ReentrancyGuard, IReceiver {
    using SafeERC20 for IERC20;

    enum Status {
        OPEN,
        FUNDED,
        REPAID,
        DEFAULTED,
        LIQUIDATED,
        CANCELLED
    }

    enum CollateralKind {
        NONE,
        WETH,
        INVOICE
    }

    struct Note {
        uint256 id;
        address borrower;
        uint256 requested;
        uint256 funded;
        uint256 collateralAmount; // WETH amount (0 for invoice notes)
        uint256 interest;
        uint256 duration;
        uint256 maturity;
        uint256 settlementCutoff;
        uint256 repaidAmount;
        bytes32 purposeHash;
        bytes32 policyHash;
        Status status;
        // --- invoice additions ---

        CollateralKind collateralKind;
        uint256 invoiceTokenId; // 0 for WETH notes
        bytes32 invoiceHash; // 0x0 for WETH notes
    }

    struct InvoiceRequest {
        uint256 id;
        address borrower;
        bytes32 invoiceHash;
        bytes32 evidenceHash;
        bytes32 policyHash;
        bytes32 purposeHash;
        uint256 requested;
        uint256 interest;
        uint256 duration;
        uint256 createdAt;
        bool processed;
        bool approved;
    }

    struct OffChainCollateral {
        bytes32 invoiceHash;
        uint256 invoiceAmount;
        uint256 riskScore; // 0-100
        uint256 advanceRateBps; // e.g. 7000 = 70%
        address debtor;
        bool verified;
        uint256 verifiedAt;
        bool financed;
    }

    uint256 public constant BPS = 10_000;

    uint256 public constant MAX_LTV_BPS = 8_000;

    uint256 public constant DEFAULT_GRACE = 1 days;

    uint256 public constant MAX_PRICE_STALENESS = 1 hours;

    uint256 public constant LIQUIDATOR_BONUS_BPS = 500;

    uint256 public constant VERIFICATION_TTL = 30 days;

    bytes1 public constant PREFIX_VERIFY = 0x00;

    bytes1 public constant PREFIX_UPDATE_RISK = 0x02;

    bytes1 public constant PREFIX_LIQUIDATE = 0x03;

    uint256 public immutable SETTLEMENT_BUFFER;

    address public immutable protocolOwner;

    IERC20 public immutable asset;

    IERC20 public immutable collateralAsset;

    AggregatorV3Interface public immutable priceFeed;

    InvoiceNFT public immutable invoiceNFT;

    uint8 public immutable assetDecimals;

    uint8 public immutable collateralDecimals;

    uint8 public immutable feedDecimals;

    uint256 public nextNoteId = 1;

    mapping(uint256 => Note) public notes;

    mapping(address => bool) public publisher;

    address public router;

    address public creForwarder;

    mapping(bytes32 => OffChainCollateral) public offChainCollaterals;

    mapping(bytes32 => bool) public financedInvoices;

    mapping(uint256 => bytes32) public noteInvoiceHash;
    uint256 public nextInvoiceRequestId = 1;
    mapping(uint256 => InvoiceRequest) public invoiceRequests;
    mapping(bytes32 => uint256) public requestIdByInvoice;
    mapping(uint256 => bool) public usedReportNonce;

    error Invalid();

    error BadState();

    error NotDue();

    error NotRouter();

    error NotOwner();

    error NotPublisher();

    error NotForwarder();

    error LtvExceeded();

    error StalePrice();

    error NotVerified();

    error AlreadyFinanced();

    error ExceedsAdvanceRate();
    error BadInvoiceRequest();
    error ReportExpired();
    error ReportReplay();
    error PolicyMismatch();

    event RouterSet(address indexed account);

    event PublisherSet(address indexed account, bool enabled);

    event CreForwarderSet(address indexed forwarder);

    event Created(
        uint256 indexed id,
        address indexed borrower,
        uint256 requested,
        uint256 collateralAmount,
        uint256 collateralPriceUsd,
        uint256 collateralValueUsd,
        uint256 duration
    );

    event RepaymentDeposited(uint256 indexed id, uint256 amount);

    event RepaymentWithdrawn(uint256 indexed id, uint256 amount);

    event Drawn(uint256 indexed id, uint256 amount);

    event Repaid(uint256 indexed id, uint256 amount);

    event Defaulted(uint256 indexed id);

    event Liquidated(uint256 indexed id, uint256 recovered);

    event Cancelled(uint256 indexed id);

    event CollateralReturned(uint256 indexed id, uint256 amount);

    event CollateralAdded(uint256 indexed id, uint256 amount);

    event UnderwaterLiquidated(
        uint256 indexed id,
        address indexed liquidator,
        uint256 collateralToLiquidator
    );

    event InvoiceVerified(
        bytes32 indexed invoiceHash,
        uint256 riskScore,
        uint256 advanceRateBps,
        uint256 invoiceAmount,
        address debtor
    );

    event InvoiceVerificationRequested(
        uint256 indexed requestId,
        bytes32 indexed invoiceHash,
        address indexed borrower,
        bytes32 evidenceHash,
        bytes32 policyHash,
        bytes32 purposeHash,
        uint256 requested,
        uint256 interest,
        uint256 duration,
        uint256 createdAt
    );
    event InvoiceVerificationRejected(
        uint256 indexed requestId,
        bytes32 indexed invoiceHash,
        uint256 riskScore
    );
    event InvoiceRiskUpdated(bytes32 indexed invoiceHash, uint256 newRiskScore);

    event InvoiceLiquidationTriggered(
        uint256 indexed noteId,
        uint256 riskScore
    );

    event InvoiceNoteCreated(
        uint256 indexed noteId,
        bytes32 indexed invoiceHash,
        uint256 invoiceTokenId,
        uint256 requested
    );

    constructor(
        address asset_,
        address collateralAsset_,
        address priceFeed_,
        address invoiceNFT_,
        uint256 settlementBuffer_
    ) {
        require(
            asset_ != address(0) &&
                collateralAsset_ != address(0) &&
                priceFeed_ != address(0) &&
                invoiceNFT_ != address(0),
            "bad ctor"
        );

        protocolOwner = msg.sender;

        publisher[msg.sender] = true;

        asset = IERC20(asset_);

        collateralAsset = IERC20(collateralAsset_);

        priceFeed = AggregatorV3Interface(priceFeed_);

        invoiceNFT = InvoiceNFT(invoiceNFT_);

        assetDecimals = IERC20Metadata(asset_).decimals();

        collateralDecimals = IERC20Metadata(collateralAsset_).decimals();

        feedDecimals = AggregatorV3Interface(priceFeed_).decimals();

        SETTLEMENT_BUFFER = settlementBuffer_;
    }

    modifier onlyOwner() {
        if (msg.sender != protocolOwner) revert NotOwner();

        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router || router == address(0)) revert NotRouter();

        _;
    }

    // ------------------------------------------------------------------

    // Admin

    // ------------------------------------------------------------------

    function setRouter(address r) external onlyOwner {
        if (r == address(0)) revert Invalid();

        router = r;

        emit RouterSet(r);
    }

    function setCreForwarder(address f) external onlyOwner {
        if (f == address(0)) revert Invalid();

        creForwarder = f;

        emit CreForwarderSet(f);
    }

    function setPublisher(address p, bool value) external onlyOwner {
        if (p == address(0)) revert Invalid();

        publisher[p] = value;

        emit PublisherSet(p, value);
    }

    // ------------------------------------------------------------------

    // Price helpers (WETH path)

    // ------------------------------------------------------------------

    function currentEthPriceUsd() public view returns (uint256 price) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        if (answer <= 0) revert Invalid();

        if (
            updatedAt == 0 ||
            updatedAt > block.timestamp ||
            block.timestamp - updatedAt > MAX_PRICE_STALENESS ||
            answeredInRound < roundId
        ) revert StalePrice();

        price = uint256(answer);
    }

    function collateralValueInAsset(
        uint256 collateralAmount,
        uint256 ethPriceUsd
    ) public view returns (uint256) {
        uint256 numerator = Math.mulDiv(collateralAmount, ethPriceUsd, 1);

        numerator = Math.mulDiv(numerator, 10 ** uint256(assetDecimals), 1);

        uint256 denominator = 10 **
            (uint256(collateralDecimals) + uint256(feedDecimals));

        return numerator / denominator;
    }

    // ------------------------------------------------------------------

    // INotes views

    // ------------------------------------------------------------------

    function maturityOf(uint256 noteId) external view returns (uint256) {
        return notes[noteId].maturity;
    }

    function noteAsset(uint256 noteId) external view returns (address) {
        if (notes[noteId].id == 0) revert Invalid();

        return address(asset);
    }

    // ------------------------------------------------------------------

    // WETH-collateralized note (existing path)

    // ------------------------------------------------------------------

    function createNote(
        uint256 requested,
        uint256 collateralAmount,
        uint256 interest,
        uint256 duration,
        bytes32 purposeHash,
        bytes32 policyHash
    ) external nonReentrant returns (uint256 id) {
        if (requested == 0 || collateralAmount == 0 || duration == 0)
            revert Invalid();

        if (interest > requested) revert Invalid();

        uint256 ethPriceUsd = currentEthPriceUsd();

        uint256 collateralUsd = collateralValueInAsset(
            collateralAmount,
            ethPriceUsd
        );

        if (Math.mulDiv(requested, BPS, collateralUsd) > MAX_LTV_BPS)
            revert LtvExceeded();

        uint256 before = collateralAsset.balanceOf(address(this));

        collateralAsset.safeTransferFrom(
            msg.sender,
            address(this),
            collateralAmount
        );

        uint256 received = collateralAsset.balanceOf(address(this)) - before;

        if (received == 0) revert Invalid();

        id = nextNoteId++;

        notes[id] = Note({
            id: id,
            borrower: msg.sender,
            requested: requested,
            funded: 0,
            collateralAmount: received,
            interest: interest,
            duration: duration,
            maturity: 0,
            settlementCutoff: 0,
            repaidAmount: 0,
            purposeHash: purposeHash,
            policyHash: policyHash,
            status: Status.OPEN,
            collateralKind: CollateralKind.WETH,
            invoiceTokenId: 0,
            invoiceHash: bytes32(0)
        });

        emit Created(
            id,
            msg.sender,
            requested,
            received,
            ethPriceUsd,
            collateralUsd,
            duration
        );
    }

    // ------------------------------------------------------------------

    // Invoice-collateralized note (new path)

    // ------------------------------------------------------------------

    /// @notice Creates a borrower-bound, immutable request for CRE policy evaluation.
    function requestInvoiceVerification(
        bytes32 invoiceHash,
        bytes32 evidenceHash,
        bytes32 policyHash,
        bytes32 purposeHash,
        uint256 requested,
        uint256 interest,
        uint256 duration
    ) external nonReentrant returns (uint256 requestId) {
        if (
            invoiceHash == bytes32(0) ||
            evidenceHash == bytes32(0) ||
            policyHash == bytes32(0) ||
            purposeHash == bytes32(0) ||
            requested == 0 ||
            duration == 0 ||
            interest > requested ||
            financedInvoices[invoiceHash]
        ) revert BadInvoiceRequest();
        uint256 previousId = requestIdByInvoice[invoiceHash];
        if (previousId != 0) {
            InvoiceRequest storage previous = invoiceRequests[previousId];
            bool previousExpired = block.timestamp >
                previous.createdAt + VERIFICATION_TTL;
            if (!previousExpired && (!previous.processed || previous.approved))
                revert BadInvoiceRequest();
        }
        requestId = nextInvoiceRequestId++;
        invoiceRequests[requestId] = InvoiceRequest({
            id: requestId,
            borrower: msg.sender,
            invoiceHash: invoiceHash,
            evidenceHash: evidenceHash,
            policyHash: policyHash,
            purposeHash: purposeHash,
            requested: requested,
            interest: interest,
            duration: duration,
            createdAt: block.timestamp,
            processed: false,
            approved: false
        });
        requestIdByInvoice[invoiceHash] = requestId;
        emit InvoiceVerificationRequested(
            requestId,
            invoiceHash,
            msg.sender,
            evidenceHash,
            policyHash,
            purposeHash,
            requested,
            interest,
            duration,
            block.timestamp
        );
    }

    function createNoteWithInvoice(
        bytes32 invoiceHash,
        uint256 requested,
        uint256 interest,
        uint256 duration,
        bytes32 purposeHash,
        bytes32 policyHash,
        string calldata pdfUri
    ) external nonReentrant returns (uint256 id) {
        if (requested == 0 || duration == 0 || interest > requested)
            revert Invalid();
        uint256 requestId = requestIdByInvoice[invoiceHash];
        if (requestId == 0) revert BadInvoiceRequest();
        InvoiceRequest storage req = invoiceRequests[requestId];
        if (
            req.borrower != msg.sender ||
            !req.processed ||
            !req.approved ||
            req.invoiceHash != invoiceHash ||
            req.requested != requested ||
            req.interest != interest ||
            req.duration != duration ||
            req.purposeHash != purposeHash ||
            req.policyHash != policyHash
        ) revert PolicyMismatch();
        if (block.timestamp > req.createdAt + VERIFICATION_TTL)
            revert NotVerified();
        OffChainCollateral storage oc = offChainCollaterals[invoiceHash];
        if (!oc.verified) revert NotVerified();
        if (financedInvoices[invoiceHash] || oc.financed)
            revert AlreadyFinanced();
        if (
            block.timestamp < oc.verifiedAt ||
            block.timestamp - oc.verifiedAt > VERIFICATION_TTL
        ) revert NotVerified();
        uint256 maxBorrow = (oc.invoiceAmount * oc.advanceRateBps) / BPS;
        if (requested > maxBorrow) revert ExceedsAdvanceRate();

        uint256 tokenId = invoiceNFT.mint(
            address(this),
            invoiceHash,
            oc.invoiceAmount,
            oc.advanceRateBps,
            oc.riskScore,
            oc.debtor,
            block.timestamp + duration,
            pdfUri
        );
        financedInvoices[invoiceHash] = true;
        oc.financed = true;
        id = nextNoteId++;
        notes[id] = Note({
            id: id,
            borrower: msg.sender,
            requested: requested,
            funded: 0,
            collateralAmount: 0,
            interest: interest,
            duration: duration,
            maturity: 0,
            settlementCutoff: 0,
            repaidAmount: 0,
            purposeHash: purposeHash,
            policyHash: policyHash,
            status: Status.OPEN,
            collateralKind: CollateralKind.INVOICE,
            invoiceTokenId: tokenId,
            invoiceHash: invoiceHash
        });
        noteInvoiceHash[id] = invoiceHash;
        emit InvoiceNoteCreated(id, invoiceHash, tokenId, requested);
    }

    // ------------------------------------------------------------------
    // CRE report handler
    // ------------------------------------------------------------------

    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != creForwarder || creForwarder == address(0))
            revert NotForwarder();
        if (report.length <= 1) revert Invalid();
        bytes1 prefix = report[0];
        bytes calldata payload = report[1:];
        if (prefix == PREFIX_VERIFY) {
            (
                uint256 requestId,
                bytes32 invoiceHash,
                address borrower,
                bytes32 policyHash,
                bool approved,
                uint256 riskScore,
                uint256 advanceRateBps,
                uint256 invoiceAmount,
                address debtor,
                bytes32 evidenceHash,
                uint256 validUntil,
                uint256 reportNonce
            ) = abi.decode(
                    payload,
                    (
                        uint256,
                        bytes32,
                        address,
                        bytes32,
                        bool,
                        uint256,
                        uint256,
                        uint256,
                        address,
                        bytes32,
                        uint256,
                        uint256
                    )
                );
            InvoiceRequest storage req = invoiceRequests[requestId];
            if (req.id == 0 || req.processed) revert BadInvoiceRequest();
            if (
                req.invoiceHash != invoiceHash ||
                req.borrower != borrower ||
                req.policyHash != policyHash ||
                req.evidenceHash != evidenceHash ||
                requestIdByInvoice[invoiceHash] != requestId
            ) revert PolicyMismatch();
            if (validUntil > req.createdAt + VERIFICATION_TTL)
                revert ReportExpired();
            _consumeReportNonce(reportNonce, validUntil);
            if (
                riskScore > 100 ||
                advanceRateBps > BPS ||
                invoiceAmount == 0 ||
                debtor == address(0)
            ) revert Invalid();
            if (financedInvoices[invoiceHash]) revert AlreadyFinanced();
            req.processed = true;
            req.approved = approved;
            if (!approved) {
                delete requestIdByInvoice[invoiceHash];
                emit InvoiceVerificationRejected(
                    requestId,
                    invoiceHash,
                    riskScore
                );
                return;
            }
            if (riskScore > 35 || advanceRateBps > 7000 || advanceRateBps == 0)
                revert Invalid();
            offChainCollaterals[invoiceHash] = OffChainCollateral({
                invoiceHash: invoiceHash,
                invoiceAmount: invoiceAmount,
                riskScore: riskScore,
                advanceRateBps: advanceRateBps,
                debtor: debtor,
                verified: true,
                verifiedAt: block.timestamp,
                financed: false
            });
            emit InvoiceVerified(
                invoiceHash,
                riskScore,
                advanceRateBps,
                invoiceAmount,
                debtor
            );
        } else if (prefix == PREFIX_UPDATE_RISK) {
            (
                bytes32 invoiceHash,
                uint256 newRiskScore,
                uint256 validUntil,
                uint256 reportNonce
            ) = abi.decode(payload, (bytes32, uint256, uint256, uint256));
            OffChainCollateral storage oc = offChainCollaterals[invoiceHash];
            if (!oc.verified || newRiskScore > 100) revert Invalid();
            _consumeReportNonce(reportNonce, validUntil);
            oc.riskScore = newRiskScore;
            emit InvoiceRiskUpdated(invoiceHash, newRiskScore);
        } else if (prefix == PREFIX_LIQUIDATE) {
            (
                uint256 noteId,
                uint256 riskScore,
                uint256 validUntil,
                uint256 reportNonce
            ) = abi.decode(payload, (uint256, uint256, uint256, uint256));
            Note storage n = notes[noteId];
            if (
                n.id == 0 ||
                n.collateralKind != CollateralKind.INVOICE ||
                n.status != Status.FUNDED
            ) revert BadState();
            if (riskScore < 70 || riskScore > 100) revert Invalid();
            _consumeReportNonce(reportNonce, validUntil);
            n.status = Status.DEFAULTED;
            emit InvoiceLiquidationTriggered(noteId, riskScore);
        } else {
            revert Invalid();
        }
    }

    function _consumeReportNonce(
        uint256 reportNonce,
        uint256 validUntil
    ) internal {
        if (reportNonce == 0 || usedReportNonce[reportNonce])
            revert ReportReplay();
        if (
            validUntil < block.timestamp ||
            validUntil > block.timestamp + VERIFICATION_TTL
        ) revert ReportExpired();
        usedReportNonce[reportNonce] = true;
    }

    // ------------------------------------------------------------------
    // Repayment / draw / settlement

    // ------------------------------------------------------------------

    function depositRepayment(uint256 id) external nonReentrant {
        Note storage n = notes[id];

        if (msg.sender != n.borrower) revert Invalid();

        if (n.status != Status.FUNDED && n.status != Status.DEFAULTED) {
            revert BadState();
        }

        uint256 owed = n.requested + n.interest;

        if (n.repaidAmount >= owed) revert BadState();

        uint256 shortfall = owed - n.repaidAmount;

        asset.safeTransferFrom(msg.sender, address(this), shortfall);

        n.repaidAmount += shortfall;

        emit RepaymentDeposited(id, shortfall);
    }

    function withdrawRepayment(uint256 id) external nonReentrant {
        Note storage n = notes[id];

        if (msg.sender != n.borrower) revert Invalid();

        if (n.status == Status.REPAID) revert BadState();

        if (n.repaidAmount == 0) revert Invalid();

        if (block.timestamp < n.settlementCutoff) {
            revert NotDue();
        }

        uint256 amount = n.repaidAmount;

        n.repaidAmount = 0;

        asset.safeTransfer(n.borrower, amount);

        emit RepaymentWithdrawn(id, amount);
    }

    function draw(uint256 id, uint256 amount) external onlyRouter nonReentrant {
        Note storage n = notes[id];

        if (n.status != Status.OPEN) revert Invalid();

        if (amount == 0 || amount != n.requested) {
            revert Invalid();
        }

        uint256 balance = asset.balanceOf(address(this));

        if (balance < amount) revert Invalid();

        n.funded = amount;

        n.maturity = block.timestamp + n.duration;

        n.settlementCutoff = n.maturity + SETTLEMENT_BUFFER;

        n.status = Status.FUNDED;

        asset.safeTransfer(n.borrower, amount);

        emit Drawn(id, amount);
    }

    function markRepaid(
        uint256 id
    ) external nonReentrant returns (uint256 amount) {
        Note storage n = notes[id];

        if (n.status != Status.FUNDED && n.status != Status.DEFAULTED) {
            revert BadState();
        }

        if (block.timestamp < n.maturity) {
            revert NotDue();
        }

        bool allowed = msg.sender == router ||
            block.timestamp >= n.maturity + DEFAULT_GRACE;

        if (!allowed) revert Invalid();

        uint256 owed = n.requested + n.interest;

        if (n.repaidAmount < owed) {
            revert Invalid();
        }

        amount = n.repaidAmount;

        n.repaidAmount = 0;

        n.status = Status.REPAID;

        asset.safeTransfer(router, amount);

        emit Repaid(id, amount);
    }

    function liquidate(
        uint256 id
    ) external onlyRouter nonReentrant returns (uint256 recovered) {
        Note storage n = notes[id];

        if (n.status != Status.FUNDED && n.status != Status.DEFAULTED)
            revert BadState();

        if (n.collateralKind == CollateralKind.WETH) {
            recovered = n.collateralAmount;

            n.collateralAmount = 0;

            collateralAsset.safeTransfer(msg.sender, recovered);
        } else if (n.collateralKind == CollateralKind.INVOICE) {
            // Transfer the InvoiceNFT to the liquidator (router).

            n.status = Status.LIQUIDATED;

            invoiceNFT.safeTransferFrom(
                address(this),
                msg.sender,
                n.invoiceTokenId
            );

            recovered = 0; // NFT face value is not cash recovery; collection is off-chain
        } else {
            revert BadState();
        }

        n.status = Status.LIQUIDATED;

        emit Liquidated(id, recovered);
    }

    function addCollateral(uint256 id, uint256 amount) external nonReentrant {
        Note storage n = notes[id];

        if (msg.sender != n.borrower) revert Invalid();

        if (n.status != Status.FUNDED && n.status != Status.DEFAULTED)
            revert BadState();

        if (n.collateralKind != CollateralKind.WETH) revert BadState();

        if (amount == 0) revert Invalid();

        uint256 before = collateralAsset.balanceOf(address(this));

        collateralAsset.safeTransferFrom(msg.sender, address(this), amount);

        uint256 received = collateralAsset.balanceOf(address(this)) - before;

        if (received == 0) revert Invalid();

        n.collateralAmount += received;

        emit CollateralAdded(id, received);
    }

    function liquidateUnderwater(uint256 id) external nonReentrant {
        Note storage n = notes[id];

        if (n.collateralKind != CollateralKind.WETH) revert BadState();

        if (n.status != Status.FUNDED && n.status != Status.DEFAULTED)
            revert BadState();

        uint256 price = currentEthPriceUsd();

        uint256 currentValue = collateralValueInAsset(
            n.collateralAmount,
            price
        );

        if (
            Math.mulDiv(n.requested, BPS, 1) <=
            Math.mulDiv(currentValue, MAX_LTV_BPS, 1)
        ) revert Invalid();

        uint256 collateral = n.collateralAmount;

        n.collateralAmount = 0;

        n.status = Status.LIQUIDATED;

        uint256 toLiquidator = (collateral * LIQUIDATOR_BONUS_BPS) / BPS;

        uint256 toRouter = collateral - toLiquidator;

        if (toLiquidator > 0)
            collateralAsset.safeTransfer(msg.sender, toLiquidator);

        if (toRouter > 0) collateralAsset.safeTransfer(router, toRouter);

        emit UnderwaterLiquidated(id, msg.sender, toLiquidator);
    }

    function withdrawCollateral(uint256 id) external nonReentrant {
        Note storage n = notes[id];

        if (msg.sender != n.borrower) revert Invalid();

        if (n.status != Status.REPAID) revert BadState();

        if (n.collateralKind == CollateralKind.WETH) {
            if (n.collateralAmount == 0) revert Invalid();

            uint256 amount = n.collateralAmount;

            n.collateralAmount = 0;

            collateralAsset.safeTransfer(n.borrower, amount);

            emit CollateralReturned(id, amount);
        } else if (n.collateralKind == CollateralKind.INVOICE) {
            invoiceNFT.safeTransferFrom(
                address(this),
                n.borrower,
                n.invoiceTokenId
            );

            emit CollateralReturned(id, n.invoiceTokenId);
        }
    }

    function cancel(uint256 id) external nonReentrant {
        Note storage n = notes[id];

        if (
            n.status != Status.OPEN || n.funded != 0 || msg.sender != n.borrower
        ) revert BadState();

        n.status = Status.CANCELLED;

        if (n.collateralKind == CollateralKind.WETH) {
            uint256 amount = n.collateralAmount;

            n.collateralAmount = 0;

            collateralAsset.safeTransfer(n.borrower, amount);
        } else if (n.collateralKind == CollateralKind.INVOICE) {
            // Unlock the hash so the borrower can re-submit.

            financedInvoices[n.invoiceHash] = false;

            offChainCollaterals[n.invoiceHash].financed = false;

            invoiceNFT.safeTransferFrom(
                address(this),
                n.borrower,
                n.invoiceTokenId
            );
        }

        emit Cancelled(id);
    }

    function markDefault(uint256 id) external {
        if (!publisher[msg.sender] && msg.sender != protocolOwner)
            revert NotPublisher();

        Note storage n = notes[id];

        if (
            n.status != Status.FUNDED ||
            block.timestamp < n.maturity + DEFAULT_GRACE
        ) revert NotDue();

        n.status = Status.DEFAULTED;

        emit Defaulted(id);
    }

    // ------------------------------------------------------------------

    // CRE read helpers

    // ------------------------------------------------------------------

    function getNote(uint256 id) external view returns (Note memory) {
        return notes[id];
    }

    function getActiveInvoiceNotes() external view returns (uint256[] memory) {
        uint256 count;

        for (uint256 i = 1; i < nextNoteId; ++i) {
            if (
                notes[i].collateralKind == CollateralKind.INVOICE &&
                notes[i].status == Status.FUNDED
            ) count++;
        }

        uint256[] memory out = new uint256[](count);

        uint256 j;

        for (uint256 i = 1; i < nextNoteId; ++i) {
            if (
                notes[i].collateralKind == CollateralKind.INVOICE &&
                notes[i].status == Status.FUNDED
            ) out[j++] = i;
        }

        return out;
    }

    function getOffChainCollateral(
        bytes32 invoiceHash
    ) external view returns (OffChainCollateral memory) {
        return offChainCollaterals[invoiceHash];
    }
}
