// Runs every e2e script in sequence against one base URL; exits non-zero if any fails.
// `npm run test:e2e -- http://127.0.0.1:5002`  (Playwright's Chromium must be installed: `npx playwright install chromium`)
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
const here = path.dirname(fileURLToPath(import.meta.url))
const base = process.argv[2] || process.env.E2E_BASE || 'http://127.0.0.1:5002'
let failed = 0
for (const s of ['states.mjs', 'flow.mjs', 'tradebook.mjs', 'shots.mjs']) {
  console.log(`\n── ${s} @ ${base} ──`)
  const r = spawnSync(process.execPath, [path.join(here, s), base], { stdio: 'inherit' })
  if (r.status !== 0) failed += 1
}
console.log(failed ? `\n${failed} script(s) failed` : '\nall e2e scripts passed')
process.exit(failed ? 1 : 0)
