import { ContractTransactionReceipt, Interface } from "ethers";
export function eventArg(receipt: ContractTransactionReceipt, iface: Interface, eventName: string, argIndex: number|string = 0) {
  for (const raw of receipt.logs) {
    try {
      const p = iface.parseLog({ topics: raw.topics, data: raw.data });
      if (p?.name === eventName) return p.args[argIndex as any];
    } catch {}
  }
  return undefined;
}
