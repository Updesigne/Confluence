import "dotenv/config";
import { Contract, Interface, parseUnits } from "ethers";
import { loadArtifact } from "./lib/artifacts";
import { address, wallet } from "./lib/env";
import { eventArg } from "./lib/events";
import { log, waitTx } from "./lib/logger";
import { loadDeployment, saveDeployment } from "./lib/state";

async function main() {
  const d=loadDeployment(), c=d.contracts;
  const usdg=new Contract(c.usdg,loadArtifact("MockUSDG").abi,wallet);
  const vault=new Contract(c.vaultUSDG,loadArtifact("CapitalVault").abi,wallet);
  const mandates=new Contract(c.mandatesUSDG,loadArtifact("MandateRegistry").abi,wallet);
  const amount=parseUnits("1000",6);

  await waitTx("mint 1000 USDG to deployer",await usdg.mint(address,amount));
  const ar=await waitTx("create USDG capital account",await vault.createAccount());
  const accountId=eventArg(ar,new Interface(loadArtifact("CapitalVault").abi),"AccountCreated","accountId");
  if(accountId===undefined) throw new Error("AccountCreated event not found");

  await waitTx("approve USDG vault deposit",await usdg.approve(c.vaultUSDG,amount));
  await waitTx(`deposit ${amount} USDG`,await vault.deposit(accountId,amount));

  const mr=await waitTx("create USDG mandate",await mandates.createMandate({
    accountId, asset:c.usdg, initialVenues:[], maxAllocation:amount,
    minDuration:1, maxDuration:3600, minLiquidityBps:0, maxRiskClass:255,
    leverageAllowed:false, purposeHash:"0x"+"11".repeat(32), policyHash:"0x"+"22".repeat(32)
  }));
  const mandateId=eventArg(mr,new Interface(loadArtifact("MandateRegistry").abi),"MandateCreated","mandateId");
  if(mandateId===undefined) throw new Error("MandateCreated event not found");

  d.usdgAccountId=accountId.toString(); d.usdgMandateId=mandateId.toString(); saveDeployment(d);
  log.info({accountId:accountId.toString(),mandateId:mandateId.toString()},"USDG account and mandate ready");
}
main().catch(err=>{log.error({err},"USDG account/mandate failed");process.exit(1)});
