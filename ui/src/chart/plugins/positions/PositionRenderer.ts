import {
  MediaCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
} from 'fancy-canvas';

export interface PositionViewData {
  symbol: string;
  qty: number;
  avgPrice: number;
  y: number;
  pnl: number;
  pnlPct: number;
  liqY?: number;
  slY?: number;
  tpY?: number;
}

export class PositionRenderer {
  positions: PositionViewData[] = [];

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace((scope: MediaCoordinatesRenderingScope) => {
      const ctx = scope.context;
      const { mediaWidth, mediaHeight } = scope;

      for (const p of this.positions) {
        if (p.y !== -100) {
          console.log(`[PositionRenderer] drawing ${p.symbol} at y=${p.y} (height=${mediaHeight})`);
        }
        this._drawPosition(ctx, p, mediaWidth, mediaHeight);
      }
    });
  }

  private _drawPosition(ctx: CanvasRenderingContext2D, p: PositionViewData, width: number, height: number) {
    const color = p.pnl >= 0 ? '#2ebd85' : '#f6465d';
    const label = `${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty).toFixed(4)} @ ${p.avgPrice.toFixed(2)}`;
    const pnlLabel = `${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)} (${p.pnlPct.toFixed(2)}%)`;

    ctx.save();

    const isOffScreenTop = p.y < 0;
    const isOffScreenBottom = p.y > height;
    const drawY = Math.max(30, Math.min(height - 30, p.y));

    // 1. Draw LIQ Line (High priority risk)
    if (p.liqY !== undefined && p.liqY >= 0 && p.liqY <= height) {
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      ctx.moveTo(0, p.liqY);
      ctx.lineTo(width, p.liqY);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ff9800';
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      this._drawTag(ctx, 'LIQ', 10, p.liqY, '#ff9800');
      ctx.setLineDash([]);
    }

    // 2. Draw Entry Line
    if (!isOffScreenTop && !isOffScreenBottom) {
      ctx.beginPath();
      ctx.setLineDash([8, 4]);
      ctx.moveTo(0, p.y);
      ctx.lineTo(width, p.y);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Draw SL Line
    if (p.slY !== undefined && p.slY >= 0 && p.slY <= height) {
      ctx.beginPath();
      ctx.moveTo(0, p.slY);
      ctx.lineTo(width, p.slY);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#f6465d';
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      this._drawTag(ctx, 'SL', 50, p.slY, '#f6465d');
    }

    // 4. Draw TP Line
    if (p.tpY !== undefined && p.tpY >= 0 && p.tpY <= height) {
      ctx.beginPath();
      ctx.moveTo(0, p.tpY);
      ctx.lineTo(width, p.tpY);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#2ebd85';
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      this._drawTag(ctx, 'TP', 50, p.tpY, '#2ebd85');
    }

    // 5. Draw Main Position Label
    const tagW = 200;
    const tagH = 28;
    const tagX = width - tagW - 10;
    const tagY = drawY - tagH / 2;

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#1e222d';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    if (isOffScreenTop || isOffScreenBottom) {
       ctx.setLineDash([2, 2]);
    }
    this._roundRect(ctx, tagX, tagY, tagW, tagH, 6, true, true);
    ctx.setLineDash([]);

    if (isOffScreenTop) {
      this._drawArrow(ctx, tagX + tagW/2, tagY - 4, 'up', color);
    } else if (isOffScreenBottom) {
      this._drawArrow(ctx, tagX + tagW/2, tagY + tagH + 4, 'down', color);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, tagX + 10, tagY + 18);

    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(pnlLabel, tagX + tagW - 10, tagY + 18);

    ctx.restore();
  }

  private _drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
    ctx.save();
    ctx.font = 'bold 9px Inter, sans-serif';
    const metrics = ctx.measureText(text);
    const pad = 4;
    const w = metrics.width + pad * 2;
    const h = 14;

    ctx.fillStyle = color;
    this._roundRect(ctx, x, y - h / 2, w, h, 2, true, false);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + 4);
    ctx.restore();
  }

  private _drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 'up' | 'down', color: string) {
    ctx.beginPath();
    ctx.fillStyle = color;
    if (dir === 'up') {
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 6);
      ctx.lineTo(x + 5, y + 6);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y - 6);
      ctx.lineTo(x + 5, y - 6);
    }
    ctx.fill();
  }

  private _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: boolean, stroke: boolean) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
}
