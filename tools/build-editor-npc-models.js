const fs = require('fs');
const path = require('path');

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

  const mat = makeMaterials(THREE);
  const models = {
    'trader_npc.glb': () => humanoid(THREE, mat, { coat: mat.coatBlue, plain: true }),
    'npc_caravan_trader.glb': () => humanoid(THREE, mat, { coat: mat.coatBlue, plain: true }),
    'npc_caravan_guard.glb': () => humanoid(THREE, mat, { coat: mat.dustCoat, plain: true }),
    'npc_klim_guard.glb': () => humanoid(THREE, mat, { coat: mat.greenCoat, plain: true }),
    'npc_wasteland_settler.glb': () => humanoid(THREE, mat, { coat: mat.canvas, plain: true }),
    'npc_raider.glb': () => humanoid(THREE, mat, { coat: mat.raiderCloth, plain: true }),
    'npc_ghoul.glb': () => ghoul(THREE, mat),
    'npc_super_mutant.glb': () => superMutant(THREE, mat),
    'npc_ash_wolf.glb': () => ashWolf(THREE, mat),
    'npc_radscorpion.glb': () => radscorpion(THREE, mat),
    'npc_mutant_ant.glb': () => mutantAnt(THREE, mat),
    'npc_gecko.glb': () => gecko(THREE, mat, false),
    'npc_fire_gecko.glb': () => gecko(THREE, mat, true)
  };

  for (const [file, factory] of Object.entries(models)) {
    const root = factory();
    root.name = file.replace(/\.glb$/, '');
    root.userData.editorNpcModel = true;
    await exportGlb(THREE, GLTFExporter, root, path.join(outDir, file));
  }
}

function makeMaterials(THREE) {
  const material = (name, color, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.86,
      metalness: opts.metalness ?? 0
    });
    m.name = name;
    return m;
  };
  return {
    skin: material('npc_weathered_skin', 0xb89168),
    bone: material('npc_bone_claw', 0xc7b78d),
    dark: material('npc_dark_metal', 0x1d1b18, { roughness: 0.72, metalness: 0.34 }),
    rust: material('npc_rust_metal', 0x7d4a2d, { roughness: 0.84, metalness: 0.25 }),
    leather: material('npc_old_leather', 0x5b3e27),
    coatBlue: material('npc_faded_blue_coat', 0x41515b),
    dustCoat: material('npc_dust_coat', 0x735c3e),
    greenCoat: material('npc_klim_green_coat', 0x40523b),
    canvas: material('npc_canvas_cloth', 0x8a744d),
    raiderCloth: material('npc_raider_cloth', 0x6d4633),
    scrapArmor: material('npc_scrap_armor', 0x68655a, { roughness: 0.64, metalness: 0.28 }),
    metalArmor: material('npc_patrol_metal_armor', 0x555f5f, { roughness: 0.58, metalness: 0.36 }),
    ghoulSkin: material('npc_ghoul_skin', 0x766d50),
    mutantSkin: material('npc_mutant_skin', 0x6a8157),
    wolfHide: material('npc_ash_wolf_hide', 0x5d5a50),
    scorpion: material('npc_radscorpion_shell', 0x3c2f23, { roughness: 0.78, metalness: 0.06 }),
    ant: material('npc_mutant_ant_shell', 0x40281d, { roughness: 0.82, metalness: 0.05 }),
    gecko: material('npc_gecko_hide', 0x587047),
    fireGecko: material('npc_fire_gecko_hide', 0x835337),
    toxic: material('npc_toxic_green', 0x7fda56),
    ember: material('npc_fire_ember', 0xff8b2a, { roughness: 0.55, metalness: 0.02 })
  };
}

function box(THREE, parent, mat, name, pos, scale, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), mat);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function sphere(THREE, parent, mat, name, pos, radius, scale = [1, 1, 1], segments = 12) {
  const mesh = new THREE.Mesh(new THREE.SphereBufferGeometry(radius, segments, Math.max(6, Math.floor(segments * 0.65))), mat);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cyl(THREE, parent, mat, name, pos, radiusTop, radiusBottom, height, segments = 10, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CylinderBufferGeometry(radiusTop, radiusBottom, height, segments), mat);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cone(THREE, parent, mat, name, pos, radius, height, segments = 8, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.ConeBufferGeometry(radius, height, segments), mat);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addHumanoidDetailPass(THREE, g, mat, opts = {}) {
  if (opts.plain) return;
  box(THREE, g, mat.skin, 'left_hand_gloved_knuckles', [-0.47, 0.64, -0.10], [0.16, 0.12, 0.16], [0.02, 0, -0.08]);
  box(THREE, g, mat.skin, 'right_hand_gloved_knuckles', [0.47, 0.64, -0.10], [0.16, 0.12, 0.16], [0.02, 0, 0.08]);
  box(THREE, g, mat.leather, 'left_wrist_wrap', [-0.46, 0.72, -0.08], [0.18, 0.07, 0.18], [0, 0, -0.08]);
  box(THREE, g, mat.leather, 'right_wrist_wrap', [0.46, 0.72, -0.08], [0.18, 0.07, 0.18], [0, 0, 0.08]);
  box(THREE, g, mat.rust, 'left_knee_plate', [-0.15, 0.39, -0.11], [0.22, 0.10, 0.20], [0.08, 0, 0.04]);
  box(THREE, g, mat.dark, 'right_knee_plate', [0.15, 0.39, -0.11], [0.22, 0.10, 0.20], [-0.08, 0, -0.04]);
  box(THREE, g, mat.dark, 'left_boot_toe_cap', [-0.16, 0.11, -0.21], [0.28, 0.06, 0.18], [0.02, 0, 0.02]);
  box(THREE, g, mat.dark, 'right_boot_toe_cap', [0.16, 0.11, -0.21], [0.28, 0.06, 0.18], [0.02, 0, -0.02]);
  box(THREE, g, mat.leather, 'diagonal_bandolier_leather', [-0.16, 1.03, -0.22], [0.07, 0.70, 0.07], [0.08, 0, -0.54]);
  box(THREE, g, opts.armor || mat.scrapArmor, 'bandolier_scrap_buckle', [0.05, 0.93, -0.26], [0.14, 0.10, 0.05], [0, 0, -0.08]);
  [-0.18, -0.06, 0.06].forEach((x, i) => {
    box(THREE, g, mat.rust, `bandolier_small_round_${i}`, [x, 1.06 - i * 0.06, -0.28], [0.05, 0.08, 0.04], [0.08, 0, -0.54]);
  });
  box(THREE, g, mat.canvas, 'left_belt_pouch', [-0.34, 0.78, -0.06], [0.18, 0.20, 0.12], [0.02, 0, -0.08]);
  box(THREE, g, mat.canvas, 'right_belt_pouch', [0.34, 0.78, -0.06], [0.18, 0.20, 0.12], [0.02, 0, 0.08]);
  box(THREE, g, mat.leather, 'neck_mask_filter', [0, 1.35, -0.18], [0.20, 0.12, 0.08]);
  box(THREE, g, mat.dark, 'left_eye_goggle', [-0.09, 1.43, -0.21], [0.14, 0.06, 0.05]);
  box(THREE, g, mat.dark, 'right_eye_goggle', [0.09, 1.43, -0.21], [0.14, 0.06, 0.05]);
  if (opts.rifle) {
    cyl(THREE, g, mat.rust, 'rifle_barrel_wrap', [0.55, 0.92, -0.78], 0.045, 0.045, 0.18, 8, [Math.PI / 2, 0, 0]);
  }
  if (opts.spikes) {
    cone(THREE, g, mat.bone, 'raider_back_spike_left', [-0.22, 1.20, 0.20], 0.04, 0.20, 6, [-0.25, 0, -0.18]);
    cone(THREE, g, mat.bone, 'raider_back_spike_right', [0.22, 1.20, 0.20], 0.04, 0.20, 6, [-0.25, 0, 0.18]);
  }
}

function addCreatureDetailPass(THREE, g, mat, kind = '') {
  if (kind === 'ghoul') {
    box(THREE, g, mat.bone, 'ghoul_bared_teeth', [0, 1.25, -0.31], [0.20, 0.055, 0.04], [-0.08, 0, 0]);
    sphere(THREE, g, mat.toxic, 'ghoul_glowing_wound_c', [-0.17, 0.73, -0.22], 0.04, [1, 1, 1], 8);
    sphere(THREE, g, mat.toxic, 'ghoul_glowing_wound_d', [0.12, 1.17, -0.25], 0.032, [1, 1, 1], 8);
    box(THREE, g, mat.bone, 'left_ghoul_claw_fingers', [-0.43, 0.50, -0.22], [0.08, 0.22, 0.055], [0.22, 0, -0.58]);
    box(THREE, g, mat.bone, 'right_ghoul_claw_fingers', [0.43, 0.50, -0.22], [0.08, 0.22, 0.055], [0.22, 0, 0.58]);
    return;
  }
  if (kind === 'mutant') {
    box(THREE, g, mat.bone, 'mutant_left_tooth_plate', [-0.16, 1.52, -0.28], [0.22, 0.18, 0.10], [0, 0, 0.04]);
    box(THREE, g, mat.bone, 'mutant_right_tooth_plate', [0.16, 1.52, -0.28], [0.22, 0.18, 0.10], [0, 0, -0.04]);
    return;
  }
  if (kind === 'wolf') {
    cone(THREE, g, mat.bone, 'wolf_left_bone_ear', [-0.12, 0.86, -0.72], 0.055, 0.20, 5, [-0.2, 0, -0.28]);
    cone(THREE, g, mat.bone, 'wolf_right_bone_ear', [0.12, 0.86, -0.72], 0.055, 0.20, 5, [-0.2, 0, 0.28]);
    sphere(THREE, g, mat.toxic, 'wolf_left_glowing_eye', [-0.08, 0.73, -0.84], 0.035, [1, 1, 1], 8);
    sphere(THREE, g, mat.toxic, 'wolf_right_glowing_eye', [0.08, 0.73, -0.84], 0.035, [1, 1, 1], 8);
    return;
  }
  if (kind === 'scorpion') {
    [-0.24, 0, 0.24].forEach((x, i) => {
      box(THREE, g, mat.bone, `scorpion_chipped_shell_plate_${i}`, [x, 0.57 + i * 0.035, -0.04 + i * 0.18], [0.18, 0.045, 0.30], [0.04, 0, x * 0.3]);
    });
    sphere(THREE, g, mat.toxic, 'scorpion_venom_sac_glow', [0, 0.82, 1.25], 0.055, [1, 1, 1], 8);
    return;
  }
  if (kind === 'ant') {
    [-0.16, 0.16].forEach((x, i) => {
      sphere(THREE, g, mat.ember, `ant_reflective_eye_${i}`, [x, 0.43, -0.62], 0.045, [1, 1, 1], 8);
      box(THREE, g, mat.bone, `ant_ivory_mandible_tip_${i}`, [x * 0.9, 0.29, -0.74], [0.05, 0.05, 0.34], [0, x < 0 ? -0.38 : 0.38, x < 0 ? -0.12 : 0.12]);
    });
    return;
  }
  if (kind === 'gecko' || kind === 'fireGecko') {
    const glow = kind === 'fireGecko' ? mat.ember : mat.toxic;
    box(THREE, g, glow, 'gecko_spine_glow_main', [0, 0.57, -0.20], [0.10, 0.08, 0.36], [0.08, 0, 0]);
    box(THREE, g, glow, 'gecko_spine_glow_left', [-0.13, 0.53, 0.12], [0.08, 0.07, 0.28], [0.06, 0, -0.18]);
    box(THREE, g, glow, 'gecko_spine_glow_right', [0.13, 0.53, 0.12], [0.08, 0.07, 0.28], [0.06, 0, 0.18]);
  }
}

function humanoid(THREE, mat, opts = {}) {
  const g = new THREE.Group();
  const coat = opts.coat || mat.canvas;
  box(THREE, g, mat.dark, 'left_boot', [-0.16, 0.07, -0.04], [0.24, 0.13, 0.32]);
  box(THREE, g, mat.dark, 'right_boot', [0.16, 0.07, -0.04], [0.24, 0.13, 0.32]);
  box(THREE, g, coat, 'left_leg', [-0.15, 0.34, 0.02], [0.16, 0.52, 0.18], [0.03, 0, -0.04]);
  box(THREE, g, coat, 'right_leg', [0.15, 0.34, 0.02], [0.16, 0.52, 0.18], [-0.03, 0, 0.04]);
  cyl(THREE, g, coat, 'torso', [0, 0.84, 0.02], 0.30, 0.38, 0.76, 10);
  box(THREE, g, coat, 'plain_cloth_chest', [0, 1.01, -0.06], [0.52, 0.30, 0.16], [0.02, 0, 0.03]);
  sphere(THREE, g, mat.skin, 'head', [0, 1.42, -0.02], 0.22, [1, 1.05, 0.95], 12);
  box(THREE, g, coat, 'left_arm', [-0.42, 0.94, -0.01], [0.13, 0.52, 0.15], [0, 0, -0.28]);
  box(THREE, g, coat, 'right_arm', [0.42, 0.94, -0.01], [0.13, 0.52, 0.15], [0, 0, 0.28]);
  addHumanoidDetailPass(THREE, g, mat, { ...opts, armor: coat });
  return g;
}

function ghoul(THREE, mat) {
  const g = new THREE.Group();
  box(THREE, g, mat.ghoulSkin, 'left_ghoul_leg', [-0.13, 0.31, 0.02], [0.12, 0.52, 0.14], [0.12, 0, -0.12]);
  box(THREE, g, mat.ghoulSkin, 'right_ghoul_leg', [0.14, 0.31, -0.02], [0.12, 0.50, 0.14], [-0.10, 0, 0.10]);
  cyl(THREE, g, mat.ghoulSkin, 'hunched_body', [0, 0.82, 0.06], 0.20, 0.27, 0.82, 8, [-0.16, 0, 0]);
  box(THREE, g, mat.bone, 'exposed_ribs', [0, 0.94, -0.18], [0.42, 0.26, 0.08], [-0.14, 0, 0]);
  sphere(THREE, g, mat.ghoulSkin, 'sunken_head', [0.01, 1.34, -0.16], 0.22, [0.9, 1.05, 0.84], 10);
  box(THREE, g, mat.ghoulSkin, 'left_long_arm', [-0.36, 0.84, -0.11], [0.10, 0.68, 0.12], [0.20, 0, -0.54]);
  box(THREE, g, mat.ghoulSkin, 'right_long_arm', [0.36, 0.84, -0.11], [0.10, 0.68, 0.12], [0.20, 0, 0.54]);
  sphere(THREE, g, mat.toxic, 'glowing_wound_a', [-0.12, 1.04, -0.23], 0.045, [1, 1, 1], 8);
  sphere(THREE, g, mat.toxic, 'glowing_wound_b', [0.16, 0.78, -0.20], 0.035, [1, 1, 1], 8);
  addCreatureDetailPass(THREE, g, mat, 'ghoul');
  return g;
}

function superMutant(THREE, mat) {
  const g = new THREE.Group();
  g.scale.set(1.18, 1.18, 1.18);
  box(THREE, g, mat.mutantSkin, 'left_mutant_leg', [-0.22, 0.34, 0.04], [0.23, 0.56, 0.28]);
  box(THREE, g, mat.mutantSkin, 'right_mutant_leg', [0.22, 0.34, 0.04], [0.23, 0.56, 0.28]);
  cyl(THREE, g, mat.mutantSkin, 'mutant_body', [0, 0.98, 0.03], 0.42, 0.58, 1.02, 11);
  sphere(THREE, g, mat.mutantSkin, 'mutant_head', [0, 1.62, -0.02], 0.27, [1.1, 1, 0.95], 12);
  box(THREE, g, mat.bone, 'mutant_jaw', [0, 1.49, -0.20], [0.36, 0.14, 0.12]);
  box(THREE, g, mat.mutantSkin, 'left_mutant_arm', [-0.67, 0.93, -0.02], [0.19, 0.72, 0.22], [0.02, 0, -0.22]);
  box(THREE, g, mat.mutantSkin, 'right_mutant_arm', [0.67, 0.93, -0.02], [0.19, 0.72, 0.22], [0.02, 0, 0.22]);
  addCreatureDetailPass(THREE, g, mat, 'mutant');
  return g;
}

function ashWolf(THREE, mat) {
  const g = new THREE.Group();
  box(THREE, g, mat.wolfHide, 'wolf_body', [0, 0.48, 0.02], [0.52, 0.34, 0.92]);
  box(THREE, g, mat.wolfHide, 'wolf_chest', [0, 0.57, -0.38], [0.42, 0.42, 0.36], [-0.12, 0, 0]);
  sphere(THREE, g, mat.wolfHide, 'wolf_head', [0, 0.69, -0.68], 0.22, [1, 0.9, 1], 10);
  box(THREE, g, mat.bone, 'wolf_muzzle', [0, 0.64, -0.86], [0.18, 0.12, 0.22], [-0.08, 0, 0]);
  box(THREE, g, mat.wolfHide, 'wolf_tail', [0, 0.56, 0.68], [0.12, 0.12, 0.44], [0.32, 0, 0]);
  [[-0.21,0.31,-0.3], [0.21,0.31,-0.3], [-0.21,0.28,0.34], [0.21,0.28,0.34]].forEach((p, i) => {
    box(THREE, g, mat.wolfHide, `wolf_leg_${i}`, p, [0.12, 0.42, 0.12], [i < 2 ? -0.18 : 0.12, 0, i % 2 ? 0.12 : -0.12]);
  });
  for (let i = 0; i < 4; i++) cone(THREE, g, mat.bone, `wolf_spine_${i}`, [0, 0.78 - i * 0.035, -0.28 + i * 0.2], 0.055, 0.22, 5, [-0.35, 0, 0]);
  addCreatureDetailPass(THREE, g, mat, 'wolf');
  return g;
}

function radscorpion(THREE, mat) {
  const g = new THREE.Group();
  sphere(THREE, g, mat.scorpion, 'scorpion_body', [0, 0.34, 0.06], 0.43, [1.45, 0.48, 1.0], 14);
  sphere(THREE, g, mat.scorpion, 'scorpion_head', [0, 0.31, -0.65], 0.27, [1.1, 0.62, 0.85], 12);
  [-0.42, -0.18, 0.1, 0.36].forEach((z, row) => [-1, 1].forEach(side => {
    box(THREE, g, mat.scorpion, `scorpion_leg_${row}_${side}_a`, [side * 0.48, 0.20, z], [0.62, 0.07, 0.08], [0.04, side * 0.12, side * (0.34 + row * 0.04)]);
    box(THREE, g, mat.scorpion, `scorpion_leg_${row}_${side}_b`, [side * 0.86, 0.13, z + 0.06], [0.38, 0.06, 0.07], [0.03, side * 0.06, side * -0.24]);
  }));
  [-1, 1].forEach(side => {
    box(THREE, g, mat.scorpion, `scorpion_claw_arm_${side}`, [side * 0.45, 0.28, -0.82], [0.50, 0.08, 0.10], [0, side * -0.16, side * 0.46]);
    sphere(THREE, g, mat.scorpion, `scorpion_claw_${side}`, [side * 0.78, 0.29, -1.05], 0.16, [1.2, 0.5, 0.85], 10);
  });
  [[0,0.42,0.58,0.17], [0,0.56,0.82,0.14], [0,0.68,1.02,0.12], [0,0.76,1.18,0.10]].forEach((p, i) => sphere(THREE, g, mat.scorpion, `scorpion_tail_${i}`, [p[0], p[1], p[2]], p[3], [1,1,1], 10));
  cone(THREE, g, mat.toxic, 'scorpion_stinger', [0, 0.74, 1.36], 0.10, 0.34, 8, [Math.PI * 0.62, 0, 0]);
  addCreatureDetailPass(THREE, g, mat, 'scorpion');
  return g;
}

function mutantAnt(THREE, mat) {
  const g = new THREE.Group();
  sphere(THREE, g, mat.ant, 'ant_abdomen', [0, 0.34, 0.48], 0.34, [1.0, 0.78, 1.24], 12);
  sphere(THREE, g, mat.ant, 'ant_thorax', [0, 0.36, -0.02], 0.30, [1.05, 0.72, 0.92], 12);
  sphere(THREE, g, mat.ant, 'ant_head', [0, 0.33, -0.48], 0.24, [1.05, 0.7, 0.88], 10);
  [-0.3, -0.02, 0.28].forEach((z, row) => [-1, 1].forEach(side => {
    box(THREE, g, mat.ant, `ant_leg_${row}_${side}_a`, [side * 0.45, 0.22, z], [0.52, 0.06, 0.07], [0.03, side * 0.08, side * (0.36 + row * 0.08)]);
    box(THREE, g, mat.ant, `ant_leg_${row}_${side}_b`, [side * 0.78, 0.13, z + 0.06], [0.34, 0.055, 0.06], [0.02, side * 0.05, side * -0.26]);
  }));
  box(THREE, g, mat.bone, 'left_ant_mandible', [-0.12, 0.31, -0.72], [0.08, 0.06, 0.25], [0, -0.32, -0.12]);
  box(THREE, g, mat.bone, 'right_ant_mandible', [0.12, 0.31, -0.72], [0.08, 0.06, 0.25], [0, 0.32, 0.12]);
  addCreatureDetailPass(THREE, g, mat, 'ant');
  return g;
}

function gecko(THREE, mat, fire) {
  const g = new THREE.Group();
  const hide = fire ? mat.fireGecko : mat.gecko;
  sphere(THREE, g, hide, 'gecko_body', [0, 0.36, 0], 0.36, [1.15, 0.58, 1.48], 14);
  sphere(THREE, g, hide, 'gecko_head', [0, 0.38, -0.68], 0.25, [1.0, 0.72, 0.95], 12);
  box(THREE, g, hide, 'gecko_snout', [0, 0.34, -0.90], [0.28, 0.11, 0.26], [-0.04, 0, 0]);
  box(THREE, g, hide, 'gecko_tail', [0, 0.32, 0.88], [0.16, 0.12, 0.86], [0.12, 0, 0]);
  [[-0.28,-0.36], [0.28,-0.36], [-0.28,0.34], [0.28,0.34]].forEach(([x, z], i) => {
    const side = x < 0 ? -1 : 1;
    box(THREE, g, hide, `gecko_leg_${i}_a`, [x, 0.22, z], [0.34, 0.07, 0.10], [0.03, side * 0.14, side * (i < 2 ? 0.42 : -0.34)]);
    box(THREE, g, hide, `gecko_leg_${i}_b`, [x + side * 0.25, 0.12, z + (i < 2 ? -0.08 : 0.1)], [0.22, 0.055, 0.08], [0.02, side * 0.08, side * -0.2]);
  });
  sphere(THREE, g, fire ? mat.ember : mat.toxic, 'left_gecko_eye', [-0.10, 0.50, -0.83], 0.04, [1,1,1], 8);
  sphere(THREE, g, fire ? mat.ember : mat.toxic, 'right_gecko_eye', [0.10, 0.50, -0.83], 0.04, [1,1,1], 8);
  if (fire) {
    for (let i = 0; i < 4; i++) sphere(THREE, g, mat.ember, `fire_gecko_ember_${i}`, [i % 2 ? 0.16 : -0.16, 0.54 - i * 0.03, -0.18 + i * 0.22], 0.04, [1,1,1], 8);
  }
  addCreatureDetailPass(THREE, g, mat, fire ? 'fireGecko' : 'gecko');
  return g;
}

async function exportGlb(THREE, GLTFExporter, root, file) {
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise(resolve => {
    exporter.parse(scene, result => resolve(result), { binary: true, trs: false, onlyVisible: true, truncateDrawRange: true });
  });
  fs.writeFileSync(file, Buffer.from(arrayBuffer));
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)} (${Buffer.byteLength(Buffer.from(arrayBuffer))} bytes)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
