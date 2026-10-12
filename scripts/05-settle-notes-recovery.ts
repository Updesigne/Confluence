
import "dotenv/config";

import { Contract, parseUnits } from "ethers";
import { loadArtifact } from "./lib/artifacts";
import { address, wallet } from "./lib/env";
import { log, sleep, waitTx } from "./lib/logger";
import { loadDeployment } from "./lib/state";

async function main() {
  const d = loadDeployment();
  const c = d.contracts;
  const abi = (name: string) => loadArtifact(name).abi;

    const vault = new Contract(
    c.vaultUSDC,
    abi("CapitalVault"),
    wallet
  );


  const conf = new Contract(
    c.confluenceNotes,
    abi("Confluence"),
    wallet
  );

  const router = new Contract(
    c.router,
    abi("ExecutionRouter"),
    wallet
  );

  const notes = new Contract(
    c.notes,
    abi("Notes"),
    wallet
  );

  const noteId = 1n;
  const positionId = 1n;

  // Recreate exactly the same settlement call used by the locked plan.
  const repayCall = {
    target: c.notes,
    value: 0n,
    data: notes.interface.encodeFunctionData(
      "markRepaid",
      [noteId]
    ),
  };

  const position = await conf.positions(positionId);
  const note = await notes.notes(noteId);

  const settlementHash = await router.hashCalls([repayCall]);

  if (
    position.settlementHash.toLowerCase() !==
    settlementHash.toLowerCase()
  ) {
    throw new Error(
      "Settlement call hash does not match the locked plan. " +
      "Do not submit a different call."
    );
  }

  if (
    position.emergencySettlementHash.toLowerCase() !==
    settlementHash.toLowerCase()
  ) {
    throw new Error(
      "Emergency settlement hash does not match the repayment call."
    );
  }

  if (BigInt(note.repaidAmount) < BigInt(note.requested) + BigInt(note.interest)) {
    throw new Error(
      "The Notes contract does not hold the full repayment. " +
      "Check the note repayment state before continuing."
    );
  }

  log.info({
    noteId: noteId.toString(),
    positionId: positionId.toString(),
    noteMaturity: note.maturity.toString(),
    positionMaturity: position.maturity.toString(),
    settlementDeadline: position.settlementDeadline.toString(),
    repaidAmount: note.repaidAmount.toString(),
    status: position.status.toString(),
  }, "Checking existing Notes position");

  // Wait for Confluence maturity, not just Notes maturity.
  while (true) {
    const block = await wallet.provider!.getBlock("latest");
    if (!block) throw new Error("Unable to read latest block");

    const now = BigInt(block.timestamp);
    const maturity = BigInt(position.maturity);

    if (now >= maturity) break;

    const remaining = Number(maturity - now);
    const seconds = Math.min(Math.max(remaining, 1), 10);

    log.info({
      now: now.toString(),
      maturity: maturity.toString(),
      waitSeconds: seconds,
    }, "Waiting for Confluence maturity");

    await sleep(seconds * 1000);
  }

  const latest = await wallet.provider!.getBlock("latest");
  if (!latest) throw new Error("Unable to read latest block");

  const now = BigInt(latest.timestamp);
  const deadline = BigInt(position.settlementDeadline);

  if (now <= deadline) {
    await waitTx(
      "Settle existing Notes position",
      await conf.settle(positionId, [repayCall])
    );
  } else {
    log.warn({
      now: now.toString(),
      settlementDeadline: deadline.toString(),
    }, "Settlement deadline passed; attempting authorized emergency exit");

    await waitTx(
      "Emergency exit existing Notes position",
      await conf.emergencyExit(positionId, [repayCall])
    );
  }

  const finalPosition = await conf.positions(positionId);
  const finalNote = await notes.notes(noteId);

  log.info({
    positionId: positionId.toString(),
    returnedTotal: finalPosition.returnedTotal.toString(),
    noteStatus: finalNote.status.toString(),
    positionStatus: finalPosition.status.toString(),
  }, "Notes recovery completed");

  

  //------------------------------------
    const principal =
    parseUnits("1000", 6);

      const interest =
    parseUnits("10", 6);

      const repayment =
    principal + interest;

    const opp = new Contract(
    c.opportunities,
    abi("OpportunityRegistry"),
    wallet
  );

  const opportunityId =
    (await opp.nextOpportunityId()) -
    1n;
    const position0 =
      await conf.positions(
        positionId
      );
  
    const accountA =
      await vault.account(
        1
      );
  
    const accountB =
      await vault.account(
        2
      );
  
    const expectedA =
      parseUnits("606", 6);
  
    const expectedB =
      parseUnits("404", 6);
  
    log.info(
      {
        event:
          "notes_settled",
  
        noteId:
          noteId.toString(),
  
        opportunityId:
          opportunityId.toString(),
  
        positionId:
          positionId.toString(),
  
        returnedTotal:
          position0.returnedTotal.toString(),
  
        expectedReturn:
          repayment.toString(),
  
        accountAAvailable:
          accountA.available.toString(),
  
        accountBAvailable:
          accountB.available.toString(),
  
        expectedA:
          expectedA.toString(),
  
        expectedB:
          expectedB.toString(),
      },
      "Notes position settled"
    );
  
    // ------------------------------------------------------------------
    // Assertions
    // ------------------------------------------------------------------
  
    if (
      position0.returnedTotal <
      repayment
    ) {
      throw new Error(
        `returnedTotal ${position0.returnedTotal.toString()} ` +
        `is below expected ${repayment.toString()}`
      );
    }
  
    if (
      accountA.available <
      expectedA
    ) {
      throw new Error(
        `Account A returned ${accountA.available.toString()}, ` +
        `expected at least ${expectedA.toString()}`
      );
    }
  
    if (
      accountB.available <
      expectedB
    ) {
      throw new Error(
        `Account B returned ${accountB.available.toString()}, ` +
        `expected at least ${expectedB.toString()}`
      );
    }
  
}

main().catch((err) => {
  log.error({ err }, "Notes settlement recovery failed");
  process.exit(1);
});
