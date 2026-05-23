import {
  MediaCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
} from 'fancy-canvas'

export class RealtimeLineRenderer {
  x = 0
  y = 0

  previousX = 0
  previousY = 0

  color = '#00ff88'

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(
      (scope: MediaCoordinatesRenderingScope) => {
        const ctx = scope.context

        ctx.save()

        ctx.beginPath()

        ctx.moveTo(this.previousX, this.previousY)

        ctx.lineTo(this.x, this.y)

        ctx.lineWidth = 2

        ctx.strokeStyle = this.color

        ctx.shadowBlur = 12
        ctx.shadowColor = this.color

        ctx.stroke()

        ctx.beginPath()

        ctx.arc(this.x, this.y, 4, 0, Math.PI * 2)

        ctx.fillStyle = this.color

        ctx.fill()

        ctx.restore()
      }
    )
  }
}
