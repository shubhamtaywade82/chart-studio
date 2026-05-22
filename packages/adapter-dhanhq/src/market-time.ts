/**
 * Indian Market Hours Utility (IST: UTC+5:30)
 */

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

export interface MarketStatus {
  isOpen: boolean;
  reason?: string;
  nextCheckMs: number;
}

/**
 * Checks if the Indian market is currently open.
 * Standard hours: 09:00 to 15:30 IST. 
 * We allow a buffer: 08:30 to 16:00 IST.
 */
export function getIndianMarketStatus(): MarketStatus {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + IST_OFFSET);

  const day = ist.getDay(); // 0: Sun, 6: Sat
  const hours = ist.getHours();
  const mins = ist.getMinutes();
  const timeNum = hours * 100 + mins;

  // Weekends
  if (day === 0 || day === 6) {
    return { isOpen: false, reason: 'Weekend', nextCheckMs: 60_000 * 60 }; // Check in an hour
  }

  // Market hours (with buffer for pre-market and post-market settlement)
  // 08:30 is 830, 16:00 is 1600
  if (timeNum >= 830 && timeNum <= 1600) {
    return { isOpen: true, nextCheckMs: 30_000 }; // Check every 30s while open
  }

  return { 
    isOpen: false, 
    reason: 'Outside Market Hours', 
    nextCheckMs: 60_000 * 5 // Check every 5 mins while closed
  };
}
