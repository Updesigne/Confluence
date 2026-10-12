import fs from "node:fs";
import path from "node:path";
import { ContractFactory } from "ethers";
import { wallet } from "./env";
import { waitTx, log } from "./logger";

export function artifactPath(contractName: string) {
  const root = path.join(process.cwd(), "artifacts", "contracts");
  if (!fs.existsSync(root)) throw new Error(`Missing artifacts directory: ${root}`);
  const wanted = path.basename(contractName) + ".json";
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === wanted) return full;
    }
  }
  throw new Error(`Artifact not found for ${contractName}; compile first.`);
}
export function loadArtifact(name: string) {
  return JSON.parse(fs.readFileSync(name.endsWith(".json") ? name : artifactPath(name), "utf8"));
}
export async function deploy(label: string, name: string, args: any[] = []) {
  const a = loadArtifact(name);
  const f = new ContractFactory(a.abi, a.bytecode, wallet);
  const c = await f.deploy(...args);
  await waitTx(`deploy:${label}`, c.deploymentTransaction());
  await c.waitForDeployment();
  const addr = await c.getAddress();
  log.info({ event: "contract_deployed", label, contractName: name, address: addr }, `${label} deployed`);
  return c;
}
