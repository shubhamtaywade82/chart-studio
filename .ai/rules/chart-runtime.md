# Chart Runtime & Animation Pipeline

## Core Architecture
The charting system utilizes a custom `PluginRuntime` and `RafScheduler` overlaid on top of Lightweight Charts. This decouples the visual rendering of forming candles and real-time prices from the native chart's historical static data.

## Critical Safeguards
**DO NOT ALTER OR REFACTOR** the following core pipelines without explicit architectural approval from the user:

1. **The 60FPS Physics Loop (`RafScheduler` & `MotionEngine`)**
   - The loop auto-suspends when target price is reached to save battery.
   - When calling `motion.setTarget(price)`, you MUST immediately call `scheduler.requestContinuousRender()` to wake the loop.
   - Plugins MUST compute their coordinates within `onAnimationFrame()` by querying `engine.motion.getCurrent()`.

2. **The Active Candle Handover Protocol**
   - Lightweight Charts natively handles all historical candles (Indices `0` to `n-2`).
   - The *latest* candle (Index `n-1`) MUST ALWAYS be passed to `series.update()` with `color: 'rgba(0,0,0,0)'` (invisible) so that `ActiveCandlePrimitive` can draw the animated version in its place.
   - When a rollover occurs, the *previous* candle MUST have its color properties set to `undefined` via `series.update()` so the native renderer paints it solid green/red again.

3. **Coordinate Recalculation on Zoom/Pan**
   - Lightweight Charts calls `updateAllViews()` on custom primitives during zoom/pan events.
   - All animated primitives MUST implement `updateAllViews()` to call `this.engine.scheduler.requestContinuousRender()` and synchronously fire `this.onAnimationFrame(performance.now())`. This guarantees that the primitives stay glued to the grid without 1-frame lags.

## Extending the Chart
- **NO DIRECT DOM MANIPULATION**.
- If you need to add new overlays, markers, lines, or indicators, create a class implementing `ChartPlugin`.
- Register the plugin with `this.engine.registerPlugin()` in `chart.ts`.
- If the plugin needs to follow real-time price smoothly, use `this.engine.motion.getCurrent()` inside its `onAnimationFrame` hook.
