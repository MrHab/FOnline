const fs = require('fs');
const path = require('path');

let unitBeveledBoxGeometry = null;

global.window = {
  FileReader: class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = buffer;
        if (this.onloadend) this.onloadend({ target: this });
      }).catch(error => {
        if (this.onerror) this.onerror(error);
      });
    }
  }
};

async function main() {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const outDir = path.join(__dirname, '..', 'public', 'assets', 'models', 'wasteland');
  fs.mkdirSync(outDir, { recursive: true });

  const mat = {
    shadow: material(THREE, 'baked_soft_contact_shadow', 0x050403, { roughness: 1, transparent: true, opacity: 0.34, metalness: 0 }),
    rust: material(THREE, 'oxidized_rust_metal', 0x8a4a27, { roughness: 0.93, metalness: 0.38 }),
    rustDark: material(THREE, 'blackened_scrap_metal', 0x25231f, { roughness: 0.96, metalness: 0.55 }),
    rustLight: material(THREE, 'worn_scraped_metal', 0xb38957, { roughness: 0.86, metalness: 0.46 }),
    rubber: material(THREE, 'old_cracked_rubber', 0x171411, { roughness: 0.98, metalness: 0.02 }),
    glass: material(THREE, 'dirty_dark_glass', 0x263233, { roughness: 0.45, metalness: 0, transparent: true, opacity: 0.64 }),
    wood: material(THREE, 'dead_dry_wood', 0x725034, { roughness: 0.98, metalness: 0 }),
    bone: material(THREE, 'sun_bleached_bone', 0xc4b583, { roughness: 0.94, metalness: 0 }),
    concrete: material(THREE, 'cracked_sun_baked_concrete', 0x89806d, { roughness: 0.99, metalness: 0 }),
    dust: material(THREE, 'powdery_wasteland_dust', 0xb49362, { roughness: 1, metalness: 0 }),
    fadedPaint: material(THREE, 'faded_prewar_paint', 0x315f58, { roughness: 0.92, metalness: 0.12 }),
    yellow: material(THREE, 'faded_warning_yellow', 0xc49a35, { roughness: 0.9, metalness: 0.12 }),
    red: material(THREE, 'dull_emergency_red', 0x7f2d22, { roughness: 0.93, metalness: 0.14 }),
    cloth: material(THREE, 'torn_sun_baked_canvas', 0x876c49, { roughness: 1, metalness: 0 })
  };

  const models = {
    'rust_barrel_v1.glb': () => rustBarrel(THREE, mat),
    'barrel_cluster.glb': () => barrelCluster(THREE, mat),
    'car_wreck.glb': () => carWreck(THREE, mat),
    'dead_tree_a.glb': () => deadTree(THREE, mat, 1),
    'dead_tree_b.glb': () => deadTree(THREE, mat, 2),
    'dead_tree_c.glb': () => deadTree(THREE, mat, 3),
    'deadwood.glb': () => deadwood(THREE, mat),
    'tire_stack.glb': () => tireStack(THREE, mat),
    'scrap_heap.glb': () => scrapHeap(THREE, mat),
    'concrete_wall.glb': () => concreteWall(THREE, mat),
    'low_ruined_wall.glb': () => lowRuinedWall(THREE, mat),
    'wasteland_shack.glb': () => wastelandShack(THREE, mat),
    'cactus.glb': () => cactus(THREE, mat),
    'rubble_rock.glb': () => rubbleRock(THREE, mat),
    'ore_outcrop.glb': () => oreOutcrop(THREE, mat),
    'oil_pump_jack.glb': () => oilPumpJack(THREE, mat),
    'highway_sign.glb': () => highwaySign(THREE, mat),
    'ruined_billboard.glb': () => ruinedBillboard(THREE, mat),
    'utility_pole.glb': () => utilityPole(THREE, mat),
    'roadblock_barricade.glb': () => roadblockBarricade(THREE, mat),
    'dry_bush.glb': () => dryBush(THREE, mat),
    'asphalt_slab.glb': () => asphaltSlab(THREE, mat),
    'trade_machine.glb': () => tradeMachine(THREE, mat),
    'cot_bed.glb': () => cotBed(THREE, mat),
    'craft_station_ammo.glb': () => craftStationAmmo(THREE, mat),
    'craft_station_weapon.glb': () => craftStationWeapon(THREE, mat),
    'craft_station_tools.glb': () => craftStationTools(THREE, mat),
    'craft_station_repair.glb': () => craftStationRepair(THREE, mat),
    'craft_station_energy.glb': () => craftStationEnergy(THREE, mat),
    'craft_station_chem.glb': () => craftStationChem(THREE, mat)
  };

  const requested = process.argv.slice(2).filter(Boolean);
  const entries = requested.length
    ? Object.entries(models).filter(([file]) => requested.includes(file) || requested.includes(file.replace(/\.glb$/, '')))
    : Object.entries(models);
  if (requested.length && !entries.length) throw new Error(`No matching model found for: ${requested.join(', ')}`);

  for (const [file, factory] of entries) {
    const root = factory();
    root.name = file.replace(/\.glb$/, '');
    if (!file.startsWith('craft_station_')) addMicroSetDressing(THREE, root, mat, file);
    await exportGlb(THREE, GLTFExporter, root, path.join(outDir, file));
  }
}

function material(THREE, name, color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0.0,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0
  });
  m.name = name;
  if (opts.transparent) m.depthWrite = false;
  return m;
}

function mesh(THREE, parent, geometry, material, name, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.name = name;
  item.position.set(pos[0], pos[1], pos[2]);
  item.scale.set(scale[0], scale[1], scale[2]);
  item.rotation.set(rot[0], rot[1], rot[2]);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function beveledUnitBoxGeometry(THREE) {
  if (unitBeveledBoxGeometry) return unitBeveledBoxGeometry;
  const inset = 0.465;
  const depth = 0.93;
  const bevel = 0.035;
  const shape = new THREE.Shape();
  shape.moveTo(-inset, -inset);
  shape.lineTo(inset, -inset);
  shape.lineTo(inset, inset);
  shape.lineTo(-inset, inset);
  shape.closePath();
  unitBeveledBoxGeometry = new THREE.ExtrudeBufferGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1
  });
  unitBeveledBoxGeometry.translate(0, 0, -depth * 0.5);
  unitBeveledBoxGeometry.computeVertexNormals();
  unitBeveledBoxGeometry.computeBoundingSphere();
  unitBeveledBoxGeometry.name = 'unit_beveled_hard_surface_box_v776';
  return unitBeveledBoxGeometry;
}

function box(THREE, parent, material, name, pos, scale, rot = [0, 0, 0]) {
  return mesh(THREE, parent, beveledUnitBoxGeometry(THREE), material, name, pos, scale, rot);
}

function cyl(THREE, parent, material, name, radiusTop, radiusBottom, height, segments, pos, rot = [0, 0, 0], scale = [1, 1, 1]) {
  return mesh(THREE, parent, new THREE.CylinderBufferGeometry(radiusTop, radiusBottom, height, Math.max(12, Number(segments || 12))), material, name, pos, scale, rot);
}

function torus(THREE, parent, material, name, radius, tube, pos, rot = [Math.PI / 2, 0, 0], scale = [1, 1, 1]) {
  return mesh(THREE, parent, new THREE.TorusBufferGeometry(radius, tube, 12, 32), material, name, pos, scale, rot);
}

function profile(THREE, parent, material, name, commands, depth, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const shape = new THREE.Shape();
  commands.forEach(cmd => {
    if (cmd[0] === 'M') shape.moveTo(cmd[1], cmd[2]);
    else if (cmd[0] === 'L') shape.lineTo(cmd[1], cmd[2]);
    else if (cmd[0] === 'Q') shape.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
    else if (cmd[0] === 'C') shape.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
  });
  const geometry = new THREE.ExtrudeBufferGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.016,
    bevelSize: 0.018,
    bevelSegments: 2
  });
  geometry.translate(0, 0, -depth / 2);
  return mesh(THREE, parent, geometry, material, name, pos, [1, 1, 1], rot);
}

function sphere(THREE, parent, material, name, radiusOrPos, posOrScale, scale = [1, 1, 1]) {
  const legacyPosSignature = Array.isArray(radiusOrPos);
  const radius = legacyPosSignature ? 0.5 : Math.max(0.01, Number(radiusOrPos) || 0.5);
  const pos = legacyPosSignature ? radiusOrPos : (Array.isArray(posOrScale) ? posOrScale : [0, 0, 0]);
  const finalScale = legacyPosSignature ? (Array.isArray(posOrScale) ? posOrScale : [1, 1, 1]) : scale;
  return mesh(THREE, parent, new THREE.SphereBufferGeometry(radius, 20, 14), material, name, pos, finalScale);
}

function branch(THREE, parent, material, name, from, to, radius = 0.045, segments = 7) {
  const a = new THREE.Vector3(from[0], from[1], from[2]);
  const b = new THREE.Vector3(to[0], to[1], to[2]);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const item = new THREE.Mesh(new THREE.CylinderBufferGeometry(radius * 0.68, radius, len, Math.max(9, Number(segments || 9))), material);
  item.name = name;
  item.position.copy(mid);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function contactShadow(THREE, parent, mat, rx = 1, rz = 0.62, opacity = 0.3) {
  const shadow = mesh(THREE, parent, new THREE.CircleBufferGeometry(1, 32), mat.shadow, 'painted_contact_shadow', [0, 0.012, 0], [rx, rz, 1], [-Math.PI / 2, 0, 0]);
  shadow.material = mat.shadow.clone();
  shadow.material.name = 'baked_soft_contact_shadow';
  shadow.material.opacity = opacity;
  shadow.castShadow = false;
  shadow.receiveShadow = true;
  return shadow;
}

function seededNoise(seed, index) {
  const x = Math.sin(seed * 97.13 + index * 37.71) * 43758.5453;
  return x - Math.floor(x);
}

function addMicroSetDressing(THREE, root, mat, file = '') {
  const seed = Array.from(file).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const heavy = /car|shack|wall|barricade|billboard|scrap|ore|tire/i.test(file);
  const radius = /car|shack|billboard/i.test(file) ? 1.55 : (/tree|utility/i.test(file) ? 0.86 : 1.05);
  const count = heavy ? 8 : 5;
  for (let i = 0; i < count; i++) {
    const a = seededNoise(seed, i) * Math.PI * 2;
    const r = radius * (0.38 + seededNoise(seed + 11, i) * 0.62);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const rot = [0.02 * (seededNoise(seed + 17, i) - 0.5), seededNoise(seed + 23, i) * Math.PI, 0.02 * (seededNoise(seed + 29, i) - 0.5)];
    const pick = seededNoise(seed + 31, i);
    if (pick < 0.36) {
      const s = 0.05 + seededNoise(seed + 37, i) * 0.07;
      sphere(THREE, root, i % 2 ? mat.dust : mat.concrete, `ground_pebble_detail_${i}`, [x, 0.035 + s * 0.28, z], [s * 1.35, s * 0.55, s]);
    } else if (pick < 0.72) {
      box(THREE, root, i % 2 ? mat.rustDark : mat.rust, `loose_scrap_flake_${i}`, [x, 0.045, z], [0.18 + seededNoise(seed + 41, i) * 0.16, 0.018, 0.05 + seededNoise(seed + 43, i) * 0.08], rot);
    } else {
      cyl(THREE, root, mat.rustLight, `discarded_bolt_detail_${i}`, 0.025, 0.025, 0.08 + seededNoise(seed + 47, i) * 0.08, 7, [x, 0.05, z], [Math.PI / 2, 0, seededNoise(seed + 53, i) * Math.PI]);
    }
  }

  if (/barrel|car|scrap|asphalt/i.test(file)) {
    const oil = material(THREE, `dark_oil_stain_${file.replace(/\W+/g, '_')}`, 0x100d0a, { roughness: 1, metalness: 0, transparent: true, opacity: 0.42 });
    mesh(THREE, root, new THREE.CircleBufferGeometry(0.34, 28), oil, 'irregular_oil_stain_ground_detail', [0.22, 0.018, -0.26], [1.25, 0.58, 1], [-Math.PI / 2, 0, 0.18]);
  }
}

function addBarrelParts(THREE, group, mat, prefix = 'barrel') {
  cyl(THREE, group, mat.rust, `${prefix}_dented_body`, 0.33, 0.36, 1.08, 20, [0, 0.56, 0]);
  cyl(THREE, group, mat.rustDark, `${prefix}_dark_lid_top`, 0.34, 0.32, 0.045, 20, [0, 1.13, 0]);
  cyl(THREE, group, mat.rustDark, `${prefix}_dark_lid_bottom`, 0.32, 0.34, 0.045, 20, [0, 0.01, 0]);
  [0.22, 0.57, 0.91].forEach((y, i) => torus(THREE, group, mat.rustLight, `${prefix}_raised_rib_${i}`, 0.35, 0.025, [0, y, 0]));
  box(THREE, group, mat.rustLight, `${prefix}_scraped_label_plate`, [0.0, 0.58, -0.352], [0.34, 0.22, 0.018], [0.02, 0, 0]);
  box(THREE, group, mat.rustDark, `${prefix}_oil_stain`, [-0.22, 0.33, -0.35], [0.12, 0.32, 0.016], [-0.08, 0, 0.06]);
}

function rustBarrel(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.56, 0.45, 0.28);
  addBarrelParts(THREE, g, mat, 'single_barrel');
  return g;
}

function barrelInstance(THREE, mat, pos, rot = [0, 0, 0], scale = 1) {
  const g = new THREE.Group();
  addBarrelParts(THREE, g, mat, 'cluster_barrel');
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  g.scale.setScalar(scale);
  return g;
}

function barrelCluster(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.25, 0.86, 0.34);
  g.add(barrelInstance(THREE, mat, [-0.42, 0, -0.18], [0, -0.18, 0], 0.94));
  g.add(barrelInstance(THREE, mat, [0.28, 0, 0.08], [0, 0.34, 0], 1.02));
  g.add(barrelInstance(THREE, mat, [0.68, 0.32, -0.34], [0, 0.1, Math.PI / 2], 0.88));
  box(THREE, g, mat.rustDark, 'loose_flat_scrap', [-0.25, 0.08, 0.63], [0.9, 0.045, 0.24], [0.03, 0.52, -0.02]);
  cyl(THREE, g, mat.rustLight, 'loose_pipe', 0.045, 0.045, 1.15, 9, [0.22, 0.16, 0.58], [Math.PI / 2, 0.28, 0]);
  return g;
}

function wheel(THREE, parent, mat, x, z, name) {
  const outward = z < 0 ? -1 : 1;
  const wheelY = 0.395;
  torus(THREE, parent, mat.rubber, `${name}_chunky_offroad_tire`, 0.305, 0.086, [x, wheelY, z], [0, 0, 0], [1.02, 1.0, 1.0]);
  cyl(THREE, parent, mat.rustLight, `${name}_plain_rusty_rim`, 0.132, 0.132, 0.076, 16, [x, wheelY, z + outward * 0.014], [Math.PI / 2, 0, 0]);
  cyl(THREE, parent, mat.rustDark, `${name}_dark_hub`, 0.058, 0.058, 0.088, 14, [x, wheelY, z + outward * 0.023], [Math.PI / 2, 0, 0]);
  box(THREE, parent, mat.rustLight, `${name}_rim_spoke_vertical`, [x, wheelY, z + outward * 0.030], [0.030, 0.235, 0.018]);
  box(THREE, parent, mat.rustLight, `${name}_rim_spoke_horizontal`, [x, wheelY, z + outward * 0.030], [0.235, 0.030, 0.018]);
}

function carWreck(THREE, mat) {
  const g = new THREE.Group();
  const armor = material(THREE, 'welded_matte_black_armor', 0x171615, { roughness: 0.94, metalness: 0.34 });
  const bareSteel = material(THREE, 'scraped_bare_wasteland_steel', 0x706755, { roughness: 0.76, metalness: 0.58 });
  const deadPaint = material(THREE, 'dusty_dead_muscle_car_paint', 0x2c3f37, { roughness: 0.98, metalness: 0.08 });

  contactShadow(THREE, g, mat, 2.42, 1.08, 0.42);

  profile(THREE, g, deadPaint, 'stripped_muscle_car_shell', [
    ['M', -2.22, 0.32],
    ['Q', -2.06, 0.56, -1.76, 0.62],
    ['L', -0.92, 0.78],
    ['Q', -0.42, 0.82, 0.08, 0.78],
    ['L', 1.52, 0.70],
    ['Q', 1.84, 0.62, 2.08, 0.44],
    ['L', 2.12, 0.34],
    ['L', 1.48, 0.31],
    ['Q', 1.16, 0.24, 0.86, 0.33],
    ['L', -0.96, 0.33],
    ['Q', -1.24, 0.24, -1.55, 0.33],
    ['L', -2.22, 0.32]
  ], 1.26, [0, 0, 0]);

  box(THREE, g, mat.rustDark, 'open_dark_underbody', [0, 0.25, 0], [3.52, 0.16, 1.05], [0.01, 0, -0.01]);
  box(THREE, g, armor, 'welded_left_door_armor_plate', [-0.22, 0.62, -0.68], [0.94, 0.36, 0.055], [0.03, 0.0, -0.08]);
  box(THREE, g, armor, 'welded_right_door_armor_plate', [-0.18, 0.62, 0.68], [0.92, 0.36, 0.055], [0.02, 0.0, 0.05]);
  box(THREE, g, armor, 'rear_quarter_left_armor', [1.08, 0.62, -0.69], [0.70, 0.34, 0.055], [-0.02, 0.0, 0.06]);
  box(THREE, g, armor, 'rear_quarter_right_armor', [1.08, 0.62, 0.69], [0.70, 0.34, 0.055], [-0.02, 0.0, -0.06]);
  box(THREE, g, mat.rust, 'rusted_left_front_fender', [-1.38, 0.58, -0.68], [0.58, 0.28, 0.060], [0.04, 0.0, 0.08]);
  box(THREE, g, mat.rust, 'rusted_right_front_fender', [-1.38, 0.58, 0.68], [0.58, 0.28, 0.060], [0.04, 0.0, -0.08]);

  box(THREE, g, armor, 'cut_down_hood_left_plate', [-1.18, 0.84, -0.25], [0.92, 0.070, 0.46], [-0.10, 0.01, 0.05]);
  box(THREE, g, armor, 'cut_down_hood_right_plate', [-1.16, 0.82, 0.25], [0.86, 0.070, 0.44], [-0.04, -0.02, -0.03]);
  box(THREE, g, mat.rustDark, 'exposed_engine_bay_shadow', [-1.50, 0.79, 0], [0.44, 0.16, 0.74], [-0.08, 0, 0.03]);
  box(THREE, g, bareSteel, 'exposed_engine_block', [-1.48, 0.92, 0], [0.34, 0.25, 0.40], [-0.04, 0.0, 0.02]);
  cyl(THREE, g, mat.rustLight, 'left_engine_cylinder_bank', 0.050, 0.050, 0.38, 10, [-1.49, 1.08, -0.18], [0, 0, Math.PI / 2]);
  cyl(THREE, g, mat.rustLight, 'right_engine_cylinder_bank', 0.050, 0.050, 0.38, 10, [-1.49, 1.08, 0.18], [0, 0, Math.PI / 2]);
  box(THREE, g, mat.rustDark, 'low_air_intake_scoop', [-1.38, 1.18, 0], [0.32, 0.12, 0.38], [-0.04, 0, 0.02]);

  const cage = [
    [[-0.62, 0.82, -0.48], [-0.40, 1.34, -0.46], 'left_front_roll_bar'],
    [[-0.62, 0.82, 0.48], [-0.40, 1.34, 0.46], 'right_front_roll_bar'],
    [[0.64, 0.82, -0.46], [0.48, 1.30, -0.44], 'left_rear_roll_bar'],
    [[0.64, 0.82, 0.46], [0.48, 1.30, 0.44], 'right_rear_roll_bar'],
    [[-0.40, 1.34, -0.46], [0.48, 1.30, -0.44], 'left_roof_roll_rail'],
    [[-0.40, 1.34, 0.46], [0.48, 1.30, 0.44], 'right_roof_roll_rail'],
    [[-0.40, 1.34, -0.46], [-0.40, 1.34, 0.46], 'front_top_crossbar'],
    [[0.48, 1.30, -0.44], [0.48, 1.30, 0.44], 'rear_top_crossbar']
  ];
  cage.forEach(([from, to, name]) => branch(THREE, g, mat.rustDark, name, from, to, 0.026, 8));
  branch(THREE, g, mat.rustDark, 'empty_windshield_lower_bar', [-0.72, 0.90, -0.50], [-0.72, 0.90, 0.50], 0.022, 8);
  branch(THREE, g, mat.rustDark, 'empty_windshield_top_bar', [-0.40, 1.25, -0.46], [-0.40, 1.25, 0.46], 0.022, 8);
  branch(THREE, g, mat.rustDark, 'open_window_left_lower_rail', [-0.56, 0.88, -0.62], [0.70, 0.86, -0.62], 0.020, 8);
  branch(THREE, g, mat.rustDark, 'open_window_right_lower_rail', [-0.56, 0.88, 0.62], [0.70, 0.86, 0.62], 0.020, 8);

  box(THREE, g, mat.rustDark, 'dark_empty_cabin', [0.12, 0.75, 0], [1.08, 0.20, 0.70], [0.02, 0.0, 0.0]);
  box(THREE, g, mat.rustDark, 'bare_front_seat', [-0.12, 0.80, -0.08], [0.38, 0.18, 0.42], [0.04, 0.0, -0.08]);
  box(THREE, g, mat.rustDark, 'bare_rear_seat', [0.56, 0.77, 0.02], [0.44, 0.16, 0.46], [0.00, 0.0, 0.02]);
  torus(THREE, g, bareSteel, 'bent_steering_wheel', 0.105, 0.012, [-0.46, 0.90, -0.30], [0.30, 0.44, 0.10], [1, 1, 1]);
  branch(THREE, g, bareSteel, 'steering_column', [-0.45, 0.87, -0.25], [-0.58, 0.74, -0.06], 0.018, 7);

  box(THREE, g, mat.rustDark, 'heavy_front_ram_bumper', [-2.24, 0.43, 0], [0.16, 0.18, 1.34], [0.0, 0.02, 0.0]);
  box(THREE, g, mat.rustDark, 'upper_grille_guard', [-2.10, 0.66, 0], [0.08, 0.34, 1.08]);
  for (let i = -2; i <= 2; i++) {
    branch(THREE, g, bareSteel, `vertical_grille_guard_${i + 2}`, [-2.16, 0.48, i * 0.19], [-2.12, 0.82, i * 0.19], 0.018, 6);
  }
  box(THREE, g, mat.rustDark, 'simple_rear_bumper', [2.04, 0.39, 0], [0.13, 0.13, 1.14], [0.0, -0.02, 0.0]);
  cyl(THREE, g, mat.yellow, 'left_recessed_headlamp', 0.068, 0.068, 0.040, 14, [-2.18, 0.68, -0.34], [0, 0, Math.PI / 2]);
  cyl(THREE, g, mat.yellow, 'right_recessed_headlamp', 0.068, 0.068, 0.040, 14, [-2.18, 0.68, 0.34], [0, 0, Math.PI / 2]);
  cyl(THREE, g, mat.red, 'left_small_tail_light', 0.046, 0.046, 0.036, 12, [2.08, 0.60, -0.34], [0, 0, Math.PI / 2]);
  cyl(THREE, g, mat.red, 'right_small_tail_light', 0.046, 0.046, 0.036, 12, [2.08, 0.60, 0.34], [0, 0, Math.PI / 2]);

  [[-1.34, -0.70], [-1.34, 0.70], [1.18, -0.70], [1.18, 0.70]].forEach(([x, z], i) => {
    wheel(THREE, g, mat, x, z, `offroad_wheel_${i}`);
    torus(THREE, g, mat.rustDark, `cut_wheel_arch_${i}`, 0.376, 0.026, [x, 0.36, z + (z < 0 ? -0.018 : 0.018)], [0, 0, 0], [1.10, 0.84, 1.0]);
  });
  cyl(THREE, g, bareSteel, 'front_visible_axle', 0.026, 0.026, 1.56, 8, [-1.34, 0.395, 0], [Math.PI / 2, 0, 0]);
  cyl(THREE, g, bareSteel, 'rear_visible_axle', 0.026, 0.026, 1.56, 8, [1.18, 0.395, 0], [Math.PI / 2, 0, 0]);
  cyl(THREE, g, mat.rustDark, 'left_side_exhaust_pipe', 0.034, 0.034, 1.55, 8, [-0.30, 0.36, -0.76], [Math.PI / 2, 0.20, 0]);
  cyl(THREE, g, mat.rustDark, 'right_side_exhaust_pipe', 0.034, 0.034, 1.55, 8, [-0.30, 0.36, 0.76], [Math.PI / 2, -0.20, 0]);
  box(THREE, g, mat.rust, 'left_side_rust_patch', [0.48, 0.50, -0.72], [0.42, 0.18, 0.035], [0.04, 0.0, -0.06]);
  box(THREE, g, mat.rust, 'right_side_rust_patch', [0.72, 0.50, 0.72], [0.42, 0.18, 0.035], [0.04, 0.0, 0.06]);
  box(THREE, g, bareSteel, 'rear_fuel_tank_strap_left', [1.62, 0.74, -0.30], [0.40, 0.055, 0.040], [0.0, 0.0, 0.0]);
  box(THREE, g, bareSteel, 'rear_fuel_tank_strap_right', [1.62, 0.74, 0.30], [0.40, 0.055, 0.040], [0.0, 0.0, 0.0]);
  cyl(THREE, g, mat.rustDark, 'rear_external_fuel_tank', 0.18, 0.18, 0.72, 16, [1.72, 0.72, 0], [Math.PI / 2, 0, 0]);
  return g;
}

function deadTree(THREE, mat, variant) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.92, 0.72, 0.24);
  const lean = variant === 2 ? -0.28 : (variant === 3 ? 0.18 : 0.08);
  branch(THREE, g, mat.wood, 'twisted_main_trunk_lower', [0, 0.02, 0], [lean * 0.45, 1.05, 0.05], 0.13, 9);
  branch(THREE, g, mat.wood, 'twisted_main_trunk_upper', [lean * 0.45, 1.0, 0.05], [lean, 2.05, variant === 3 ? 0.18 : -0.08], 0.09, 8);
  const top = [lean, 1.85, variant === 3 ? 0.18 : -0.08];
  const branches = variant === 1
    ? [[[-0.12, 1.0, 0.02], [-0.82, 1.45, -0.18], 0.055], [[0.08, 1.28, 0.02], [0.82, 1.68, 0.22], 0.052], [top, [-0.25, 2.42, 0.03], 0.04], [top, [0.38, 2.34, -0.38], 0.035]]
    : variant === 2
      ? [[[-0.10, 0.86, 0.02], [-0.9, 1.04, 0.34], 0.06], [[-0.24, 1.38, 0.03], [-1.02, 1.86, -0.28], 0.042], [[-0.28, 1.58, 0.0], [0.46, 2.12, 0.2], 0.04]]
      : [[[0.05, 0.9, 0.02], [0.78, 1.2, -0.18], 0.06], [[0.05, 1.28, 0.02], [-0.66, 1.82, 0.22], 0.045], [[0.14, 1.62, 0.05], [0.92, 2.08, 0.34], 0.04], [[0.22, 1.82, 0.1], [-0.28, 2.46, -0.20], 0.035]];
  branches.forEach((row, i) => branch(THREE, g, mat.wood, `bleached_branch_${i}`, row[0], row[1], row[2], 7));
  [[-0.18, -0.26], [0.22, -0.16], [-0.04, 0.30]].forEach(([x, z], i) => branch(THREE, g, mat.wood, `surface_root_${i}`, [0, 0.08, 0], [x, 0.05, z], 0.055, 7));
  if (variant !== 2) sphere(THREE, g, mat.bone, 'pale_broken_knot', [lean * 0.48, 1.18, 0.07], [1.1, 0.62, 0.85]);
  return g;
}

function deadwood(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.0, 0.5, 0.22);
  branch(THREE, g, mat.wood, 'fallen_trunk', [-0.72, 0.18, -0.08], [0.78, 0.22, 0.14], 0.115, 9);
  branch(THREE, g, mat.wood, 'broken_side_branch_a', [-0.22, 0.22, 0.0], [-0.62, 0.45, 0.48], 0.045, 7);
  branch(THREE, g, mat.wood, 'broken_side_branch_b', [0.18, 0.22, 0.04], [0.48, 0.44, -0.44], 0.04, 7);
  box(THREE, g, mat.bone, 'fresh_cut_light_side', [0.82, 0.22, 0.15], [0.12, 0.24, 0.18], [0.02, 0.2, 0]);
  return g;
}

function tireStack(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.92, 0.72, 0.28);
  for (let i = 0; i < 5; i++) {
    torus(THREE, g, mat.rubber, `stacked_cracked_tire_${i}`, 0.35, 0.075, [0, 0.15 + i * 0.13, 0], [Math.PI / 2, 0, 0], [1.04 + (i % 2) * 0.05, 1, 0.94]);
  }
  torus(THREE, g, mat.rubber, 'leaning_loose_tire', 0.35, 0.075, [0.58, 0.59, -0.10], [0.22, 0.0, 1.05], [1, 1, 0.95]);
  cyl(THREE, g, mat.rustLight, 'discarded_rim', 0.16, 0.16, 0.08, 14, [-0.48, 0.12, 0.24], [Math.PI / 2, 0, 0]);
  return g;
}

function scrapHeap(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.38, 0.85, 0.32);
  const pieces = [
    ['bent_door_skin', mat.rust, [-0.42, 0.16, 0.02], [1.16, 0.06, 0.52], [0.14, 0.44, -0.08]],
    ['black_frame_rail', mat.rustDark, [0.18, 0.30, -0.10], [1.42, 0.08, 0.12], [0.0, -0.38, 0.22]],
    ['faded_green_panel', mat.fadedPaint, [0.40, 0.22, 0.36], [0.74, 0.045, 0.48], [-0.12, -0.12, 0.18]],
    ['broken_light_plate', mat.rustLight, [-0.02, 0.48, -0.38], [0.92, 0.05, 0.22], [0.2, 0.72, -0.22]],
    ['heavy_scrap_block', mat.rustDark, [-0.56, 0.28, -0.34], [0.38, 0.32, 0.28], [0.02, -0.2, 0.03]]
  ];
  pieces.forEach(p => box(THREE, g, p[1], p[0], p[2], p[3], p[4]));
  cyl(THREE, g, mat.rustLight, 'pipe_bundle_a', 0.045, 0.045, 1.2, 8, [0.42, 0.18, -0.46], [Math.PI / 2, 0.34, 0]);
  cyl(THREE, g, mat.rust, 'pipe_bundle_b', 0.052, 0.052, 0.95, 8, [-0.15, 0.23, 0.48], [Math.PI / 2, -0.65, 0]);
  torus(THREE, g, mat.rubber, 'half_buried_tire', 0.29, 0.06, [-0.82, 0.44, 0.18], [0.52, 0.0, 1.1], [1, 1, 0.86]);
  return g;
}

function concreteWall(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.35, 0.36, 0.24);
  box(THREE, g, mat.concrete, 'main_cracked_wall_slab', [0, 0.52, 0], [1.92, 0.92, 0.22], [0.0, 0.02, 0.0]);
  box(THREE, g, mat.concrete, 'missing_corner_chunk', [0.72, 1.05, 0.02], [0.48, 0.26, 0.24], [0, 0, -0.18]);
  box(THREE, g, mat.dust, 'fallen_concrete_chunk_a', [-0.82, 0.10, 0.28], [0.38, 0.16, 0.30], [0.08, -0.3, 0.08]);
  box(THREE, g, mat.dust, 'fallen_concrete_chunk_b', [0.62, 0.09, -0.26], [0.46, 0.13, 0.24], [-0.08, 0.24, -0.04]);
  [-0.42, 0.02, 0.46].forEach((x, i) => branch(THREE, g, mat.rustDark, `exposed_rebar_${i}`, [x, 0.92, 0.13], [x + 0.10, 1.38, 0.14], 0.018, 6));
  return g;
}

function lowRuinedWall(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.28, 0.34, 0.22);
  box(THREE, g, mat.concrete, 'broken_low_wall_left', [-0.44, 0.32, 0], [0.86, 0.56, 0.24], [0.0, 0.04, 0.0]);
  box(THREE, g, mat.concrete, 'broken_low_wall_right', [0.52, 0.25, 0.02], [0.66, 0.42, 0.22], [0.0, -0.05, 0.0]);
  box(THREE, g, mat.dust, 'rubble_base', [0.04, 0.08, 0.22], [1.72, 0.14, 0.34], [0.03, 0.02, 0.01]);
  branch(THREE, g, mat.rustDark, 'low_wall_rebar_a', [-0.62, 0.62, 0.13], [-0.28, 0.95, 0.15], 0.016, 6);
  branch(THREE, g, mat.rustDark, 'low_wall_rebar_b', [0.46, 0.45, 0.13], [0.82, 0.72, 0.15], 0.016, 6);
  return g;
}

function wastelandShack(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.45, 1.12, 0.34);
  box(THREE, g, mat.wood, 'rear_timber_wall', [0, 0.82, 0.58], [1.9, 1.42, 0.12], [0, 0.05, 0]);
  box(THREE, g, mat.rust, 'left_corrugated_wall', [-0.98, 0.76, 0], [0.12, 1.28, 1.16], [0, -0.08, 0]);
  box(THREE, g, mat.rustDark, 'right_patchwork_wall', [0.98, 0.72, 0.08], [0.12, 1.18, 0.96], [0, 0.10, 0.02]);
  box(THREE, g, mat.rustLight, 'front_left_panel', [-0.52, 0.72, -0.58], [0.72, 1.18, 0.11], [0, -0.03, -0.02]);
  box(THREE, g, mat.rustDark, 'front_right_panel', [0.56, 0.72, -0.58], [0.58, 1.12, 0.11], [0, 0.06, 0.04]);
  box(THREE, g, mat.rustDark, 'dark_open_doorway', [0.02, 0.50, -0.64], [0.46, 0.92, 0.08]);
  box(THREE, g, mat.rust, 'slumped_sheet_roof', [0, 1.62, -0.02], [2.28, 0.13, 1.58], [0.05, 0.04, -0.12]);
  for (let i = -3; i <= 3; i++) box(THREE, g, mat.rustLight, `roof_corrugation_${i + 3}`, [i * 0.31, 1.70, -0.02], [0.055, 0.05, 1.62], [0.05, 0.04, -0.12]);
  branch(THREE, g, mat.wood, 'front_support_pole_left', [-0.9, 0.04, -0.74], [-0.82, 1.45, -0.69], 0.045, 7);
  branch(THREE, g, mat.wood, 'front_support_pole_right', [0.9, 0.04, -0.72], [0.82, 1.38, -0.68], 0.045, 7);
  box(THREE, g, mat.cloth, 'torn_canvas_strip', [-0.12, 1.32, -0.76], [1.12, 0.08, 0.05], [0.0, 0.0, -0.06]);
  return g;
}

function cotBed(THREE, mat) {
  const g = new THREE.Group();
  const canvas = material(THREE, 'patched_sleeping_canvas', 0x6d5a3c, { roughness: 1, metalness: 0 });
  const blanket = material(THREE, 'faded_blanket_cloth', 0x3f5b50, { roughness: 1, metalness: 0 });
  const pillow = material(THREE, 'dusty_pillow_roll', 0xb6aa8b, { roughness: 1, metalness: 0 });
  contactShadow(THREE, g, mat, 0.92, 0.56, 0.24);
  box(THREE, g, mat.rustDark, 'thin_scrap_frame_left', [0, 0.23, -0.36], [1.62, 0.06, 0.07]);
  box(THREE, g, mat.rustDark, 'thin_scrap_frame_right', [0, 0.23, 0.36], [1.62, 0.06, 0.07]);
  box(THREE, g, mat.rustDark, 'thin_scrap_frame_head', [-0.82, 0.23, 0], [0.07, 0.06, 0.78]);
  box(THREE, g, mat.rustDark, 'thin_scrap_frame_foot', [0.82, 0.23, 0], [0.07, 0.06, 0.78]);
  [[-0.72, -0.30], [-0.72, 0.30], [0.72, -0.30], [0.72, 0.30]].forEach(([x, z], i) => {
    cyl(THREE, g, mat.rustDark, `short_bed_leg_${i}`, 0.028, 0.035, 0.27, 7, [x, 0.12, z]);
  });
  box(THREE, g, canvas, 'stretched_canvas_mattress', [0.02, 0.31, 0], [1.54, 0.12, 0.66], [0.0, 0.0, 0.012]);
  box(THREE, g, blanket, 'folded_wasteland_blanket', [0.24, 0.405, 0.02], [0.82, 0.08, 0.58], [0.0, 0.0, -0.02]);
  cyl(THREE, g, pillow, 'rolled_pillow_at_head', 0.105, 0.105, 0.48, 14, [-0.56, 0.43, 0], [Math.PI / 2, 0, 0]);
  box(THREE, g, mat.rustLight, 'wired_nameplate_clip', [-0.86, 0.39, -0.20], [0.04, 0.10, 0.22], [0, 0, 0.1]);
  box(THREE, g, mat.cloth, 'small_personal_bundle', [0.67, 0.39, -0.25], [0.20, 0.12, 0.18], [0.02, 0.26, 0]);
  return g;
}

function cactus(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.55, 0.38, 0.18);
  const green = material(THREE, 'dusty_mutated_cactus_green', 0x4d7148, { roughness: 1 });
  branch(THREE, g, green, 'main_cactus_stem', [0, 0.04, 0], [0, 1.22, 0], 0.12, 9);
  branch(THREE, g, green, 'left_cactus_arm', [-0.04, 0.72, 0], [-0.48, 0.98, 0.04], 0.07, 8);
  branch(THREE, g, green, 'right_cactus_arm', [0.05, 0.58, 0], [0.42, 0.84, -0.06], 0.065, 8);
  sphere(THREE, g, mat.bone, 'pale_spine_cluster_a', [-0.10, 0.72, -0.10], [0.24, 0.12, 0.24]);
  sphere(THREE, g, mat.bone, 'pale_spine_cluster_b', [0.10, 0.98, 0.08], [0.20, 0.11, 0.20]);
  return g;
}

function rubbleRock(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.74, 0.50, 0.22);
  for (let i = 0; i < 7; i++) {
    const x = (i % 3 - 1) * 0.25 + (i * 0.03);
    const z = (Math.floor(i / 3) - 0.8) * 0.23;
    const s = 0.18 + (i % 4) * 0.045;
    sphere(THREE, g, i % 2 ? mat.concrete : mat.dust, `angular_wasteland_rock_${i}`, [x, 0.12 + s * 0.35, z], [s * 1.5, s * 0.75, s * 1.12]);
  }
  return g;
}

function oreOutcrop(THREE, mat) {
  const g = rubbleRock(THREE, mat);
  const ore = material(THREE, 'dull_iron_ore_faces', 0x6d5f4f, { roughness: 0.82, metalness: 0.32 });
  box(THREE, g, ore, 'visible_iron_vein_a', [-0.16, 0.28, -0.10], [0.42, 0.07, 0.08], [0.18, 0.2, -0.16]);
  box(THREE, g, ore, 'visible_iron_vein_b', [0.18, 0.22, 0.20], [0.36, 0.065, 0.07], [-0.12, -0.4, 0.08]);
  return g;
}

function oilPumpJack(THREE, mat) {
  const g = new THREE.Group();
  const oil = material(THREE, 'thick_black_crude_oil', 0x110d09, { roughness: 0.98, metalness: 0.08 });
  contactShadow(THREE, g, mat, 1.62, 1.04, 0.38);
  box(THREE, g, mat.rustDark, 'left_ground_skid', [-0.38, 0.08, -0.54], [1.82, 0.10, 0.12], [0, 0.06, 0]);
  box(THREE, g, mat.rustDark, 'right_ground_skid', [-0.38, 0.08, 0.54], [1.82, 0.10, 0.12], [0, -0.06, 0]);
  box(THREE, g, mat.rustLight, 'rear_cross_tie', [0.40, 0.18, 0], [0.18, 0.16, 1.22], [0, 0.02, 0]);
  branch(THREE, g, mat.rustDark, 'left_a_frame_leg', [-0.88, 0.12, -0.44], [-0.12, 1.68, -0.10], 0.045, 8);
  branch(THREE, g, mat.rustDark, 'right_a_frame_leg', [-0.88, 0.12, 0.44], [-0.12, 1.68, 0.10], 0.045, 8);
  branch(THREE, g, mat.rustDark, 'rear_a_frame_leg', [0.22, 0.12, 0.0], [-0.12, 1.68, 0.0], 0.04, 8);
  cyl(THREE, g, mat.rustLight, 'walking_beam_pivot', 0.10, 0.10, 0.34, 14, [-0.12, 1.70, 0], [Math.PI / 2, 0, 0]);
  box(THREE, g, mat.rust, 'counterweighted_walking_beam', [0.18, 1.86, 0], [1.86, 0.14, 0.18], [0, 0, -0.13]);
  box(THREE, g, mat.rustDark, 'horse_head_plate', [-0.86, 1.66, 0], [0.26, 0.48, 0.20], [0, 0, -0.22]);
  cyl(THREE, g, mat.rustLight, 'round_counterweight', 0.22, 0.22, 0.22, 18, [1.04, 1.95, 0.0], [Math.PI / 2, 0, 0]);
  branch(THREE, g, mat.rustLight, 'polished_pump_rod', [-0.94, 1.45, 0.0], [-1.02, 0.16, 0.0], 0.022, 7);
  cyl(THREE, g, mat.rustDark, 'wellhead_pipe', 0.13, 0.15, 0.42, 14, [-1.02, 0.22, 0]);
  cyl(THREE, g, mat.rustLight, 'side_delivery_pipe', 0.035, 0.035, 1.15, 8, [-0.50, 0.18, -0.68], [Math.PI / 2, 0, Math.PI / 2]);
  cyl(THREE, g, mat.rustLight, 'front_delivery_pipe', 0.032, 0.032, 0.82, 8, [-1.02, 0.20, -0.34], [Math.PI / 2, 0, 0]);
  box(THREE, g, mat.yellow, 'faded_warning_panel', [0.20, 1.88, -0.105], [0.46, 0.08, 0.018], [0, 0, -0.13]);
  mesh(THREE, g, new THREE.CircleBufferGeometry(0.44, 28), oil, 'fresh_crude_oil_pool', [-1.05, 0.018, 0.18], [1.25, 0.62, 1], [-Math.PI / 2, 0, 0.18]);
  box(THREE, g, mat.rustDark, 'small_pump_motor_block', [0.56, 0.34, 0.36], [0.46, 0.32, 0.38], [0, -0.16, 0]);
  cyl(THREE, g, mat.rustLight, 'belt_wheel', 0.16, 0.16, 0.08, 14, [0.28, 0.55, 0.34], [Math.PI / 2, 0, 0]);
  return g;
}

function highwaySign(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.72, 0.44, 0.20);
  branch(THREE, g, mat.rustDark, 'bent_sign_post', [0, 0.02, 0], [0.10, 1.42, 0.02], 0.035, 8);
  box(THREE, g, mat.fadedPaint, 'faded_highway_sign_plate', [0.22, 1.22, -0.02], [0.92, 0.46, 0.045], [0.04, 0.02, -0.10]);
  box(THREE, g, mat.yellow, 'peeled_warning_stripe_top', [0.22, 1.38, -0.048], [0.84, 0.055, 0.018], [0.04, 0.02, -0.10]);
  box(THREE, g, mat.dust, 'sand_packed_base', [0.0, 0.045, 0.0], [0.42, 0.08, 0.32], [0.0, 0.2, 0.0]);
  return g;
}

function ruinedBillboard(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.55, 0.58, 0.24);
  branch(THREE, g, mat.rustDark, 'left_billboard_post', [-0.62, 0.02, 0], [-0.52, 1.65, 0.02], 0.04, 8);
  branch(THREE, g, mat.rustDark, 'right_billboard_post', [0.62, 0.02, 0], [0.52, 1.48, 0.02], 0.04, 8);
  box(THREE, g, mat.rust, 'broken_billboard_left_panel', [-0.42, 1.35, 0], [0.78, 0.54, 0.055], [0.02, 0.02, -0.08]);
  box(THREE, g, mat.fadedPaint, 'broken_billboard_right_panel', [0.42, 1.28, 0.03], [0.62, 0.44, 0.05], [-0.04, -0.04, 0.15]);
  box(THREE, g, mat.yellow, 'old_ad_stripe', [-0.25, 1.45, -0.035], [0.55, 0.05, 0.018], [0.02, 0.02, -0.08]);
  branch(THREE, g, mat.rustDark, 'fallen_sign_support', [-0.86, 0.10, 0.28], [0.65, 0.15, 0.42], 0.025, 7);
  return g;
}

function utilityPole(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.52, 0.38, 0.18);
  branch(THREE, g, mat.wood, 'sun_cracked_pole', [0, 0.03, 0], [0.08, 2.02, 0.0], 0.055, 8);
  branch(THREE, g, mat.wood, 'crooked_crossarm', [-0.58, 1.56, 0.02], [0.68, 1.62, 0.0], 0.035, 8);
  [-0.42, 0.42].forEach((x, i) => sphere(THREE, g, mat.bone, `ceramic_insulator_${i}`, [x, 1.66, 0.02], [0.5, 0.7, 0.5]));
  branch(THREE, g, mat.rustDark, 'sagging_wire_a', [-0.48, 1.64, 0.0], [-1.04, 1.38, -0.18], 0.012, 6);
  branch(THREE, g, mat.rustDark, 'sagging_wire_b', [0.48, 1.64, 0.0], [1.02, 1.34, 0.16], 0.012, 6);
  return g;
}

function roadblockBarricade(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.15, 0.42, 0.22);
  branch(THREE, g, mat.wood, 'left_sawhorse_leg_a', [-0.78, 0.02, -0.16], [-0.58, 0.56, 0.0], 0.035, 7);
  branch(THREE, g, mat.wood, 'left_sawhorse_leg_b', [-0.38, 0.02, 0.16], [-0.58, 0.56, 0.0], 0.035, 7);
  branch(THREE, g, mat.wood, 'right_sawhorse_leg_a', [0.38, 0.02, -0.16], [0.58, 0.56, 0.0], 0.035, 7);
  branch(THREE, g, mat.wood, 'right_sawhorse_leg_b', [0.78, 0.02, 0.16], [0.58, 0.56, 0.0], 0.035, 7);
  box(THREE, g, mat.yellow, 'striped_barricade_board', [0, 0.62, 0], [1.72, 0.16, 0.08], [0, 0.02, -0.05]);
  [-0.55, 0.05, 0.65].forEach((x, i) => box(THREE, g, mat.red, `dull_red_stripe_${i}`, [x, 0.64, -0.045], [0.18, 0.17, 0.025], [0, 0.02, -0.25]));
  return g;
}

function dryBush(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.55, 0.38, 0.16);
  const ends = [[-0.42, 0.42, 0.12], [0.38, 0.36, -0.22], [0.12, 0.52, 0.42], [-0.18, 0.46, -0.38], [0.0, 0.58, 0.0], [0.52, 0.24, 0.12], [-0.52, 0.28, -0.08]];
  ends.forEach((end, i) => branch(THREE, g, mat.wood, `dry_bush_twig_${i}`, [0, 0.04, 0], end, 0.018 + (i % 2) * 0.006, 6));
  sphere(THREE, g, mat.dust, 'dusty_root_ball', [0, 0.23, 0], [1.1, 0.45, 0.9]);
  return g;
}

function asphaltSlab(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 1.2, 0.72, 0.20);
  const asphalt = material(THREE, 'sun_cracked_old_asphalt', 0x35332e, { roughness: 0.98, metalness: 0 });
  box(THREE, g, asphalt, 'broken_asphalt_slab_main', [0, 0.045, 0], [1.82, 0.075, 0.96], [0.01, 0.22, -0.02]);
  box(THREE, g, mat.dust, 'sandy_broken_edge_a', [-0.78, 0.09, -0.42], [0.44, 0.04, 0.08], [0, 0.32, 0]);
  box(THREE, g, mat.yellow, 'faded_lane_paint', [0.05, 0.096, -0.02], [1.26, 0.018, 0.055], [0, 0.22, 0]);
  return g;
}

function tradeMachine(THREE, mat) {
  const g = new THREE.Group();
  contactShadow(THREE, g, mat, 0.72, 0.48, 0.24);
  const screen = material(THREE, 'dim_green_vendor_screen', 0x163b2f, { roughness: 0.5, metalness: 0.08 });
  const brass = material(THREE, 'worn_vendor_brass', 0x9b7a35, { roughness: 0.74, metalness: 0.42 });
  const darkRubber = material(THREE, 'black_vendor_rubber', 0x11100d, { roughness: 0.98, metalness: 0.02 });

  box(THREE, g, mat.rustDark, 'vendor_outer_body', [0, 0.82, 0], [0.92, 1.64, 0.54]);
  box(THREE, g, mat.fadedPaint, 'vendor_faded_front_panel', [0, 0.88, -0.285], [0.76, 1.34, 0.045]);
  box(THREE, g, mat.rustLight, 'vendor_top_cap', [0, 1.68, -0.01], [1.0, 0.14, 0.62]);
  box(THREE, g, mat.rust, 'vendor_bottom_kickplate', [0, 0.12, -0.305], [0.82, 0.18, 0.06]);

  box(THREE, g, screen, 'vendor_glowing_screen', [-0.12, 1.24, -0.315], [0.46, 0.28, 0.035]);
  box(THREE, g, brass, 'vendor_supply_label', [-0.12, 1.49, -0.325], [0.54, 0.07, 0.03]);
  box(THREE, g, darkRubber, 'vendor_pickup_slot', [-0.08, 0.52, -0.325], [0.54, 0.16, 0.055]);
  box(THREE, g, mat.rustLight, 'vendor_slot_lip', [-0.08, 0.42, -0.35], [0.62, 0.04, 0.08]);

  [-0.28, -0.12, 0.04].forEach((yOffset, i) => {
    box(THREE, g, brass, `vendor_button_row_${i}`, [0.34, 1.08 + yOffset, -0.325], [0.16, 0.045, 0.035]);
  });
  [0.22, 0.34, 0.46].forEach((x, i) => {
    cyl(THREE, g, i === 0 ? mat.red : brass, `vendor_round_button_${i}`, 0.035, 0.035, 0.025, 12, [x, 0.82, -0.33], [Math.PI / 2, 0, 0]);
  });

  box(THREE, g, mat.yellow, 'vendor_warning_stripe_left', [-0.41, 0.92, -0.335], [0.045, 1.08, 0.035]);
  box(THREE, g, mat.yellow, 'vendor_warning_stripe_right', [0.41, 0.92, -0.335], [0.045, 1.08, 0.035]);
  box(THREE, g, mat.rustDark, 'vendor_left_side_groove', [-0.485, 0.92, 0], [0.045, 1.16, 0.48]);
  box(THREE, g, mat.rustDark, 'vendor_right_side_groove', [0.485, 0.92, 0], [0.045, 1.16, 0.48]);
  box(THREE, g, darkRubber, 'vendor_left_foot', [-0.3, 0.03, -0.1], [0.2, 0.06, 0.3]);
  box(THREE, g, darkRubber, 'vendor_right_foot', [0.3, 0.03, -0.1], [0.2, 0.06, 0.3]);
  return g;
}

function craftStationPalette(THREE, mat, accentColor, glowColor = 0x000000) {
  return {
    steel: material(THREE, 'workstation_worn_steel', 0x4a4d49, { roughness: 0.76, metalness: 0.72 }),
    dark: material(THREE, 'workstation_dark_frame', 0x242622, { roughness: 0.9, metalness: 0.58 }),
    accent: material(THREE, 'workstation_type_paint', accentColor, { roughness: 0.84, metalness: 0.24 }),
    brass: material(THREE, 'workstation_brass_parts', 0xa77b35, { roughness: 0.58, metalness: 0.78 }),
    copper: material(THREE, 'workstation_copper_parts', 0x9a4f2d, { roughness: 0.62, metalness: 0.75 }),
    glow: material(THREE, 'workstation_active_indicator', glowColor || accentColor, {
      roughness: 0.34,
      metalness: 0.08,
      emissive: glowColor || accentColor,
      emissiveIntensity: glowColor ? 0.82 : 0.24
    }),
    glass: material(THREE, 'workstation_dirty_glass', 0x9eb9aa, { roughness: 0.28, metalness: 0, transparent: true, opacity: 0.5 }),
    wood: mat.wood
  };
}

function craftStationBase(THREE, mat, palette, name, width = 2.2, depth = 0.9) {
  const g = new THREE.Group();
  g.name = name;
  contactShadow(THREE, g, mat, width * 0.62, depth * 0.82, 0.28);
  box(THREE, g, palette.wood, `${name}_worktop`, [0, 0.91, 0], [width, 0.16, depth]);
  box(THREE, g, palette.steel, `${name}_front_edge`, [0, 0.87, -depth * 0.47], [width + 0.05, 0.13, 0.08]);
  [-1, 1].forEach(side => {
    [-1, 1].forEach(front => {
      box(THREE, g, palette.dark, `${name}_leg_${side}_${front}`, [side * width * 0.40, 0.45, front * depth * 0.34], [0.13, 0.84, 0.13]);
    });
  });
  box(THREE, g, palette.dark, `${name}_lower_shelf`, [0, 0.28, 0.04], [width * 0.84, 0.08, depth * 0.70]);
  box(THREE, g, palette.accent, `${name}_type_plate`, [0, 0.71, -depth * 0.52], [width * 0.46, 0.16, 0.035]);
  return g;
}

function craftStationAmmo(THREE, mat) {
  const p = craftStationPalette(THREE, mat, 0xb89036, 0xffb43b);
  const g = craftStationBase(THREE, mat, p, 'ammo_press_station', 2.05, 0.92);
  box(THREE, g, p.dark, 'press_left_column', [-0.42, 1.38, 0.04], [0.14, 0.92, 0.18]);
  box(THREE, g, p.dark, 'press_right_column', [0.42, 1.38, 0.04], [0.14, 0.92, 0.18]);
  box(THREE, g, p.accent, 'press_top_crosshead', [0, 1.80, 0.04], [1.02, 0.18, 0.28]);
  box(THREE, g, p.steel, 'press_die_base', [0, 1.02, 0.02], [0.62, 0.13, 0.46]);
  cyl(THREE, g, p.steel, 'press_ram', 0.09, 0.09, 0.58, 14, [0, 1.49, 0.02]);
  torus(THREE, g, p.brass, 'press_flywheel', 0.34, 0.045, [0.62, 1.52, 0.02], [0, Math.PI / 2, 0]);
  branch(THREE, g, p.dark, 'press_handle', [0.62, 1.52, 0.02], [0.95, 1.18, -0.03], 0.035, 10);
  box(THREE, g, p.brass, 'cartridge_sorting_tray', [-0.72, 1.02, -0.02], [0.42, 0.08, 0.52]);
  for (let i = 0; i < 5; i++) {
    cyl(THREE, g, p.brass, `cartridge_${i}`, 0.025, 0.03, 0.16, 10, [-0.86 + (i % 3) * 0.13, 1.13, -0.14 + Math.floor(i / 3) * 0.17]);
  }
  return g;
}

function craftStationWeapon(THREE, mat) {
  const p = craftStationPalette(THREE, mat, 0x8a3f2d, 0xe06442);
  const g = craftStationBase(THREE, mat, p, 'weapon_bench_station', 2.55, 0.94);
  box(THREE, g, p.dark, 'weapon_pegboard', [0, 1.47, 0.40], [2.38, 0.98, 0.09]);
  for (let x = -1; x <= 1; x += 0.25) {
    cyl(THREE, g, p.steel, `peg_${x.toFixed(2)}`, 0.012, 0.012, 0.06, 7, [x, 1.55 + ((Math.round(x * 8) & 1) ? 0.16 : -0.14), 0.34], [Math.PI / 2, 0, 0]);
  }
  box(THREE, g, p.steel, 'gunsmith_vise_base', [-0.72, 1.04, -0.06], [0.44, 0.18, 0.40]);
  box(THREE, g, p.dark, 'gunsmith_vise_fixed_jaw', [-0.84, 1.19, -0.06], [0.10, 0.26, 0.38]);
  box(THREE, g, p.dark, 'gunsmith_vise_moving_jaw', [-0.56, 1.19, -0.06], [0.10, 0.26, 0.38]);
  branch(THREE, g, p.steel, 'rifle_receiver', [-0.94, 1.60, 0.31], [0.38, 1.35, 0.31], 0.055, 8);
  branch(THREE, g, p.dark, 'rifle_barrel', [0.30, 1.37, 0.31], [1.02, 1.24, 0.31], 0.025, 8);
  box(THREE, g, p.wood, 'rifle_stock', [-0.98, 1.60, 0.31], [0.42, 0.16, 0.09], [0, 0, -0.18]);
  box(THREE, g, p.accent, 'weapon_parts_tray', [0.70, 1.02, -0.02], [0.72, 0.08, 0.48]);
  return g;
}

function craftStationTools(THREE, mat) {
  const p = craftStationPalette(THREE, mat, 0x3e6d55, 0x73d18d);
  const g = craftStationBase(THREE, mat, p, 'tool_bench_station', 2.12, 0.90);
  box(THREE, g, p.accent, 'tool_chest', [0.52, 1.15, 0.02], [0.88, 0.48, 0.54]);
  for (let i = 0; i < 3; i++) {
    box(THREE, g, p.dark, `tool_drawer_${i}`, [0.52, 1.02 + i * 0.15, -0.27], [0.76, 0.10, 0.035]);
    box(THREE, g, p.brass, `tool_drawer_handle_${i}`, [0.52, 1.02 + i * 0.15, -0.30], [0.23, 0.025, 0.025]);
  }
  box(THREE, g, p.dark, 'tool_board', [-0.50, 1.48, 0.39], [0.96, 0.98, 0.08]);
  branch(THREE, g, p.steel, 'hanging_wrench', [-0.78, 1.76, 0.31], [-0.58, 1.25, 0.31], 0.035, 8);
  torus(THREE, g, p.steel, 'wrench_open_end', 0.10, 0.026, [-0.82, 1.79, 0.31], [0, 0, 0], [1, 1.35, 1]);
  branch(THREE, g, p.accent, 'hammer_handle', [-0.34, 1.72, 0.30], [-0.18, 1.24, 0.30], 0.035, 8);
  box(THREE, g, p.steel, 'hammer_head', [-0.37, 1.76, 0.30], [0.34, 0.10, 0.10], [0, 0, 0.14]);
  cyl(THREE, g, p.brass, 'drill_press_column', 0.055, 0.065, 0.74, 12, [-0.74, 1.34, -0.04]);
  box(THREE, g, p.dark, 'drill_press_head', [-0.74, 1.68, -0.04], [0.36, 0.22, 0.30]);
  return g;
}

function craftStationRepair(THREE, mat) {
  const p = craftStationPalette(THREE, mat, 0xb65b2d, 0xff7838);
  const g = craftStationBase(THREE, mat, p, 'repair_rig_station', 2.34, 1.02);
  box(THREE, g, p.steel, 'engine_block', [0, 1.22, 0.02], [0.92, 0.48, 0.58]);
  [-0.30, 0, 0.30].forEach((x, i) => {
    cyl(THREE, g, p.dark, `engine_cylinder_${i}`, 0.12, 0.14, 0.36, 12, [x, 1.52, 0.03]);
  });
  torus(THREE, g, p.brass, 'engine_gear', 0.23, 0.055, [0.50, 1.25, -0.31], [0, Math.PI / 2, 0]);
  branch(THREE, g, p.dark, 'hoist_left', [-1.00, 0.12, 0.30], [-0.82, 2.20, 0.24], 0.055, 9);
  branch(THREE, g, p.dark, 'hoist_right', [1.00, 0.12, 0.30], [0.82, 2.20, 0.24], 0.055, 9);
  branch(THREE, g, p.accent, 'hoist_crossbeam', [-0.86, 2.16, 0.24], [0.86, 2.16, 0.24], 0.065, 9);
  branch(THREE, g, p.brass, 'hoist_chain', [0, 2.12, 0.24], [0, 1.65, 0.12], 0.018, 7);
  torus(THREE, g, p.brass, 'hoist_hook', 0.085, 0.022, [0, 1.61, 0.10], [0, 0, 0]);
  return g;
}

function craftStationEnergy(THREE, mat) {
  const p = craftStationPalette(THREE, mat, 0x315f72, 0x48c9ff);
  const g = craftStationBase(THREE, mat, p, 'energy_calibration_station', 2.18, 0.94);
  box(THREE, g, p.dark, 'energy_console', [0, 1.48, 0.31], [1.86, 0.88, 0.32], [-0.08, 0, 0]);
  box(THREE, g, p.glow, 'oscilloscope_screen', [-0.42, 1.56, 0.12], [0.62, 0.36, 0.035], [-0.08, 0, 0]);
  for (let i = 0; i < 4; i++) {
    cyl(THREE, g, i === 0 ? p.glow : p.brass, `console_dial_${i}`, 0.045, 0.045, 0.025, 12, [0.18 + i * 0.17, 1.54, 0.12], [Math.PI / 2, 0, 0]);
  }
  [-0.28, 0.28].forEach((x, i) => {
    torus(THREE, g, p.copper, `tesla_coil_ring_${i}`, 0.18, 0.035, [x, 1.13, -0.10], [0, Math.PI / 2, 0]);
    cyl(THREE, g, p.glow, `energy_cell_${i}`, 0.07, 0.07, 0.48, 12, [x, 1.28, -0.10]);
  });
  branch(THREE, g, p.copper, 'energy_cable_left', [-0.28, 1.06, -0.10], [-0.82, 0.95, 0.28], 0.025, 8);
  branch(THREE, g, p.copper, 'energy_cable_right', [0.28, 1.06, -0.10], [0.82, 0.95, 0.28], 0.025, 8);
  box(THREE, g, p.accent, 'insulated_battery_case', [0.72, 0.50, 0.02], [0.56, 0.36, 0.52]);
  return g;
}

function craftStationChem(THREE, mat) {
  const p = craftStationPalette(THREE, mat, 0x53743c, 0x83e94f);
  const g = craftStationBase(THREE, mat, p, 'chemical_lab_station', 2.22, 0.96);
  box(THREE, g, p.dark, 'chem_upper_rack', [0, 1.82, 0.34], [2.02, 0.10, 0.30]);
  box(THREE, g, p.dark, 'chem_rack_left', [-0.94, 1.40, 0.34], [0.08, 0.88, 0.12]);
  box(THREE, g, p.dark, 'chem_rack_right', [0.94, 1.40, 0.34], [0.08, 0.88, 0.12]);
  [-0.62, 0, 0.62].forEach((x, i) => {
    cyl(THREE, g, p.glass, `reagent_tube_${i}`, 0.12, 0.15, 0.54 + i * 0.08, 14, [x, 1.30 + i * 0.04, 0.03]);
    cyl(THREE, g, i === 1 ? p.glow : p.accent, `reagent_liquid_${i}`, 0.085, 0.11, 0.25 + i * 0.04, 14, [x, 1.13 + i * 0.02, 0.03]);
    branch(THREE, g, p.copper, `reagent_pipe_${i}`, [x, 1.58 + i * 0.08, 0.03], [x * 0.72, 1.79, 0.28], 0.018, 7);
  });
  sphere(THREE, g, p.glass, 'mixing_flask', 0.22, [-0.34, 1.14, -0.18], [1, 0.82, 1]);
  cyl(THREE, g, p.glass, 'mixing_flask_neck', 0.055, 0.075, 0.28, 12, [-0.34, 1.38, -0.18]);
  sphere(THREE, g, p.glow, 'mixing_flask_liquid', 0.15, [-0.34, 1.08, -0.18], [1, 0.48, 1]);
  box(THREE, g, p.accent, 'sealed_chemical_case', [0.68, 0.50, 0.02], [0.62, 0.38, 0.54]);
  return g;
}

async function exportGlb(THREE, GLTFExporter, root, file) {
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(scene, result => resolve(result), { binary: true, trs: false, onlyVisible: true, truncateDrawRange: true });
  });
  fs.writeFileSync(file, Buffer.from(arrayBuffer));
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)} (${Buffer.byteLength(Buffer.from(arrayBuffer))} bytes)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
