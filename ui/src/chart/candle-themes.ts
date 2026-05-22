import type { CandlestickSeriesOptions, DeepPartial } from 'lightweight-charts';

export interface CandleTheme {
  id: string;
  label: string;
  options: DeepPartial<CandlestickSeriesOptions>;
  volumeUp?: string;
  volumeDown?: string;
}

/**
 * Candle themes optimized for lightweight-charts.
 */
export const CANDLE_THEMES: CandleTheme[] = [
  {
    id: 'quantum',
    label: 'Quantum',
    options: {
      upColor: '#00e676', downColor: '#ff1744',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: '#00e676', wickDownColor: '#ff1744',
      borderVisible: false, wickVisible: true,
    },
    volumeUp: 'rgba(0,230,118,0.35)', volumeDown: 'rgba(255,23,68,0.35)',
  },
  {
    id: 'hollow',
    label: 'Hollow bull',
    options: {
      upColor: 'rgba(0,230,118,0.1)', downColor: '#ff1744',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: '#00e676', wickDownColor: '#ff5252',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(0,230,118,0.35)', volumeDown: 'rgba(255,23,68,0.35)',
  },
  {
    id: 'trading-dark',
    label: 'TV dark',
    options: {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#2bbd9a', borderDownColor: '#ff7960',
      wickUpColor: '#4db6ac', wickDownColor: '#e57373',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(38,166,154,0.38)', volumeDown: 'rgba(239,83,80,0.38)',
  },
  {
    id: 'outline',
    label: 'Outline',
    options: {
      upColor: 'rgba(144,202,249,0.12)', downColor: 'rgba(239,154,154,0.18)',
      borderUpColor: '#90caf9', borderDownColor: '#ef9a9a',
      wickUpColor: '#b0bec5', wickDownColor: '#b0bec5',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(144,202,249,0.35)', volumeDown: 'rgba(239,154,154,0.35)',
  },
  {
    id: 'monochrome',
    label: 'Mono',
    options: {
      upColor: '#cfd8dc', downColor: '#546e7a',
      borderUpColor: '#eceff1', borderDownColor: '#78909c',
      wickUpColor: '#90a4ae', wickDownColor: '#90a4ae',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(207,216,220,0.4)', volumeDown: 'rgba(84,110,122,0.45)',
  },
  {
    id: 'bars',
    label: 'Bars (no wick)',
    options: {
      upColor: '#00e676', downColor: '#ff1744',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: '#00e676', wickDownColor: '#ff1744',
      borderVisible: false, wickVisible: false,
    },
    volumeUp: 'rgba(0,230,118,0.35)', volumeDown: 'rgba(255,23,68,0.35)',
  },
  {
    id: 'oled',
    label: 'Neon OLED',
    options: {
      upColor: '#00ffc8', downColor: '#ff2d6a',
      borderUpColor: '#5fffd4', borderDownColor: '#ff6b9d',
      wickUpColor: '#00ffc8', wickDownColor: '#ff2d6a',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(0,255,200,0.32)', volumeDown: 'rgba(255,45,106,0.32)',
  },
  {
    id: 'colorblind-blue-orange',
    label: 'Colorblind (Blue/Orange)',
    options: {
      upColor: '#2962FF', downColor: '#FF6D00',
      borderUpColor: '#2962FF', borderDownColor: '#FF6D00',
      wickUpColor: '#2962FF', wickDownColor: '#FF6D00',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(41,98,255,0.35)', volumeDown: 'rgba(255,109,0,0.35)',
  },
  {
    id: 'colorblind-blue-red',
    label: 'Colorblind (Blue/Red)',
    options: {
      upColor: '#2196F3', downColor: '#F44336',
      borderUpColor: '#2196F3', borderDownColor: '#F44336',
      wickUpColor: '#2196F3', wickDownColor: '#F44336',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(33,150,243,0.35)', volumeDown: 'rgba(244,67,54,0.35)',
  },
  {
    id: 'hollow-classic',
    label: 'Hollow Classic',
    options: {
      upColor: 'transparent', downColor: 'transparent',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: '#00e676', wickDownColor: '#ff1744',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(0,230,118,0.3)', volumeDown: 'rgba(255,23,68,0.3)',
  },
  {
    id: 'hollow-dark',
    label: 'Hollow Dark',
    options: {
      upColor: 'transparent', downColor: 'transparent',
      borderUpColor: '#cfd8dc', borderDownColor: '#546e7a',
      wickUpColor: '#cfd8dc', wickDownColor: '#546e7a',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(207,216,220,0.3)', volumeDown: 'rgba(84,110,122,0.3)',
  },
  {
    id: 'colorblind-hc',
    label: 'Colorblind (HC Yellow/Blue)',
    options: {
      upColor: '#FFD600', downColor: '#2962FF',
      borderUpColor: '#FFD600', borderDownColor: '#2962FF',
      wickUpColor: '#FFD600', wickDownColor: '#2962FF',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(255,214,0,0,35)', volumeDown: 'rgba(41,98,255,0.35)',
  },
  {
    id: 'colorblind-deuteranopia',
    label: 'Colorblind (Deuteranopia)',
    options: {
      upColor: '#0072B2', downColor: '#D55E00',
      borderUpColor: '#0072B2', borderDownColor: '#D55E00',
      wickUpColor: '#0072B2', wickDownColor: '#D55E00',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(0,114,178,0.4)', volumeDown: 'rgba(213,94,0,0.4)',
  },
  {
    id: 'colorblind-tritanopia',
    label: 'Colorblind (Tritanopia)',
    options: {
      upColor: '#009E73', downColor: '#CC79A7',
      borderUpColor: '#009E73', borderDownColor: '#CC79A7',
      wickUpColor: '#009E73', wickDownColor: '#CC79A7',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(0,158,115,0.4)', volumeDown: 'rgba(204,121,167,0.4)',
  },
  {
    id: 'hollow-mixed',
    label: 'Hollow Mixed',
    options: {
      upColor: 'transparent', downColor: '#ff1744',
      borderUpColor: '#00e676', borderDownColor: '#ff1744',
      wickUpColor: '#00e676', wickDownColor: '#ff1744',
      borderVisible: true, wickVisible: true,
    },
    volumeUp: 'rgba(0,230,118,0.3)', volumeDown: 'rgba(255,23,68,0.3)',
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
