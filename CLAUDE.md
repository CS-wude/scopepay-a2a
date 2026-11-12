# ScopePay engineering notes

## Commands

- `npm ci`: install locked dependencies; Node.js >=24 required.
- `npm test`: deterministic Node test suite, isolated temporary state.
- `npm run scopepay:check`: syntax checks.
- `node scopepay/market-preview.mjs`: credential-free deterministic workspace on loopback port 8997.
- `npm run scopepay:local`: configured live model with isolated payment ledger on port 8994; local-network listener.
- `npm run scopepay:start`: observer workflow with explicitly selected model/payment adapters.

## Boundaries

Source of truth is code and tests. Read affected implementations before changing behavior. Buyer/seller agents run in separate processes. Contract, policy and payment checks are deterministic; model output cannot expand owner authority. Generic marketplace and confirmed-contract workflows have distinct acceptance limits. Braintree supports Sandbox only.

Do not print, publish or commit populated `.env`, identities, runtime databases or payment logs. Never modify a user's historical state during tests. Keep fixture, live-model and Sandbox evidence distinct. The report is linked from README; its incomplete scenario results must not be described as passes.
