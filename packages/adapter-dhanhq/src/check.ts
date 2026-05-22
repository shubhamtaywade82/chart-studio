import { loadInstruments } from './instruments';

async function main() {
  console.log('Loading instruments...');
  const insts = await loadInstruments();
  console.log('Total instruments loaded:', insts.length);
  
  const niftyIdx = insts.filter(i => i.symbolName.toUpperCase().includes('NIFTY') && i.exchangeSegment === 'IDX_I');
  console.log('NIFTY Index matches:', niftyIdx);
  
  const niftyOther = insts.filter(i => i.symbolName.toUpperCase() === 'NIFTY').slice(0, 10);
  console.log('NIFTY symbol exact matches:', niftyOther);
}

main().catch(console.error);
