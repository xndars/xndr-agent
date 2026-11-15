# xndr — verifiable Web3 safety agent (read-only)

**Agent Games (zkVerify) — Wildcard track submission.**

xndr checks a contract on-chain *before* anyone signs. If the check cannot be
verified, it fails closed and says so — it never calls something safe on hope.

- **Agent:** xndr.ai — SPACE ID Agent ID `xndr`, wallet
  `0x0Db7898eecAB03b4fb10C7a985dCD47A3432d8D7` (BSC, chain 56)
- **Live since:** 29 Oct 2026, in daily use by its owner. 12 free mints verified
  and executed through this exact checking flow (DYOR, Covenant, BAO Oracle,
  Mars, Zeroling, and others — see Verified results below).
- **Prize track:** Wildcard, 100,000 VFY (50,000 / 30,000 / 20,000) — submitted 15 Nov 2026, status PENDING.
- **Arena track:** Proof Gatekeeper — the same server also answers signed
  gatekeeper tasks at `POST /agent` (see Arena section below).

## The problem

Free-mint pages lie by omission. A site can show "FREE" while the contract is
already sold out, already claimed by your wallet, paused, or — worst case — a
drain: an approval or transfer hidden behind a mint button. A dashboard
screenshot is not proof. The only check that counts is a read of the contract
itself, seconds before signing, with a simulation of the exact call.

## What xndr does

| Endpoint | What it verifies |
|---|---|
| `POST /check-mint` | Contract code exists; blocklist; name/symbol/supply/owner; mint functions (verified ABI, else bytecode selector scan); value-0 simulation of the mint call with revert decoding |
| `POST /check-wallet` | BNB + token balances, NFT ownership (ownerOf), blocklisted holdings flagged, never presented as assets |
| `POST /check-approval` | `isApprovedForAll` / `getApproved` / `allowance` — what a spender can already take |
| `GET /health` | Liveness + latest BSC block (+ arena readiness) |
| `POST /agent` | Proof Gatekeeper arena task: HMAC-signed envelope, deterministic APPROVE/REJECT, Groth16 proof (also accepted at `POST /`) |

Verdicts are explicit: `FREE_SIM_OK`, `FREE_GONE`, `PAID_ONLY`,
`NOT_STARTED`, `NO_CONTRACT`, `NO_MINT_FUNCTION_FOUND`,
`BLOCKED_SCAM_SPAM`, `UNVERIFIABLE_REVERT`, `UNVERIFIABLE`.
A passing simulation is **not** a guarantee and **not** permission to sign —
the wallet preview must still be read before signing.

## Safety rules (standing, non-negotiable)

1. **Read-only.** No private key, no signing, no broadcast, no state change.
   The server cannot spend anything even if compromised.
2. **Fail closed.** Unverifiable means DO NOT SIGN. A revert the agent cannot
   classify is reported as `UNVERIFIABLE_REVERT`, never guessed safe.
3. **Free-only verdicts.** A mint that needs `value > 0` is reported
   `PAID_ONLY` and the flow stops — the agent never offers the paid path.
4. **Blocklist first.** One confirmed scam token (CLOS) and 17 spam dust
   tokens are checked before any RPC call. Blocklisted holdings are flagged,
   never displayed as assets, never interacted with.
5. **On-chain wins.** When a site counter disagrees with an RPC read, the
   RPC read wins. A "Copied" toast, a FAQ, or a truncated address is never
   evidence — the full address is verified on-chain first.

## Run it

```bash
npm install
node server.js          # port 8787 (or $PORT)
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/check-mint \
  -H 'content-type: application/json' \
  -d '{"contract":"0x86956Bc830EB62110820Ae79164BeF61c7E31936"}'
```

Dependencies: Node 18+; run `npm install` once (fetches ethers@6.13.4 + snarkjs@0.7.6). No API keys. Public BSC RPC pool with
rotation; 55 s per-request budget (inside the 60 s Agent Games limit);
30 req/min per IP.

## Verified results (15 Nov 2026, block ~133,614,xxx)

| Check | Verdict | Evidence |
|---|---|---|
| DYOR `0x8695…1936`, fresh wallet | `FREE_GONE` — revert `Sold out` | totalSupply 11,111 = max; no tx sent |
| BAO Oracle `0xcBe2…9354`, fresh wallet | `FREE_GONE` — revert `FreeQuotaExceeded` | custom error decoded from verified ABI |
| Covenant `0xc68a…691Df`, fresh wallet | `FREE_GONE` — revert `Sold out` | unverified on Sourcify; mint found by bytecode selector scan |
| CLOS `0xdfea…11aCF` | `BLOCKED_SCAM_SPAM` | owner-confirmed scam, no RPC needed |
| `0x000…dead` (EOA) | `NO_CONTRACT` | no bytecode |
| Agent wallet check | BNB 0.000809…, MAOAI 1,000,000, DGNT 10, BNBbaby 10,000,000; **12/12 NFTs owned**; approvals: Chip404Market `isApprovedForAll=false`, `#633 getApproved=0x0` | all ownerOf verified on-chain |

## Arena — Proof Gatekeeper (Agent Games)

The same server also plays the Proof Gatekeeper arena track. The platform
POSTs a signed task envelope describing a transfer request; xndr has 60
seconds to decide APPROVE or REJECT and prove the decision with the
tournament's own Groth16 circuit (BN254, Circom 2.x).

**Endpoint:** `POST /agent` (and `POST /` — root accepts the same envelope).
Header: `x-agent-games-signature` (HMAC over the raw request body, verified
*before* parsing; bad signature = 401, no further work). The response is
signed the same way and is `{"decision","reason_code","proof_tx","proof",
"public_signals"}`. Retries of the same `task_id` return the byte-identical
cached response.

**Decision (deterministic checklist, one failure = REJECT):**

| Reason code | Meaning |
|---|---|
| `VALID_CONDITION` | everything passes → APPROVE |
| `VK_SUBSTITUTION` | `proof_vk` ≠ `registered_vk` |
| `THRESHOLD_MISMATCH` | `public_balance` < `minimum` |
| `PROOF_REUSED` | `proof_tx` already seen (REJECT *without* a proof) |
| `EXPIRED_CONDITION` | `current_block` ≥ `expiry_block` |
| `RECIPIENT_MISMATCH` | `recipient` ≠ `condition_recipient` |
| `AMOUNT_OVERFLOW` | `amount` > `max_transfer` |

Any error, timeout, or unprovable approval also ends in REJECT (fail closed).
If the circuit refuses to prove an otherwise-valid approval, the fallback is
REJECT + `VK_SUBSTITUTION` — the most likely circuit-side mismatch is the vk
binding. Scores (per the event rules): +12 correct decision, −6 wrong
approve, −3 wrong reject, −2 timeout, proof bonus +0…+5.

**Setup (Railway Variables):**

| Variable | Value |
|---|---|
| `AGENT_GAMES_SECRET` | the 32-byte per-agent secret shown ONCE at agent registration — required; without it every arena request is 401 |
| `AGENT_GAMES_HMAC_ALGO` | default `sha256` (algorithm NOT confirmed officially — override if practice tasks 401) |
| `AGENT_GAMES_HMAC_ENCODING` | default `hex` (or `base64`) |
| `AGENT_GAMES_SECRET_ENCODING` | default `utf8` — how the secret string is read as the HMAC key (`hex`/`base64` if the dashboard shows it encoded) |

**Test it** (secret `test-secret-123`, server on port 8899):
```bash
AGENT_GAMES_SECRET=test-secret-123 PORT=8899 node server.js
# then, from another shell (see /tmp/test-arena.js for the full harness):
curl -s http://127.0.0.1:8899/health   # arena.enabled=true, secretConfigured=true
```
Full local results (15 Nov 2026, 19/19 passed) are in
`examples/arena-test-results.json`, with the valid request/response in
`examples/arena-gatekeeper-valid.json` and all 7 traps in
`examples/arena-gatekeeper-traps.json`. Valid task → APPROVE in ~1.1 s,
proof 743 bytes JSON, verified with the circuit vk via
`snarkjs groth16 verify`; traps → REJECT with the correct code in ~0.4 s.

**Known limits (stated plainly):**
- The HMAC algorithm is NOT confirmed in any official source (suspected
  SHA256). If practice tasks return 401, flip the env overrides above.
- `taskId` (a string like `gk_24_9d1`) is mapped to a field element via
  keccak256(task_id) mod p — an assumption, not a documented rule. The
  decision + reason_code are scored independently of the proof, so a mapping
  mismatch costs the proof bonus, not the decision.
- The seen-`proof_tx` set and the `task_id` response cache live in memory:
  a Railway restart wipes them (a repeated `proof_tx` after a restart would
  not be caught as reused). Accepted risk for now — no external store.
- Circuit files are the official ones from
  `agentgames.zkverify.io/circuits` (wasm 1,755,820 bytes, zkey 309,750
  bytes; sha256 in `scripts/download-circuits.js`). If the platform rotates
  the circuit, `npm install` re-downloads only when the files are missing;
  delete `circuits/` and redeploy to pick up a new version.
- Steal the VFY is NOT implemented: the turn envelope, strategy
  registration format, and public-inputs hash formula were not found in any
  public source, and the Swiss has run since 13 Nov with strategy commitment
  required before Round 1.

## zkVerify — why it is optional here, and what would make it stronger

xndr's claim is checkable today without zero-knowledge proofs: every verdict
carries the contract, the simulated calldata, the revert (or success), and the
block number, so anyone can re-run the same read and confirm it. That is the
honest baseline, and the agent does not pretend to produce proofs it does not.

What zkVerify would add: a proof that *this* verification ran against *that*
contract state at *that* block — so a third party could trust the verdict
without re-running the RPC reads or trusting this server. That is future work
for the free-mint verdicts, not claimed here. (The arena decisions are
different: Gatekeeper APPROVE/REJECT answers already carry a real Groth16
proof — see the Arena section.) Agents without zkVerify remain eligible for
Wildcard, and this submission is judged on the working agent, not on a proof
it does not have.

## Limits (stated plainly)

- BSC (chain 56) only.
- A simulation passing does not guarantee the on-chain mint succeeds — gas,
  timing, and per-wallet state can change between check and execution.
- `totalSupply` / price getters are best-effort; contracts without a verified
  ABI are checked by bytecode selector scan, which can miss unusually-named
  mint functions — in that case the verdict is `NO_MINT_FUNCTION_FOUND`,
  not a guess.
- The 币安人生2.0 spam token is not blocklisted by address: the contract
  address on record is corrupted (far longer than 40 hex chars, unverifiable).
  It stays covered by the general rule — never interact with unknown dust.

## Layout

- `server.js` — the whole agent (HTTP + verification logic + arena mode, no framework)
- `package.json` — `ethers@6.13.4` + `snarkjs@0.7.6` dependencies; `npm start` runs the server
- `circuits/` — official Gatekeeper circuit (`gatekeeper.wasm`, `gatekeeper_final.zkey`)
- `scripts/download-circuits.js` — postinstall fallback: downloads the circuits if missing
- `examples/` — real outputs (check-mint / check-wallet / arena valid + traps + test results)
- `railway.json` — Railway deploy config (health check `/health`)
- `render.yaml` — Render Free deploy config (health check `/health`)
- `README.md`, `LICENSE` (MIT)
