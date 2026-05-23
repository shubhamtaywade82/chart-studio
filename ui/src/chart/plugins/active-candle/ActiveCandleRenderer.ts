import {
  MediaCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
} from 'fancy-canvas'

export class ActiveCandleRenderer {
  x = 0

  openY = 0
  highY = 0
  lowY = 0
  closeY = 0

  candleWidth = 8

  color = '#00ff88'

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(
      (scope: MediaCoordinatesRenderingScope) => {
        const ctx = scope.context

        ctx.save()

        ctx.strokeStyle = this.color
        ctx.fillStyle = this.color

        ctx.shadowBlur = 14
        ctx.shadowColor = this.color

        // wick
        ctx.beginPath()

        ctx.moveTo(this.x, this.highY)

        ctx.lineTo(this.x, this.lowY)

        ctx.stroke()

        // body
        const bodyTop = Math.min(
          this.openY,
          this.closeY
        )

        const bodyHeight = Math.max(
          Math.abs(this.closeY - this.openY),
          1
        )

        ctx.fillRect(
          this.x - this.candleWidth / 2,
          bodyTop,
          this.candleWidth,
          bodyHeight
        )

        ctx.restore()
      }
    )
  }
}
