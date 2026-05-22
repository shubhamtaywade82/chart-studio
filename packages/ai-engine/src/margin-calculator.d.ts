import type { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';
export interface PositionInfo {
    symbol: string;
    exchangeSegment: string;
    qty: number;
    lotSize: number;
    ltp: number;
    isOption: boolean;
    strike?: number;
    optionType?: 'CE' | 'PE';
    impliedVol?: number;
    historicalVol?: number;
}
export interface MarginResult {
    used: number;
    available: number;
    span: number;
    exposure: number;
    totalInitial: number;
    maintenance: number;
    isFallback: boolean;
}
export declare class MarginCalculator extends EventEmitter {
    private client;
    private availableCash;
    private lastUpdate;
    constructor(client?: AxiosInstance | null);
    /**
     * Fetches funds and margins. If API fails, falls back to internal SPAN approximation.
     */
    calculate(positions: PositionInfo[]): Promise<MarginResult>;
    private approximateMargin;
}
