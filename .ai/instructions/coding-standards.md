# Coding Standards

- **Language**: TypeScript (v5+).
- **Style**: Standard TypeScript conventions.
- **Logging**: Use `pino` for structured logging.
- **Error Handling**: Use explicit error types; avoid generic `Error` where possible.
- **Testing**: (To be determined based on existing tests).
- **Async**: Use `async/await` exclusively; avoid raw Promises or callbacks.
- **Types**: Prefer `interface` for object shapes, `type` for unions/aliases. Avoid `any`.
