// lib/mock-data.ts
export type MandateRow = readonly [
  id: string, owner: string, asset: string, venue: string,
  maxAllocation: string, duration: string, risk: string,
  reserved: string, status: string,
]

export const MANDATES: MandateRow[] = [
  ['#001','Alice','USDC','Any venue','$500k','30–180d','≤ 8','$30k','Active'],
  ['#002','Ronan','USDC','Notes','$100k','60–90d','≤ 6','$20k','Active'],
  ['#003','Maya','USDC','Any venue','$250k','30–120d','≤ 7','$0','Active'],
  ['#004','Theo','USDC','Notes','$75k','14–60d','≤ 5','$12k','Paused'],
]

export type Opportunity = {
  name: string; venue: string; asset: string; amount: string;
  capacity: string; duration: string; ret: string; risk: string; status: string;
}

export const OPPORTUNITIES: Opportunity[] = [
  { name:'Senior Note #042', venue:'Confluence Notes', asset:'USDC', amount:'$30,000', capacity:'62%', duration:'90 days', ret:'8.42%', risk:'3', status:'OPEN' },
  { name:'USDC / Arbitrum', venue:'Aave v3', asset:'USDC', amount:'$120,000', capacity:'38%', duration:'30–180 days', ret:'6.18%', risk:'2', status:'OPEN' },
  { name:'Credit Pool #08', venue:'OpenYield', asset:'USDC', amount:'$80,000', capacity:'81%', duration:'60 days', ret:'9.10%', risk:'5', status:'OPEN' },
  { name:'Senior Note #039', venue:'Confluence Notes', asset:'USDC', amount:'$42,000', capacity:'100%', duration:'120 days', ret:'7.95%', risk:'4', status:'EXECUTED' },
  { name:'Treasury Vault', venue:'Arbitrum DAO', asset:'USDC', amount:'$250,000', capacity:'24%', duration:'180 days', ret:'5.70%', risk:'1', status:'OPEN' },
  { name:'Credit Pool #05', venue:'OpenYield', asset:'USDC', amount:'$65,000', capacity:'100%', duration:'45 days', ret:'8.88%', risk:'6', status:'CLOSED' },
]

export type TxRow = readonly [method: string, hash: string, block: string, gas: string, age: string]

export const TXS: TxRow[] = [
  ['executeAggregate','0x8b4f…a921','18,492,071','0.0008 ETH','2m ago'],
  ['lockExecutionPlan','0xf12c…4d10','18,492,060','0.0003 ETH','4m ago'],
  ['addParticipants','0x44ae…e829','18,492,044','0.0004 ETH','6m ago'],
  ['createMandate','0x72ac…b118','18,491,988','0.0002 ETH','12m ago'],
]