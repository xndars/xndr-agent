'use strict';
/**
 * xndr — verifiable Web3 safety agent (read-only)
 *
 * What it does: before anyone signs a mint / approval / transfer, xndr checks
 * the contract on-chain and says plainly what it found — or refuses to call
 * it safe when the check cannot be verified. It never signs, never broadcasts,
 * never holds a private key, and never spends anything.
 *
 * Endpoints (all JSON, BSC chain 56 only):
 *   GET  /            agent card
 *   GET  /health      liveness + latest block (+ arena readiness)
 *   POST /check-mint  { contract, wallet?, quantity? }  — free-mint verification
 *   POST /check-wallet { wallet, tokens?, nfts? }        — balances + ownership
 *   POST /check-approval { wallet, contract, tokenId?, operator }
 *   POST /agent       Proof Gatekeeper arena task (HMAC-signed envelope, see ARENA section)
 *   POST /            same as POST /agent (root also accepts arena tasks)
 *
 * Run:  node server.js            (port 8787, or $PORT)
 * Dependencies: run `npm install` once (fetches ethers@6.13.4 + snarkjs@0.7.6).
 * ethers@6.13.4 via npm. Arena proofs: snarkjs 0.7.6 + official circuit files in circuits/.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
let snarkjs = null;
try { snarkjs = require('snarkjs'); } catch { snarkjs = null; /* arena proofs unavailable; read-only endpoints keep working */ }

const PORT = Number(process.env.PORT || 8787);
const CHAIN_ID = 56;
const AGENT_WALLET = '0x0Db7898eecAB03b4fb10C7a985dCD47A3432d8D7';
const AGENT_HANDLE = 'xndr';
const AGENT_REGISTRY = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
const VERSION = '0.2.0';

const RPCS = (process.env.XNDR_RPCS || [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://1rpc.io/bnb',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

function wib(d = new Date()) {
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }) + ' WIB';
}
function log(...a) { console.log(`[${wib()}]`, ...a); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- blocklist: known scam / spam — never interact, only flag ----------
const BLOCKLIST = {
  // user-confirmed scam token (2026-11-02): never report as an asset, never interact
  '0xdfeaee944ecaf90190809ed589275a1777911acf': { name: 'CLOS (Closer)', reason: 'SCAM per owner — never interact' },
  // 17 spam dust tokens, user rule 2026-11-07: skip totally, never display/interact/report
  '0xfcf83d966c7c70aaaa331c3cc0a62dc76af76693': { name: '3 比特币能飞', reason: 'spam dust' },
  '0x46a3c907969ac9ff68f3897dfc92b81c068ac695': { name: '6 币安人能飞', reason: 'spam dust' },
  '0x8b52f5d80c3ad362b9988a4e7a286f49097fcab4': { name: '7 币安世界', reason: 'spam dust' },
  '0xf2842f9b359560e81cba8b49aa96beacda8be811': { name: '2 币安支付', reason: 'spam dust' },
  '0xb1336ed83d5c9a242a11926edb76c9ad58593832': { name: '5 AppleSI', reason: 'spam dust' },
  '0x0627167b7caf51ae94bd7f56a549e44abf94b792': { name: '🦅老虎', reason: 'spam dust' },
  '0x81f70edd17177ccdaff6e2a1fb9b0cc9e6a53': { name: '币安新人生', reason: 'spam dust' },
  '0xc8c7778a9b4301f3d19b1579abfc08a6d25f8888': { name: 'RKT', reason: 'spam dust' },
  '0x9231ad8ca77af72617953451ef02578a02666666': { name: 'RKT', reason: 'spam dust' },
  '0x4e351bb2f0a67aa383c9e73333749788ad9f3b': { name: '币安无忧', reason: 'spam dust' },
  '0xa00a038ad1d21c3edc5613f34c1a8807203e9d0e': { name: '诺亚方舟', reason: 'spam dust' },
  '0xdbd4bbc0ef2c6771d3e1815b9d77388f5f02d2b7': { name: 'FAGENT', reason: 'spam dust' },
  '0xd8673d164a8993f9a28031012511388a29653a84': { name: '币安人', reason: 'spam dust' },
  '0xce5abdf8ac358087b3f9b2da4f58397cebf01': { name: '币安能飞', reason: 'spam dust' },
  '0xa140e68fc7154feb5c86be07ccaa8f2711ada5c3': { name: '亮剑人生', reason: 'spam dust' },
  '0x74819a5e70db4504f10bcdcb2ffe5942182e7777': { name: 'RKT', reason: 'spam dust' },
  // NOTE: 币安人生2.0 spam token is NOT blocklisted by address — the contract address on record is corrupted (far longer than 40 hex chars, unverifiable). It stays covered by the general rule: never interact with unknown dust.
};

const KNOWN_TOKENS = [
  { symbol: 'MAOAI', address: '0xBB357ecA84A438Caaa3a8783d78eDAA57B5d665d', decimals: 18 },
  { symbol: 'DGNT', address: '0xB1a7974a5f5fcDFD1Eeec7D9E8E1a7B6Cee7B64c', decimals: 18 },
  { symbol: 'BNBbaby', address: '0xD0079025a9Bb66a7a1de991De2E4326FABA35729', decimals: 18 },
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
];

// Owned NFTs of the agent wallet (ownerOf verified on-chain 2026-11-09).
const KNOWN_NFTS = [
  { name: 'Ptah Proof of Agent #40669', contract: '0xD87ADb2E47979d6cb323896B1A9320E0dd132213', tokenId: '40669', tier: 'tanpa tier', note: 'soulbound' },
  { name: 'drop.ai #11899', contract: '0x51baA9d0e4F3318Bc2f62bB8eFC3cd65F1548654', tokenId: '11899', tier: 'tanpa tier' },
  { name: 'SPACE ID Agent ID "xndr"', contract: '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F', tokenId: '5255512418916110230807213132159213175278434331814961199458548407655084639979', tier: 'tanpa tier' },
  { name: 'Zeroling #1904', contract: '0x8a71C85CAf9bABd475E59d53371683f37B78b9dD', tokenId: '1904', tier: 'Tier 2 Rare' },
  { name: 'Agent Shift #3499', contract: '0x4c5F33653F447229E85e52A238Da826f1B3299fa', tokenId: '3499', tier: 'tanpa tier' },
  { name: 'SIGILS #3375', contract: '0x984e8B55B62599203F809F7b33691e9df4757844', tokenId: '3375', tier: 'tanpa tier' },
  { name: 'Cogladius #2680', contract: '0x2bbad2A3421a0BBd62A319a9Db70122047839483', tokenId: '2680', tier: 'Tier Silver' },
  { name: 'Mars Identity #5951', contract: '0xC4059D2F9F6F86695896e68F3E73E1e6cC3791c8', tokenId: '5951', tier: 'Tier MINER' },
  { name: 'Chip404 #633', contract: '0xAB6b18C626daaDd1ff7Cc45F402141153a5a9759', tokenId: '633', tier: 'Tier Violet' },
  { name: 'Agent Covenant #2732', contract: '0xc68aC7a1e076918DFFf9279698dc2976268691Df', tokenId: '2732', tier: 'tanpa tier' },
  { name: 'BAO Oracle #4051', contract: '0xcBe2DBBFF4264Dc67Bf557c64e29997B82439354', tokenId: '4051', tier: 'Tier Silver' },
  { name: 'DYOR #7573', contract: '0x86956Bc830EB62110820Ae79164BeF61c7E31936', tokenId: '7573', tier: 'tanpa tier' },
];

// ---------- RPC pool: race, first success wins; first *revert* also wins ----------
let rpcId = 1;
async function rpcOne(url, method, params, timeoutMs = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }), signal: ctl.signal,
    });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message || 'rpc error'); e.rpcError = j.error; e.url = url; throw e; }
    return j.result;
  } finally { clearTimeout(t); }
}
function isRevert(e) {
  const er = e && e.rpcError;
  if (!er) return false;
  if (er.data !== undefined && er.data !== null) return true;
  return /revert|execution|invalid opcode|out of gas|insufficient funds/i.test(er.message || '');
}
function rpcRace(method, params, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let left = RPCS.length, lastErr;
    for (const u of RPCS) {
      rpcOne(u, method, params, timeoutMs).then(
        res => resolve({ ok: true, result: res, url: u }),
        err => {
          if (isRevert(err)) return resolve({ ok: false, error: err, url: u });
          lastErr = err; if (--left === 0) reject(lastErr);
        });
    }
  });
}
async function rpc(method, params, opts) {
  const r = await rpcRace(method, params, opts);
  if (!r.ok) throw r.error;
  return r.result;
}

// ---------- revert decoding ----------
const STD_ERRORS = [
  'error Error(string)', 'error Panic(uint256)',
  ...['NotStarted', 'NotOpen', 'NotOpened', 'NotLive', 'NotActive', 'SaleNotStarted', 'MintNotStarted', 'MintNotOpen', 'TooEarly', 'SaleNotActive', 'Paused', 'EnforcedPause',
    'SoldOut', 'FreeSoldOut', 'FreeGone', 'PaidSoldOut', 'MaxSupply', 'ExceedsMaxSupply', 'MaxSupplyReached', 'QuotaExceeded', 'LimitExceeded', 'ExceedsLimit', 'MaxPerWallet', 'MaxPerWalletExceeded',
    'AlreadyClaimed', 'AlreadyMinted', 'AlreadyTaken', 'FreeUsed', 'FreeAlreadyClaimed', 'AlreadyBooked', 'AllowanceUsed',
    'AgentIdRequired', 'NoAgentId', 'NotAgent', 'NotEligible', 'NotWhitelisted', 'NotAllowed', 'Unauthorized', 'InvalidProof', 'BadSignature',
    'SaleExpired', 'Ended', 'SaleEnded', 'MintEnded', 'Closed', 'Expired', 'DeadlinePassed',
    'WrongValue', 'WrongPrice', 'InsufficientPayment', 'BadValue', 'InvalidValue', 'BadQty', 'ZeroQty', 'BadStart', 'StartMismatch', 'Slippage', 'BadInviter', 'SelfInvite', 'NoShares', 'NothingToCollect']
    .map(n => `error ${n}()`),
];
const stdIface = new ethers.Interface(STD_ERRORS);
const WAIT_RE = /not.?start|not.?open(ed)?$|^notopen$|not.?live|not.?active|too.?early|before.?start|^paused$|enforcedpause|mint.?closed|sale.?closed|not.?yet|wait/i;
const FATAL_RE = /sold.?out|gone|max.?supply|exceed|limit|already|used|taken|booked|agent.?id|no.?agent|not.?agent|eligible|whitelist|not.?allowed|unauthori|proof|signature|expired|ended|deadline|wrong|insufficient|bad|invalid|zero|slippage|mismatch|self|no.?shares|nothing|panic|quota|cap|payment/i;
function classifyRevert(name) {
  const n = String(name || '');
  if (WAIT_RE.test(n)) return 'wait';
  if (FATAL_RE.test(n)) return 'fatal';
  return 'unknown';
}
async function decodeRevert(err, extraIface) {
  const er = (err && err.rpcError) || {};
  let raw = typeof er.data === 'string' ? er.data : (er.data && typeof er.data.data === 'string' ? er.data.data : '');
  if (!raw) { const m = String(er.message || err.message || '').match(/0x[0-9a-fA-F]{8,}/); if (m) raw = m[0]; }
  const msg = String(er.message || err.message || '');
  if (!raw || raw === '0x') {
    const m = msg.match(/reverted:?\s*(.*)$/i);
    return { name: m && m[1] ? m[1].trim() : 'Unknown', sel: null, raw: raw || '', msg };
  }
  const sel = raw.slice(0, 10).toLowerCase();
  for (const ifc of [extraIface, stdIface]) {
    if (!ifc) continue;
    try {
      const d = ifc.parseError(raw);
      if (d) {
        if (d.name === 'Error') return { name: String(d.args[0]), sel, raw, msg, isString: true };
        return { name: d.name, sel, raw, args: d.args.map(String), msg };
      }
    } catch {}
  }
  return { name: 'Unknown', sel, raw, msg };
}

// ---------- Sourcify ABI (verified source only; cache in memory) ----------
const abiCache = new Map();
async function sourcifyAbi(addr) {
  const key = addr.toLowerCase();
  if (abiCache.has(key)) return abiCache.get(key);
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://sourcify.dev/server/v2/contract/${CHAIN_ID}/${addr}?fields=abi`, { signal: ctl.signal });
    if (!r.ok) { abiCache.set(key, null); return null; }
    const j = await r.json();
    const out = j.abi ? { abi: j.abi, match: j.match || j.runtimeMatch || 'verified' } : null;
    abiCache.set(key, out); return out;
  } catch { abiCache.set(key, null); return null; }
}

// ---------- standard ERC20 / ERC721 read interface ----------
const READ_IFACE = new ethers.Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function isApprovedForAll(address,address) view returns (bool)',
  'function getApproved(uint256) view returns (address)',
  'function allowance(address,address) view returns (uint256)',
]);
const MINT_FALLBACK = new ethers.Interface([
  'function mint(uint256)',
  'function claim()',
  'function claimFreeShare()',
  'function mintFree()',
  'function freeMint()',
  'function claimFree()',
]);
const MINT_RE = /mint|claim|free|buy|purchase|acquire|reserve|book/i;
const SKIP_WRITE = /^(approve|transfer|transferFrom|setApprovalForAll|safeTransferFrom|renounce|transferOwnership|acceptOwnership|set[A-Z]|withdraw|rescue|pause|unpause|upgrade|init|admin|owner)/;

async function tryCall(to, iface, fn, args, from) {
  try {
    const data = iface.encodeFunctionData(fn, args);
    const res = await rpc('eth_call', [{ from: from || AGENT_WALLET, to, data }, 'latest'], { timeoutMs: 5000 });
    return { ok: true, value: iface.decodeFunctionResult(fn, res) };
  } catch (e) { return { ok: false, error: e }; }
}
function fmtVal(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(fmtVal);
  return v;
}
function isAddr(s) { try { return ethers.isAddress(s); } catch { return false; } }

async function checkMint(contractRaw, walletRaw, quantity) {
  const started = Date.now();
  const contract = ethers.getAddress(contractRaw);
  const wallet = walletRaw && isAddr(walletRaw) ? ethers.getAddress(walletRaw) : AGENT_WALLET;
  const qty = Number.isInteger(quantity) && quantity > 0 && quantity <= 10 ? quantity : 1;
  const checks = [];
  const out = {
    agent: 'xndr', chainId: CHAIN_ID, contract, wallet, quantity: qty,
    checkedAt: wib(), verdict: 'UNVERIFIABLE', reasons: [], checks,
    disclaimer: 'Read-only verification. A passing simulation is NOT a guarantee and NOT permission to sign — always read the wallet preview before signing. This agent never signs or broadcasts.',
  };
  const fail = (verdict, reason) => { out.verdict = verdict; out.reasons.push(reason); out.elapsedMs = Date.now() - started; return out; };

  // 1. blocklist first — fail closed, no RPC needed
  const blocked = BLOCKLIST[contract.toLowerCase()];
  if (blocked) {
    checks.push({ step: 'blocklist', result: 'BLOCKED', detail: `${blocked.name}: ${blocked.reason}` });
    return fail('BLOCKED_SCAM_SPAM', `${blocked.name} is blocklisted (${blocked.reason}). Do not interact.`);
  }
  checks.push({ step: 'blocklist', result: 'clear' });

  // 2. code must exist
  let code;
  try { code = await rpc('eth_getCode', [contract, 'latest']); }
  catch (e) { return fail('UNVERIFIABLE', 'RPC unavailable for eth_getCode: ' + (e.message || e).toString().slice(0, 120)); }
  if (!code || code === '0x') {
    checks.push({ step: 'code', result: 'NO_CODE', detail: 'address has no bytecode (EOA or undeployed)' });
    return fail('NO_CONTRACT', 'No contract code at this address.');
  }
  checks.push({ step: 'code', result: 'ok', detail: `${(code.length - 2) / 2} bytes` });

  // 3. identity reads (best effort, each independent)
  const identity = {};
  for (const fn of ['name', 'symbol', 'totalSupply', 'owner']) {
    const r = await tryCall(contract, READ_IFACE, fn, fn === 'totalSupply' || fn === 'owner' ? [] : [], wallet);
    if (r.ok) identity[fn] = fmtVal(r.value[0]);
  }
  if (identity.name) identity.name = String(identity.name).slice(0, 120);
  if (identity.symbol) identity.symbol = String(identity.symbol).slice(0, 30);
  out.identity = identity;
  checks.push({ step: 'identity', result: Object.keys(identity).length ? 'ok' : 'unreadable', detail: identity });

  // 4. mint functions: verified ABI first, else bytecode selector scan
  const verified = await sourcifyAbi(contract);
  out.sourcify = verified ? verified.match : 'not-verified';
  let iface = null; let mintFns = [];
  if (verified) {
    try {
      iface = new ethers.Interface(verified.abi);
      mintFns = iface.fragments.filter(f => f.type === 'function' && !['view', 'pure'].includes(f.stateMutability)
        && MINT_RE.test(f.name) && !SKIP_WRITE.test(f.name));
    } catch { iface = null; }
  }
  if (!mintFns.length) {
    const codeLow = code.toLowerCase();
    const found = MINT_FALLBACK.fragments.filter(f => codeLow.includes('63' + f.selector.slice(2)));
    if (found.length) { iface = new ethers.Interface(found); mintFns = found; out.abiFrom = 'bytecode-selector-scan'; }
  }
  if (!mintFns.length) {
    checks.push({ step: 'mint-functions', result: 'NONE_FOUND', detail: 'no mint/claim function found in verified ABI or bytecode' });
    return fail('NO_MINT_FUNCTION_FOUND', 'No mint/claim function found. Cannot verify a free mint for this contract.');
  }
  checks.push({ step: 'mint-functions', result: 'ok', detail: mintFns.map(f => f.format('sighash')) });
  out.mintFunctions = mintFns.map(f => ({ sig: f.format('sighash'), selector: f.selector, payable: f.payable, params: f.inputs.map(i => `${i.type} ${i.name}`).join(', ') }));

  // 5. price / supply getters from verified ABI (best effort)
  if (iface) {
    const getters = {};
    const views = iface.fragments.filter(f => f.type === 'function' && ['view', 'pure'].includes(f.stateMutability) && f.inputs.length === 0);
    const picked = views.filter(f => /price|cost|fee|nextprice|totalminted|freeminted|minted|supply|left|remaining|max|quota|limit|free|paused|status|active|live|can|eligible/i.test(f.name)).slice(0, 20);
    for (const f of picked) {
      const r = await tryCall(contract, iface, f.name, [], wallet);
      if (r.ok) getters[f.name] = fmtVal(r.value.length === 1 ? r.value[0] : [...r.value].map(fmtVal));
    }
    if (Object.keys(getters).length) out.getters = getters;
  }

  // 6. simulate mint(1) with value 0 — the decisive check
  const mintFn = mintFns.find(f => /free/i.test(f.name)) || mintFns.find(f => f.name === 'mint') || mintFns[0];
  const args = mintFn.inputs.map(i => {
    if (i.type === 'address') return /invit|ref|sponsor/.test(i.name) ? ethers.ZeroAddress : wallet;
    if (/^uint|^int/.test(i.type)) {
      if (/deadline|expir/.test(i.name)) return BigInt(Math.floor(Date.now() / 1000) + 1800);
      if (/^min/.test(i.name)) return 0n;
      if (/^max/.test(i.name)) return ethers.MaxUint256;
      return BigInt(qty);
    }
    if (i.type === 'bool') return false;
    if (i.type === 'string') return '';
    if (/^bytes/.test(i.type)) return '0x';
    return null;
  });
  let data;
  try { data = iface.encodeFunctionData(mintFn, args); }
  catch (e) { return fail('UNVERIFIABLE', 'Could not encode mint calldata: ' + e.message.slice(0, 120)); }
  out.simulatedCall = { sig: mintFn.format('sighash'), value: '0', args: args.map(String) };
  const sim = await rpcRace('eth_call', [{ from: wallet, to: contract, data, value: '0x0' }, 'latest'], { timeoutMs: 8000 });
  if (sim.ok) {
    checks.push({ step: 'simulate-mint-value-0', result: 'OK', detail: mintFn.format('sighash') });
    out.verdict = 'FREE_SIM_OK';
    out.reasons.push(`Simulation of ${mintFn.format('sighash')} with value 0 succeeded. This does NOT guarantee the on-chain mint will succeed — gas, timing and wallet preview still apply.`);
    out.elapsedMs = Date.now() - started;
    return out;
  }
  const dec = await decodeRevert(sim.error, iface);
  checks.push({ step: 'simulate-mint-value-0', result: 'REVERT', detail: `${dec.name}${dec.sel ? ' ' + dec.sel : ''}` });
  out.revert = { name: dec.name, selector: dec.sel || null, class: classifyRevert(dec.name) };
  const n = dec.name || '';
  if (/soldout|freegone|freesoldout|paidsoldout|maxsupply|alreadyclaimed|alreadyminted|freeused|freealreadyclaimed|quotaexceeded|limitexceeded|maxperwallet/i.test(n.replace(/\s/g, ''))) {
    return fail('FREE_GONE', `Free mint is gone: revert ${dec.name}. No transaction was sent.`);
  }
  if (/notstarted|notopen|notlive|notactive|tooearly|paused|saleexpired|ended|closed/i.test(n.replace(/\s/g, ''))) {
    return fail('NOT_STARTED', `Mint is not open yet / paused: revert ${dec.name}.`);
  }
  if (/wrongvalue|wrongprice|insufficientpayment|badvalue|invalidvalue/i.test(n.replace(/\s/g, ''))) {
    return fail('PAID_ONLY', `This mint needs payment (value > 0): revert ${dec.name}. Free-only rule: do not proceed.`);
  }
  return fail('UNVERIFIABLE_REVERT', `Simulation reverted with ${dec.name} (${out.revert.class}). Fail closed: do not sign.`);
}

async function checkWallet(walletRaw, tokenAddrs, nftList) {
  const started = Date.now();
  const wallet = ethers.getAddress(walletRaw);
  const out = { agent: 'xndr', chainId: CHAIN_ID, wallet, checkedAt: wib(), balances: {}, nfts: [], notes: [] };
  const [bnb, block] = await Promise.all([
    rpc('eth_getBalance', [wallet, 'latest']).catch(() => null),
    rpc('eth_blockNumber', []).catch(() => null),
  ]);
  out.blockNumber = block ? parseInt(block, 16) : null;
  out.balances.BNB = bnb ? ethers.formatEther(bnb) : null;
  const tokens = KNOWN_TOKENS.slice();
  for (const a of (tokenAddrs || []).slice(0, 20)) {
    if (isAddr(a) && !tokens.some(t => t.address.toLowerCase() === a.toLowerCase())) {
      tokens.push({ symbol: ethers.getAddress(a).slice(0, 8) + '…', address: ethers.getAddress(a), decimals: 18 });
    }
  }
  for (const t of tokens) {
    const r = await tryCall(t.address, READ_IFACE, 'balanceOf', [wallet]);
    if (r.ok) {
      const raw = BigInt(r.value[0]);
      out.balances[t.symbol] = { raw: raw.toString(), formatted: ethers.formatUnits(raw, t.decimals), contract: t.address };
    }
  }
  // blocklisted holdings are flagged, never presented as assets
  for (const [addr, info] of Object.entries(BLOCKLIST)) {
    const r = await tryCall(addr, READ_IFACE, 'balanceOf', [wallet]).catch(() => ({ ok: false }));
    if (r.ok && BigInt(r.value[0]) > 0n) {
      const dec = await tryCall(addr, READ_IFACE, 'decimals', []);
      const formatted = dec.ok ? ethers.formatUnits(BigInt(r.value[0]), Number(dec.value[0])) : r.value[0].toString();
      out.notes.push(`Blocklisted holding detected (not an asset): ${info.name} ${formatted} — ${info.reason}`);
    }
  }
  const nfts = nftList && nftList.length ? nftList.slice(0, 30) : (wallet.toLowerCase() === AGENT_WALLET.toLowerCase() ? KNOWN_NFTS : []);
  for (const n of nfts) {
    try {
      const c = ethers.getAddress(n.contract); const tid = BigInt(n.tokenId);
      const r = await tryCall(c, READ_IFACE, 'ownerOf', [tid]);
      const owned = r.ok && String(r.value[0]).toLowerCase() === wallet.toLowerCase();
      out.nfts.push({ name: n.name || `${c} #${n.tokenId}`, contract: c, tokenId: String(tid), tier: n.tier || null, owned: r.ok ? owned : null });
    } catch { out.nfts.push({ name: n.name || n.contract, contract: n.contract, tokenId: String(n.tokenId), owned: null }); }
  }
  out.elapsedMs = Date.now() - started;
  return out;
}

async function checkApproval(walletRaw, contractRaw, tokenId, operatorRaw) {
  const wallet = ethers.getAddress(walletRaw);
  const contract = ethers.getAddress(contractRaw);
  const out = { agent: 'xndr', chainId: CHAIN_ID, wallet, contract, checkedAt: wib(), approvals: {} };
  if (operatorRaw && isAddr(operatorRaw)) {
    const op = ethers.getAddress(operatorRaw);
    const r = await tryCall(contract, READ_IFACE, 'isApprovedForAll', [wallet, op]);
    out.approvals.isApprovedForAll = { operator: op, value: r.ok ? Boolean(r.value[0]) : null };
  }
  if (tokenId !== undefined && tokenId !== null) {
    const r = await tryCall(contract, READ_IFACE, 'getApproved', [BigInt(tokenId)]);
    out.approvals.getApproved = { tokenId: String(tokenId), approved: r.ok ? String(r.value[0]) : null };
  }
  return out;
}

// ---------- ARENA — Proof Gatekeeper (Agent Games) ----------
// Accepts signed task envelopes at POST /agent and POST / (root). This mode
// never touches the wallet: it only decides APPROVE/REJECT on a payment-gate
// task and proves the decision with the tournament's own Groth16 circuit.
// Fail closed everywhere: bad signature, malformed task, missing circuits,
// or an unprovable approval all end in REJECT (or 4xx), never in a guess.
//
// Sources: agentgames.zkverify.io (event page, /api/circuit-info) + the
// builder field guide + participant write-ups (Medium, Nov 2026).
// CONFIRMED: envelope shape, 7 traps + reason codes, response shape,
// header x-agent-games-signature, secret shown ONCE at agent registration,
// circuit files + vkHash 0x6b79c6…d77b0, snarkjs 0.7.6, proof ~3s.
// NOT CONFIRMED officially: the HMAC algorithm (suspected SHA256) and the
// exact taskId->field mapping. Defaults below are the safest guesses and
// every one of them is overridable by env (see README Arena section).
// If practice-mode tasks come back 401, flip AGENT_GAMES_SECRET_ENCODING
// (utf8/hex/base64) or AGENT_GAMES_HMAC_ALGO first.
const FIELD_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // BN254 scalar field
const CIRCUIT_DIR = path.join(__dirname, 'circuits');
const GATEKEEPER_WASM = path.join(CIRCUIT_DIR, 'gatekeeper.wasm');
const GATEKEEPER_ZKEY = path.join(CIRCUIT_DIR, 'gatekeeper_final.zkey');
// Registered verification-key hash, from https://agentgames.zkverify.io/api/circuit-info
// (informational: the decision compares proof_vk against the task's registered_vk).
const REGISTERED_VK_HASH = '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';
const ARENA_HMAC_HEADER = 'x-agent-games-signature';

function arenaHmacConfig() {
  return {
    algo: (process.env.AGENT_GAMES_HMAC_ALGO || 'sha256').toLowerCase(),
    encoding: (process.env.AGENT_GAMES_HMAC_ENCODING || 'hex').toLowerCase(),
    secretEncoding: (process.env.AGENT_GAMES_SECRET_ENCODING || 'utf8').toLowerCase(),
  };
}
function arenaSecret() { const s = (process.env.AGENT_GAMES_SECRET || '').trim(); return s || null; }
function arenaCircuitsReady() {
  return Boolean(snarkjs) && fs.existsSync(GATEKEEPER_WASM) && fs.existsSync(GATEKEEPER_ZKEY);
}
function hmacKeyBytes(secret, secretEncoding) {
  if (secretEncoding === 'hex') return Buffer.from(secret, 'hex');
  if (secretEncoding === 'base64') return Buffer.from(secret, 'base64');
  return Buffer.from(secret, 'utf8');
}
function hmacSign(secret, rawBody) {
  const cfg = arenaHmacConfig();
  const h = crypto.createHmac(cfg.algo, hmacKeyBytes(secret, cfg.secretEncoding));
  h.update(rawBody);
  return cfg.encoding === 'base64' ? h.digest('base64') : h.digest('hex');
}
function hmacVerify(secret, rawBody, sigHeader) {
  if (!sigHeader) return false;
  let sig = String(sigHeader).trim();
  for (const p of ['sha256=', 'hmac-sha256=', 'hmac=']) {
    if (sig.toLowerCase().startsWith(p)) { sig = sig.slice(p.length); break; }
  }
  let expected;
  try { expected = hmacSign(secret, rawBody); } catch { return false; }
  const a = Buffer.from(sig, 'utf8'), b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}
function hexToField(h) {
  const s = String(h).trim();
  if (!/^0x[0-9a-fA-F]+$/.test(s)) throw new Error('not hex');
  return (BigInt(s) % FIELD_P).toString();
}
function taskIdToField(taskId) {
  // ASSUMPTION (not documented officially): map the string task id to a field
  // element via keccak256(task_id) mod p. If the platform expects a different
  // mapping, the proof's public signals won't match its expectation — the
  // decision + reason_code are still scored independently.
  const hash = ethers.keccak256(ethers.toUtf8Bytes(String(taskId)));
  return (BigInt(hash) % FIELD_P).toString();
}
function randomSalt() {
  return (BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_P).toString();
}

// Deterministic decision. Check order is deliberate: reuse first (no proof
// may be minted for a spent reference), then the cheap field checks.
function decideGatekeeper(input, seenProofs) {
  const norm = s => String(s).toLowerCase();
  if (seenProofs.has(norm(input.proof_tx))) return { decision: 'REJECT', reason_code: 'PROOF_REUSED' };
  if (norm(input.proof_vk) !== norm(input.registered_vk)) return { decision: 'REJECT', reason_code: 'VK_SUBSTITUTION' };
  if (BigInt(input.public_balance) < BigInt(input.minimum)) return { decision: 'REJECT', reason_code: 'THRESHOLD_MISMATCH' };
  if (Number(input.current_block) >= Number(input.expiry_block)) return { decision: 'REJECT', reason_code: 'EXPIRED_CONDITION' };
  if (norm(input.recipient) !== norm(input.condition_recipient)) return { decision: 'REJECT', reason_code: 'RECIPIENT_MISMATCH' };
  if (BigInt(input.amount) > BigInt(input.max_transfer)) return { decision: 'REJECT', reason_code: 'AMOUNT_OVERFLOW' };
  return { decision: 'APPROVE', reason_code: 'VALID_CONDITION' };
}

function validateGatekeeperInput(body) {
  const bad = error => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('envelope must be a JSON object');
  if (body.type && body.type !== 'agent-games.proof-gatekeeper.v1') return bad('unsupported envelope type');
  const input = body.input && typeof body.input === 'object' ? body.input : body;
  const task_id = body.task_id || input.task_id;
  if (!task_id || typeof task_id !== 'string') return bad('task_id is required');
  const isHex = (s, len) => typeof s === 'string' && new RegExp(len ? `^0x[0-9a-fA-F]{${len}}$` : '^0x[0-9a-fA-F]+$').test(s);
  const isDec = s => /^-?\d+$/.test(String(s));
  const isInt = s => Number.isInteger(Number(s)) && Number(s) >= 0 && String(s).trim() !== '';
  for (const f of ['registered_vk', 'proof_vk']) if (!isHex(input[f])) return bad(`${f} must be a 0x hex string`);
  for (const f of ['minimum', 'public_balance', 'amount', 'max_transfer']) if (!isDec(input[f])) return bad(`${f} must be a decimal integer string`);
  for (const f of ['expiry_block', 'current_block']) if (!isInt(input[f])) return bad(`${f} must be a non-negative integer`);
  for (const f of ['recipient', 'condition_recipient']) if (!isAddr(input[f])) return bad(`${f} must be a valid 0x address`);
  if (!isHex(input.proof_tx, 64)) return bad('proof_tx must be a 0x 64-hex string');
  return {
    ok: true,
    input: {
      task_id: String(task_id),
      registered_vk: String(input.registered_vk),
      proof_vk: String(input.proof_vk),
      minimum: String(input.minimum),
      public_balance: String(input.public_balance),
      expiry_block: Number(input.expiry_block),
      current_block: Number(input.current_block),
      recipient: ethers.getAddress(input.recipient),
      condition_recipient: ethers.getAddress(input.condition_recipient),
      amount: String(input.amount),
      max_transfer: String(input.max_transfer),
      proof_tx: String(input.proof_tx).toLowerCase(),
    },
  };
}

let arenaVkCache = null;
async function arenaGetVk() {
  if (!arenaVkCache) arenaVkCache = await snarkjs.zKey.exportVerificationKey(GATEKEEPER_ZKEY);
  return arenaVkCache;
}
// Returns { proof, publicSignals } or null. Null means: no circuits, proof
// generation failed, local verification failed, or the 50s safety budget ran out.
async function arenaProve(input, decision) {
  if (!arenaCircuitsReady()) return null;
  const circuitInput = {
    registeredVkHash: hexToField(input.registered_vk),
    proofVkHash: hexToField(input.proof_vk),
    minimum: BigInt(input.minimum).toString(),
    publicBalance: BigInt(input.public_balance).toString(),
    expiryBlock: String(input.expiry_block),
    currentBlock: String(input.current_block),
    recipient: hexToField(input.recipient),
    conditionRecipient: hexToField(input.condition_recipient),
    amount: BigInt(input.amount).toString(),
    maxTransfer: BigInt(input.max_transfer).toString(),
    decision: decision === 'APPROVE' ? '1' : '0',
    taskId: taskIdToField(input.task_id),
    salt: randomSalt(),
  };
  const proveP = (async () => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, GATEKEEPER_WASM, GATEKEEPER_ZKEY);
    const vk = await arenaGetVk();
    const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
    return ok ? { proof, publicSignals } : null;
  })().catch(() => null);
  const raced = await Promise.race([proveP, sleep(50000).then(() => 'TIMEOUT')]);
  return raced === 'TIMEOUT' ? null : raced;
}

const arenaCache = new Map(); // task_id -> { status, body, signature } (byte-identical retries)
const arenaInflight = new Map(); // task_id -> Promise (a retry during proving waits, never poisons the cache)
const arenaSeenProofs = new Set(); // normalized proof_tx (in-memory; lost on restart — see README)

async function arenaProcess(input) {
  const started = Date.now();
  const secret = arenaSecret();
  const verdict = decideGatekeeper(input, arenaSeenProofs);
  arenaSeenProofs.add(input.proof_tx); // record before the proving await (fail closed on concurrent duplicates)
  let proof = null, publicSignals = [];
  let decision = verdict.decision, reason = verdict.reason_code;
  if (reason !== 'PROOF_REUSED') {
    let p = null;
    try { p = await arenaProve(input, decision); } catch { p = null; }
    if (p) { proof = p.proof; publicSignals = p.publicSignals; }
    else if (decision === 'APPROVE') {
      // The circuit refused to prove an approval: fail closed. The most
      // likely circuit-side mismatch is the vk binding.
      decision = 'REJECT'; reason = 'VK_SUBSTITUTION';
    }
    // A REJECT without a proof is still a valid response (decision + reason are scored).
  }
  const out = { decision, reason_code: reason, proof_tx: input.proof_tx, proof, public_signals: publicSignals };
  const respBody = JSON.stringify(out);
  let sig = null;
  try { sig = hmacSign(secret, Buffer.from(respBody, 'utf8')); } catch { sig = null; }
  const result = { status: 200, body: respBody, signature: sig };
  arenaCache.set(input.task_id, result);
  log(`ARENA ${input.task_id} ${decision} ${reason} ${Date.now() - started}ms proof=${proof ? 'yes' : 'no'}`);
  return result;
}

function sendSignedArena(res, code, obj, secret) {
  const body = JSON.stringify(obj);
  let sig = null;
  if (secret) { try { sig = hmacSign(secret, Buffer.from(body, 'utf8')); } catch { sig = null; } }
  return sendRaw(res, code, body, sig);
}

async function handleArena(req, res) {
  const secret = arenaSecret();
  if (!secret) {
    log('ARENA 401 no secret configured');
    return sendRaw(res, 401, JSON.stringify({ error: 'agent games secret not configured' }), null);
  }
  let raw;
  try { raw = await readRawBody(req); } catch {
    return sendSignedArena(res, 413, { error: 'body too large' }, secret);
  }
  if (!hmacVerify(secret, raw, req.headers[ARENA_HMAC_HEADER])) {
    log('ARENA 401 bad signature');
    return sendSignedArena(res, 401, { error: 'bad signature' }, secret);
  }
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch {
    return sendSignedArena(res, 400, { error: 'invalid JSON' }, secret);
  }
  const v = validateGatekeeperInput(body);
  if (!v.ok) return sendSignedArena(res, 400, { error: v.error }, secret);
  const input = v.input;
  if (arenaCache.has(input.task_id)) {
    const c = arenaCache.get(input.task_id);
    log(`ARENA replay ${input.task_id} -> cached`);
    return sendRaw(res, c.status, c.body, c.signature);
  }
  if (arenaInflight.has(input.task_id)) {
    const c = await arenaInflight.get(input.task_id);
    return sendRaw(res, c.status, c.body, c.signature);
  }
  const work = arenaProcess(input);
  arenaInflight.set(input.task_id, work);
  try {
    const c = await work;
    return sendRaw(res, c.status, c.body, c.signature);
  } finally {
    arenaInflight.delete(input.task_id);
  }
}

// ---------- HTTP ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' });
  res.end(body);
}
// Raw-body send (arena): byte-exact body + optional HMAC signature header.
function sendRaw(res, code, body, signature) {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-agent-games-signature' };
  if (signature) headers[ARENA_HMAC_HEADER] = signature;
  res.writeHead(code, headers);
  res.end(body);
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 65536) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 65536) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
// simple per-IP rate limit: 30 req/min
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr); return arr.length > 30;
}
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw Object.assign(new Error('timeout: exceeded 55s budget'), { code: 504 }); })]);

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (rateLimited(ip)) return send(res, 429, { error: 'rate limited: max 30 requests/minute per IP' });
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, {
        agent: 'xndr', handle: 'xndr.ai', version: VERSION, chainId: CHAIN_ID,
        wallet: AGENT_WALLET, registry: AGENT_REGISTRY,
        what: 'Read-only Web3 safety agent: verifies a mint/approval/wallet on-chain before anyone signs. Never signs, never broadcasts, never holds a private key.',
        capabilities: ['POST /check-mint — verify a free mint (code, identity, mint fns, value-0 simulation)', 'POST /check-wallet — BNB/token balances + NFT ownership', 'POST /check-approval — operator / per-token approvals', 'GET /health — liveness + block', 'POST /agent — Proof Gatekeeper arena task (HMAC-signed envelope, Groth16 proof)'],
        limits: ['BSC (chain 56) only', 'read-only: no signing, no broadcast, no state change', 'fail-closed: unverifiable means DO NOT SIGN', 'free-mint verdicts are simulations, not guarantees'],
        evidence: { bscscan: `https://bscscan.com/address/${AGENT_WALLET}`, registry: `https://bscscan.com/address/${AGENT_REGISTRY}` },
      });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      const block = await withTimeout(rpc('eth_blockNumber', []), 10000).catch(() => null);
      return send(res, 200, { ok: true, agent: 'xndr', chainId: CHAIN_ID, blockNumber: block ? parseInt(block, 16) : null, time: wib(), arena: { enabled: arenaCircuitsReady(), circuits: arenaCircuitsReady(), secretConfigured: Boolean(arenaSecret()), hmacAlgo: arenaHmacConfig().algo } });
    }
    if (req.method === 'GET' && url.pathname === '/agent') {
      return send(res, 405, { error: 'method not allowed: POST a signed Gatekeeper task envelope here', agent: 'xndr' });
    }
    if (req.method === 'POST' && (url.pathname === '/agent' || url.pathname === '/')) {
      return handleArena(req, res);
    }
    if (req.method === 'POST' && ['/check-mint', '/check-wallet', '/check-approval'].includes(url.pathname)) {
      const body = await readBody(req);
      if (url.pathname === '/check-mint') {
        if (!body.contract || !isAddr(body.contract)) return send(res, 400, { error: 'contract must be a valid 0x address' });
        const out = await withTimeout(checkMint(body.contract, body.wallet, body.quantity), 55000);
        return send(res, 200, out);
      }
      if (url.pathname === '/check-wallet') {
        if (!body.wallet || !isAddr(body.wallet)) return send(res, 400, { error: 'wallet must be a valid 0x address' });
        const out = await withTimeout(checkWallet(body.wallet, body.tokens, body.nfts), 55000);
        return send(res, 200, out);
      }
      if (url.pathname === '/check-approval') {
        if (!body.wallet || !isAddr(body.wallet) || !body.contract || !isAddr(body.contract)) return send(res, 400, { error: 'wallet and contract must be valid 0x addresses' });
        const out = await withTimeout(checkApproval(body.wallet, body.contract, body.tokenId, body.operator), 55000);
        return send(res, 200, out);
      }
    }
    return send(res, 404, { error: 'not found', routes: ['GET /', 'GET /health', 'POST /check-mint', 'POST /check-wallet', 'POST /check-approval', 'POST /agent — Proof Gatekeeper arena task (HMAC-signed)'] });
  } catch (e) {
    log('ERR', req.method, url.pathname, e.message);
    return send(res, e.code === 504 ? 504 : 500, { error: e.message.slice(0, 200), agent: 'xndr' });
  }
});

server.listen(PORT, () => log(`xndr v${VERSION} listening on :${PORT} — read-only, BSC 56, no keys, no signing — arena: ${arenaCircuitsReady() ? 'ready' : 'NO CIRCUITS'}, secret: ${arenaSecret() ? 'set' : 'NOT SET'}`));
module.exports = { server };
