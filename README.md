# ScopePay

Delegated negotiation for changes to an existing service agreement. Buyer and seller agents exchange complete proposals covering scope, price and delivery conditions, within independently configured authority. Owners can participate in details or delegate the process and review its result.

ScopePay combines signed A2A communication, versioned contract evidence, a deterministic negotiation kernel and payment recovery. Braintree Sandbox is the implemented PayPal-ecosystem payment adapter. No live-money payment mode is supported.

## Requirements and installation

Use Node.js 24 or newer and npm. From the repository root:

```sh
npm ci
cp .env.example .env
npm test
npm run scopepay:check
```

The default regression suite uses isolated deterministic model outputs and isolated payment ledgers. It does not require credentials and does not prove online-model quality. The recorded development baseline is 152 passing tests.

## Run a reproducible local workspace

```sh
node scopepay/market-preview.mjs
```

Open http://127.0.0.1:8997/market . This entry uses deterministic model outputs and a local FixturePSP ledger. It does not call an external model or payment service. Buyer, seller and platform views are roles within a local demonstration, not production authentication.

To exercise a contract change, use Buyer → My delegations (我的委托) → Record existing delegation. The explicitly labelled sample supplies a 30-second video contract, English subtitles, one included color adjustment, French subtitles at USD 10 and optional rush at USD 5. Switch to Seller → Existing delegations (已有委托) and confirm the same version. Return to Buyer, request blue color adjustment and French subtitles with optional rush, and authorize USD 10. Choose automatic interaction for both roles. Inspect the complete proposals, then approve the same result from each role before payment. Subtitle generation and color-video delivery are separate obligations; the application does not render a video.

## Online-model workspace

Set MODEL_BASE_URL, MODEL_NAME and MODEL_API_KEY in the local `.env` to your OpenAI-compatible chat/completions endpoint, then run:

```sh
npm run scopepay:local
```

Open http://127.0.0.1:8994/market . This entry calls the configured model, incurs that provider's usage, and still uses the isolated payment ledger. It listens on the local network for phone testing; agent ports stay on loopback. Do not expose this demonstration to the public internet. The broader service-negotiation workflow depends on model behavior and may pause when conditions cannot be represented.

For isolated online contract-change verification:

```sh
node scopepay/contract-change-smoke.mjs
```

## Braintree Sandbox

Populate the BRAINTREE variables in `.env` using a Sandbox account. Never use production credentials. To inspect configuration without creating a transaction:

```sh
npm run braintree:status
```

The following explicit command creates a virtual USD 1 Sandbox sale if there is no saved operation, otherwise queries the original transaction. Keep its local evidence file for idempotent recovery:

```sh
npm run braintree:smoke
```

The original signed-A2A payment demonstration uses the ScopePay entry point. Set SCOPEPAY_PAYMENT_MODE=sandbox and select fixture or live model mode explicitly, then run `npm run scopepay:start` (http://127.0.0.1:8980). That observer workflow is distinct from the marketplace UI. Do not infer that the online-model marketplace and Braintree were jointly accepted from separate evidence records.

## What was evaluated

- Three online-model contract-change runs agreed on USD 10 standard delivery, preserving included color work and new French subtitles while dropping optional rush. They used an isolated ledger; subtitles passed program checks and actual color-video delivery remained pending.
- Exact calendar deadlines with conditional glossary/feedback obligations, and combined quality-repair/new-work requests, each paused in three tested runs. These complete scenario families did not pass business acceptance.
- A separate Braintree Sandbox record validated a USD 10 transaction as submitted for settlement. Its decision outputs were predetermined. This is not final settlement or evidence of the latest online-model path running with Braintree in one end-to-end test.
- Budget reservation, unknown payment results, original-order recovery, stale agreements, role-specific interaction and duplicate included-work allocation have regression coverage.

The detailed Chinese technical and test report, including an English project summary, is included in [the report](docs/ScopePay参赛技术与测试报告-PayPal.docx).

## Architecture and navigation

- `scopepay/start.mjs`: separate buyer/seller processes and gateway.
- `scopepay/marketplace.mjs` and `scopepay/public/market.js`: service listings and workspace.
- `scopepay/market-conversation.mjs`: role-specific negotiation state machine.
- `scopepay/service-contract.mjs`: confirmed contracts and priced changes.
- `scopepay/payment.mjs`: isolated ledger and Braintree Sandbox adapters.
- `scopepay/conversation-*.mjs`: authority projection, requirements and strategy.
- `scopepay/subtitles.mjs`: subtitle structure checks.
- `tests/`: deterministic regression cases.

Runtime identities, databases, evidence logs and populated environment files are generated locally and excluded from source control. Never publish them. See [MIT License](LICENSE).
