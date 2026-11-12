# Security and payment scope

ScopePay is a local demonstration, not a production payment service. Buyer, seller and platform views share a local owner environment; they do not provide production identity or tenant isolation. Do not expose this workspace to the public internet.

Payment adapters are an isolated local ledger and Braintree Sandbox. Neither moves real funds. Do not add production credentials. The live-model entry calls your configured provider and may incur model usage charges.

Keep all API keys and payment credentials in the backend's local environment only. Never upload populated `.env`, `.scopepay` runtime data, SQLite databases, private signing identities, payment evidence or credential-bearing screenshots. Public configuration examples must contain empty credential values.

When reporting a security issue, omit credentials and personal or payment information. Describe a minimal reproduction with invented values and the affected code path. Do not post an exploit against an account or running service; use the repository's private vulnerability reporting feature if enabled. If no private reporting channel is available, open a public issue containing only a non-sensitive request for a reporting channel.
