'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const terminologyFile = path.join(root, 'data', 'kromka', 'terminology.json');
const supportedExtensions = new Set(['.asset', '.cs', '.json', '.md', '.prefab', '.txt', '.unity']);

function normalizeRelative(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term, match) {
  const escaped = escapeRegExp(term);
  if (match === 'word') {
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
  }
  return new RegExp(escaped, 'giu');
}

function findViolations(text, rules) {
  const violations = [];
  for (const rule of rules) {
    for (const legacy of rule.legacy || []) {
      const pattern = termPattern(legacy, rule.match);
      let match;
      while ((match = pattern.exec(text)) !== null) {
        violations.push({
          ruleId: rule.id,
          legacy,
          canonical: rule.canonical,
          index: match.index
        });
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    }
  }
  return violations;
}

function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function collectFiles(entry, files = []) {
  if (!fs.existsSync(entry)) return files;
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (supportedExtensions.has(path.extname(entry).toLowerCase())) files.push(entry);
    return files;
  }
  for (const name of fs.readdirSync(entry).sort((a, b) => a.localeCompare(b, 'en'))) {
    collectFiles(path.join(entry, name), files);
  }
  return files;
}

function validateConfig(config, errors) {
  if (config?.schema !== 'kromka.terminology.v1') {
    errors.push('data/kromka/terminology.json: expected schema kromka.terminology.v1');
  }
  if (!Array.isArray(config?.rules) || config.rules.length === 0) {
    errors.push('data/kromka/terminology.json: rules must be a non-empty array');
    return;
  }

  const ids = new Set();
  for (const [index, rule] of config.rules.entries()) {
    const label = `data/kromka/terminology.json: rules[${index}]`;
    if (!rule || typeof rule !== 'object') {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!String(rule.id || '').trim()) errors.push(`${label}.id is required`);
    if (ids.has(rule.id)) errors.push(`${label}.id duplicates ${rule.id}`);
    ids.add(rule.id);
    if (!Array.isArray(rule.legacy) || rule.legacy.length === 0) {
      errors.push(`${label}.legacy must be a non-empty array`);
    }
    if (!String(rule.canonical || '').trim()) errors.push(`${label}.canonical is required`);
    if (!['phrase', 'word'].includes(rule.match)) errors.push(`${label}.match must be phrase or word`);
  }
}

function main() {
  const errors = [];
  if (!fs.existsSync(terminologyFile)) {
    console.error('Kromka terminology check failed: data/kromka/terminology.json is missing.');
    process.exit(1);
  }

  let config;
  try {
    config = readJson(terminologyFile);
  } catch (error) {
    console.error(`Kromka terminology check failed: ${error.message}`);
    process.exit(1);
  }
  validateConfig(config, errors);

  const invalidProbe = findViolations('Realm of Ashes / супермутант / PIP-ASH', config.rules || []);
  const safeProbe = findViolations('Кромка / Складень / ПУТНИК', config.rules || []);
  if (invalidProbe.length < 3 || safeProbe.length !== 0) {
    errors.push('terminology validator self-test failed');
  }

  const probeFlag = process.argv.indexOf('--probe-text');
  if (probeFlag >= 0) {
    const probe = process.argv[probeFlag + 1] || '';
    const violations = findViolations(probe, config.rules || []);
    if (violations.length) {
      for (const violation of violations) {
        console.error(`probe: legacy term "${violation.legacy}"; use "${violation.canonical}"`);
      }
      process.exit(1);
    }
    console.log('Kromka terminology probe passed.');
    return;
  }

  const exclusions = new Set((config.scanExclusions || []).map(value => String(value).replace(/\\/g, '/')));
  const files = [];
  for (const configuredRoot of config.scanRoots || []) {
    const absoluteRoot = path.join(root, String(configuredRoot).replace(/\//g, path.sep));
    collectFiles(absoluteRoot, files);
  }

  const uniqueFiles = [...new Set(files.map(file => path.resolve(file)))].sort((a, b) => a.localeCompare(b, 'en'));
  for (const file of uniqueFiles) {
    const rel = normalizeRelative(file);
    if (exclusions.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const violation of findViolations(text, config.rules || [])) {
      const position = lineAndColumn(text, violation.index);
      errors.push(`${rel}:${position.line}:${position.column}: legacy term "${violation.legacy}"; use "${violation.canonical}"`);
    }
  }

  if (errors.length) {
    console.error(`Kromka terminology check failed (${errors.length}):`);
    errors.forEach(error => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log(`Kromka terminology check passed (${uniqueFiles.length} authored files scanned).`);
}

main();
