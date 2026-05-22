# Global AI Agent Instructions

- Prioritize correctness and type safety.
- Follow existing patterns in the codebase.
- Maintain consistency across different packages.
- Always run type checks (`npm run typecheck`) after changes.
- Ensure all new features are documented in `FEATURES.md` if applicable.
- Respect the boundaries between packages (adapters should not leak exchange-specific logic into `adapter-core`).
