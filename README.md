# xndr — verifiable Web3 safety agent (read-only)

**Agent Games (zkVerify) — Wildcard track submission.**

xndr checks a contract on-chain *before* anyone signs. If the check cannot be
verified, it fails closed and says so — it never calls something safe on hope.

- **Agent:** xndr.ai — SPACE ID Agent ID `xndr`, wallet
  `0x0Db7898eecAB03b4fb10C7a985dCD47A3432d8D7` (BSC, chain 56)
- **Live since:** 29 Oct 2026, in daily use by its owner. 12 free mints verified
  and executed through this exact checking flow (DYOR, Covenant, BAO Oracle,
  Mars, Zeroling, and others — see Verified results below).
- **Prize track:** Wildcard, 100,000 VFY (50,000 / 30,000 / 20,000).

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
| `GET /health` | Liveness + latest BSC block |

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

Dependencies: Node 18+; run `npm install` once (fetches ethers@6.13.4). No API keys. Public BSC RPC pool with
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

## zkVerify — why it is optional here, and what would make it stronger

xndr's claim is checkable today without zero-knowledge proofs: every verdict
carries the contract, the simulated calldata, the revert (or success), and the
block number, so anyone can re-run the same read and confirm it. That is the
honest baseline, and the agent does not pretend to produce proofs it does not.

What zkVerify would add: a proof that *this* verification ran against *that*
contract state at *that* block — so a third party could trust the verdict
without re-running the RPC reads or trusting this server. That is future work,
not claimed here. Agents without zkVerify remain eligible for Wildcard, and
this submission is judged on the working agent, not on a proof it does not have.

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

- `server.js` — the whole agent (HTTP + verification logic, no framework)
- `package.json` — `ethers@6.13.4` dependency; `npm start` runs the server
- `render.yaml` — Render Free deploy config (health check `/health`)
- `README.md`, `LICENSE` (MIT)
