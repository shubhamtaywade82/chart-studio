# Architecture

## Monorepo Structure
- **Core Abstractions**: `packages/adapter-core` defines the interfaces that all adapters must implement.
- **Exchange Adapters**: `packages/adapter-binance` and `packages/adapter-dhanhq` implement exchange-specific logic (REST, WebSockets).
- **Runtime**: `packages/indicator-runtime` is a specialized engine for executing technical analysis indicators.
- **Engine**: `packages/ai-engine` consumes data from adapters to produce signals and narratives.
- **Gateway**: `packages/gateway` acts as a central hub for data distribution.
- **UI**: A Vite-powered TypeScript frontend.

## Communication
- Components typically communicate via Redis (see `adapter-core/src/redis-adapter.ts`).
- WebSockets are used for real-time updates to the UI.
