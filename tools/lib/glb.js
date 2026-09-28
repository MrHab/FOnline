'use strict';
// Чтение и запись GLB для инструментов импорта клипов.
const fs = require('fs');

function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8').replace(/\0+$/, ''));
  const binAt = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binAt);
  return { json, bin: Buffer.from(buf.slice(binAt + 8, binAt + 8 + binLen)) };
}

// Замена клипа оставляет его прежние кадры в буфере: перед записью в файле
// остаются только accessor и bufferView, на которые кто-то ссылается, иначе
// каждый прогон импорта раздувал бы GLB.
// Порядок данных — порядок обхода (сетки, скины, клипы), а не порядок создания:
// повторный прогон импорта даёт те же байты.
function compactGlb(json, bin) {
  // Сэмплеры, на которые не ссылается ни один канал (правка клипа заменила их).
  for (const animation of json.animations || []) {
    const keep = [...new Set(animation.channels.map(channel => channel.sampler))];
    const map = new Map(keep.map((index, at) => [index, at]));
    animation.samplers = keep.map(index => animation.samplers[index]);
    animation.channels.forEach(channel => { channel.sampler = map.get(channel.sampler); });
  }
  const usedAccessors = new Set();
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives) {
      Object.values(primitive.attributes).forEach(index => usedAccessors.add(index));
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const target of primitive.targets || []) Object.values(target).forEach(index => usedAccessors.add(index));
    }
  }
  for (const skin of json.skins || []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of json.animations || []) {
    for (const sampler of animation.samplers) { usedAccessors.add(sampler.input); usedAccessors.add(sampler.output); }
  }
  const accessorMap = new Map();
  const accessors = [];
  for (const index of usedAccessors) {
    accessorMap.set(index, accessors.length);
    accessors.push(json.accessors[index]);
  }
  const usedViews = new Set(accessors.map(accessor => accessor.bufferView));
  for (const image of json.images || []) if (image.bufferView !== undefined) usedViews.add(image.bufferView);
  const viewMap = new Map();
  const views = [];
  const parts = [];
  let offset = 0;
  for (const index of usedViews) {
    const view = json.bufferViews[index];
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad, 0)); offset += pad; }
    parts.push(bin.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    viewMap.set(index, views.length);
    views.push({ ...view, byteOffset: offset });
    offset += view.byteLength;
  }
  const remap = index => accessorMap.get(index);
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives) {
      for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = remap(primitive.attributes[key]);
      if (primitive.indices !== undefined) primitive.indices = remap(primitive.indices);
      for (const target of primitive.targets || []) for (const key of Object.keys(target)) target[key] = remap(target[key]);
    }
  }
  for (const skin of json.skins || []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
  for (const animation of json.animations || []) {
    for (const sampler of animation.samplers) { sampler.input = remap(sampler.input); sampler.output = remap(sampler.output); }
  }
  accessors.forEach(accessor => { accessor.bufferView = viewMap.get(accessor.bufferView); });
  for (const image of json.images || []) if (image.bufferView !== undefined) image.bufferView = viewMap.get(image.bufferView);
  json.accessors = accessors;
  json.bufferViews = views;
  const compact = Buffer.concat(parts);
  json.buffers[0].byteLength = compact.length;
  return compact;
}

function writeGlb(file, json, bin) {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const textPad = (4 - (text.length % 4)) % 4;
  if (textPad) text = Buffer.concat([text, Buffer.alloc(textPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const body = binPad ? Buffer.concat([bin, Buffer.alloc(binPad, 0)]) : bin;
  const total = 12 + 8 + text.length + 8 + body.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(text.length, 12);
  out.writeUInt32LE(0x4E4F534A, 16);
  text.copy(out, 20);
  out.writeUInt32LE(body.length, 20 + text.length);
  out.writeUInt32LE(0x004E4942, 24 + text.length);
  body.copy(out, 28 + text.length);
  fs.writeFileSync(file, out);
}

const WIDTH = { SCALAR: 1, VEC3: 3, VEC4: 4 };

function readAccessor({ json, bin }, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126) throw new Error(`accessor ${index}: only float data is supported`);
  const width = WIDTH[accessor.type];
  const stride = view.byteStride || width * 4;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const rows = [];
  for (let i = 0; i < accessor.count; i++) {
    const row = [];
    for (let k = 0; k < width; k++) row.push(bin.readFloatLE(start + i * stride + k * 4));
    rows.push(row);
  }
  return rows;
}

module.exports = { parseGlb, compactGlb, writeGlb, readAccessor };
