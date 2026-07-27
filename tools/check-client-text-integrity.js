#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PARTS_DIR = path.join(ROOT, 'public', 'js', 'game');
const PART_FILES = fs.readdirSync(PARTS_DIR)
  .filter(name => name.endsWith('.js'))
  .sort();

// UTF-8 Cyrillic decoded as Windows-1251 typically becomes alternating
// Р?/С? pairs, for example "мимо" -> "РјРёРјРѕ".
const CYRILLIC_MOJIBAKE = /(?:\u0420[\u0400-\u04ff]|\u0421[\u0400-\u04ff]){3,}/gu;
const REMOVED_CLICK_TO_MOVE_TOKENS = [
  'targetPath',
  'moveTargetMarker',
  'showMoveMarker',
  'setMoveTargetWorld'
];
const failures = [];

for (const name of PART_FILES) {
  const source = fs.readFileSync(path.join(PARTS_DIR, name), 'utf8');
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const matches = lines[index].match(CYRILLIC_MOJIBAKE);
    if (matches) {
      failures.push(`${name}:${index + 1}: suspicious Cyrillic mojibake (${matches.join(', ')})`);
    }
  }
  if (source.includes('LegacyUnused')) {
    failures.push(`${name}: remove code marked LegacyUnused instead of shipping it`);
  }
  for (const token of REMOVED_CLICK_TO_MOVE_TOKENS) {
    if (source.includes(token)) {
      failures.push(`${name}: removed click-to-move token returned (${token})`);
    }
  }
}

assert.strictEqual(
  failures.length,
  0,
  `Client text/dead-code integrity failed:\n${failures.map(item => `- ${item}`).join('\n')}`
);

console.log(`Client text/dead-code integrity OK: ${PART_FILES.length} parts`);
