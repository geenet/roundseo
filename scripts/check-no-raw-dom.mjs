#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../src/ui/', import.meta.url);
const nativeFiles = ['App.native.tsx', ...readdirSync(new URL('screens/', root)).filter(file => file.endsWith('.tsx')).map(file => `screens/${file}`)];
const failures = [];
for (const file of nativeFiles) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) failures.push(`${file}: raw DOM element <${node.tagName.text}>`);
    if (ts.isIdentifier(node) && ['document', 'window', 'localStorage'].includes(node.text)) failures.push(`${file}: browser-only global ${node.text}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failures.length) { failures.forEach(message => console.error(message)); process.exitCode = 1; }
else console.log(`✓ ${nativeFiles.length} native source files checked for browser-only elements and globals`);
