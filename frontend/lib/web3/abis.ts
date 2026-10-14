export const VAULT_ABI = [
  'function nextAccountId() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function account(uint256) view returns (tuple(address owner, uint256 available, uint256 committed, uint256 deployed, uint256 collateralized, bool active))',
  'function accountsOf(address) view returns (uint256[])',
  'function totalLiabilities() view returns (uint256)',
  'function totalCommitted() view returns (uint256)',
  'function externalBacking() view returns (uint256)',
  'function createAccount() returns (uint256)',
  'function deposit(uint256,uint256)',
  'function withdraw(uint256,uint256)',
  'event AccountCreated(uint256 indexed accountId, address indexed owner)',
  'event Deposited(uint256 indexed accountId, uint256 amount)',
  'event Withdrawn(uint256 indexed accountId, uint256 amount)',
  'event Committed(uint256 indexed accountId, uint256 amount)',
  'event CommitmentReleased(uint256 indexed accountId, uint256 amount)',
  'event AggregateDeployed(uint256 amount, address indexed recipient)',
  'event SettlementReceived(uint256 indexed accountId, uint256 principal, uint256 returnedAmount)',
] as const

export const MANDATE_REGISTRY_ABI = [
  'function nextMandateId() view returns (uint256)',
  'function mandates(uint256) view returns (uint256 id, uint256 accountId, address owner, address asset, uint256 maxAllocation, uint256 minDuration, uint256 maxDuration, uint256 minLiquidityBps, uint8 maxRiskClass, bool leverageAllowed, bytes32 purposeHash, bytes32 policyHash, bool active, uint256 reserved)',
  'function getMandate(uint256) view returns (tuple(uint256 id, uint256 accountId, address owner, address asset, uint256 maxAllocation, uint256 minDuration, uint256 maxDuration, uint256 minLiquidityBps, uint8 maxRiskClass, bool leverageAllowed, bytes32 purposeHash, bytes32 policyHash, bool active, uint256 reserved))',
  'function createMandate(tuple(uint256 accountId, address asset, address[] initialVenues, uint256 maxAllocation, uint256 minDuration, uint256 maxDuration, uint256 minLiquidityBps, uint8 maxRiskClass, bool leverageAllowed, bytes32 purposeHash, bytes32 policyHash) input) returns (uint256)',
  'function venueCount(uint256 mandateId) view returns (uint256)',
  'function venueAllowed(uint256 mandateId, address venue) view returns (bool)',
  'function isVenueAllowed(uint256 mandateId, address venue) view returns (bool)',
  'function addVenue(uint256 mandateId, address venue)',
  'function removeVenue(uint256 mandateId, address venue)',
  'function setActive(uint256,bool)',
  'function isCompliant(uint256,address,address,uint256,uint256,uint256,uint8,bool) view returns (bool)',
  'event MandateCreated(uint256 indexed mandateId, uint256 indexed accountId, address indexed owner)',
  'event ActiveSet(uint256 indexed mandateId, bool active)',
  'event VenueAdded(uint256 indexed mandateId, address indexed venue)',
  'event VenueRemoved(uint256 indexed mandateId, address indexed venue)',
] as const

export const OPPORTUNITY_REGISTRY_ABI = [
  'function protocolOwner() view returns (address)',
  'function publisher(address) view returns (bool)',
  'function nextOpportunityId() view returns (uint256)',
  'function opportunities(uint256) view returns (uint256 id, address asset, address venue, address adapter, uint256 capacity, uint256 allocated, uint256 duration, uint256 liquidityBps, uint8 riskClass, bool usesLeverage, uint256 minReturn, uint256 deadline, uint8 status, bytes32 metadataHash, uint256 venueRefId)',
  'function getOpportunity(uint256) view returns (tuple(uint256 id, address asset, address venue, address adapter, uint256 capacity, uint256 allocated, uint256 duration, uint256 liquidityBps, uint8 riskClass, bool usesLeverage, uint256 minReturn, uint256 deadline, uint8 status, bytes32 metadataHash, uint256 venueRefId))',
  'function opportunityPosition(uint256) view returns (uint256)',
  'function createOpportunity(tuple(address asset, address venue, address adapter, uint256 capacity, uint256 duration, uint256 liquidityBps, uint8 riskClass, bool usesLeverage, uint256 minReturn, uint256 deadline, bytes32 metadataHash, uint256 venueRefId) input) returns (uint256)',
  'event OpportunityCreated(uint256 indexed id, address indexed asset, address indexed venue, uint256 capacity, uint256 venueRefId)',
] as const

export const CONFLUENCE_ABI = [
  'function nextId() view returns (uint256)',
  'function positions(uint256) view returns (uint256 id, uint256 opportunityId, address creator, address asset, address venue, address adapter, uint256 target, uint256 totalPrincipal, uint256 totalShares, uint256 maturity, uint256 returnedTotal, uint256 minReturn, uint256 emergencyMinReturn, uint256 executionDeadline, uint256 settlementDeadline, uint256 nonce, bytes32 executionHash, bytes32 settlementHash, bytes32 emergencySettlementHash, bytes32 positionMetadataHash, uint8 status)',
  'function participants(uint256,uint256) view returns (uint256 accountId, uint256 mandateId, uint256 principal, uint256 shares, bool realized)',
  'function participantAccounts(uint256) view returns (uint256[])',
  'function create(uint256,uint256,uint256,uint256,uint256) returns (uint256)',
  'function addParticipant(uint256,uint256,uint256,uint256)',
  'function addParticipants(uint256,tuple(uint256 accountId,uint256 mandateId,uint256 amount)[])',
  'function removeParticipant(uint256,uint256)',
  'function lockPlan(uint256,tuple(bytes32 executionHash, bytes32 settlementHash, bytes32 emergencySettlementHash, bytes32 positionMetadataHash, uint256 maturity, uint256 emergencyMinReturn) plan)',
  'function execute(uint256,tuple(address target, uint256 value, bytes data)[] calls)',
  'function settle(uint256,tuple(address target, uint256 value, bytes data)[] calls)',
  'function emergencyExit(uint256,tuple(address target, uint256 value, bytes data)[] calls)',
  'function cancel(uint256)',
  'function sweepCancelled(uint256)',
  'event Created(uint256 indexed id, uint256 indexed opportunityId, address indexed creator, uint256 target)',
  'event ParticipantAdded(uint256 indexed id, uint256 indexed accountId, uint256 amount)',
  'event PlanLocked(uint256 indexed id, bytes32 executionHash, bytes32 settlementHash, bytes32 emergencyHash, uint256 nonce)',
  'event Executed(uint256 indexed id, bytes32 executionHash, uint256 maturity)',
  'event Settled(uint256 indexed id, uint256 returnedAmount, bool emergency)',
  'event Realized(uint256 indexed id, uint256 indexed accountId, uint256 returnedAmount)',
  'event Cancelled(uint256 indexed id)',
] as const

export const NOTES_ABI = [
  'function nextNoteId() view returns (uint256)',
  'function notes(uint256) view returns (uint256 id, address borrower, uint256 requested, uint256 funded, uint256 collateralAmount, uint256 interest, uint256 duration, uint256 maturity, uint256 settlementCutoff, uint256 repaidAmount, bytes32 purposeHash, bytes32 policyHash, uint8 status, uint8 collateralKind, uint256 invoiceTokenId, bytes32 invoiceHash)',
  'function getNote(uint256) view returns (tuple(uint256 id, address borrower, uint256 requested, uint256 funded, uint256 collateralAmount, uint256 interest, uint256 duration, uint256 maturity, uint256 settlementCutoff, uint256 repaidAmount, bytes32 purposeHash, bytes32 policyHash, uint8 status, uint8 collateralKind, uint256 invoiceTokenId, bytes32 invoiceHash))',
  'function currentEthPriceUsd() view returns (uint256)',
  'function asset() view returns (address)',
  'function draw(uint256,uint256)',
  'function markRepaid(uint256) returns (uint256)',
  'function collateralValueInAsset(uint256,uint256) view returns (uint256)',
  'function createNote(uint256,uint256,uint256,uint256,bytes32,bytes32) returns (uint256)',
  'function depositRepayment(uint256)',
  'function withdrawRepayment(uint256)',
  'function addCollateral(uint256,uint256)',
  'function liquidateUnderwater(uint256)',
  'function withdrawCollateral(uint256)',
  'function cancel(uint256)',
  'function invoiceNFT() view returns (address)',
  'function creForwarder() view returns (address)',
  'function protocolOwner() view returns (address)',
  'function nextInvoiceRequestId() view returns (uint256)',
  'function requestIdByInvoice(bytes32) view returns (uint256)',
  'function invoiceRequests(uint256) view returns (uint256 id, address borrower, bytes32 invoiceHash, bytes32 evidenceHash, bytes32 policyHash, bytes32 purposeHash, uint256 requested, uint256 interest, uint256 duration, uint256 createdAt, bool processed, bool approved)',
  'function offChainCollaterals(bytes32) view returns (bytes32 invoiceHash, uint256 invoiceAmount, uint256 riskScore, uint256 advanceRateBps, address debtor, bool verified, uint256 verifiedAt, bool financed)',
  'function financedInvoices(bytes32) view returns (bool)',
  'function requestInvoiceVerification(bytes32 invoiceHash, bytes32 evidenceHash, bytes32 policyHash, bytes32 purposeHash, uint256 requested, uint256 interest, uint256 duration) returns (uint256)',
  'function createNoteWithInvoice(bytes32 invoiceHash, uint256 requested, uint256 interest, uint256 duration, bytes32 purposeHash, bytes32 policyHash, string pdfUri) returns (uint256)',
  'function onReport(bytes metadata, bytes report)',
  'function setCreForwarder(address forwarder)',
  'event Created(uint256 indexed id, address indexed borrower, uint256 requested, uint256 collateralAmount, uint256 collateralPriceUsd, uint256 collateralValueUsd, uint256 duration)',
  'event Drawn(uint256 indexed id, uint256 amount)',
  'event Repaid(uint256 indexed id, uint256 amount)',
  'event CollateralAdded(uint256 indexed id, uint256 amount)',
  'event UnderwaterLiquidated(uint256 indexed id, address indexed liquidator, uint256 collateralToLiquidator)',
  'event InvoiceVerificationRequested(uint256 indexed requestId, bytes32 indexed invoiceHash, address indexed borrower, bytes32 evidenceHash, bytes32 policyHash, bytes32 purposeHash, uint256 requested, uint256 interest, uint256 duration, uint256 createdAt)',
  'event InvoiceVerified(bytes32 indexed invoiceHash, uint256 riskScore, uint256 advanceRateBps, uint256 invoiceAmount, address debtor)',
  'event InvoiceVerificationRejected(uint256 indexed requestId, bytes32 indexed invoiceHash, uint256 riskScore)',
  'event InvoiceNoteCreated(uint256 indexed noteId, bytes32 indexed invoiceHash, uint256 invoiceTokenId, uint256 requested)',
] as const

export const INVOICE_NFT_ABI = [
  'function nextTokenId() view returns (uint256)',
  'function tokenByHash(bytes32) view returns (uint256)',
  'function metadata(uint256) view returns (tuple(bytes32 invoiceHash, uint256 invoiceAmount, uint256 advanceRateBps, uint256 riskScore, address debtor, uint256 dueDate, uint256 verifiedAt, string pdfUri))',
  'function ownerOf(uint256) view returns (address)',
  'function owner() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'event InvoiceMinted(uint256 indexed tokenId, bytes32 indexed invoiceHash, address indexed borrower, uint256 invoiceAmount, uint256 advanceRateBps)',
] as const

export const ROUTER_ABI = [
  'function hashCalls(tuple(address target, uint256 value, bytes data)[] calls) pure returns (bytes32)',
] as const

export const ADAPTER_REGISTRY_ABI = [
  'function isEnabled(address adapter,address venue) view returns (bool)',
] as const

export const MOCK_USDG_POOL_ABI = [
  'function priceUsdcPerUsdgE6() view returns (uint256)',
  'function setPrice(uint256 usdcPerUsdgE6)',
  'function quote() view returns (uint256 usdcPerUsdgE6,uint256 depth)',
] as const

export const USDG_DEPEG_ADAPTER_ABI = [
  'function nextHedgeId() view returns (uint256)',
  'function open(uint256 usdgIn,uint256 minUsdcOut) returns (uint256 hedgeId,uint256 usdcOut)',
  'function close(uint256 hedgeId,uint256 minUsdgOut) returns (uint256 usdgOut)',
  'function hedges(uint256) view returns (address opener,uint256 usdgIn,uint256 usdcHeld,uint256 openedAt,bool closed)',
] as const

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
] as const