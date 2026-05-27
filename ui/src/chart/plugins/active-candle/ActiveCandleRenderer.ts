import {
  MediaCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
} from 'fancy-canvas'
import type { CandleScopeOverlay } from './CandleScopeOverlay'

export class ActiveCandleRenderer {
  x = 0

  openY = 0
  highY = 0
  lowY  = 0
  closeY = 0

  candleWidth = 8

  color       = '#00ff88'
  borderColor = '#00ff88'

  /** Y coordinate (media px) of best ask price — passed in from primitive */
  askY: number | null = null
  /** Y coordinate (media px) of best bid price — passed in from primitive */
  bidY: number | null = null

  /** Y coordinate (media px) of the last trade — used for pulse ring */
  lastTradeY: number | null = null
  lastTradeQty = 0
  lastTradeIsBuy = false
  /** Set to true once, then cleared after the overlay consumes it */
  pendingTrade = false

  overlay: CandleScopeOverlay | null = null

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(
      (scope: MediaCoordinatesRenderingScope) => {
        const ctx = scope.context

        ctx.save()

        // ── Base candle (wick + body) ───────────────────────────────────────
        ctx.strokeStyle = this.borderColor
        ctx.fillStyle   = this.color
        ctx.shadowBlur  = 14
        ctx.shadowColor = this.borderColor

        // wick
        ctx.beginPath()
        ctx.moveTo(this.x, this.highY)
        ctx.lineTo(this.x, this.lowY)
        ctx.stroke()

        // body
        const bodyTop = Math.min(this.openY, this.closeY)
        const bodyH   = Math.max(Math.abs(this.closeY - this.openY), 1)

        ctx.fillRect(
          this.x - this.candleWidth / 2,
          bodyTop,
          this.candleWidth,
          bodyH
        )
        ctx.strokeRect(
          this.x - this.candleWidth / 2,
          bodyTop,
          this.candleWidth,
          bodyH
        )

        ctx.shadowBlur = 0
        ctx.restore()

        // ── CandleScope overlay (renders above base candle) ─────────────────
        if (this.overlay) {
          // Consume pending trade event → create pulse ring
          if (this.pendingTrade && this.lastTradeY !== null) {
            this.overlay.onTrade(this.lastTradeY, this.lastTradeQty, this.lastTradeIsBuy)
            this.pendingTrade = false
          }

          // Advance pulse animation
          this.overlay.tickPulses()

          // In media coordinate space, DPR = 1 (media coords are logical pixels).
          // We pass dpr=1 here and the overlay handles everything in logical pixels
          // (same coord space as the candle body above).
          const halfW = this.candleWidth / 2

          this.overlay.draw(
            ctx,
            this.x,
            this.openY,
            this.closeY,
            this.highY,
            this.lowY,
            halfW,
            1,         // dpr = 1 in media coordinate space
            this.askY,
            this.bidY,
          )
        }
      }
    )
  }
}
