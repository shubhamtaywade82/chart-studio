# Adapter Rule

- All adapters must extend the base classes in `@chart-studio/adapter-core`.
- Maintain a clear separation between REST and WebSocket logic.
- Use the `TokenProvider` for authentication where applicable.
- Implement robust reconnection logic for WebSockets.
- Log important events (connection, errors, data flow) using the provided logger.
