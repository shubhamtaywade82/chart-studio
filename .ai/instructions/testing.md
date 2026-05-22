# Testing

- **Unit Testing**: Use Vitest or Jest for unit tests (to be confirmed).
- **Test Placement**: Keep tests adjacent to the source file using `.test.ts` suffix.
- **Mocking**: Mock external exchange APIs in all tests.
- **Coverage**: Aim for high coverage in `indicator-runtime` and `adapter-core`.
- **Integration**: Use the `adapter-template` to test core integration logic without external dependencies.
