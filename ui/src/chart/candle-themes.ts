import type { CandlestickSeriesOptions, DeepPartial } from 'lightweight-charts';

export interface CandleTheme {
  id: string;
  label: string;
  options: DeepPartial<CandlestickSeriesOptions>;
}

/**
 * Candle themes loosely modeled after binance UI's candle-themes.js. v5
 * supports `borderVisible`/`wickVisible` so we can render "hollow" or
 * "filled" bodies.
 */
export const CANDLE_THEMES: CandleTheme[] = [
  {
    id: 'quantum',
    label: 'Quantum',
    options: {
      upColor: '#00e676', downColor: '#ff1744',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: 'rgba(0, 230, 118, 0.85)', wickDownColor: 'rgba(255, 23, 68, 0.85)',
      borderVisible: true, wickVisible: true,
    },
  },
  {
    id: 'hollow',
    label: 'Hollow up · Solid down',
    options: {
      upColor: 'rgba(0,0,0,0)', downColor: '#ff1744',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: '#00e676', wickDownColor: '#ff1744',
      borderVisible: true, wickVisible: true,
    },
  },
  {
    id: 'mono',
    label: 'Monochrome',
    options: {
      upColor: '#e8eaf0', downColor: '#3a3f4b',
      borderUpColor: '#e8eaf0', borderDownColor: '#3a3f4b',
      wickUpColor: '#e8eaf0', wickDownColor: '#3a3f4b',
      borderVisible: true, wickVisible: true,
    },
  },
  {
    id: 'classic',
    label: 'Classic green/red',
    options: {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      borderVisible: true, wickVisible: true,
    },
  },
];

const STORAGE_KEY = 'chart-studio:candle-theme:v1';

export const loadCandleTheme = (): CandleTheme => {
  const id = localStorage.getItem(STORAGE_KEY);
  return CANDLE_THEMES.find((t) => t.id === id) ?? CANDLE_THEMES[0]!;
};

export const saveCandleTheme = (id: string): void => {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
};
