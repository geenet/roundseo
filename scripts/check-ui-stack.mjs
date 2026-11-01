#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entry = readFileSync(new URL('../src/ui/main.tsx', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const checks = [
  [entry.includes("from 'react-dom/client'") && entry.includes('createRoot('), 'Web entry must mount React with createRoot'],
  [entry.includes("from './App'") && !entry.includes('App.native'), 'Web entry must load the web application'],
  [html.includes('/src/ui/main.tsx'), 'HTML must point to the web entry'],
  [existsSync(new URL('../src/ui/index.css', import.meta.url)), 'Workspace styles must exist'],
];
for (const dependency of ['react', 'react-dom', 'vite', 'typescript']) {
  try { require.resolve(dependency); } catch { checks.push([false, `${dependency} must be installed`]); }
}
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) { failures.forEach(message => console.error(message)); process.exitCode = 1; }
else console.log(`✓ Web entry and ${checks.length} UI stack requirements verified`);
