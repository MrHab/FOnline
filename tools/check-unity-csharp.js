'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const project = path.join(root, 'unity-client');
const versionText = fs.readFileSync(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'utf8');
const version = /m_EditorVersion:\s*([^\r\n]+)/.exec(versionText)?.[1]?.trim() || '6000.5.8f1';

function filesUnder(directory, predicate, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function existingEditorRoot() {
  const candidates = [
    process.env.UNITY_EDITOR_PATH ? path.dirname(process.env.UNITY_EDITOR_PATH) : '',
    `D:\\Games\\${version}\\Editor`,
    `C:\\Program Files\\Unity\\Hub\\Editor\\${version}\\Editor`,
    `C:\\Program Files\\Unity\\Hub\\Editor\\${version}`
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'Unity.exe'))
    || fs.existsSync(path.join(candidate, 'Data/DotNetSdk/dotnet.exe'))) || '';
}

const editor = existingEditorRoot();
if (!editor) throw new Error(`Unity ${version} was not found. Set UNITY_EDITOR_PATH to Unity.exe.`);
const dotnet = path.join(editor, 'Data/DotNetSdk/dotnet.exe');
const sdkRoot = path.join(editor, 'Data/DotNetSdk/sdk');
const sdk = fs.readdirSync(sdkRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(sdkRoot, entry.name, 'Roslyn/bincore/csc.dll')))
  .map(entry => entry.name)
  .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))[0];
if (!sdk) throw new Error('Unity Roslyn compiler was not found.');
const csc = path.join(sdkRoot, sdk, 'Roslyn/bincore/csc.dll');

const responseFiles = filesUnder(path.join(project, 'Library/Bee/artifacts'), full => path.basename(full) === 'Assembly-CSharp.rsp')
  .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
if (!responseFiles.length) throw new Error('Unity compilation response file is missing. Open the project once in Unity.');

const baseLines = fs.readFileSync(responseFiles[0], 'utf8').split(/\r?\n/)
  .filter(line => line && !/^"?Assets\/.+\.cs"?$/.test(line) && !/^-out:|^-refout:/.test(line));
const sources = filesUnder(path.join(project, 'Assets'), full => full.endsWith('.cs') && !/[\\/]Editor[\\/]/i.test(full))
  .sort()
  .map(full => `"${path.relative(project, full).replace(/\\/g, '/')}"`);
const suffix = `${process.pid}-${Date.now()}`;
const rsp = path.join(os.tmpdir(), `fonline-unity-${suffix}.rsp`);
const output = path.join(os.tmpdir(), `fonline-unity-${suffix}.dll`);
const refOutput = path.join(os.tmpdir(), `fonline-unity-${suffix}.ref.dll`);
fs.writeFileSync(rsp, [
  `-out:"${output}"`,
  `-refout:"${refOutput}"`,
  ...baseLines,
  ...sources
].join('\n'), 'utf8');

try {
  const result = spawnSync(dotnet, [csc, `@${rsp}`], {
    cwd: project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`Unity C# compile passed: ${sources.length} runtime source files.`);
} finally {
  for (const file of [rsp, output, refOutput]) {
    try { fs.rmSync(file, { force: true }); } catch (_) { /* best-effort temp cleanup */ }
  }
}
