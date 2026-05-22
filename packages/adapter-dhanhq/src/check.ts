import { loadInstruments, findInstrument } from './instruments';

async function main() {
  console.log('Loading instruments...');
  const insts = await loadInstruments();
  console.log('Total instruments loaded:', insts.length);
  
  console.log('Finding SBIN:', findInstrument('SBIN'));
  console.log('Finding NIFTY:', findInstrument('NIFTY'));
}

main().catch(console.error);
