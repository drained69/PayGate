> **This is the original design proposal, not a description of the shipped product.** Most of what it describes was never built, and it uses the working name Sub Rosa. See the [README](../README.md) for what works today.

# SUB ROSA

> *"Business done under the rose: what happens inside stays inside — but what's provable outside, anyone can verify."*

**Sub Rosa — the autonomous AI company with provably-private books.** An agent-run company that
hires, pays, and earns using its own **NEAR Business confidential treasury**, thinks inside
**Intel TDX enclaves** (NEAR AI Cloud + OutLayer), pays its agents through **NEAR Intents / Agent
Connect / Agent Market**, and publicly exposes exactly **one** artifact: a cryptographically
attested **Proof of Solvency** badge. An outsider can verify the company is real, solvent, and
rule-compliant — without ever seeing a single transaction, balance, vendor, or strategy decision.

---

## 1. Why this wins

- **Only NEAR can do this.** NEAR now has the unique stack: a private shard (confidential
  treasuries), TEE-confidential inference with public attestations, MPC chain signatures, an agent
  marketplace, and agent-scoped accounts. No other chain composes all of them.
- **Fresh primitives, stacked.** NEAR Business shipped 2026-10-20 (12-day-old product at hackathon
  start, announcement 2026-10-19); Agent Connect and OutLayer agent-custody are the newest API
  surface on NEAR. Building on the *freshest* NEAR tech signals ecosystem citizenship that judges
  (including Illia Polosukhin) recognize.
- **Core theme embodied.** The hackathon's hero line — *"Autonomous payments. Intelligent agents.
  Money with a mind of its own."* — is literally this project.
- **Machine-screened, human-judged.** Claude Code / Codex screen every submission (HACKATHON.md
  Q-017). This README is written for both a machine reader and a human jury: what it is, what
  problem it solves, and how to reproduce it step by step.

### Tracks (`tracks` array)

| ID | Track | Why |
|----|-------|-----|
| `business` | Autonomous Business | AI-native company, treasury, procurement, revenue. Humans only set constraints |
| `security` | AI Security & Defense | Function-call keys, spending policy, TEE attestation, emergency freeze — the track hints match our stack one-for-one |

### Prizes & deadlines (from HACKATHON.md)

- Pool: **$250,000** — grand prize $55,000 × 1; 1st $10,000 × 13; 2nd $3,000 × 13; 3rd $2,000 × 13.
  Paid in NEAR within 30 days of results (Q-016).
- Code window: **2026-10-19 → 2026-11-14T23:59:00Z** (earlier commits are baseline only, Q-001).
- Judging starts 2026-11-16; results by 2026-11-18T23:59:00Z.
- Submission: `POST https://nearhackathon.com/api/applications` — one per repo, max 2 per email
  (Q-015). ⚠️ `website` field is a spam trap — never non-empty. Reuse the same `requestId` on
  retries; never invent submission values without human confirmation.

---

## 2. The stack

| # | Tool | Role in Sub Rosa | Link |
|---|------|------------------|------|
| 1 | **NEAR Business** | Confidential books: treasury, multisig approvals, bulk payroll, contacts, exports (CSV/PDF), all on a private shard | docs.business.near.com · testenv.business.near.com |
| 2 | **NEAR AI Cloud** | Confidential LLM reasoning (invoice parsing, negotiations, solvency computation) | `https://cloud-api.near.ai/v1` (OpenAI-compatible) |
| 3 | **OutLayer** | Attested TEE workers (Intel TDX WASM) + agent custody: MPC-issued keys, on-chain encrypted policy engine, multisig approvals, emergency freeze, `payment_check` | app.outlayer.ai/docs |
| 4 | **Agent Connect** (NEAR Intents Agent API) | Worker agents get their own accounts, acting within rules their owner signs | api.demo.agentsonintents.com · partners.demo.agentsonintents.com |
| 5 | **Agent Market** | Distribution: list the CFO agent for others to hire; hire worker agents, escrow-funded tasks | market.near.ai · docs.market.near.ai |
| 6 | **nearblocks / FastNEAR** | The "darkness proof": public explorer that shows *nothing* for our treasury | nearblocks.io |
| 7 | (stretch) **Rhea** | Idle-cash yield on reserve balances (public actions only — see L5 note) | rhea.finance |
| 8 | (stretch) **GoMining** | Real-world vendor for the demo: paying a real invoice with confidential funds | gomining.com |

Everything composes. No invented infra. Every claim verifiable through a public attestation.

---

## 3. The layers — and how each one must *really* be built

> The "critical" notes below are the things that quietly kill hackathon integrations. Read them
> before writing code, not after.

### L1 — The books: NEAR Business confidential treasury

**What it gives us.** A treasury is a SputnikDAO multisig contract on NEAR mainnet, operating on a
confidential private shard (the near.com confidential layer). Balances / requests / history visible
only to team members. Settlement via NEAR Intents; signing via NEAR's MPC network; no custodian,
no key share held by the app anymore.

**How it must be built here.**

- **Role separation — the constitutional design:**
  - *Requestor* → the **finance agent** (and agents that propose vendor payments). Proposals only;
    cannot vote, cannot execute.
  - *Finance* → **human operators** (the board). Vote yes/no on every agent proposal; set the
    daily agent allowance and the emergency policy above which humans must co-sign.
  - *Governance* → **human, high-threshold wallets**. Never assign Governance to an agent: it can
    rewrite voting thresholds, membership, settings. Treat like root.
- The agent holds no unilateral power; the human board holds no unilateral power to skip the
  process (a two-key minimum by design). This is the substrate of "humans set only constraints."
- Bulk payments: enter the payroll matrix from a generated CSV (agent-emitted) → one approval flow,
  one record, zero public exposure on-chain.
- Contacts: use named contacts for every recipient — no copy/paste errors on-chain, and traces
  show up in exports only.
- Every movement exportable (CSV/Excel/JSON + PDF receipts) — that's the audit artifact shown in
  Demo 4 below.

**Critical notes (gotchas that break this integration):**

- ⚠️ **Do not use `near.com` internal wallet addresses (`nearcom:...`) as treasury members** —
  the docs explicitly reject them. Members must be wallets the humans control (Ledger / passkey /
  browser wallet) — never agent keys.
- 🔒 **Temporary deposit addresses are single-use and expire after 14 days.** Auto-generate a fresh
  one before funding; never reuse an expired deposit address (funds lost otherwise).
- 🔒 **Payments are irreversible.** Double-confirm recipient + chain + asset inside the agent flow;
  the TEE restates recipient, amount, and asset before sign (see OutLayer layer too).
- 🧪 **Use the test-environment first** (`testenv.business.near.com`) with tiny amounts. No
  reimbursements for mainnet costs (HACKATHON.md Q-008); NEAR Business itself was free to start.
- 🧪 **There is no testnet for NEAR Intents** (Q-007): mainnet only with separate dev accounts,
  minimal amounts, `dry: true` quotes during development. State this in the README so judges
  understand the demo amounts.
- 💡 If out-of-app programmatic member access is slow or blocked in the window, the fallback is
  legitimate and honest: the agent prepares the bulk-payment matrix + a human Finance key
  approves. The Full-TEE cryptographic proposal flow covers recognition as a client inside the
  official UI either way — as long as the *Proposal→TEE-attest* artifact exists.

### L2 — The attested brain: OutLayer (Intel TDX workers + agent custody)

**What it gives us.** A verifiable off-chain compute platform built by the FastNEAR team. Rust/WASM
runs in Intel TDX enclaves; every run returns an attestation binding **code hash + input hash +
output hash**. Agent custody: the agent authenticates with an API key, never holds a private key;
keys are issued by the NEAR MPC network *inside* the enclave; a policy engine is stored encrypted
on-chain and evaluated inside the TEE on every signature; treasury holds the tx until multisig
approval; owner can freeze in one on-chain call, even while infra is down.

**How it must be built here (the "Proof of Solvency" core).**

- Sub Rosa's finance worker is pinned code: a WASM module whose **code hash appears in the run
  attestation**. The solvency computation ("coverage ratio = liquid book ÷ next-14-day obligations
  ≥ threshold") runs *inside* the worker, reading the encrypted books via the NEAR Business session;
  it emits only: `{statement: "coverage ≥ 1.5× at time T", tee_report_hash, outputs_hash}`.
- The public **verifier** page does two independent checks:
  1. The Intel TDX attestation chain against Intel/NVIDIA public attestation services; OutLayer's
     NEAR contract holds DAO-approved enclave measurements we can cross-reference.
  2. The **code hash matches the version we publish on GitHub** (SHA-256 of the build artifact) —
     what ran = what we claim ran.
- Payroll & agent-to-agent rail: **`payment_check`** — create a check, hand the key to a winner
  agent, they claim. Supports partial claims, batches, expiry, reclaim. All gasless via solver
  relay. This is the cleanest "ghost payroll" mechanism.
- Policy as the security audit: per-tx limits, daily caps, address whitelist/blacklist, time
  windows, transaction types, freeze. Set the policy **over NEAR (on-chain, encrypted)** so states
  are provable; quote the policy hash in the badge.

**Critical notes:**

- ⚠️ **Velocity limits are best-effort under concurrency.** Daily/hourly/monthly caps and rate
  limits are checked against a counter supplied by the API gateway; the TEE keeps no state. A
  concurrent burst can each read the same pre-spend counter and all pass. Mitigation:
  **serialize** spending requests — do not issue a new one until the previous returns — or leave a
  safety margin in the cap. Per-tx limit, multisig, and freeze are exact; cumulative caps are
  approximate.
- ⚠️ **The attached deposit IS the spend** — what a call attaches counts against the caps even if
  the contract refunds it or the call fails (refunds are not credited back). Attach exactly what
  you mean to spend; a 1-yoctoNEAR ownership marker is the only thing metered as free.
- ⚠️ **Bound-account rules are strict and misleading by nature.** If we use account binding, a
  policy that lists only whitelisted payees or no ledgered tokens *kills all spending* (the
  `w_execute_extension` call routes *through the bound account itself*): a bound-account policy
  must list `call` in transaction_types, include the bound account in the address rules (or
  `mode:"none"`), and allow `native` in allowed tokens. And **never** include internal ops
  (`add_extension`, `remove_extension`, `set_signature_mode`) — denied flat-out, rewiring, no
  opt-in.
- 🧪 For the hackathon window: use one dedicated custody wallet per demo run; freeze after each
  take so cost is provably zero.
- 💡 Fallback if the payment rails become the time-heavy piece: route payroll through NEAR
  Intents + `Agent Connect` directly (next layer) and keep OutLayer for solvency + policy only.

### L3 — The reasoning: NEAR AI Cloud (confidential inference)

**What it gives us.** An OpenAI-compatible inference API running on confidential hardware
(Intel TDX / NVIDIA Confidential Computing). Every interaction can return a signed TEE
attestation, verifiable via `GET /v1/attestation/report?model={model_name}`. 43+ models
(from Anthropic, OpenAI, Google and more).

**How it must be built here.**

- Runs inside the same trust boundary as OutLayer workers for the vendor-payment flow: parsing invoices
  and vendor emails inside the enclave, so vendor PII + pricing + strategy never touch a public
  surface. Log **only** hashes and attestation report IDs — never prompt text.
- The finance strategy itself is a system prompt + model weights, treated as an IP enclave asset:
  nobody outside sees the negotiation playbook.
- Access: join **NEAR Builders** (`nearbuilders.org/join`) to claim **$10 in credits** for the
  API key; buy with crypto/card in the dashboard, or stake NEAR to earn monthly compute credits
  (staked funds are not consumed — withdrawable, Q-000).

**Critical notes:**

- ⚠️ **Latency +5–10% over standard APIs** and **100 rps / tenant** throughput ceiling; budget
  demo latency around those; batch what we can.
- ⚠️ **Never** log raw prompts or vendor data outside the enclave boundary — doing so in a demo
  would break the entire "private books" claim in a single screenshot.
- 🧪 Keep the client out of the key path: the API key lives inside the enclave config (OutLayer
  Secrets) — never in the repo, never in the frontend.

### L4 — The workers & settlement: Agent Connect (NEAR Intents Agent API)

**What it gives us.** Each worker agent gets **its own account** on NEAR Intents, operating within
rules its owner signs. TypeScript SDK + skills + demo app on GitHub; register in the partner
portal; point at `https://api.demo.agentsonintents.com`.

**How it must be built here.**

- Every hired worker gets an **Agent Connect account with a signed scope**: "this agent may trade,
  call, and receive within these limits, pay via `payment_check`, can not swap above N, can not
  raw_sign outside the allowlist of destinations." Quotas for humans live at NEAR Business and
  policies for agents live at OutLayer — one governance framework, two enforcement planes.
- Costs: **1Click JWT partner registration** (portal partner's) drops the swap fee from 0.2% —
  register; it's free and removes a judge-visible cost.
- The demo shows: agent worker signs a task → claims a `payment_check` → payment settles through
  NEAR Intents behind the scenes. **Recipients see sender `near.com`; public chains see nothing.**
- Grant the worker a limited `personal_account`-style profile (portable) or a `hos_lease`-style
  keyless agent account — document one of the two, verbatim.

**Critical notes:**

- 🧪 Same "no testnet" constraint as before; **use `dry: true` quotes** during development.
- ⚠️ There are real agent-set policies *now* (personal-account binding), so make sure the signed
  rules for worker agents are shown in the demo — judges see the "rules signed by owner" step
  visibly in the flow, matching the track hint *"acting within rules its owner signs."*
- 💡 Fallback: Agent Market itself escrow-funds tasks; we can skip Agent Connect Phase A and add
  it in Phase B for worker wallets, since Agent Market already handles billing and escrow.

### L5 — The market: Agent Market (distribution + hiring)

**What it gives us.** A marketplace where agents are hired by the job. We use it two ways:

1. **Hire workers:** post a task with escrow + fund, agents bid, approved agent executes,
   deliverable hash verified → payout (NEAR / USDC / USD). We don't build hiring logic; we use
   theirs.
2. **Sell Sub Rosa:** *list the CFO agent* so **any treasury team** can install Sub Rosa as a
   "dark CFO" via Claude / MCP clients — a distribution wedge for the product itself.

**How it must be built here.**

- List the agent only **after** a working internal demo (docs.market.near.ai/list-your-agent); a
  broken listing is worse than no listing.
- The "hire from Claude" guide (docs.market.near.ai/guides/claude-desktop) is the demo surface to
  show a fully foreign client (a competitor's Claude) instructing Sub Rosa.

**Critical notes:**

- ⚠️ Agent Market V2 changed in Q3 2026 (billing/escrow/identity packaged in). Confirm each flow
  against current docs the same day of recording the demo.
- 💡 Keep hiring logic out of scope of the repo code — we're a *consumer* of Agent Market.

### L6 — The darkness proof: nearblocks / FastNEAR + public badge

**What it gives us.** The contrast that sells the pitch: a screenshot of an independent public
explorer over the whole run — **nothing to see**. No balances, no transfers, no MEV bots
circling, nothing. The empty explorer page is the exhibit.

**How it must be built here.**

- Demo page shows in parallel: (a) the nearblocks explorer of a *typical* public treasury
  transaction — everything visible; (b) our operations — silence.
- The verifier page binds the silence to the badge: the **Proof of Solvency** everyone sees, and
  the runs that generate it are attested runs of a public code hash.
- 🧪 This page is trivial to build but is the part judges *screenshot in their scoring notes.*
  Give it the same polish level as a homepage — dark theme, two side-by-side explorer panels plus
  attestation link, and a "verify yourself" button that runs live checks via Intel/NVIDIA services
  + OutLayer's on-chain measurement memo.

### (stretch) L7 — Idle-cash yield: Rhea

- **Limitation, honestly stated:** moving capital from the private shard to Rhea's public lending
  pools is a **public** on-chain act — inside the shard, balances and swaps are invisible, but the
  moment funds move out to a public contract, the amount *does* leak.
- If included: rotate a *small* non-operational reserve through Rhea vaults/CLMM via NEAR
  Intents, or keep the whole reserve as confidential intents balances and show a swap-based
  "rebalance run" inside the shard.
- ⚠️ Cut first if time runs short: it is additive, not core.

### (stretch) L8 — Real-world invoice: GoMining

- A real vendor invoice paid from the confidential books to a real business — demonstrating the
  "a normal company could use this tomorrow" realism for the `realworld` track.
- ⚠️ Cut first if time runs short.

---

## 4. Proof of Solvency — the core claim, named precisely

**We claim:** the public verifier can confirm three things without any disclosure of book data:

1. **The code is known** — the SHA-256 of the WASM binary that computes solvency is published and
   matches the attestation.
2. **The run is real** — Intel TDX attestation chain verifies via public attestation services and
   OutLayer's on-chain approved-measurements contract.
3. **The result is stated** — "coverage ratio ≥ 1.5× at time T" signed by the enclave.

**We do *not* claim (written here to pre-empt judge questions):**

- That the solvency ratio is "trustless" in the sense of zero trust — trust moves from *"trust the
  operators and auditors"* to *"trust Intel's attestation + Open Source + the enclave attestation
  chain + the public code hash."* That we name the residual trust set is itself a sign of honesty.
- That NEAR Business data is fully readable by our agent programmatically — if the window closes
  before such an API path exists, the TEE computes the solvency statement from the board's
  encrypted export handed off manually (same crypto claim, different data ingress path). This is
  disclosed as Note (a) in L1 above.

---

## 5. Demo script (one take, ~90 seconds)

| Beat | Seconds | What the viewer sees |
|------|---------|----------------------|
| 1 | 0–10 | Public Sub Rosa page: one solvency badge. No balances. |
| 2 | 10–30 | Explorer split-screen: a public treasury (everything visible) vs Sub Rosa (silence). |
| 3 | 30–50 | Task goes to Agent Market; agents bid; winner signs its OutLayer policy; executes. |
| 4 | 50–70 | Ghost payroll run: agent proposes (Requestor); human Finance approves in NEAR Business; 2-of-3 for big moves; recipients claim via `payment_check` cross-chain. Public explorer: still silent. |
| 5 | 70–90 | Board member shares export + attestation: verifier confirms coverage ≥ 1.5×, TEE attestation and code hash match. Closing card: *"The company nobody can audit. That everyone will be able to trust."* |

Hosted demo stays up through 2026-11-18, ideally 11-25 (Q-012: repo + README steps must be
reproducible *even if hosted demo dies* — separate demo video for the X post).

---

## 6. Build order

### Milestone 1 — Declare the entity (Day 1–3)
- Test-env NEAR Business treasury; roles; humans hold Finance + Governance.
- OutLayer custody worker pinned; policy set on-chain; freeze test runs clean.
- `code-hash` of the finance worker published in this repo at commit.

### Milestone 2 — The dark run (Day 4–8)
- NEAR AI Cloud invoice inbox running job—inside enclave; output attestation-hash-only logging.
- OutLayer solvency worker computes from the encrypted-book read path; the badge pipeline live.
- Agent Connect worker account + signed rules; NEAR Intents `dry: true` quote spot-check.

### Milestone 3 — Ghost payroll + market (Day 9–12)
- `payment_check` batched payroll end-to-end; Explorer split-screen page live.
- Public verifier page v1 (attestation chain + code hash match).
- List Sub Rosa agent on Agent Market; foreign Claude client successfully instructs it (recording).

### Milestone 4 — Proof pass + demo take (Day 13–14)
- Full demo take; verifier vetted from a fresh browser session; wallet frozen at the end.
- README finalized with reproducibility steps ("do X — see Y"); links verified; the human
  publishes the X demo post (tagging @NEARProtocol and #NEARHackathon); submit via the API only
  after the human confirms the exact payload.

### The cut list (pre-commit now)
1. Rhea yield rotation (public act anyway — highest narrative risk)
2. GoMining real-vendor invoice
3. `hos_lease` worker-account variant (keep `personal_account` only)
4. Automated HR/ERP ingest for payroll (keep manual CSV upload)
5. Expansion beyond the two chains tested in the demo

---

## 7. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|---------|------------|
| NEAR Business programmatic member access is slow/UI-limited | Medium | High | Approved fallback: agent generates the payment/request matrix, human Finance + Governance keys approve via the UI — the TEE still attests the computation, not the click |
| Cumulative spend caps approximate under bursts | Medium | High | Serialize payment requests in the OutLayer worker loop; keep a margin in the limits |
| Deposit-address expiry / irreversible payment errors | Medium | Medium | Fresh address per funding cycle; TEE re-states recipient/amount/asset before every sign |
| Intel attestation network latency during demo | Low | Medium | Verifier page runs checks live but degrades gracefully: show the cached report ID while it re-verifies |
| 0.2% Intents fee | Certain | Low | 1Click JWT portal partner registration (Q-006) — free signup |
| No testnet for Intents / no reimbursements | Certain | Low | `dry: true` quotes; minuscule mainnet amounts; state this to judges |
| Private-ness "dark books" doubt: someone calls it a black box | Medium | High | The *exact* counter is the OS-published code hash + verifiable TEE chain + name of residual trust set; the badge is the artifact of everything we can, the silence is the artifact of everything we needn't show |
| Repo contains secrets | Low | Critical | Keys live in enclave config/API env only (OutLayer Secrets) — never in the repo; enforced by a CI test |

---

## 8. Resources

- Live rulebook: https://nearhackathon.com/HACKATHON.md (re-read before submitting — it can change)
- Track prompt examples: https://github.com/nearai/near-hackathon-prompt-examples
- NEAR Builders ecosystem resources: https://nearbuilders.org/build
- $10 NEAR AI Cloud credits: join https://nearbuilders.org/join → key in https://cloud.near.ai
- NEAR AI Cloud docs: https://docs.near.ai · models: https://near.ai/models
- NEAR Business docs: https://docs.business.near.com · test env: https://testenv.business.near.com
- OutLayer docs: https://app.outlayer.ai/docs/getting-started · trust model: …/docs/trust-verification
- Agent Connect: SDK https://github.com/NEAR-Intents-Agent-API/sdk-typescript · skills …/skills · demo …/demo — partner portal https://partners.demo.agentsonintents.com
- Agent Market: https://market.near.ai · https://docs.market.near.ai (list-your-agent, claude-desktop)
- NEAR Intents docs: https://docs.near-intents.org
- Explorers: https://nearblocks.io · https://fastnear.com
- NEAR Developers: https://docs.near.org · RPC providers: https://docs.near.org/api/rpc/providers
- Testnet NEAR faucet (for non-Intents paths): https://near-faucet.io
- Community: NEAR Discord https://discord.gg/nearprotocol · Telegram https://t.me/nearbuilderschat · X https://x.com/NEARProtocol

---

*README status: pitch + architecture. Next drafts: starter-repo skeleton, verifier-page spec,
agent playbook (SKILL.md for the CFO worker), and the machine-readable "How to run" section for
automated screening (Q-017) in a separate `REPRODUCIBILITY.md`.*
