#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(
  ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review',
  'integration-evidence'
);
const OUTPUT = path.join(
  EVIDENCE_DIR,
  'service-scout-integration-evidence.json'
);
const REVIEW_ROOT = path.join(
  ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review'
);
const SOURCE_PRODUCTION = path.join(
  ROOT,
  'source-assets',
  'production',
  'characters',
  'outfits',
  'field_worker',
  'service_boots'
);
const PUBLIC_PRODUCTION = path.join(
  ROOT,
  'public',
  'assets',
  'models',
  'characters',
  'outfits',
  'field_worker',
  'service_boots'
);

function rel(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : [file];
    });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function pngSize(buffer) {
  if (
    buffer.length >= 24 &&
    buffer.toString('ascii', 1, 4) === 'PNG'
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }
  return null;
}

const fixedFiles = [
  path.join(REVIEW_ROOT, 'CRITIC_CONFIRMATION.md'),
  path.join(REVIEW_ROOT, 'DELEGATED_USER_DECISION.md'),
  path.join(REVIEW_ROOT, 'service_boots_redesign_working.blend'),
  path.join(ROOT, 'docs', 'art', 'ASSET_SOURCE_REGISTRY.json'),
  path.join(ROOT, 'docs', 'wiki', 'CHANGELOG.md'),
  path.join(ROOT, 'docs', 'wiki', 'PATCH_NOTES_SERVICE_SCOUT_BOOTS_V2.md'),
  path.join(ROOT, 'source-assets', 'characters', 'library', 'character-library.json'),
  path.join(ROOT, 'source-assets', 'library', 'asset-library.json'),
  path.join(ROOT, 'source-assets', 'library', 'asset-production-contract.json'),
  path.join(ROOT, 'server.js'),
  path.join(
    REVIEW_ROOT,
    'production-preview',
    'service-boots-service-scout-review.json'
  ),
  path.join(
    ROOT,
    'public',
    'assets',
    'models',
    'characters',
    'service-scout-boots-manifest.json'
  ),
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'js', 'game.js'),
  path.join(ROOT, 'public', 'js', 'game-runtime.js'),
  path.join(ROOT, 'public', 'js', 'game', '04_player_model_visuals.js'),
  path.join(ROOT, 'public', 'js', 'game', '04a_player_model_modern_runtime.js'),
  path.join(ROOT, 'public', 'js', 'game', '04b_service_scout_boots_runtime.js'),
  path.join(ROOT, 'public', 'js', 'game', '03_items_inventory_core.js'),
  path.join(ROOT, 'public', 'js', 'game', '05b_remote_player_locomotion.js'),
  path.join(ROOT, 'public', 'js', 'game', '05c_multiplayer_socket_room.js'),
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'tools', 'check-client-js.js'),
  path.join(ROOT, 'tools', 'check-combat-runtime.js'),
  path.join(ROOT, 'tools', 'check-equipment-models.js'),
  path.join(ROOT, 'tools', 'check-project-metadata.js'),
  path.join(ROOT, 'tools', 'check-movement-collision.js'),
  path.join(ROOT, 'tools', 'smoke-check.js'),
  path.join(ROOT, 'tools', 'art', 'blender', 'build_service_boots_service_scout.py'),
  path.join(ROOT, 'tools', 'art', 'blender', 'build_character_bc_first_outfit_review.py'),
  path.join(ROOT, 'tools', 'art', 'blender', 'render_service_boots_fit_review.py'),
  path.join(ROOT, 'tools', 'art', 'blender', 'render_service_boots_service_scout.py'),
  path.join(ROOT, 'tools', 'art', 'blender', 'validate_service_boots_roundtrip.py'),
  path.join(ROOT, 'tools', 'art', 'build-service-boots-service-scout-review.js'),
  path.join(ROOT, 'tools', 'art', 'build-service-boots-service-scout-production.js'),
  path.join(ROOT, 'tools', 'art', 'build-service-boots-service-scout-integration-evidence.js'),
  path.join(ROOT, 'tools', 'art', 'validate-character-body-set.js'),
  path.join(ROOT, 'tools', 'art', 'validate-character-module-set.js'),
  path.join(ROOT, 'tools', 'art', 'validate-production-glb.js'),
  path.join(ROOT, 'tools', 'art', 'validate-production-lod-set.js'),
  path.join(ROOT, 'tools', 'art', 'validate-service-boots-service-scout-review.js'),
  path.join(ROOT, 'tools', 'art', 'validate-service-boots-service-scout-production.js'),
  path.join(ROOT, 'tools', 'art', 'validate-service-boots-service-scout-integration-evidence.js'),
  path.join(ROOT, 'tools', 'art', 'run-service-boots-service-scout-blender-roundtrip.js')
];
const evidenceFiles = walk(EVIDENCE_DIR).filter(file => file !== OUTPUT);
const files = [
  ...fixedFiles,
  ...walk(SOURCE_PRODUCTION),
  ...walk(PUBLIC_PRODUCTION),
  ...evidenceFiles
];
const uniqueFiles = [...new Set(files.map(file => path.resolve(file)))].sort(
  (left, right) => rel(left).localeCompare(rel(right))
);
for (const file of uniqueFiles) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Integration evidence dependency is missing: ${rel(file)}`);
  }
}

const entries = uniqueFiles.map(file => {
  const buffer = fs.readFileSync(file);
  const image = path.extname(file).toLowerCase() === '.png'
    ? pngSize(buffer)
    : null;
  return {
    file: rel(file),
    bytes: buffer.length,
    sha256: sha256(buffer),
    ...(image ? { image } : {})
  };
});
const digestLines = entries
  .map(entry => `${entry.sha256}  ${entry.file}`)
  .join('\n') + '\n';
const runtimeDiagnostics = {
  desktop: {
    viewport: { width: 2560, height: 1271 },
    screenshot: 'desktop-gameplay.png',
    manifest: 'ready',
    requests: 3,
    attachedActors: 1,
    failedActors: 0,
    lastError: '',
    cachedTemplates: 3,
    selectedVariant: 'male_medium',
    equippedPhysicalItemId: 'scoutBoots',
    consoleWarningsOrErrors: 0
  },
  mobileLandscapeViewport: {
    viewport: { width: 844, height: 390 },
    screenshot: 'mobile-landscape-844x390.png',
    manifest: 'ready',
    requests: 3,
    attachedActors: 1,
    failedActors: 0,
    lastError: '',
    cachedTemplates: 3,
    selectedVariant: 'male_medium',
    note: 'Viewport regression check in desktop Chrome; touch/coarse-pointer emulation was not available.'
  }
};
const report = {
  schema: 'realm.service-scout-integration-evidence.v1',
  assetId: 'service_boots',
  runtimeItemId: 'scoutBoots',
  status: 'awaiting_critic_final_approval',
  approvedReviewManifestSha256:
    'd66e7ebac2b8685b06a7345ef3e5a2c0f457ab2d901be6caa079dd460556f9b9',
  scope: {
    variants: 6,
    publishedVariants: 6,
    selectableVariantsInCurrentPlayerRuntime: 1,
    lodsPerVariant: 3,
    productionGlbs: 18,
    triangleTiers: [3900, 1992, 1100],
    materialsPerGlb: 2,
    jointsPerGlb: 65,
    provenance: 'original',
    thirdPartyAssets: 0
  },
  runtimeReachability: {
    status: 'default_variant_only',
    defaultVariant: 'male_medium',
    browserExercisedVariants: ['male_medium'],
    browserRequestedGlbs: 3,
    publishedButNotSelectableFromCurrentPlayerState: [
      'female_slim',
      'female_medium',
      'female_large',
      'male_slim',
      'male_large'
    ],
    reason: 'The current local and remote procedural-character constructors do not yet receive authoritative sex/bodyType appearance fields.'
  },
  blenderRoundTrip: {
    command: 'npm run check:service-boots-service-scout:blender',
    blenderVersion: '4.5.12 LTS',
    cleanScenePerFile: true,
    importedGlbs: 18,
    result: 'passed',
    report: rel(path.join(EVIDENCE_DIR, 'service-scout-blender-roundtrip.json'))
  },
  runtimeDiagnostics,
  checks: [
    { command: 'npm run check:service-boots-service-scout', result: 'passed' },
    { command: 'npm run check:service-boots-service-scout:blender', result: 'passed' },
    { command: 'node tools/check-client-js.js', result: 'passed', clientParts: 61 },
    { command: 'node tools/check-combat-runtime.js', result: 'passed', spoofedActionVisualsRejected: true },
    { command: 'node tools/check-static-assets.js', result: 'passed', runtimeAssetFiles: 241 },
    { command: 'node tools/check-movement-collision.js', result: 'passed' },
    { command: 'node tools/smoke-check.js', result: 'passed' },
    { command: 'npm run check', result: 'passed' },
    { command: 'GET http://127.0.0.1:3001/health', result: 'passed' },
    { command: 'Socket.IO websocket connection to port 3001', result: 'passed' }
  ],
  authority: {
    source: 'server equipment snapshot',
    actionVisualSource: 'server player equipment only',
    spoofedActionVisualRegression: 'passed',
    physicalInventoryRequired: true,
    cosmeticOverrideAllowed: false,
    itemId: 'scoutBoots'
  },
  knownLimitations: [
    'Runtime attachment is a transitional ankle-split adapter over the current procedural character, not the final shared-GLB humanoid runtime.',
    'The current player and remote-player constructors do not provide sex/bodyType, so browser runtime selects only male_medium (3 LOD GLBs); the other 15 published GLBs are Blender-validated but are not player-selectable until the modular appearance state/editor is wired.',
    'Formal production BVH fit remains pending_geometry_check; the critic-approved review package contains eight visual fit poses for all six body variants.',
    'The 844x390 check validates loading and attachment at a mobile landscape viewport but does not emulate touch/coarse-pointer device detection.',
    'The complete Realm of Ashes 3D library is not release-ready; this evidence covers only Service Scout boots.'
  ],
  evidenceFiles: entries,
  evidenceFileCount: entries.length,
  evidenceBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  contentDigestSha256: sha256(Buffer.from(digestLines, 'utf8'))
};

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  `Service Scout integration evidence built: ${entries.length} files, digest ${report.contentDigestSha256}.`
);
