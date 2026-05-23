import {
  ISeriesPrimitive,
  IPrimitivePaneView,
} from 'lightweight-charts'

import { RealtimeLineRenderer } from './RealtimeLineRenderer'

export class RealtimeLinePrimitive
  implements ISeriesPrimitive
{
  private renderer = new RealtimeLineRenderer()
  private requestUpdate?: () => void

  attached({ requestUpdate }: { requestUpdate: () => void }) {
    this.requestUpdate = requestUpdate
  }

  update(
    x: number,
    y: number,
    previousX: number,
    previousY: number,
    color: string
  ) {
    this.renderer.x = x
    this.renderer.y = y

    this.renderer.previousX = previousX
    this.renderer.previousY = previousY
    
    this.renderer.color = color
    
    this.requestUpdate?.()
  }

  paneViews(): IPrimitivePaneView[] {
    return [
      {
        renderer: () => this.renderer,
      },
    ]
  }
}
