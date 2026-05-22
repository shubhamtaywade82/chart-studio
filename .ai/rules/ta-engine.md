# Technical Analysis Engine Rule

- All indicators must be stateless.
- Use the `Series` abstraction for time-series data handling.
- Ensure all math operations are safe and handle `NaN` or `Infinity` gracefully.
- Optimize the interpreter for high-frequency data throughput.
- Document the inputs and outputs of each indicator in the header comments.
