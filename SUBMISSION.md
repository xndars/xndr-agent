# xndr — Wildcard Submission Draft

> Draf ini disiapkan 2026-11-15. Teks berbahasa Inggris di bawah ini copy-ready
> untuk form submission Agent Games. Bagian "STATUS" berbahasa Indonesia
> untuk nano — jangan ikut disalin ke form.

## STATUS (untuk nano, jangan disalin)

- [x] Agent dibangun & diuji: `~/workspace/xndr-agent/` (server.js, Node, tanpa framework)
- [x] Demo publik (web artifact): sudah jadi, sudah ditampilkan di chat
- [ ] Demo artifact di-share publik — BUTUH permintaan eksplisit kamu (aturan share)
- [x] Repo GitHub publik — https://github.com/xndars/xndr-agent (publik, branch main, user xndars; terverifikasi 15 Nov ~08:44 WIB)
- [x] **Endpoint HTTPS publik — LIVE di Railway sejak 15 Nov ~09:03 WIB: https://xndr-agent-production.up.railway.app** — terverifikasi: `/health` ok (blok 133652326), `/check-mint` DYOR → `FREE_GONE` "Sold out", `/check-wallet` BNB 0.000809… + 12/12 NFT. Render DIBATALKAN (minta kartu saat deploy, user tidak mau isi kartu); Railway trial $5/30 hari tanpa kartu. Railway tidak tidur seperti Render Free, jadi TIDAK perlu ping keep-alive.
- [x] Akun Agent Games — SUDAH via X (15 Nov ~08:22 WIB). Akun tampil sebagai "Kaiden" (nama dari X). Handle xndr BELUM diklaim di mana pun (registrasi agent butuh pilih track arena wajib — dilewati; form submission tidak minta handle). Link reff user MASIH BELUM DIKETAHUI. Wallet agent 0x0Db7… BELUM dimasukkan ke profil (tidak ada menu Profile di dashboard) — perlu dicari jalurnya sebelum klaim hadiah.
- [ ] Link referral kamu sendiri — baru ada setelah akun jadi
- [x] Submit di https://agentgames.zkverify.io/dashboard/submissions?category=wildcard — BERHASIL 15 Nov ~09:28 WIB (Wildcard, title ASCII "xndr - Verifiable Web3 Safety Agent (read-only)", repo + endpoint Railway live, What It Does ASCII 1738 karakter, Additional Links 3 baris, Message to Judges DIKOSONGKAN, Proof Reference kosong). Pelajaran: form Agent Games MENOLAK karakter em-dash "—" (non-ASCII) — Message to Judges gagal submit karena "—" di "public — please test"; versi ASCII lolos. Endpoint sengaja dikosongkan saat submit pertama? TIDAK — endpoint tetap terisi di percobaan pertama; yang bikin gagal adalah Message to Judges, bukan endpoint.
- [x] ARENA — Proof Gatekeeper DITAMBAHKAN 15 Nov ~09:36 WIB (server v0.2.0): POST /agent + POST / (root), HMAC-SHA256 header x-agent-games-signature, secret dari env AGENT_GAMES_SECRET, keputusan deterministik 7 trap + reason_code, proof Groth16 snarkjs 0.7.6 dari circuit resmi (circuits/ diunduh otomatis saat deploy via scripts/download-circuits.js, sha256 cocok dengan file resmi), idempotency per task_id + seen-set proof_tx (in-memory). KOREKSI CATATAN TES: file examples/arena-test-results.json lama (02:37 WIB) mencatat 9/19 karena dijalankan melawan server lama yang masih jalan di port 8899 — BUKAN kode v0.2.0. Tes ulang terhadap kode v0.2.0 yang sekarang (15 Nov 09:41–09:47 WIB, server lokal fresh): valid APPROVE + proof Groth16 TERVERIFIKASI kriptografis via snarkjs (exportVerificationKey + groth16.verify = true), proof_tx echo benar, 5 trap REJECT + reason_code benar + proof, PROOF_REUSED REJECT tanpa proof, replay task_id sama = respons cached identik, POST / root terima arena task, HMAC salah/tanpa signature = 401, respons ~0,3–1,1 detik (limit 60 detik). BELUM DIREGISTRASI: pendaftaran agent butuh login user (centang Proof Gatekeeper) + secret HMAC 32-byte dari dashboard (tampil SATU KALI) yang harus diisi ke Railway Variables AGENT_GAMES_SECRET. Ronde Gatekeeper 13-20 Nov, 8 ronde/hari 17:30-03:30 WIB; Round 3 mulai 15 Nov 17:30 WIB — daftar + practice SEBELUM itu. Steal the VFY TIDAK DIBANGUN (spesifikasi envelope/strategi tidak ditemukan di sumber publik).
- [x] ARENA UPDATE 15 Nov 10:14–10:41 WIB (server v0.2.4): agent xndr TERDAFTAR (Gatekeeper saja) 09:59 WIB, secret HMAC diisi ke Railway, PREFLIGHT LOLOS + HEALTHY 10:14 WIB (fix: preflight jawab persis {"ok":true,"protocolVersion":"v1"} bertanda tangan). PRACTICE GATEKEEPER LOLOS 10:20 WIB (THRESHOLD_MISMATCH, REJECT benar, proof terverifikasi 1767 ms). STEAL THE VFY: format envelope terungkap lewat diagnostic practice — respons wajib matchId, turn, action, policyProof{circuitVersion, publicInputsHash}, agentTimestamp, idempotencyKey (UUID v5 deterministik); circuit vfy-policy.wasm+zkey resmi sudah diunduh (sha256 terverifikasi) + auto-download saat deploy. PRACTICE KE-4 KATEGORI HIJAU SEMUA 10:41 WIB per user (Gatekeeper + Steal Fortify/Extract/Hold, verified). CATATAN JUJUR: hijau practice = skema + signature + timing lolos; proof Groth16 Steal yang asli (terikat match/turn, konsisten dengan strategi ter-commit, terkonfirmasi on-chain) BELUM dibangun — publicInputsHash saat ini placeholder keccak(match/turn/action), strategi belum di-commit, agent terdaftar Gatekeeper SAJA (Steal belum dicentang). Sisa: (1) cek apakah agent bisa diedit/didaftarkan ke track Steal + apakah Swiss masih menerima peserta baru, (2) cari cara commit strategi, (3) butuh JSON INITIALIZED REQUEST dari hasil practice Steal untuk rumus public-inputs + state turn.

## 1. AGENT LINK (isi saat submit)

- Public repository: https://github.com/xndars/xndr-agent
- Public demo: (link share artifact `xndr` — minta share dulu)
- Public endpoint: https://xndr-agent-production.up.railway.app

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

## Update v0.2.5 (2026-11-15 ~12:30 WIB)

- Tambah `GET /arena/results`: log jawaban Gatekeeper (task_id, decision, reason_code, proof, ms, + 5 checks audit vk/threshold/expiry/recipient/amount) — tanpa login, tanpa secret — supaya pemilik bisa cek sendiri tiap jawaban benar/salah setelah ronde, dan poin bisa dicocokkan dengan leaderboard publik.
- Tes lokal 5/5 lolos: valid APPROVE + proof (996 ms), trap THRESHOLD_MISMATCH REJECT + proof (364 ms), preflight exact body, /arena/results 2 entri + checks benar, /health arena ready, versi 0.2.5.
- Perubahan aditif saja (buffer + 1 route GET + 1 panggilan record ber-try/catch); logika decision/proof tidak berubah. v0.2.4 tetap jalan normal kalau update ini belum di-upload sebelum ronde.
