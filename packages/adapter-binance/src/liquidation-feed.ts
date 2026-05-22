export interface LiquidationEvent {
  symbol: string;
  side: 'BUY' | 'SELL'; // BUY = Shorts liquidated, SELL = Longs liquidated
  price: number;
  qty: number;
  notionalUsd: number;
  time: number;
}

export interface LiquidationBucket {
  timestamp: number;
  longLiqUsd: number;
  shortLiqUsd: number;
  events: LiquidationEvent[];
}

export class LiquidationFeed {
  private buckets = new Map<number, LiquidationBucket>();
  
  // Track large liquidations and cascades
  processEvent(event: LiquidationEvent) {
    const bucketMin = Math.floor(event.time / 60000) * 60000;
    
    let bucket = this.buckets.get(bucketMin);
    if (!bucket) {
      bucket = { timestamp: bucketMin, longLiqUsd: 0, shortLiqUsd: 0, events: [] };
      this.buckets.set(bucketMin, bucket);
    }
    
    bucket.events.push(event);
    
    // In Futures, a forced SELL means a Long was liquidated. 
    // A forced BUY means a Short was liquidated.
    if (event.side === 'SELL') {
      bucket.longLiqUsd += event.notionalUsd;
    } else {
      bucket.shortLiqUsd += event.notionalUsd;
    }
    
    // Clean up old buckets (keep last 60 minutes)
    const tooOld = bucketMin - 60 * 60000;
    for (const ts of this.buckets.keys()) {
      if (ts < tooOld) this.buckets.delete(ts);
    }
    
    return bucket;
  }
  
  getRecentCascades(symbol: string, windowMs: number = 30000) {
    // Basic cascade detector: 3+ liquidations > $100k within windowMs
    const now = Date.now();
    const thresholdUsd = 100_000;
    
    let largeEvents = 0;
    for (const bucket of this.buckets.values()) {
      if (bucket.timestamp > now - windowMs * 2) {
        for (const ev of bucket.events) {
          if (ev.symbol === symbol && ev.time > now - windowMs && ev.notionalUsd >= thresholdUsd) {
            largeEvents++;
          }
        }
      }
    }
    
    return {
      cascadeDetected: largeEvents >= 3,
      count: largeEvents
    };
  }
}
