import pino from "pino";
export const log = pino({ level: process.env.LOG_LEVEL ?? "info", base: undefined, timestamp: pino.stdTimeFunctions.isoTime });

export function txLog(label: string, txHash: string, extra: Record<string, unknown> = {}) {
  log.info({ event: "tx_submitted", label, txHash, ...extra }, `${label} submitted`);
}
export async function waitTx(label: string, tx: any, extra: Record<string, unknown> = {}) {
  if (!tx?.hash) throw new Error(`${label}: missing tx hash`);
  txLog(label, tx.hash, extra);
  const receipt = await tx.wait();
  log.info({ event: "tx_confirmed", label, txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed?.toString(), ...extra }, `${label} confirmed`);
  return receipt;
}
export async function sleep(ms: number) {
  log.info({ event: "sleep", ms }, `sleeping ${ms}ms`);
  await new Promise(r => setTimeout(r, ms));
}
