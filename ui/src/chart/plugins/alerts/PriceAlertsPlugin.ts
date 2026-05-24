import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  IPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
} from 'lightweight-charts';

export interface AlertData {
  id: string;
  price: number;
  title: string;
  color: string;
}

export class PriceAlertsPlugin implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _alerts: AlertData[] = [];
  
  // Event handlers
  public onAlertMoved?: (id: string, newPrice: number) => void;
  public onAlertDeleted?: (id: string) => void;

  private _isDragging = false;
  private _draggedAlertId: string | null = null;

  setAlerts(alerts: AlertData[]) {
    this._alerts = alerts;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    
    this._chart.subscribeClick(this._onClick);
    this._chart.subscribeCrosshairMove(this._onMouseMove);
    
    // We need to handle mouse down/up on the document or chart container for dragging
    const container = this._chart.chartElement();
    container.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  detached() {
    this._chart?.unsubscribeClick(this._onClick);
    this._chart?.unsubscribeCrosshairMove(this._onMouseMove);
    
    const container = this._chart?.chartElement();
    container?.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);

    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [new AlertsPaneView(this)];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this._alerts.map(a => new AlertAxisView(a, this._series!));
  }

  _getAlerts() { return this._alerts; }
  _getSeries() { return this._series; }

  private _onMouseDown = (e: MouseEvent) => {
    if (!this._chart || !this._series) return;
    const box = this._chart.chartElement().getBoundingClientRect();
    const y = e.clientY - box.top;
    
    // Check if we clicked near any alert line
    for (const a of this._alerts) {
      const alertY = this._series.priceToCoordinate(a.price);
      if (alertY !== null && Math.abs(y - alertY) < 10) {
        this._isDragging = true;
        this._draggedAlertId = a.id;
        e.preventDefault();
        break;
      }
    }
  };

  private _onMouseMove = (param: any) => {
    if (this._isDragging && this._draggedAlertId && param.point && this._series) {
      const newPrice = this._series.coordinateToPrice(param.point.y);
      if (newPrice !== null) {
        // Update local state for smooth drag
        const alert = this._alerts.find(a => a.id === this._draggedAlertId);
        if (alert) {
          alert.price = newPrice;
          this._requestUpdate?.();
        }
      }
    }
  };

  private _onMouseUp = () => {
    if (this._isDragging && this._draggedAlertId) {
      const alert = this._alerts.find(a => a.id === this._draggedAlertId);
      if (alert && this.onAlertMoved) {
        this.onAlertMoved(alert.id, alert.price);
      }
    }
    this._isDragging = false;
    this._draggedAlertId = null;
  };

  private _onClick = (param: any) => {
    if (!param.point || !this._series) return;
    
    // Check for delete button click (small X on the left)
    for (const a of this._alerts) {
      const alertY = this._series.priceToCoordinate(a.price);
      if (alertY !== null && Math.abs(param.point.y - alertY) < 15 && param.point.x < 30) {
        if (this.onAlertDeleted) {
          this.onAlertDeleted(a.id);
          break;
        }
      }
    }
  };
}

class AlertsPaneView implements IPrimitivePaneView {
  constructor(private _plugin: PriceAlertsPlugin) {}
  renderer(): IPrimitivePaneRenderer {
    return new AlertsRenderer(this._plugin._getAlerts(), this._plugin._getSeries()!);
  }
}

class AlertsRenderer implements IPrimitivePaneRenderer {
  constructor(private _alerts: AlertData[], private _series: ISeriesApi<SeriesType>) {}
  draw(target: any) {
    target.useMediaCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const width = scope.mediaWidth;

      for (const a of this._alerts) {
        const y = this._series.priceToCoordinate(a.price);
        if (y === null) continue;

        ctx.save();
        
        // Line
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.lineWidth = 1;
        ctx.strokeStyle = a.color;
        ctx.stroke();

        // Delete "X" button on the left
        ctx.fillStyle = '#1e222d';
        ctx.beginPath();
        ctx.arc(15, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = a.color;
        ctx.stroke();
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('✕', 15, y + 4);

        ctx.restore();
      }
    });
  }
}

class AlertAxisView implements ISeriesPrimitiveAxisView {
  constructor(private _alert: AlertData, private _series: ISeriesApi<SeriesType>) {}
  coordinate() { return this._series.priceToCoordinate(this._alert.price) ?? 0; }
  text() { return this._alert.price.toFixed(2); }
  textColor() { return '#ffffff'; }
  backColor() { return this._alert.color; }
  visible() { return true; }
  tickVisible() { return true; }
}
