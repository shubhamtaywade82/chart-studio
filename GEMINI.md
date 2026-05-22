# Chart Studio

Multi-provider charting platform with AI-powered analytics and multi-exchange support.

## Project Structure
- `packages/adapter-core`: Core adapter interfaces and utilities.
- `packages/indicator-runtime`: Custom TA indicator execution engine.
- `packages/adapter-binance`: Binance exchange adapter.
- `packages/adapter-dhanhq`: DhanHQ exchange adapter.
- `packages/ai-engine`: AI-powered trading signals and narrative generation.
- `packages/gateway`: Real-time data bridge and monitoring.
- `ui`: Frontend charting interface.

## AI Agent Instructions
Agent behavior is governed by instructions in `.ai/instructions/`.

- [Global Instructions](.ai/instructions/global.md)
- [Architecture](.ai/instructions/architecture.md)
- [Coding Standards](.ai/instructions/coding-standards.md)

## Scoped Rules
Detailed rules for specific parts of the codebase are in `.ai/rules/`.
