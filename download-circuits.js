'use strict';
// Postinstall fallback: download the official Proof Gatekeeper circuit files
// if they are missing (e.g. the user could not upload the .wasm/.zkey via the
// GitHub web uploader). Files already present are left untouched.
// Pinned sha256 below are the files as downloaded 2026-11-15; a mismatch only
// warns (the platform may have rotated the circuit) and never fails the build.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'circuits');
const FILES = [
  { name: 'gatekeeper.wasm', url: 'https://agentgames.zkverify.io/circuits/gatekeeper.wasm', sha256: 'be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f' },
  { name: 'gatekeeper_final.zkey', url: 'https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey', sha256: 'adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d' },
];

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(DIR, f.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`[circuits] ${f.name} already present, skipping download`);
      continue;
    }
    console.log(`[circuits] downloading ${f.url} ...`);
    const r = await fetch(f.url);
    if (!r.ok) { console.log(`[circuits] WARNING: download failed (${r.status}) for ${f.name}; arena proofs will be unavailable`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) { console.log(`[circuits] WARNING: empty download for ${f.name}`); continue; }
    fs.writeFileSync(dest, buf);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== f.sha256) console.log(`[circuits] WARNING: sha256 mismatch for ${f.name} (got ${hash}); file kept, platform may have rotated the circuit`);
    else console.log(`[circuits] ${f.name} OK (${buf.length} bytes, sha256 verified)`);
  }
}
main().catch(e => { console.log(`[circuits] WARNING: ${e.message}; arena proofs will be unavailable`); });
