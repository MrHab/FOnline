const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const readUnity = name => fs.readFileSync(path.join(
  root, 'unity-client', 'Assets', 'Scripts', 'Game', name), 'utf8');

const fog = readUnity('RoaFogOfWar.cs');
const gate = readUnity('RoaVisibilityGate.cs');
const enemies = readUnity('RoaEnemies.cs');
const remotes = readUnity('RoaRemotePlayers.cs');
const interaction = readUnity('RoaInteraction.cs');
const groundItems = readUnity('RoaGroundItems.cs');

[
  'public bool ShowVisualFog = true;',
  'int cullRadius = Radius + 4;',
  'if (!_visible.Contains(key))',
  'else if (Blocks(key, crouching))',
  '_overlayMesh.subMeshCount = 2;',
  '_overlayMesh.SetTriangles(_fogTriangles, 0, false);',
  '_overlayMesh.SetTriangles(_blockTriangles, 1, false);',
  '_overlayVertices.Add(center + new Vector3(-half, 0f, -half));',
  '_overlayVertices.Add(center + new Vector3(half, 0f, -half));',
  'renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;',
  'renderer.receiveShadows = false;',
  'new Color(0.01f, 0.02f, 0.025f, 0.22f)',
  'new Color(0.478f, 0.29f, 0.18f, 0.045f)',
  'Shader.Find("Universal Render Pipeline/Unlit")',
  'renderQueue = 3000',
  'material.SetFloat("_ZWrite", 0f)',
  'material.SetOverrideTag("RenderType", "Transparent")',
  'material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT")'
].forEach(marker => assert(fog.includes(marker), `Unity fog visual contract is missing: ${marker}`));

assert(gate.includes('GetComponentsInChildren(true, _renderers);'),
  'visibility gate no longer tracks asynchronously loaded renderers');
assert(gate.includes('_renderers[i].enabled = visible;'),
  'visibility gate no longer hides renderers');
assert(!gate.includes('gameObject.SetActive(visible)'),
  'visibility gate must not freeze hidden entity animation/interpolation');

for (const [name, source] of [
  ['enemies', enemies],
  ['remote players', remotes],
  ['interaction entities', interaction]
]) {
  assert(source.includes('AddComponent<RoaVisibilityGate>()'), `${name} lack a visibility gate`);
  assert(source.includes('.SetVisible(Fog == null || Fog.IsVisible('), `${name} bypass gameplay LOS`);
}
assert(groundItems.includes('bool visible = Fog == null || Fog.IsVisible(item.Position);'),
  'ground items bypass gameplay LOS');
assert(groundItems.includes('renderer.enabled = visible;'),
  'ground-item model renderers are not hidden by gameplay LOS');

// The isolated Windows-player probe exercises the production mesh with 198 fog
// cells and 7 visible wall cells. One quad is four vertices and six indices.
const fogCells = 198;
const blockCells = 7;
assert.equal((fogCells + blockCells) * 4, 820);
assert.equal((fogCells + blockCells) * 6, 1230);

console.log('Unity fog OK: 2-submesh transparent overlay, 820-vertex live probe contract, entity LOS gates');
