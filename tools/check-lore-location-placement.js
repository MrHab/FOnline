'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const map = read('data/global-map.json');
const seed = read('data/kromka/world-layout.seed.json');
const lore = read('data/kromka/locations.json');
const review = read('docs/art/reviews/global-map-lore-placement-2026-09-13.json');
const nodes = new Map(map.nodes.map(n => [n.id, n]));
const at = id => { assert(nodes.has(id), `Missing authored site ${id}`); return nodes.get(id); };
function inPolygon(p, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [x, y] = vertices[i], [u, v] = vertices[j];
    if ((y > p.y) !== (v > p.y) && p.x < (u - x) * (p.y - y) / (v - y) + x) inside = !inside;
  }
  return inside;
}
function distance(p, points) {
  return Math.min(...points.slice(1).map((b, i) => {
    const a = points[i], dx = b[0]-a[0], dy = b[1]-a[1];
    const t = Math.max(0, Math.min(1, ((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy || 1)));
    return Math.hypot(p.x-a[0]-dx*t, p.y-a[1]-dy*t);
  }));
}
const route = id => { const r = seed.routes.find(r => r.id === id); assert(r, `Missing route ${id}`); return r.points; };
assert(nodes.size >= 39, "existing lore nodes must be preserved");
assert.deepEqual(review.locations.map(r => r.id).sort(), [...nodes.keys()].sort());
assert(new Set(review.locations.map(r => r.id)).size >= 39, "reviewed placements must stay unique");
for (const node of map.nodes) {
  const definition = lore.locations.find(l => l.id === node.id);
  assert(definition, `${node.id}: missing lore`);
  assert.equal(node.macroRegion, definition.macroRegion);
  const region = seed.regions.find(r => r.id === definition.macroRegion);
  if (!region.ring) assert(inPolygon(node, region.unityBoundary), `${node.id}: outside its lore region`);
  const authored = seed.locations.find(p => p.id === node.id);
  assert.deepEqual([node.x,node.y], [authored.x,authored.z], `${node.id}: export drift`);
  assert(review.locations.find(r => r.id === node.id).reason.length > 30, `${node.id}: no reviewed rationale`);
}
for (const r of seed.routes) {
  const exported = map.infrastructure.find(e => e.id === r.id);
  assert(exported, `${r.id}: no server path`);
  assert.deepEqual(exported.points.map(p => [p.x,p.y]), r.points, `${r.id}: server route drift`);
}
assert(at('sluiceCity').y > at('settlement').y && at('settlement').y > at('cascadeRegenerator').y,
  'Cascade must descend north to south');
assert(at('scrapTown').x < at('settlement').x && at('relayStation').x > at('settlement').x);
assert(at('vectorLab').x > at('relayStation').x + 30, 'Vector belongs deeper in the Glasslands than the safe K-3 entrance');
assert(at('relayOutpost').x < at('relayStation').x, 'K-3 perimeter must control the western approach');
assert(distance(at('relayStation'), route('ore_freight_rail')) < 12, 'K-3 safe entry needs freight access');
assert(distance(at('roadOutpost'), route('ore_freight_rail')) < 4, 'Outpost 17 must guard the rail bridge approach');
assert(Math.hypot(at('roadOutpost').x-199,at('roadOutpost').y-217) < 13, 'Outpost 17 drifted from the actual Tesma crossing');
for (const id of ['resourceDryWaterPump','clanFilterT6'])
  assert(distance(at(id),route('cascade_canal')) < 5, `${id}: disconnected from Cascade water infrastructure`);
assert(at('resourceDryWaterPump').y > at('settlement').y && at('clanFilterT6').y < at('settlement').y);
for (const id of ['caravanCamp','resourceTireDepot','clanDepotBypass'])
  assert(distance(at(id),route('tract_main')) < 12, `${id}: disconnected from the Tract`);
assert(distance(at('resourceOilPump'),route('fuel_ramp_access')) < 1, 'Fuel yard entrance disconnected');
for (const id of ['balanceBunker','clanFortZero'])
  assert(distance(at(id),route('zero_admin_access')) < 1, `${id}: southern entrance disconnected`);
for (const id of ['fuel_ramp_access','zero_admin_access']) {
  const p = route(id)[0];
  assert(distance({x:p[0],y:p[1]},route('zero_service_line')) < .01, `${id}: access road has no trunk junction`);
}
assert(Math.hypot(at('resourceScrapFields').x-at('settlement').x,at('resourceScrapFields').y-at('settlement').y)
  < Math.hypot(at('resourceIronMine').x-at('settlement').x,at('resourceIronMine').y-at('settlement').y),
  'Beginner scrap fields must be closer to Keys than the deep ore mine');
console.log('Lore placement PASS: all 39 regions/IDs, river-chain ordering, bridge, water, freight, Tract and southern access.');
