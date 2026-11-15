# xndr — Wildcard Submission Draft

> Draf ini disiapkan 2026-11-15. Teks berbahasa Inggris di bawah ini copy-ready
> untuk form submission Agent Games. Bagian "STATUS" berbahasa Indonesia
> untuk nano — jangan ikut disalin ke form.

## STATUS (untuk nano, jangan disalin)

- [x] Agent dibangun & diuji: `~/workspace/xndr-agent/` (server.js, Node, tanpa framework)
- [x] Demo publik (web artifact): sudah jadi, sudah ditampilkan di chat
- [ ] Demo artifact di-share publik — BUTUH permintaan eksplisit kamu (aturan share)
- [ ] Repo GitHub publik — BELUM: repo masih lokal, push butuh login GitHub kamu
- [ ] **Endpoint HTTPS publik — BELUM, INI BLOCKER UTAMA.** Server lokal jalan di port 8787, tapi tunnel trycloudflare GAGAL 2026-11-15 ~04:37 WIB. UPDATE 15 Nov ~08:24 WIB: hosting gratis dipilih = Render Free (750 jam/bulan, tanpa kartu kredit); file deploy `package.json` + `render.yaml` sudah dibuat dan teruji jalan dengan `$PORT` (`/health` ok). Tinggal: repo GitHub publik + connect Render oleh user (login user).
- [x] Akun Agent Games — SUDAH via X (15 Nov ~08:22 WIB). Handle yang diklaim + link reff user MASIH DITANYAKAN. Jangan daftar lagi — satu akun per peserta, multi-akun = diskualifikasi. WalletConnect wallet-agent tetap gagal, tidak dipakai lagi.
- [ ] Link referral kamu sendiri — baru ada setelah akun jadi
- [ ] Submit di https://agentgames.zkverify.io/dashboard/submissions?category=wildcard
  — JANGAN submit sebelum endpoint HTTPS live dicantumkan

## 1. AGENT LINK (isi saat submit)

- Public repository: (belum — push repo ke GitHub dulu)
- Public demo: (link share artifact `xndr` — minta share dulu)
- Public endpoint: (URL HTTPS endpoint — WAJIB live sebelum submit)

## 2. USE CASE (copy-ready, English)

**Problem:** Free-mint pages lie by omission. A site can show "FREE" while the
contract is already sold out, already claimed by your wallet, paused — or,
worst case, a drain: an approval or transfer hidden behind a mint button. A
dashboard screenshot is not proof. The only check that counts is a read of the
contract itself, seconds before signing, with a simulation of the exact call.

**Who it helps:** Anyone who mints free NFTs or tokens on BSC — especially
agent wallets that act on their owner's behalf, where one bad signature can
drain a wallet. xndr has been in daily use by its owner since 29 Oct 2026;
12 free mints were verified and executed through exactly this checking flow.

**What the agent does:** Given a contract address, xndr verifies on-chain
before anyone signs: contract code exists, blocklist check first, name /
symbol / supply / owner, mint functions (verified ABI, else bytecode selector
scan), and a value-0 simulation of the mint call with revert decoding. It
also checks wallet balances and NFT ownership, and what a spender can already
take (`isApprovedForAll` / `getApproved` / `allowance`). Verdicts are
explicit: `FREE_SIM_OK`, `FREE_GONE`, `PAID_ONLY`, `NOT_STARTED`,
`NO_CONTRACT`, `NO_MINT_FUNCTION_FOUND`, `BLOCKED_SCAM_SPAM`,
`UNVERIFIABLE_REVERT`, `UNVERIFIABLE`. A passing simulation is not a
guarantee and not permission to sign — the wallet preview must still be read
before signing.

## 3. BUILD CONTEXT (copy-ready, English)

**How it works:** A single Node.js file (`server.js`, no framework) exposing
`POST /check-mint`, `POST /check-wallet`, `POST /check-approval`, and
`GET /health`. It races a pool of public BSC RPCs, reads the verified ABI
from Sourcify when available and falls back to a bytecode PUSH4 selector
scan, simulates the best mint function with value 0, and decodes reverts via
the standard-error interface plus the verified ABI. 55 s per-request budget
(inside the 60 s Agent Games limit), 30 req/min per IP, CORS open.

**Key decisions:**
- Read-only by design. No private key, no signing, no broadcast, no state
  change — the server cannot spend anything even if compromised.
- Fail closed. Anything unverifiable is reported `UNVERIFIABLE` / 
  `UNVERIFIABLE_REVERT` and means DO NOT SIGN; never guessed safe.
- Free-only verdicts. A mint needing `value > 0` is reported `PAID_ONLY`
  and the flow stops; the agent never offers the paid path.
- Blocklist first. One owner-confirmed scam token (CLOS) and 17 spam dust
  tokens are checked before any RPC call; blocklisted holdings are flagged,
  never displayed as assets, never interacted with.
- On-chain wins. When a site counter disagrees with an RPC read, the RPC
  read wins. A "Copied" toast, a FAQ, or a truncated address is never
  evidence.

**What it can and cannot do:** BSC (chain 56) only. A passing simulation
does not guarantee the on-chain mint succeeds — gas, timing, and per-wallet
state can change between check and execution. Contracts without a verified
ABI are checked by bytecode selector scan, which can miss unusually-named
mint functions; then the verdict is `NO_MINT_FUNCTION_FOUND`, not a guess.

**Verified results (15 Nov 2026, BSC block ~133,614,xxx):** DYOR fresh wallet
→ `FREE_GONE` (revert "Sold out", totalSupply 11,111 = max); BAO Oracle fresh
wallet → `FREE_GONE` (custom error `FreeQuotaExceeded` decoded from verified
ABI); Covenant fresh wallet → `FREE_GONE` (revert "Sold out", mint found by
bytecode scan — Sourcify 404); CLOS → `BLOCKED_SCAM_SPAM` (no RPC needed);
`0x000…dead` → `NO_CONTRACT`; agent wallet check → BNB 0.000809…, MAOAI
1,000,000, DGNT 10, BNBbaby 10,000,000, 12/12 NFTs owned, Chip404Market
`isApprovedForAll=false`. No transaction was sent by any of these checks.

## 4. ZKVERIFY (optional, copy-ready, English)

xndr's claim is checkable today without zero-knowledge proofs: every verdict
carries the contract, the simulated calldata, the revert (or success), and
the block number, so anyone can re-run the same read and confirm it. That is
the honest baseline, and the agent does not pretend to produce proofs it does
not.

What zkVerify would add: a proof that *this* verification ran against *that*
contract state at *that* block — so a third party could trust the verdict
without re-running the RPC reads or trusting this server. That is future
work, not claimed here. Agents without zkVerify remain eligible for Wildcard,
and this submission is judged on the working agent, not on a proof it does
not have.

## Referral note (untuk nano)

Kode `GUVCSDZN` di link yang kamu kirim adalah kode PENGUNDANG, bukan kode
kamu. Link referral kamu sendiri baru muncul setelah kamu daftar + klaim
handle di dashboard/profile Agent Games.
