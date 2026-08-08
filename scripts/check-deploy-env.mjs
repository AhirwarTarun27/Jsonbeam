/**
 * Deploy-time env guard.
 *
 * PUBLIC_* vars are inlined by Astro at BUILD time. An unset var is not an error —
 * it means "feature off", which is what local dev wants and what makes a broken
 * production deploy invisible: the build succeeds, the page renders, and the key
 * is simply gone.
 *
 * This is not hypothetical here. On 2026-07-19 the dist/ on disk was found to be a
 * build made without .env: dist/contact/index.html shipped access_key="" while the
 * live site had the real key. Deploying that build would have silently killed the
 * contact form during an AdSense review, with no error anywhere.
 *
 * Runs ONLY from `npm run deploy` (not `dev`, not `build`), so dev keeps working
 * without a .env while a production ship that would drop a var fails loudly.
 *
 * To add a var: add it to REQUIRED with a note on what breaks when it goes missing.
 */

import { readFileSync, existsSync } from 'node:fs';

// Vars that MUST be present to ship. Keep the "breaks" text concrete — it is the
// error message you will read months from now with no memory of this file.
const REQUIRED = [
  {
    name: 'PUBLIC_WEB3FORMS_ACCESS_KEY',
    breaks:
      'contact form renders normally but posts an empty access_key, silently discarding every message',
    looksLike: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  },
];

// Astro/Vite loads .env itself, so a plain node script does not see it. Parse it
// here, then let a real process env var (CI, dashboard build var) take precedence.
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) out[key] = value;
  }
  return out;
}

const fileEnv = { ...readEnvFile('.env'), ...readEnvFile('.env.production') };
const resolve = (name) => process.env[name] ?? fileEnv[name] ?? '';

const problems = [];
for (const { name, breaks, looksLike } of REQUIRED) {
  const value = resolve(name);
  if (!value) {
    problems.push(`  ${name} is MISSING -> ${breaks}`);
  } else if (looksLike && !looksLike.test(value)) {
    problems.push(`  ${name} is set to "${value}" which does not match ${looksLike} -> ${breaks}`);
  }
}

if (problems.length > 0) {
  console.error('\nDeploy blocked: required build-time env vars are missing.\n');
  console.error(problems.join('\n'));
  console.error('\nThese are inlined at build time. Deploying now would ship a site');
  console.error('that builds clean and looks fine while the feature is silently gone.');
  console.error('\nFix: add them to .env (see .env.example), then re-run the deploy.\n');
  process.exit(1);
}

console.log(`env guard ok — ${REQUIRED.length} required var(s) present`);
