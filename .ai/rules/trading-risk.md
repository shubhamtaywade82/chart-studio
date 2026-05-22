# Trading Risk Rule

- Always validate order parameters (quantity, price, tick size) against exchange limits.
- Never place orders if the risk engine signals an alert.
- Ensure stop-loss is always attached to open positions where possible.
- Log all order execution attempts with full context.
- Maintain a local state of open orders to prevent duplicates in case of network failure.
