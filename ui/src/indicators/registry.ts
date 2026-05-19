/**
 * klinecharts built-in indicator catalog (subset). The library ships
 * 30+ — we surface the most common ones here. Each entry tells the
 * picker whether it overlays on the candle pane (e.g. MA, BOLL) or
 * creates a sub-pane (VOL, RSI, MACD).
 */

export interface IndicatorDef {
  id: string;        // klinecharts indicator name
  label: string;
  /** Show on main candle pane vs separate sub-pane. */
  onMain: boolean;
  /** Default calcParams (klinecharts uses tuple-style params). */
  defaults: number[];
  /** Human description of each calc param slot. */
  paramLabels: string[];
}

export const INDICATORS: IndicatorDef[] = [
  // Overlays
  { id: 'MA',   label: 'Moving Average',         onMain: true,  defaults: [5, 10, 30, 60], paramLabels: ['fast', 'mid', 'slow', 'long'] },
  { id: 'EMA',  label: 'Exponential MA',         onMain: true,  defaults: [9, 21, 50, 200], paramLabels: ['ema1', 'ema2', 'ema3', 'ema4'] },
  { id: 'SMA',  label: 'Smoothed MA',            onMain: true,  defaults: [12, 2], paramLabels: ['period', 'weight'] },
  { id: 'BOLL', label: 'Bollinger Bands',        onMain: true,  defaults: [20, 2], paramLabels: ['period', 'mult'] },
  { id: 'BBI',  label: 'Bull-Bear Index',        onMain: true,  defaults: [3, 6, 12, 24], paramLabels: ['p1', 'p2', 'p3', 'p4'] },
  { id: 'SAR',  label: 'Parabolic SAR',          onMain: true,  defaults: [2, 2, 20], paramLabels: ['start', 'step', 'max'] },
  // Sub-panes
  { id: 'VOL',  label: 'Volume',                 onMain: false, defaults: [5, 10, 20], paramLabels: ['ma1', 'ma2', 'ma3'] },
  { id: 'MACD', label: 'MACD',                   onMain: false, defaults: [12, 26, 9], paramLabels: ['fast', 'slow', 'signal'] },
  { id: 'KDJ',  label: 'KDJ Stochastic',         onMain: false, defaults: [9, 3, 3], paramLabels: ['period', 'k', 'd'] },
  { id: 'RSI',  label: 'RSI',                    onMain: false, defaults: [6, 12, 24], paramLabels: ['rsi1', 'rsi2', 'rsi3'] },
  { id: 'CCI',  label: 'CCI',                    onMain: false, defaults: [13], paramLabels: ['period'] },
  { id: 'OBV',  label: 'On-Balance Volume',      onMain: false, defaults: [30], paramLabels: ['ma'] },
  { id: 'DMI',  label: 'Directional Movement',   onMain: false, defaults: [14, 6], paramLabels: ['period', 'ma'] },
  { id: 'ATR',  label: 'Average True Range',     onMain: false, defaults: [14], paramLabels: ['period'] },
  { id: 'WR',   label: 'Williams %R',            onMain: false, defaults: [6, 10, 14], paramLabels: ['wr1', 'wr2', 'wr3'] },
  { id: 'PSY',  label: 'Psychological Line',     onMain: false, defaults: [12, 6], paramLabels: ['period', 'ma'] },
  { id: 'TRIX', label: 'TRIX',                   onMain: false, defaults: [12, 20], paramLabels: ['period', 'ma'] },
  { id: 'ROC',  label: 'Rate of Change',         onMain: false, defaults: [12, 6], paramLabels: ['period', 'ma'] },
  { id: 'MTM',  label: 'Momentum',               onMain: false, defaults: [6, 10], paramLabels: ['period', 'ma'] },
  { id: 'EMV',  label: 'Ease of Movement',       onMain: false, defaults: [14, 9], paramLabels: ['period', 'ma'] },
  { id: 'VR',   label: 'Volume Ratio',           onMain: false, defaults: [24, 30], paramLabels: ['period', 'ma'] },
];

export interface ActiveIndicator {
  uid: string;
  defId: string;
  params: number[];
}

const STORAGE_KEY = 'chart-studio:indicators:v2';

export const loadActiveIndicators = (): ActiveIndicator[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [
      { uid: 'default-ema', defId: 'EMA', params: [9, 21, 50, 200] },
      { uid: 'default-macd', defId: 'MACD', params: [12, 26, 9] },
    ];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x.defId === 'string' && Array.isArray(x.params));
  } catch {
    return [];
  }
};

export const saveActiveIndicators = (list: ActiveIndicator[]): void => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
};
