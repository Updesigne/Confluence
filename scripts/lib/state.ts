import fs from "node:fs";
import path from "node:path";
export const deploymentFile = path.join(process.cwd(), "deployments", "arbitrum-sepolia.json");
export function loadDeployment(): any {
  if (!fs.existsSync(deploymentFile)) throw new Error(`Missing ${deploymentFile}; run deploy:testnet`);
  return JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
}
export function saveDeployment(v: any) {
  fs.mkdirSync(path.dirname(deploymentFile), { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(v, null, 2) + "\n");
}
