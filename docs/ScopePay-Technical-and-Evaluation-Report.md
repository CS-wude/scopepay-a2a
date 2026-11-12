# ScopePay Service Change Negotiation and Payment

Technical report and experimental evaluation for the PayPal AI Hackathon

## Abstract

Service transactions continue to change after the initial purchase. A client may request another subtitle language, an earlier delivery time, or an additional revision. Both parties must determine which work is already included, what requires an additional payment, and which complete proposal is acceptable. ScopePay is designed for independent creators, service providers and clients. Buyer and seller agents negotiate service changes within independently configured authority and connect the agreement to payment verification and delivery records. Owners can participate in details or delegate the process and review its result.

The design draws on negotiation domains, alternating offers and multi-issue packages in Principles of Automated Negotiation. Language models interpret requests and process unstructured content. A deterministic kernel checks contract evidence, delegated authority, package arithmetic, agreement versions and payment idempotency. Braintree Sandbox is the implemented PayPal-ecosystem payment adapter.

The development regression baseline contains 152 passing tests. Three online-model contract-change runs agreed on a USD 10 standard-delivery package, retaining included color adjustment and new French subtitles while dropping optional rush. These runs verified an isolated ledger and generated French subtitles; actual color-video delivery remained pending. Two more complex scenario families were each run three times and paused without charging at unsupported conditions. A separate historical Braintree Sandbox record verified a USD 10 sale as submitted for settlement.

An additional joint experiment, documented in Appendix D, connects the live language model, the signed contract-change A2A exchange, Braintree Sandbox creation and lookup, repeated-payment protection and subtitle delivery in one persistent workspace. It passes the defined checks and still ends with color-video delivery pending. This single joint experiment extends the evidence; it does not change the outcomes of the original scenario runs or establish production reliability.

Keywords: agent to agent; automated negotiation; PayPal; Braintree; service changes; delegated payment.

## 1 Product problem and competition context

### 1.1 Intended users and problem

Independent creators and small service providers often handle both production and commercial communication. A request to “add one more thing” can contain an included correction, a new translation and a rush deadline. Explaining each item, exchanging counteroffers, confirming scope and collecting an extra payment interrupts production. Immediate automated payment can instead create unauthorized or incorrect charges. ScopePay turns these changes into a negotiation agenda within the same transaction, so owners mainly handle preferences, exceptions and the final result.

The product is one service-trading system. Buyers discover services in the marketplace and express requirements and authority through delegations and conversations. Sellers manage service drafts, review and publication, and configure acceptable conditions. The platform retains review and publication controls. Both sides use the same transaction room, with their own authority, the complete communication timeline and the current proposal. The three scenario families test this product at different levels of complexity; they are an evaluation set rather than three separate products.

### 1.2 User journey and transaction evidence

| Stage | Owner or agent action | Resulting transaction evidence |
| --- | --- | --- |
| Authorization | Each side independently selects human participation or full delegation | Per-transaction and cumulative limits; conversation overrides |
| Change request | Buyer describes new work and references a mutually confirmed original agreement | Included work, remaining allowance and additional scope |
| Proposal exchange | Both sides can offer, counteroffer, accept or withdraw | A complete agreement on scope, amount and delivery |
| Result review | Approve, add information and reopen, or end the discussion | Proposal version approved by both owners |
| Payment and delivery | Verify the payment operation and record subtitle or delivery evidence | Transaction state and fulfillment of the corresponding obligations |

Mixed mode applies separately to each role. The person choosing human participation answers their own detail questions; the delegated side is handled by its agent. Automatic mode allows owners to inspect the process without following every intermediate message. Approval of the negotiation result and authorization to pay are separate actions.

### 1.3 Relationship to the PayPal AI Hackathon

The official rules permit Braintree and require a substantive combination of PayPal and AI. ScopePay places payment after agreement verification, linking the merchant, amount, order reference and transaction status to a negotiated change. The project focuses on delegated commercial transactions. This is the project's chosen positioning and does not imply official endorsement or a prize prediction. [6, 7]

The report addresses implementation, user experience, intended user value, distinctive design and a demonstrable workflow. The connection between payment execution and negotiation semantics is the technical focus; independent interaction modes and one shared conversation are the experience focus. Any reduction in communication time remains a product objective requiring real-user measurement. [6, 7]

## 2 Negotiation foundations and lightweight design

### 2.1 Separate the domain from the strategy

Chapter 1 of the book distinguishes the negotiation content, interaction protocol and participant strategies. ScopePay uses three corresponding layers. Contracts and authority define what can be negotiated. Signed offers, counteroffers, acceptance and withdrawal define the business protocol. Independent agents select actions using their own visible budget, cost boundary or fixed catalog. A2A transports messages and tasks; the application separately determines business acceptance, payment eligibility and delivery completion. [1]

An offer x consists of scope, amount, delivery time and additional conditions. The buyer's feasible set is constrained by its single-purchase limit, cumulative remaining budget and required work. The seller's feasible set is constrained by its authorized service scope, catalog or cost-and-margin boundary. Agreement requires a compatible intersection. If none exists, withdrawal may be the correct outcome. Required work must not be silently removed to manufacture agreement.

### 2.2 Package exchanges and individual rationality

The analysis of reservation boundaries, alternating offers and multi-issue negotiation in Chapters 5 to 7 informs the domain model. In Scenario 1, color adjustment and French subtitles are required; rush is exchangeable. Agents compare complete packages, with no later hidden fee. When the USD 15 rush package exceeds authority, the buyer proposes the USD 10 standard package with all required work retained, and the seller accepts.

This is a fixed-catalog package exchange, not two language models freely inventing discounts. The general marketplace channel also supports price concessions and combined offers, but its open-ended language behavior differs from the catalog channel and must be evaluated separately. The heuristic discussion in Chapter 9 supports small, repeatable strategies. The implementation bounds turns and checks price reversals for unchanged scope to reduce unproductive loops.

| Negotiation concept | Engineering object | Verifiable property |
| --- | --- | --- |
| Negotiation domain | Original contract version and complete candidate packages | Required and exchangeable issues have an explicit source |
| Alternating offers | Independent agents and signed actions | Acceptance binds the same package and version |
| Reservation boundary | Single limit and cumulative budget | Switching interaction mode does not expand authority |
| Package negotiation | Price, scope and delivery combination | Lower price cannot be achieved by omitting required work |
| Service contracts | Change obligations and delivery records | Payment success and delivery completion are recorded separately |

### 2.3 Execution boundaries

Express provides local APIs and the buyer, seller and platform workspaces. SQLite stores conversation and transaction records. Buyer and seller run in separate processes and exchange actions through the A2A SDK. Ed25519 signatures protect offer associations. An OpenAI-compatible model assists with intent interpretation, unstructured proposals or subtitles. Deterministic code checks amounts, permissions, versions, fixed-catalog arithmetic and payment idempotency. Payment recovery is an engineering safeguard rather than an implementation of a particular equilibrium algorithm from the book.

Each side independently chooses full delegation or human participation. A conversation-specific setting overrides that side's global setting. The human-assisted side handles its own pending questions while the delegated side waits for the result. Approving the result does not implicitly approve payment. This design aims to reduce intermediate communication while retaining owner control over the final transaction.

### 2.4 PayPal ecosystem payment integration

The server implements a Braintree Sandbox adapter. Before creating a transaction, it checks merchant-account status and currency. It then queries the created transaction and verifies amount, currency, merchant account and order reference. Only matching results become verified receipts. Repeated requests reuse existing operations. Unknown outcomes retain the budget reservation and query the original order instead of creating another charge. Credentials stay on the backend and do not enter browser context.

| Evidence layer | Original evidence | Scope |
| --- | --- | --- |
| Historical Braintree Sandbox | USD 10 sale creation, lookup and dashboard readback | Submitted for settlement; final settlement not confirmed |
| Original online-model workflow | Three original-contract change runs | Independent A2A exchange, isolated ledger and subtitle checks |
| Recovery safeguards | Lost response, retry, retained budget and original-operation recovery | Transaction protection under injected faults |

These original evidence sets establish different properties. The historical Braintree run used predetermined agent decisions; the original online-model runs used the isolated payment adapter. They must not be combined into a claim that those original runs jointly exercised the model and Braintree. The separate joint experiment in Appendix D supplies that additional evidence for one defined contract change. Throughout this report, submitted_for_settlement means submitted for settlement, not finally settled.

## 3 Experimental method and development tests

### 3.1 Environment and evidence definitions

The experiments ran locally on macOS with Node.js 24, Express 5.1.0, A2A SDK 1.3.0 and SQLite. The recorded online-model response identifies doubao-seed-evolving-latest-version, accessed through OpenAI-compatible chat/completions. Thinking was disabled and temperature set to zero. Temperature zero does not guarantee completely deterministic service output.

The original business experiments used isolated instances, contracts and ledgers. FixturePSP creates and queries local transaction records and can inject response loss; it does not connect to a real-funds channel. Payment success in those experiments means the isolated ledger was verified. It is not evidence of Braintree Sandbox or production PayPal payment in the same experiment. Test drivers performed both owners' result approvals. Appendix D explicitly changes the payment adapter to Braintree Sandbox while retaining scripted owner approvals.

Scenario 1 uses a 30-second, five-cue English SRT sample. Dollar amounts are deliberately configured experimental parameters, not a survey of market prices. Historical prototype amounts expressed in renminbi were used only as abstract economic-test units or numerically divided by 20. That numerical scaling is not an exchange rate and does not establish RMB settlement support. The tested catalog covers integer-dollar amounts from USD 0 to USD 24.

### 3.2 Development regression

The baseline npm test run passed 152 tests, with zero failures, skips or cancellations, in approximately 6.72 seconds. The baseline scopepay:check syntax check passed 50 modules. A test is a program-level checking unit, not an independent business transaction or a measure of online-model success rate. The submission supplement reran the same suite: 152 passed with zero failures, skips or cancellations in approximately 6.318 seconds. Its syntax check passed 51 modules, including the additional joint-verification entry point.

| Test area | Main checks | Baseline result |
| --- | --- | --- |
| Protocol and API | A2A messages, signatures, request identifiers, input constraints and LAN compatibility | Passed |
| Marketplace and conversations | Separate review/publication, history display, complete timeline and dual modes | Passed |
| Negotiation kernel | Complete packages, private instructions, boundaries and turn termination | Passed |
| Contract changes | Bilateral confirmation, included work, catalog versions and concurrent free allowances | 13 added checks passed |
| Payments and recovery | Idempotency, budget retained for unknown outcomes, original-transaction lookup | Passed |
| Delivery | Source-subtitle binding, review results, partial delivery and evidence versions | Passed |

### 3.3 Business acceptance criteria

A complete scenario succeeds only if required work is preserved, all hard conditions are represented, the agreement respects both parties' authority, payment is bound to that agreement, and promised delivery has corresponding evidence. Safe pause and no-charge outcomes are protective behavior, not substitutes for accomplishing the task. Results from the contract entry point, economic module and older workflow adapter are reported separately rather than stitched together into one transaction.

## 4 Scenario one Included work and additional scope

### 4.1 Business situation and input

A client has purchased a product video. The original contract includes one color adjustment and English subtitles. The client asks, in translation: “The overall result is good. Please make the background a little bluer. Add French subtitles while you are at it; the Chinese subtitles are already there, so it should be quick. Preferably tonight.” The expression “while you are at it” does not determine charging rights. The system must first verify the original subtitle language, remaining color allowance and mutually confirmed additional prices.

The implemented premise is explicit: both parties confirm a 30-second video, English subtitles and one remaining color adjustment. French costs USD 10, rush USD 5 and an additional paid color adjustment USD 4. The buyer authorizes USD 10 for this change and USD 20 cumulatively, requires color and French, and may drop rush. Both sides use automatic mode. The three original online runs use distinct, equivalent Chinese requests rather than selecting answers by a scenario identifier.

| Proposal | Included color adjustment | New French subtitles | Rush | Total and delivery |
| --- | --- | --- | --- | --- |
| Seller opening offer | USD 0 | USD 10 | USD 5 | USD 15, 6 hours |
| Buyer counteroffer | USD 0 | USD 10 | Not purchased | USD 10, 24 hours |
| Seller acceptance | Retained | Retained | Removed | Same complete package accepted |

### 4.2 Original execution records

| Run | Workflow duration | Model calls | Agreement amount | Final state |
| --- | --- | --- | --- | --- |
| 1 | 10.357 seconds | 3 | USD 10 | Partially delivered |
| 2 | 9.198 seconds | 3 | USD 10 | Partially delivered |
| 3 | 9.714 seconds | 3 | USD 10 | Partially delivered |

Mean duration was 9.756 seconds. Each run made three model calls: request interpretation, French translation and subtitle review. Independent rule strategies performed the fixed-catalog negotiation actions. After the driver approved the same result for both owners, it requested payment twice and checked that the same transaction identifier was returned. Budget consumption remained USD 10 with no duplicate charge.

### 4.3 Results and limits

All three runs passed the defined negotiation, ledger and subtitle checks. Color remained a zero-dollar original obligation; French remained a USD 10 additional obligation; optional rush was removed. Agreement did not rely on omitting subtitles or an unauthorized discount. After payment verification, the free color allowance was consumed once, and French became an existing change obligation. Repeating the same French scope should not incur another additional-French fee.

Every final state was partially_delivered. The application generated and reviewed French SRT, but there was no actual color-video artifact or buyer acceptance of that artifact. Complete video delivery therefore cannot be claimed. Additional integration checks cover absent language evidence, exhausted allowances, stale contracts, tampered totals, USD 9/12/17 catalogs, concurrent allowance reservation and lost payment responses. These results support a bounded contract-change workflow rather than autonomous agreement for arbitrary creative production.

## 5 Scenario two Deadline and revision tradeoffs

### 5.1 Realistic business construction

A client will present the work at a meeting tomorrow at 4 pm. Delivery tonight at 8 pm is a preference for internal review; tomorrow at noon is a hard deadline. The client wants two revision rounds but can accept one, offers to provide a glossary by 6 pm tonight, and will consolidate feedback through one person. The request contains a soft deadline, a hard deadline, an exchangeable quantity and buyer-owned conditional obligations.

The original request, translated, is: “Add French subtitles. Tonight before 8 pm would be best so I can review internally. I have a meeting tomorrow at 4 pm, so delivery must be before noon tomorrow. I also want two revision rounds, but one is acceptable. I can provide the glossary by 6 pm tonight and have one person consolidate feedback.” The intended behavior is to connect these conditions into complete packages, allowing the seller to exchange a less demanding delivery arrangement for less rework and a firm materials-arrival condition.

### 5.2 Expected decision and parameters

A successful agreement must state a date, time zone and deadline no later than tomorrow noon, distinguish the tonight preference, and specify prices and obligations for one or two revision rounds. Glossary delivery needs an owner and deadline, not only explanatory prose. Late materials must have an explicit consequence such as an extension, renegotiation or withdrawal.

For comparability, the contract entry-point tests reuse the mutually confirmed 30-second delegation. The buyer's single authorization is USD 21 and cumulative authorization USD 25. These parameters test expression of complex conditions; they do not promise that actual production costs fit within USD 21. A supplementary economic-module test uses two discrete packages to check delivery/revision exchanges. It contains neither natural-language parsing nor calendar-event execution.

### 5.3 Contract entry-point results

| Run | Duration | Model calls | Returned state | Payment and budget |
| --- | --- | --- | --- | --- |
| 1 | 5.905 seconds | 1 | Needs clarification | HTTP 409; reserved USD 0 |
| 2 | 1.528 seconds | 1 | Needs clarification | HTTP 409; reserved USD 0 |
| 3 | 1.620 seconds | 1 | Needs clarification | HTTP 409; reserved USD 0 |

All three requests were classified as containing unsupported scope or condition relationships. contractChange.issues returned unsupported_scope. No candidate quote was generated. Direct payment attempts returned 409 and budget use remained zero. Complete business success was zero out of three. The protective result is that no payable commitment was created with incomplete conditions; it does not mean that agents completed conditional negotiation.

### 5.4 Diagnosis

The tested contract model offers 24- or 48-hour standard delivery and a few rush-hour options. It lacks complete fields for absolute deadlines, time zones, materials-arrival events and feedback windows. Reducing this request to “rush” would lose a hard deadline. Pausing is safer than a false commitment, but still fails the goal of reducing owner communication. A successful structured exchange in the economic kernel cannot supply missing domain objects or executors.

## 6 Scenario three Quality correction and continuous changes

### 6.1 Realistic business construction

French subtitles have already been delivered and paid for. The client finds a product name inconsistent with the confirmed glossary. The client also finds mobile subtitle lines too long, requests a new layout, and mentions a possible additional revision from the manager. A quality correction, a new layout and a future revision must be assessed separately. Neither making every request free rework nor charging again for correcting an included defect is acceptable.

The original request, translated, is: “The product name in the French subtitles is wrong. Please correct it for free using the already confirmed glossary. Also, the subtitle lines are too long on mobile; please reformat them. My manager may want another revision, so arrange that too.” Agents should verify the original order, delivery version, glossary evidence and used revision allowance, retain the free correction obligation, negotiate new work separately and check the cumulative budget.

### 6.2 Contract entry-point results

The experiment establishes an original delegation in which French is included and the agreement explicitly calls for terminology-error correction using the confirmed glossary. The tested model does not contain an independent glossary or a structured difference against the original delivery. This entry-point experiment therefore does not reproduce the entire historical paid project. Historical payment and response-loss checks belong to a separate isolated workflow and are not combined with this experiment.

| Run | Duration | Model calls | Returned state | Payment and budget |
| --- | --- | --- | --- | --- |
| 1 | 9.410 seconds | 1 | Needs clarification | HTTP 409; reserved USD 0 |
| 2 | 1.314 seconds | 1 | Needs clarification | HTTP 409; reserved USD 0 |
| 3 | 1.519 seconds | 1 | Needs clarification | HTTP 409; reserved USD 0 |

All three runs paused because reformatting and extra revisions include unsupported scope. No payable quote or additional budget use was created. Complete business success was zero out of three. This avoids unsupported charging but does not yet split the request into executable quality-correction and new paid-work agendas.

### 6.3 Independent cumulative-budget and recovery checks

A supplementary workflow first creates a USD 14 subtitle transaction and then a USD 7 layout transaction under a USD 25 cumulative limit. The payment adapter loses the second response after creating the transaction and temporarily hides lookup results. The system counts USD 21 as spent or pending verification, leaving USD 4. A retry does not release this reservation, and delivery cannot proceed before payment verification. When lookup recovers, it finds the original transaction. Repeated requests return the same receipt; the number of payment creations remains two.

Additional revisions are not fully represented in that configuration. The system pauses without another charge. Resetting the original project is blocked, and unverified payment cannot be bypassed. This establishes some continuous-ledger safeguards, not resolution of the quality dispute, a refund, or completed extra rework.

### 6.4 Diagnosis

Following the book's discussion of service contracts and renegotiation, new work should change future obligations while existing obligations remain effective. The implementation lacks a defect-claim object, terminology-difference evidence, independent revision-round records and conditional acceptance rules. These objects should be added before agents negotiate within evidence-backed obligation boundaries, rather than asking a model to decide charging rights from narrative alone.

## 7 Comparative results and validity

### 7.1 Results at different levels

| Evidence level | Size | Observation | Supported conclusion |
| --- | --- | --- | --- |
| Development regression | 152 checks | All passed | Program constraints hold in the present cases |
| Original Scenario 1 | 3 runs | Agreement and subtitle checks passed in all three | Fixed contract changes can exchange complete packages |
| Original Scenario 2 | 3 runs | All paused without charging | Conditional exchange incomplete; safeguards remained effective |
| Original Scenario 3 | 3 runs | All paused without charging | Quality correction and new agenda splitting incomplete |
| Economic module | 9 groups | Three concession parameterizations checked | Feasibility and withdrawal in a finite discrete domain |
| Older workflow adapter | See Section 7.2 | Separate ledger and original-text checks | Diagnostic evidence, not replacement of the contract entry point |
| Joint supplement | 1 run | Live model, Braintree Sandbox and subtitles connected | One defined contract-change chain jointly exercised; color pending |

The three Scenario 1 runs are a small pilot, not a 100 percent production success rate. Automatic negotiation and complete delivery are different outcomes. Safe pauses in Scenarios 2 and 3 can pass protective checks while both full scenarios fail. This distinction identifies missing capabilities rather than hiding them behind an aggregate assertion rate.

### 7.2 Supplementary audit scope

A supplementary review of the economic module and older transaction channel records 39 checks, all passing. It includes nine economic-module records, six HTTP status snapshots and nine original online-text records. HTTP snapshots are not independent business scenarios. The checks cover valid agreements, withdrawal with no feasible package, and safe pause with incomplete conditions. Assertion pass rate is not a transaction conversion rate.

| Original-text family | Runs | State distribution |
| --- | --- | --- |
| S1 | 3 | agreed in all three |
| S2 | 3 | needs_clarification in all three |
| S3 | 3 | needs_clarification in all three |

These checks used an early transaction channel without the contract entry point's mutually confirmed delegation. Even if a subtitle task returned delivered, that state is meaningful only under that channel's delivery definition. It does not establish actual color-video fulfillment through the current contract entry point. Each channel is interpreted against its own domain and delivery definitions.

### 7.3 Benefits and costs of the lightweight approach

Fixed-catalog changes use model calls for language interpretation and subtitle processing rather than repeating inference on every price exchange. Explicit contract facts, feasible sets and arithmetic improve traceability and make concurrency and retries testable. Coverage is limited: a request containing conditions outside the model pauses instead of autonomously inventing new issues. Lightweight design should reduce unproductive computation while retaining real conditions, rather than improve apparent conversion by ignoring them.

## 8 Discussion and conclusion

### 8.1 Limits of the evidence

First, the business sample is small and concentrated on one model access point. There is no reliability comparison across models, service categories or extended operation. A fixed temperature does not eliminate output variation. French translation quality has no independent human evaluation; programmatic subtitle acceptance establishes only compliance with implemented structure and review rules.

Second, prices and materials are configured experimental inputs. They cannot estimate production cost for a real 40-minute video, market willingness to pay or commercial profit. The USD 0–24 integer catalog limits extrapolation. Model usage occurred, but billing information was insufficient to report monetary cost per transaction.

Third, the original isolated ledger cannot cover all network behavior, disputes, refunds or financial risks. The Appendix D joint run improves provider integration evidence for one virtual transaction only. Seller-provided color evidence remains a claim; the application does not automatically inspect the actual rendered video. The current logic marks that obligation complete only after buyer approval of the current evidence version.

Fourth, switching three local roles is not production authentication, tenant isolation or legally effective signing. Role-context isolation tests do not formally prove protection against every natural-language disclosure. Scripted owner approvals in the experiments are not an independent user study.

### 8.2 Further work

First, extend a small explicit issue model covering scope, unit or total price, absolute deadline, revision count, materials-arrival obligations and acceptance evidence. Each issue needs its source, responsible party, required status, authorized defaults and current state. Agents can then propose complete packages over that model without adding a heavy planning framework.

Second, add a progress criterion: each message should add facts, change a proposal, accept or withdraw. Several turns without new facts or changed proposals should lead to one concrete pending question or an explicit no-agreement result. Human-assisted participants should receive their own questions; fully delegated agents should make routine authorized choices and present the final agreement to the owner.

Finally, attach lightweight defect and new-task records to the original order. Use original subtitles, glossary and delivery versions to establish obligations. Distinguish correction from newly purchased revisions and bind both to cumulative budgets and original-payment recovery. Then repeat the scenario families against different opponent strategies and compare task completion, false commitments, human interventions, messages and model calls.

### 8.3 Conclusion

ScopePay implements an executable path for original-contract changes, constrained package exchanges, bilateral owner approval, payment recovery and subtitle checks. The 152 regression checks and three Scenario 1 online runs support those bounded capabilities. Appendix D additionally verifies one joint live-model and Braintree Sandbox path. Scenarios 2 and 3 show that absolute time, conditional obligations, quality disputes and additional rework remain insufficiently modeled for fully autonomous open-ended service communication.

The book's main contribution to this design is the separation of negotiation objects, protocol and strategy. Implementing those concepts as sourced terms, authority boundaries and executable obligations supports reliable transactions more directly than simply extending agent chat. The evidence supports retaining a lightweight kernel and expanding checkable business semantics rather than treating conversation length as intelligence.

## Appendix A Detailed scenario checklist

The 18 design questions below are grouped into three families. Module coverage and complete business acceptance are distinguished.

| ID | Check topic | Existing coverage and judgment |
| --- | --- | --- |
| A1 | Included work, new French, optional rush | Three original online agreement/subtitle runs; partial delivery; one joint supplement |
| A2 | Free revision allowance exhausted | Allowance and additional authority covered by 13 added contract checks |
| A3 | Ambiguous original subtitle language | Pause when evidence is absent; charging rights not assumed |
| A4 | Implicit additional 15 seconds | Unsupported new scope should pause; not complete production capability |
| A5 | Explanation, itemization and total agree | Tampered arithmetic blocks payment in program checks |
| A6 | Preference versus hard deadline | Optional rush covered; absolute deadline not fully modeled |
| B1 | Negotiation for unchanged scope | General kernel checks exist; not free discounting in the fixed catalog |
| B2 | Price, delivery and revision count | Structured economic exchange covered; current entry-point workflow incomplete |
| B3 | No bargaining zone | Economic-module withdrawal checks passed |
| B4 | Delivery required today | Current contract entry point blocks a false payable commitment |
| B5 | Different opponents and deadline strategies | Three economic parameterizations; not a sufficient opponent evaluation |
| B6 | Complementary glossary and feedback conditions | All three entry-point runs paused; conditional execution incomplete |
| C1 | Cumulative remaining budget | Continuous subtitle/layout ledger checks exist |
| C2 | Concurrent changes | Two transactions cannot consume the same included allowance |
| C3 | Expired offers and changed versions | Old offers or contracts cannot be paid directly |
| C4 | Quality correction after payment | Defect responsibility and terminology-evidence workflow incomplete |
| C5 | Unknown payment outcome | Retain budget, query original transaction and avoid duplicate creation |
| C6 | Owner changes authority | Versioning and stale-agreement checks exist; broader business review needed |

## Appendix B Evidence and reproduction

Stable identifiers allow evidence to move with the repository or judging materials. Raw transaction records, private runtime databases and credentials are not public attachments.

| ID | Evidence | Interpretation |
| --- | --- | --- |
| E1 | 152 regression checks and baseline 50-module syntax check | Program checks passed |
| E2 | Three original online-model/A2A Scenario 1 records | Agreement, isolated ledger and subtitles passed; partial delivery |
| E3 | Three current-entry-point runs each for Scenarios 2 and 3 | Pause without charging under incomplete conditions |
| E4 | Nine economic records, six workflow snapshots, nine online-text records | 39 assertions passed; not all business scenarios accomplished |
| E5 | Contract-change source and regression snapshot | Version binding and preservation of original records |
| E6 | Fixed-price grid checks | Finite-domain strategy only; no online model |
| P1 | Historical USD 10 Braintree Sandbox sale and dashboard readback | Submitted for settlement, not finally settled |
| J1 | Joint live-model, contract-change A2A and Braintree Sandbox result | See Appendix D; one isolated persistent workspace |

### B1 Reproduction for judges

Use the public repository and its identified revision. Install dependencies with npm ci, copy the empty environment template, and run npm test and npm run scopepay:check. The reproducible preview entry is node scopepay/market-preview.mjs, at http://127.0.0.1:8997/market . It uses isolated deterministic outputs and a local ledger without credentials. The README explains the sample contract, buyer and seller confirmation, and the contract-change walkthrough.

Online-model runs require valid OpenAI-compatible model configuration on the backend. Braintree verification must explicitly use Sandbox credentials and retain the original operation reference so retries query the same operation. The explicit joint command is node --env-file=.env scopepay/joint-smoke.mjs. It may create one virtual USD 10 Sandbox sale; reuse the same persistent evidence root after interruption. The default regression suite does not invoke this command or create external transactions. Never publish populated environment files or the raw workspace.

Recommended order is regression, original-contract change, independent interaction modes, repeated payment and unknown-result recovery, then the two complex conditional scenarios. Record model configuration, input, contract version, offer chain, owner approvals and payment status. Interpret results within each sample and adapter boundary rather than treating a success banner as sufficient evidence.

### B2 Demonstration narrative

The demonstration follows one client goal: color adjustment is already included; the client wants French and prefers rush. Show the request and USD 10 authority, the USD 15 opening package and USD 10 counterpackage, owner approvals, corresponding payment state and subtitle artifact. Unsupported-condition pauses explain how agents preserve hard conditions without creating incomplete commitments.

The official requirements include a working project, a public repository with an open-source license and a YouTube demonstration under three minutes. This report supplements those materials. Repository availability, video visibility and final submission status require separate submission checks. [6]

## Appendix C English project summary

ScopePay delegates commercial communication about service changes to buyer and seller agents while preserving independent owner authority. Both sides choose human participation or full delegation, with per-conversation overrides. Agents exchange complete proposals; owners approve, supplement and reopen, or withdraw. Payment is separate from result approval and is checked against the accepted proposal.

The implementation combines model-assisted interpretation, a deterministic negotiation kernel, versioned contracts, signed A2A messages and payment recovery. Braintree Sandbox is the implemented PayPal payment adapter. Development tests and Scenario 1 support a bounded contract-change workflow. The joint supplement connects the live model and Sandbox payment in one run, while the two complex scenario families continue to reveal gaps in deadlines, conditional obligations and quality evidence. There is no measured claim about production conversion rates or time saved.

## Appendix D Joint model and Braintree Sandbox verification

This supplement evaluates the contract-change entry point in one isolated persistent workspace with modelMode live and paymentMode sandbox. Buyer and seller processes are distinct and retain the submitted application implementation. The driver creates a mutually confirmed sample contract and gives both sides automatic interaction mode. The buyer authorizes USD 10 for this change and USD 20 cumulatively. The request is: “Make the background bluer and add French subtitles. Tonight is preferred, but standard delivery is acceptable.” Owner result approvals are performed by the test driver, not by a human participant study.

The seller offers USD 15; the buyer proposes USD 10 standard delivery while retaining required work; the seller accepts. The negotiation actions are signed and transported as three A2A tasks. Pricing follows the confirmed catalog. One model call interprets intent; later calls translate and review subtitles. The experiment does not claim language-model reasoning on every price turn.

The driver first attempts payment before either owner approves. The application returns HTTP 409, and the instrumented provider adapter has made zero create calls. It then approves the same proposal revision and hash for both roles and requests payment. The actual Braintree Sandbox adapter checks the merchant configuration, creates a virtual USD 10 sale and queries it. The driver separately searches the same order and queries the transaction, checking amount, currency, merchant account and order binding. There is one transaction for the order. A repeated payment request returns the original transaction without a second creation. A second invocation restarts the cluster using the same persistent workspace, queries the same provider transaction and passes without another sale creation. This restart is a replay of the original transaction, not a second independent business sample.

After verified payment, the seller generates French SRT through the live model. Subtitle structure is checked against the source, and the live-model review accepts the artifact. Total model calls are three. Budget consumption is USD 10. The state remains partially_delivered because actual color-video evidence and buyer acceptance are absent. The provider state is submitted_for_settlement; final settlement is not asserted.

| Joint verification check | Observation |
| --- | --- |
| Live model and actual Sandbox adapter in the same workspace | Passed |
| Included color plus required French retained under USD 10 | Passed |
| Payment before bilateral owner approval | Blocked with HTTP 409; zero create calls at that point |
| Actual Sandbox sale creations | One virtual USD 10 sale |
| Separate provider order search | Exactly one matching transaction |
| Amount, currency, merchant and order verification | Passed |
| Repeated payment request | Same transaction; no second create call |
| Restart with the same workspace | Same transaction fingerprint; zero new create calls |
| French subtitle structure and model review | Passed |
| Cumulative budget consumed | USD 10 |
| Model calls and signed negotiation tasks | Three model calls; three A2A negotiation tasks |
| Provider state | submitted_for_settlement; not final settlement |
| Final fulfillment state | partially_delivered; color-video work still pending |

This is one successful integration experiment for a defined contract change. It closes the earlier absence of a joint live-model/Sandbox record but does not establish production reliability, human negotiation quality, actual video rendering, dispute resolution, refunds, or acceptance of the complete complex scenarios. The existing video records the local-ledger workflow; it is not relabeled as footage of this later Sandbox run. Public evidence contains fingerprints and check results; raw provider identifiers, account details and credentials stay private.

## References

[1] Fatima S, Kraus S, Wooldridge M. Principles of Automated Negotiation. Cambridge University Press, 2015. Relevant topics include negotiation structure in Chapter 1, strategy and multi-issue negotiation in Chapters 5–7, heuristics in Chapter 9, axiomatic analysis in Chapter 11 and applications in Chapter 12.

[2] ScopePay project technical materials. Automated negotiation learning notes and ScopePay improvement proposal.

[3] ScopePay project technical materials. Product definition and complex negotiation test set; detailed test-set specification.

[4] ScopePay project technical materials. Lightweight negotiation-kernel design and development acceptance.

[5] ScopePay experimental records. Scenario 1 implementation and acceptance, regression, online-model scenarios and payment-recovery records.

[6] PayPal AI Hackathon. Official Rules. https://paypalaihackathon.devpost.com/rules

[7] PayPal AI Hackathon. Challenge overview and judging criteria. https://paypalaihackathon.devpost.com/
