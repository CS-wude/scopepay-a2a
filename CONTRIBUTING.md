# Contributing

Use Node.js 24 or later. Install the lockfile dependencies with `npm ci`, then run `npm test` and `npm run scopepay:check`.

Keep behavior changes small and include relevant tests. Distinguish deterministic fixture checks, online-model experiments and Braintree Sandbox transactions in every test report. A passing safety check is not evidence that a complete business scenario succeeded.

Never commit populated environment files, generated identities, databases, payment evidence or model/provider credentials. Use invented contract details in reproducible cases and redact any private data from screenshots. Test payment changes only in isolated local ledgers or explicitly selected Braintree Sandbox environments; preserve original-operation identifiers during recovery.

Describe the trigger, observed behavior, expected behavior and commands used to verify a pull request. ScopePay is a local prototype, so changes must not imply production authentication, real-money readiness or automatic video rendering unless independently implemented and verified.
