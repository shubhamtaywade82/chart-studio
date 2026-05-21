/**
 * Indicator catalog surfacing common technical indicators.
 * Each entry tells the picker whether it overlays on the candle pane (e.g. MA, BOLL)
 * or creates a sub-pane (VOL, RSI, MACD).
 */

export interface IndicatorDef {
  id: string;        // Unique identifier for the indicator
  label: string;
  /** Show on main candle pane vs separate sub-pane. */
  onMain: boolean;
  /** Default calcParams. */
  defaults: number[];
  /** Human description of each calc param slot. */
  paramLabels: string[];
}

export const INDICATORS: IndicatorDef[] = [
  // Overlays
  { id: 'MA',   label: 'Moving Average',         onMain: true,  defaults: [20], paramLabels: ['period'] },
  { id: 'EMA',  label: 'Exponential MA',         onMain: true,  defaults: [9],  paramLabels: ['period'] },
  { id: 'SMA',  label: 'Smoothed MA',            onMain: true,  defaults: [12, 2], paramLabels: ['period', 'weight'] },
  { id: 'BOLL', label: 'Bollinger Bands',        onMain: true,  defaults: [20, 2], paramLabels: ['period', 'mult'] },
  { id: 'SAR',  label: 'Parabolic SAR',          onMain: true,  defaults: [0.02, 0.02, 0.2], paramLabels: ['start', 'step', 'max'] },
  { id: 'VWAP', label: 'VWAP',                   onMain: true,  defaults: [], paramLabels: [] },
  { id: 'SUPERTREND', label: 'SuperTrend',       onMain: true,  defaults: [10, 3], paramLabels: ['atrPeriod', 'multiplier'] },
  { id: 'ICHIMOKU', label: 'Ichimoku Cloud',      onMain: true,  defaults: [9, 26, 52, 26], paramLabels: ['tenkan', 'kijun', 'senkouB', 'displacement'] },
  
  // Sub-panes
  { id: 'VOL',  label: 'Volume',                 onMain: false, defaults: [20], paramLabels: ['ma'] },
  { id: 'MACD', label: 'MACD',                   onMain: false, defaults: [12, 26, 9], paramLabels: ['fast', 'slow', 'signal'] },
  { id: 'RSI',  label: 'RSI',                    onMain: false, defaults: [14], paramLabels: ['period'] },
  { id: 'ATR',  label: 'Average True Range',     onMain: false, defaults: [14], paramLabels: ['period'] },
  { id: 'ADX',  label: 'ADX',                    onMain: false, defaults: [14], paramLabels: ['period'] },
  { id: 'STOCH', label: 'Stochastic',            onMain: false, defaults: [14, 3, 3], paramLabels: ['kPeriod', 'kSmoothing', 'dSmoothing'] },
  { id: 'CCI',  label: 'CCI',                    onMain: false, defaults: [20], paramLabels: ['period'] },
  { id: 'OBV',  label: 'On-Balance Volume',      onMain: false, defaults: [], paramLabels: [] },
  { id: 'MFI',  label: 'Money Flow Index',       onMain: false, defaults: [14], paramLabels: ['period'] },
  
  // Custom Analytics (built-in to chart-studio)
  { id: 'CVD',  label: 'Cumulative Volume Delta', onMain: false, defaults: [], paramLabels: [] },
  { id: 'OI',   label: 'Open Interest Change',    onMain: false, defaults: [], paramLabels: [] },
  { id: 'SMC',  label: 'Smart Money Concepts',   onMain: true,  defaults: [5], paramLabels: ['period'] },
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
