# ScopePay

**Tagline:** Buyer and seller agents negotiate service changes within your authority, then connect the agreement to verified payment and delivery evidence.

## Inspiration

A small request such as “add French subtitles and deliver tonight” can hide several commercial decisions: what is already included, what deserves an extra fee, whether rush is optional and whether either party is authorized to accept. ScopePay is built for independent creators, service providers and clients who want to delegate this back-and-forth while retaining control over the final deal.

## What it does

ScopePay provides buyer, seller and platform workspaces. Sellers create and publish services, with review and platform oversight. Buyers discover services and record existing agreements. A shared transaction room presents owner messages, agent proposals, counteroffers, accepted terms and delivery records.

Each side independently chooses human-assisted or delegated interaction. A conversation setting overrides that side's global preference. In mixed mode, the person who chose assistance answers their own detail questions while the other agent continues within its authority. Owners can approve a result, add information for another discussion or end the negotiation. Result approval does not itself trigger a payment.

## How we built it

A Node.js/Express gateway, SQLite records and two independent agent processes use the A2A SDK. Signed messages bind complete proposals to scope, price, delivery conditions and versions. An OpenAI-compatible model assists with language understanding and subtitle processing. A deterministic kernel enforces contract evidence, authority, arithmetic, turn limits and payment recovery.

Braintree Sandbox is the PayPal-ecosystem payment integration. The backend checks merchant configuration, creates a Sandbox sale, queries it and verifies amount, currency and order reference. An unknown result keeps budget reserved and recovers the original operation instead of creating another charge. Local demonstration entries use an isolated payment ledger by default; no real funds move.

## Challenges and what we learned

The main challenge was giving two agents an executable negotiation domain instead of simply asking them to chat longer. Versioned contract facts and complete alternatives make constraints explicit. Routine price exchanges can then run with bounded rules, while language models handle interpretation and non-structured content.

## Validation

The recorded regression baseline is 152 passing tests. Three online-model contract-change runs retained included color adjustment and new French subtitles at USD 10 by dropping optional rush. Subtitle checks passed; actual color-video delivery remained pending. Two more complex scenario families each paused in three runs because exact deadlines, conditional obligations or quality evidence were not fully represented; no payment was made for those paused requests.

A separate Braintree Sandbox record verifies a USD 10 sale as submitted for settlement, not final settlement. That record used predetermined decision outputs and is separate from the online-model experiments. A combined online-model and Braintree run is not claimed from those separate records.

## What's next

Extend the compact issue model with absolute deadlines, responsibility-bound conditions and quality claims linked to original delivery evidence. Evaluate human intervention, agreement quality and model usage across more services and opponents.

## About the builder

Built by a full-stack developer exploring delegated agent-to-agent commerce.

## Technical report

The [technical and test report](docs/ScopePay参赛技术与测试报告-PayPal.docx) is included in this work. It contains the negotiation-theory basis, development tests, three business scenario details and an English project summary.

## Built with

Node.js, JavaScript, Express, SQLite, A2A SDK, Ed25519, OpenAI-compatible model API, Braintree Sandbox, HTML, CSS.
