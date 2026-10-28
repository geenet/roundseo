#!/usr/bin/env node
// Verify build output exists
import { existsSync } from 'fs';
import { resolve } from 'path';

const buildDir = resolve(process.cwd(), 'dist/client');
const workerFile = resolve(process.cwd(), 'dist/worker');

if (!existsSync(buildDir)) {
  console.error('❌ Build failed: dist/client directory not found');
  process.exit(1);
}

console.log('✓ Build output verified');
