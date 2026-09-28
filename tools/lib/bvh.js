'use strict';
// Разбор BVH (иерархия + кадры) и мировые повороты суставов по кадрам.
// Повороты — кватернионы [x, y, z, w], оси BVH (Y вверх, правосторонние) —
// те же, что у glTF.
const fs = require('fs');

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qinv = q => { const n = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]; return [-q[0] / n, -q[1] / n, -q[2] / n, q[3] / n]; };
const qnorm = q => { const n = Math.hypot(...q) || 1; return q.map(v => v / n); };
const qaxis = (axis, deg) => {
  const h = deg * Math.PI / 360;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};
const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [p[0], p[1], p[2]];
};
const AXIS = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

function parseBvh(file) {
  const text = fs.readFileSync(file, 'utf8');
  const tokens = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  const read = () => tokens[i++];
  function joint(parent) {
    const name = read();
    const node = { name, parent, offset: [0, 0, 0], channels: [], children: [] };
    joints.push(node);
    if (read() !== '{') throw new Error('bvh: { expected after ' + name);
    for (;;) {
      const t = read();
      if (t === 'OFFSET') node.offset = [+read(), +read(), +read()];
      else if (t === 'CHANNELS') { const n = +read(); for (let k = 0; k < n; k++) node.channels.push(read()); }
      else if (t === 'JOINT') node.children.push(joint(node));
      else if (t === 'End') { read(); read(); read(); read(); read(); read(); read(); }
      else if (t === '}') return node;
      else throw new Error('bvh: unexpected token ' + t);
    }
  }
  if (read() !== 'HIERARCHY' || read() !== 'ROOT') throw new Error('bvh: HIERARCHY ROOT expected');
  joint(null);
  while (tokens[i] !== 'MOTION') i++;
  i++;
  read(); const frameCount = +read();
  read(); read(); const frameTime = +read();
  const channelCount = joints.reduce((sum, j) => sum + j.channels.length, 0);
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const row = new Float64Array(channelCount);
    for (let c = 0; c < channelCount; c++) row[c] = +read();
    frames.push(row);
  }
  return { joints, frames, frameTime };
}

/** Мировые повороты и позиции всех суставов в кадре f. */
function pose(bvh, f) {
  const row = bvh.frames[f];
  let c = 0;
  const world = new Map();
  for (const j of bvh.joints) {
    let local = [0, 0, 0, 1];
    let position = j.offset.slice();
    for (const channel of j.channels) {
      const value = row[c++];
      const axis = channel[0];
      if (channel.endsWith('position')) position['XYZ'.indexOf(axis)] = value;
      else local = qmul(local, qaxis(AXIS[axis], value));
    }
    if (!j.parent) world.set(j.name, { r: qnorm(local), p: position });
    else {
      const parent = world.get(j.parent.name);
      const p = qrot(parent.r, j.offset);
      world.set(j.name, { r: qnorm(qmul(parent.r, local)), p: [parent.p[0] + p[0], parent.p[1] + p[1], parent.p[2] + p[2]] });
    }
  }
  return world;
}

module.exports = { parseBvh, pose, qmul, qinv, qnorm, qaxis, qrot };
