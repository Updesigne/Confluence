import {
  Runner,
  cre,
  consensusIdenticalAggregation,
  HTTPClient,
  TxStatus,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  LATEST_BLOCK_NUMBER,
  prepareReportRequest,
  ok,
  json,
  bytesToHex,
  type HTTPSendRequester,
  type HTTPPayload,
} from "@chainlink/cre-sdk";
import { EVM_PB } from "@chainlink/cre-sdk/pb";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  concat,
  zeroAddress,
  recoverMessageAddress,
  type Address,
} from "viem";
import { z } from "zod";
import { evaluate, type Evidence } from "./policy.js";

const ConfigSchema = z.object({
  apiUrl: z
  .string()
  .regex(/^https?:\/\/\S+$/i, "apiUrl must be an HTTP(S) URL"),
  expectedPolicyHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  evidenceSignerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  gasLimit: z.string().default("500000"),
  authorizedKeys: z
    .array(
      z.object({
        type: z.literal("KEY_TYPE_ECDSA_EVM"),
        publicKey: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      }),
    )
    .min(1),
  evm: z.object({
    chainSelectorName: z.string(),
    notesAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
});
type Config = z.infer<typeof ConfigSchema>;
type TriggerInput = {
  requestId: string;
  invoiceHash: `0x${string}`;
  evidenceHash: `0x${string}`;
  borrower: `0x${string}`;
  policyHash: `0x${string}`;
  reportNonce: string;
};

const REQUEST_ABI = [
  {
    type: "function",
    name: "invoiceRequests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "borrower", type: "address" },
      { name: "invoiceHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "policyHash", type: "bytes32" },
      { name: "purposeHash", type: "bytes32" },
      { name: "requested", type: "uint256" },
      { name: "interest", type: "uint256" },
      { name: "duration", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "processed", type: "bool" },
      { name: "approved", type: "bool" },
    ],
  },
] as const;

const fetchEvidence = (
  sender: HTTPSendRequester,
  args: { url: string },
): Evidence => {
  const response = sender
    .sendRequest({ url: args.url, method: "GET" })
    .result();
  if (!ok(response))
    throw new Error(`Evidence API failed: ${response.statusCode}`);
  const record = json(response) as {
    invoiceHash: string;
    evidenceHash: string;
    signature: string | null;
    signer: string | null;
    canonical: Evidence["canonical"];
    mockChecks: Evidence["mockChecks"];
  };
  if (!record.signature || !record.signer)
    throw new Error(
      "API evidence is unsigned; configure INVOICE_API_SIGNER_PRIVATE_KEY",
    );
  return {
    invoiceHash: record.invoiceHash as `0x${string}`,
    evidenceHash: record.evidenceHash as `0x${string}`,
    signature: record.signature as `0x${string}`,
    signer: record.signer as `0x${string}`,
    canonical: record.canonical,
    mockChecks: record.mockChecks,
  };
};

async function onHttpTrigger(runtime: any, payload: HTTPPayload) {
  const config = runtime.config as Config;
  const input = JSON.parse(
    new TextDecoder().decode(payload.input),
  ) as TriggerInput;
  const requestId = BigInt(input.requestId);
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evm.chainSelectorName,
    isTestnet: true,
  });
  if (!network)
    throw new Error(`CRE network not found: ${config.evm.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const readData = encodeFunctionData({
    abi: REQUEST_ABI,
    functionName: "invoiceRequests",
    args: [requestId],
  });
  const read = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.evm.notesAddress as Address,
        data: readData,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const request = decodeFunctionResult({
    abi: REQUEST_ABI,
    functionName: "invoiceRequests",
    data: bytesToHex(read.data),
  }) as readonly [
    bigint,
    string,
    string,
    string,
    string,
    string,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
    boolean,
  ];
  const [
    id,
    borrower,
    invoiceHash,
    evidenceHash,
    policyHash,
    _purposeHash,
    _requested,
    _interest,
    _duration,
    createdAt,
    processed,
  ] = request;
  if (id !== requestId || processed)
    throw new Error("Request does not exist or has already been processed");
  if (
    borrower.toLowerCase() !== input.borrower.toLowerCase() ||
    invoiceHash.toLowerCase() !== input.invoiceHash.toLowerCase() ||
    evidenceHash.toLowerCase() !== input.evidenceHash.toLowerCase() ||
    policyHash.toLowerCase() !== input.policyHash.toLowerCase()
  )
    throw new Error("Trigger payload does not match on-chain request");
  if (policyHash.toLowerCase() !== config.expectedPolicyHash.toLowerCase())
    throw new Error(
      "Policy hash is not configured/recognized by this workflow",
    );

  const http = new HTTPClient();
  const evidence = http
    .sendRequest(
      runtime,
      fetchEvidence,
      consensusIdenticalAggregation<Evidence>(),
    )({
      url: `${config.apiUrl.replace(/\/$/, "")}/invoice/${
        input.invoiceHash
      }/evidence`,
    })
    .result();
  if (
    evidence.invoiceHash.toLowerCase() !== invoiceHash.toLowerCase() ||
    evidence.evidenceHash.toLowerCase() !== evidenceHash.toLowerCase() ||
    evidence.canonical.borrowerAddress.toLowerCase() !== borrower.toLowerCase()
  )
    throw new Error("API evidence does not match on-chain request");
  const recoveredSigner = await recoverMessageAddress({
    message: { raw: evidence.evidenceHash },
    signature: evidence.signature,
  });
  if (
    recoveredSigner.toLowerCase() !==
      config.evidenceSignerAddress.toLowerCase() ||
    evidence.signer.toLowerCase() !== config.evidenceSignerAddress.toLowerCase()
  )
    throw new Error("API evidence signer is not trusted");
  const decision = evaluate(evidence);
  const validUntil = createdAt + 30n * 24n * 60n * 60n;
  const payloadBytes = encodeAbiParameters(
    parseAbiParameters(
      "uint256 requestId, bytes32 invoiceHash, address borrower, bytes32 policyHash, bool approved, uint256 riskScore, uint256 advanceRateBps, uint256 invoiceAmount, address debtor, bytes32 evidenceHash, uint256 validUntil, uint256 reportNonce",
    ),
    [
      requestId,
      invoiceHash as `0x${string}`,
      borrower as Address,
      policyHash as `0x${string}`,
      decision.approved,
      BigInt(decision.riskScore),
      BigInt(decision.advanceRateBps),
      decision.invoiceAmount,
      decision.debtor as Address,
      evidenceHash as `0x${string}`,
      validUntil,
      BigInt(input.reportNonce),
    ],
  );
  const reportPayload = concat(["0x00", payloadBytes]);
  const report = runtime.report(prepareReportRequest(reportPayload)).result();
  const write = evm
    .writeReport(runtime, {
      receiver: config.evm.notesAddress,
      report,
      gasConfig: { gasLimit: config.gasLimit },
    })
    .result();
  runtime.log(
    `CRE invoice report txStatus=${write.txStatus}; receiverStatus=${
      write.receiverContractExecutionStatus ?? "unknown"
    }`,
  );
  if (write.txStatus !== TxStatus.SUCCESS)
    throw new Error(
      `CRE report transaction failed: ${write.errorMessage ?? write.txStatus}`,
    );
  if (
    write.receiverContractExecutionStatus ===
    EVM_PB.ReceiverContractExecutionStatus.REVERTED
  )
    throw new Error("Notes.onReport reverted");
  return {
    requestId: input.requestId,
    invoiceHash,
    approved: decision.approved,
    riskScore: decision.riskScore,
    advanceRateBps: decision.advanceRateBps,
  };
}

const initWorkflow = (config: Config) => {
  const trigger = new cre.capabilities.HTTPCapability().trigger({
    authorizedKeys: config.authorizedKeys,
  });
  return [cre.handler(trigger, onHttpTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema: ConfigSchema });
  await runner.run(initWorkflow);
}
main();
