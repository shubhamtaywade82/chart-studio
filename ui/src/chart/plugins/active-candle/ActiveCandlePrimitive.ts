import {
  ISeriesPrimitive,
  IPrimitivePaneView,
} from 'lightweight-charts'

import { ActiveCandleRenderer } from './ActiveCandleRenderer'

export class ActiveCandlePrimitive
  implements ISeriesPrimitive
{
  private renderer = new ActiveCandleRenderer()
  private requestUpdate?: () => void

  attached({ requestUpdate }: { requestUpdate: () => void }) {
    this.requestUpdate = requestUpdate
  }

  update(data: {
    x: number
    openY: number
    highY: number
    lowY: number
    closeY: number
    candleWidth: number
    color: string
  }) {
    Object.assign(this.renderer, data)
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
