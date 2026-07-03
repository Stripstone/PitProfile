#!/usr/bin/env node
/*
  PitProfile static build step.

  Source repo files stay readable. GitHub Actions builds to ./dist and deploys only ./dist.
  - Copies static files from repo root to dist/
  - Obfuscates inline JavaScript in index.html when PITPROFILE_OBFUSCATE !== "0"
  - Obfuscates sw.js when present
*/

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const shouldObfuscate = process.env.PITPROFILE_OBFUSCATE !== '0';

let JavaScriptObfuscator = null;
if (shouldObfuscate) {
  try {
    JavaScriptObfuscator = require('javascript-obfuscator');
  } catch (error) {
    console.error('javascript-obfuscator is required for obfuscated builds. Run npm install first.');
    throw error;
  }
}

const SKIP_ROOT_NAMES = new Set([
  '.git',
  '.github',
  'node_modules',
  'dist',
  'scripts',
  'package.json',
  'package-lock.json',
  'npm-debug.log'
]);

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyStaticSite() {
  rmrf(distDir);
  ensureDir(distDir);

  for (const entry of fs.readdirSync(rootDir)) {
    if (SKIP_ROOT_NAMES.has(entry)) continue;
    copyRecursive(path.join(rootDir, entry), path.join(distDir, entry));
  }
}

function obfuscateCode(code, sourceName) {
  if (!shouldObfuscate) return code;
  if (!code.trim()) return code;
  return JavaScriptObfuscator
    .obfuscate(code, { ...obfuscatorOptions, sourceMap: false })
    .getObfuscatedCode();
}

function obfuscateInlineScriptsInHtml(html, htmlName) {
  if (!shouldObfuscate) return html;

  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs = '', code = '') => {
    const attrText = String(attrs);
    if (/\bsrc\s*=/.test(attrText)) return match;
    if (/\btype\s*=\s*["'](?:application\/json|application\/ld\+json|importmap|text\/plain)["']/i.test(attrText)) return match;
    if (!code.trim()) return match;

    try {
      const obfuscated = obfuscateCode(code, htmlName);
      return `<script${attrs}>${obfuscated}</script>`;
    } catch (error) {
      console.error(`Failed to obfuscate inline script in ${htmlName}.`);
      throw error;
    }
  });
}

function processIndexHtml() {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.html was not found. Build expects index.html at repo root.');
  }

  const original = fs.readFileSync(indexPath, 'utf8');
  const processed = obfuscateInlineScriptsInHtml(original, 'index.html');
  fs.writeFileSync(indexPath, processed, 'utf8');
}

function processServiceWorker() {
  const swPath = path.join(distDir, 'sw.js');
  if (!fs.existsSync(swPath) || !shouldObfuscate) return;
  const original = fs.readFileSync(swPath, 'utf8');
  const processed = obfuscateCode(original, 'sw.js');
  fs.writeFileSync(swPath, processed, 'utf8');
}

copyStaticSite();
processIndexHtml();
processServiceWorker();

console.log(`PitProfile build complete: ${path.relative(rootDir, distDir)}/`);
console.log(`Obfuscation: ${shouldObfuscate ? 'enabled' : 'disabled'}`);
