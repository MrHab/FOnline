const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const coords = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Scripts', 'World', 'RoaCoords.cs'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Scripts', 'World', 'RoaLocationLoader.cs'), 'utf8');

[
  'public static Quaternion AuthoredRotation(float serverXRad, float serverYRad, float serverZRad)',
  'Quaternion.AngleAxis(-serverXRad * Mathf.Rad2Deg, Vector3.right)',
  'Quaternion.AngleAxis(-serverYRad * Mathf.Rad2Deg, Vector3.up)',
  'Quaternion.AngleAxis(serverZRad * Mathf.Rad2Deg, Vector3.forward)'
].forEach(marker => assert(coords.includes(marker), `Unity authored-rotation contract is missing: ${marker}`));
assert(loader.includes('RoaCoords.AuthoredRotation('), 'location loader bypasses the canonical authored rotation');
assert(!loader.includes('target.localRotation = Quaternion.Euler('), 'location loader restored order-dependent Euler conversion');

const multiply = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
});
const axis = (x, y, z, angle) => {
  const half = angle / 2;
  return { x: x * Math.sin(half), y: y * Math.sin(half), z: z * Math.sin(half), w: Math.cos(half) };
};
const xyz = (x, y, z) => multiply(multiply(axis(1, 0, 0, x), axis(0, 1, 0, y)), axis(0, 0, 1, z));
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

const samples = [
  [0.37, 0, 0],
  [0, -0.81, 0],
  [0, 0, 1.13],
  [0.37, -0.81, 1.13],
  [-1.2, 0.44, -0.29]
];
for (const [x, y, z] of samples) {
  const server = xyz(x, y, z);
  // For S=diag(1,1,-1), S*R(q)*S has quaternion (-qx,-qy,+qz,qw).
  const reflected = { x: -server.x, y: -server.y, z: server.z, w: server.w };
  const unity = xyz(-x, -y, z);
  assert(Math.abs(dot(reflected, unity)) > 0.999999999,
    `mirrored Three.js XYZ rotation drifted for ${x},${y},${z}`);
}

let authoredObjects = 0;
let tiltedObjects = 0;
for (const file of fs.readdirSync(path.join(root, 'data', 'locations')).filter(name => name.endsWith('.json'))) {
  const location = JSON.parse(fs.readFileSync(path.join(root, 'data', 'locations', file), 'utf8'));
  for (const row of location.objects || []) {
    authoredObjects++;
    if (Math.abs(Number(row.rotation?.x || 0)) > 1e-9 || Math.abs(Number(row.rotation?.z || 0)) > 1e-9)
      tiltedObjects++;
  }
}

console.log(`Unity coordinates OK: mirrored XYZ quaternion order, 5 synthetic rotations; ${tiltedObjects}/${authoredObjects} authored objects currently tilted`);
