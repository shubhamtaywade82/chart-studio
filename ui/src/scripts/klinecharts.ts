export interface IndicatorFigure {
  key: string;
  title?: string;
  type?: 'line' | 'bar' | 'circle' | 'rect';
  color?: string;
}

export interface Indicator {
  name: string;
  shortName?: string;
  series?: 'price' | 'volume' | 'normal';
  calcParams?: any[];
  figures?: IndicatorFigure[];
  calc: (dataList: any[], indicator: any) => any[];
  styles?: any;
}

export class KlinechartsRegistry {
  private indicators = new Map<string, Indicator>();

  registerIndicator(config: Indicator): void {
    this.indicators.set(config.name, config);
  }

  getIndicator(name: string): Indicator | undefined {
    return this.indicators.get(name);
  }

  getIndicators(): Indicator[] {
    return Array.from(this.indicators.values());
  }
}

export const klinecharts = new KlinechartsRegistry();
(window as any).klinecharts = klinecharts;
