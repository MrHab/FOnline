#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = path.join(
  ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review',
  'integration-evidence',
  'service-scout-integration-evidence.json'
);

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

if (!fs.existsSync(REPORT)) fail('Integration evidence report is missing');
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
if (report.schema !== 'realm.service-scout-integration-evidence.v1') {
  fail('Integration evidence schema drifted');
}
if (!['awaiting_critic_final_approval', 'critic_approved'].includes(report.status)) {
  fail(`Unexpected integration evidence status: ${report.status}`);
}
if (
  report.assetId !== 'service_boots' ||
  report.runtimeItemId !== 'scoutBoots' ||
  report.scope?.variants !== 6 ||
  report.scope?.lodsPerVariant !== 3 ||
  report.scope?.productionGlbs !== 18
) {
  fail('Integration evidence scope drifted');
}
if (
  report.blenderRoundTrip?.result !== 'passed' ||
  report.blenderRoundTrip?.importedGlbs !== 18 ||
  report.blenderRoundTrip?.cleanScenePerFile !== true
) {
  fail('Blender round-trip evidence is incomplete');
}
if (
  report.runtimeDiagnostics?.desktop?.manifest !== 'ready' ||
  report.runtimeDiagnostics?.desktop?.attachedActors !== 1 ||
  report.runtimeDiagnostics?.desktop?.failedActors !== 0 ||
  report.runtimeDiagnostics?.desktop?.selectedVariant !== 'male_medium' ||
  report.runtimeDiagnostics?.desktop?.equippedPhysicalItemId !== 'scoutBoots' ||
  report.runtimeDiagnostics?.mobileLandscapeViewport?.manifest !== 'ready' ||
  report.runtimeDiagnostics?.mobileLandscapeViewport?.attachedActors !== 1 ||
  report.runtimeDiagnostics?.mobileLandscapeViewport?.failedActors !== 0 ||
  report.runtimeDiagnostics?.mobileLandscapeViewport?.selectedVariant !== 'male_medium'
) {
  fail('Runtime diagnostics are incomplete');
}
if (
  report.runtimeReachability?.status !== 'default_variant_only' ||
  report.runtimeReachability?.defaultVariant !== 'male_medium' ||
  report.runtimeReachability?.browserRequestedGlbs !== 3 ||
  report.scope?.selectableVariantsInCurrentPlayerRuntime !== 1 ||
  report.runtimeReachability?.publishedButNotSelectableFromCurrentPlayerState?.length !== 5
) {
  fail('Default-only runtime reachability must remain explicit');
}
if (
  report.authority?.source !== 'server equipment snapshot' ||
  report.authority?.actionVisualSource !== 'server player equipment only' ||
  report.authority?.spoofedActionVisualRegression !== 'passed' ||
  report.authority?.physicalInventoryRequired !== true ||
  report.authority?.cosmeticOverrideAllowed !== false
) {
  fail('Server equipment authority evidence is incomplete');
}
if (!Array.isArray(report.knownLimitations) || report.knownLimitations.length < 5) {
  fail('Known limitations must remain explicit');
}
if (!Array.isArray(report.evidenceFiles) || report.evidenceFiles.length !== report.evidenceFileCount) {
  fail('Evidence file count drifted');
}

const lines = [];
let totalBytes = 0;
for (const entry of report.evidenceFiles) {
  const file = path.resolve(ROOT, entry.file || '');
  const relative = path.relative(ROOT, file);
  if (
    !entry.file ||
    path.isAbsolute(entry.file) ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    fail(`Invalid or missing evidence path: ${entry.file}`);
  }
  const buffer = fs.readFileSync(file);
  if (buffer.length !== entry.bytes || sha256(buffer) !== entry.sha256) {
    fail(`Evidence file changed after capture: ${entry.file}`);
  }
  totalBytes += buffer.length;
  lines.push(`${entry.sha256}  ${entry.file}`);
}
if (totalBytes !== report.evidenceBytes) fail('Evidence byte count drifted');
const contentDigest = sha256(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
if (contentDigest !== report.contentDigestSha256) {
  fail('Integration evidence content digest drifted');
}
if (!Array.isArray(report.checks) || report.checks.some(check => check.result !== 'passed')) {
  fail('One or more integration checks are not passing');
}

console.log(
  `Service Scout integration evidence is valid: ${report.evidenceFileCount} files, digest ${contentDigest}.`
);
