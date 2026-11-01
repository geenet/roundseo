import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
const failures = [];
if (/YOUR_(?:CLOUDFLARE_ACCOUNT_ID|DATABASE_ID|ZONE_ID|STAGING_DATABASE_ID)/.test(config)) failures.push('Set real Cloudflare account, zone, and database identifiers in wrangler.toml.');
if (/GENERATE_RANDOM_SECRET|STAGING_SECRET/.test(config)) failures.push('Store authentication secrets with Wrangler secrets; remove placeholder secret values.');
if (!existsSync(path.join(root, 'dist/client/index.html'))) failures.push('Run npm run build before preparing a deployment.');
if (!existsSync(path.join(root, 'migrations/008_performance_audits.sql'))) failures.push('The performance audit migration is missing.');
if (!existsSync(path.join(root, 'migrations/009_dataforseo_runs.sql'))) failures.push('The legacy run-ledger migration is missing; keep it so the migration history stays intact.');
if (!existsSync(path.join(root, 'migrations/010_intelligence_platform.sql'))) failures.push('The RoundSEO intelligence platform migration is missing.');
if (!existsSync(path.join(root, 'migrations/011_native_intelligence.sql'))) failures.push('The native intelligence migration is missing.');
if (!existsSync(path.join(root, 'migrations/012_website_media.sql'))) failures.push('The website media migration is missing.');
if (failures.length) {
  failures.forEach(message => console.error(message));
  process.exitCode = 1;
} else console.log('Static deployment checks passed. Confirm the target environment, remote migrations, and configured secrets before publishing.');
