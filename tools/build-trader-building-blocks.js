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

  const mat = {
    brick: material(THREE, 'old_klim_trader_brick_block', 0x756555, { roughness: 0.98 }),
    brickDark: material(THREE, 'dark_mortar_and_chipped_edges', 0x2b241d, { roughness: 1.0 }),
    brickLight: material(THREE, 'sun_worn_brick_highlights', 0xa08d73, { roughness: 0.96 }),
    dust: material(THREE, 'settled_wasteland_dust', 0xb49662, { roughness: 1.0 }),
    metal: material(THREE, 'blackened_window_frame_metal', 0x1c1b18, { roughness: 0.88, metalness: 0.38 }),
    glass: material(THREE, 'dirty_greenish_trader_glass', 0x536a65, { roughness: 0.26, metalness: 0.02, transparent: true, opacity: 0.48 }),
    wood: material(THREE, 'old_klim_floor_planks', 0x9c7347, { roughness: 0.96 }),
    woodDark: material(THREE, 'dark_plank_gaps', 0x2d2118, { roughness: 0.98 }),
    roof: material(THREE, 'old_klim_roof_tarred_planks', 0x574734, { roughness: 0.95, metalness: 0.06 }),
    roofRib: material(THREE, 'old_klim_roof_rib_edges', 0x8a683e, { roughness: 0.92, metalness: 0.12 }),
    moduleWood: material(THREE, 'module_sunburnt_wood', 0x8a613d, { roughness: 0.98 }),
    moduleWoodLight: material(THREE, 'module_worn_wood_highlights', 0xb58b5c, { roughness: 0.96 }),
    moduleWoodDark: material(THREE, 'module_black_plank_gaps', 0x231914, { roughness: 1.0 }),
    moduleBrick: material(THREE, 'module_fired_red_brick', 0x8b4b35, { roughness: 0.98 }),
    moduleBrickLight: material(THREE, 'module_chipped_brick_edges', 0xb57654, { roughness: 0.96 }),
    moduleMortar: material(THREE, 'module_pale_dry_mortar', 0x5a5549, { roughness: 1.0 }),
    moduleMetal: material(THREE, 'module_corrugated_dark_metal', 0x4f544e, { roughness: 0.82, metalness: 0.42 }),
    moduleMetalDark: material(THREE, 'module_oily_metal_seams', 0x171917, { roughness: 0.9, metalness: 0.52 }),
    moduleRust: material(THREE, 'module_rust_patches', 0x9b4c24, { roughness: 0.98, metalness: 0.08 }),
    moduleRoofWood: material(THREE, 'module_roof_weathered_wood', 0x6d5034, { roughness: 0.97 }),
    moduleRoofMetal: material(THREE, 'module_roof_galvanized_rust_metal', 0x65706a, { roughness: 0.78, metalness: 0.46 }),
    moduleTile: material(THREE, 'module_cracked_floor_tile', 0x8a8371, { roughness: 0.9 }),
    moduleTileDark: material(THREE, 'module_tile_grout_dark', 0x2d2b26, { roughness: 1.0 })
  };

  const models = {
    'trader_wall_block.glb': () => traderWallBlock(THREE, mat),
    'trader_window_block.glb': () => traderWindowBlock(THREE, mat),
    'trader_floor_slab.glb': () => traderFloorSlab(THREE, mat),
    'trader_roof_block.glb': () => traderRoofBlock(THREE, mat),
    'mod_wall_wood.glb': () => moduleWallWoodBlock(THREE, mat),
    'mod_wall_brick.glb': () => moduleWallBrickBlock(THREE, mat),
    'mod_wall_metal.glb': () => moduleWallMetalBlock(THREE, mat),
    'mod_roof_wood.glb': () => moduleRoofWoodBlock(THREE, mat),
    'mod_roof_metal.glb': () => moduleRoofMetalBlock(THREE, mat),
    'mod_floor_wood.glb': () => moduleFloorWoodBlock(THREE, mat),
    'mod_floor_tile.glb': () => moduleFloorTileBlock(THREE, mat)
  };

  for (const [file, factory] of Object.entries(models)) {
    const root = factory();
    root.name = file.replace(/\.glb$/, '');
    await exportGlb(THREE, GLTFExporter, root, path.join(outDir, file));
  }
}

function material(THREE, name, color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0.0,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1
  });
  m.name = name;
  if (opts.transparent) m.depthWrite = false;
  return m;
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

function tagModularBlock(group, kind, footprintX, footprintZ, height) {
  group.userData.realmModelRule = kind;
  group.userData.footprintX = footprintX;
  group.userData.footprintZ = footprintZ;
  group.userData.height = height;
  group.userData.bottomY = 0;
}

function traderWallBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'traderWallBlock', 2, 2, 1);
  box(THREE, g, mat.brick, 'single_old_klim_wall_block_core_2m', [0, 0.50, 0], [2.0, 1.0, 2.0]);

  const mortar = 0.018;
  [0.28, 0.50, 0.72].forEach((y, i) => {
    box(THREE, g, mat.brickDark, `front_horizontal_mortar_${i}`, [0, y, -0.986], [1.76, mortar, 0.026]);
    box(THREE, g, mat.brickDark, `back_horizontal_mortar_${i}`, [0, y, 0.986], [1.76, mortar, 0.026]);
    box(THREE, g, mat.brickDark, `left_horizontal_mortar_${i}`, [-0.986, y, 0], [0.026, mortar, 1.76]);
    box(THREE, g, mat.brickDark, `right_horizontal_mortar_${i}`, [0.986, y, 0], [0.026, mortar, 1.76]);
  });

  [-0.46, 0.48].forEach((x, i) => {
    box(THREE, g, mat.brickDark, `front_staggered_vertical_mortar_${i}`, [x, 0.68, -0.986], [mortar, 0.31, 0.026]);
    box(THREE, g, mat.brickDark, `back_staggered_vertical_mortar_${i}`, [-x, 0.32, 0.986], [mortar, 0.31, 0.026]);
  });
  [-0.46, 0.48].forEach((z, i) => {
    box(THREE, g, mat.brickDark, `left_staggered_vertical_mortar_${i}`, [-0.986, i ? 0.32 : 0.68, z], [0.026, 0.31, mortar]);
    box(THREE, g, mat.brickDark, `right_staggered_vertical_mortar_${i}`, [0.986, i ? 0.68 : 0.32, -z], [0.026, 0.31, mortar]);
  });

  box(THREE, g, mat.brickLight, 'worn_top_left_edge', [-0.44, 0.986, -0.56], [0.80, 0.018, 0.16], [0, 0.22, 0]);
  box(THREE, g, mat.dust, 'dusty_top_cap', [0.16, 0.988, 0.20], [1.42, 0.014, 1.16], [0, -0.08, 0]);
  box(THREE, g, mat.brickDark, 'small_chipped_corner_a', [-0.90, 0.82, -0.90], [0.18, 0.12, 0.045], [0, 0.35, 0.06]);
  box(THREE, g, mat.brickDark, 'small_chipped_corner_b', [0.90, 0.18, 0.90], [0.18, 0.13, 0.045], [0, -0.4, -0.05]);
  box(THREE, g, mat.brickDark, 'hairline_crack_front', [0.32, 0.52, -0.985], [0.016, 0.42, 0.026], [0, 0, -0.42]);
  return g;
}

function traderWindowBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'traderWindowBlock', 2, 2, 1);
  box(THREE, g, mat.brick, 'window_block_left_brick_pillar', [-0.86, 0.50, 0], [0.28, 1.0, 2.0]);
  box(THREE, g, mat.brick, 'window_block_right_brick_pillar', [0.86, 0.50, 0], [0.28, 1.0, 2.0]);
  box(THREE, g, mat.brick, 'window_block_top_lintel', [0, 0.91, 0], [2.0, 0.18, 2.0]);
  box(THREE, g, mat.brick, 'window_block_bottom_sill', [0, 0.09, 0], [2.0, 0.18, 2.0]);
  box(THREE, g, mat.glass, 'single_old_klim_window_block_glass', [0, 0.50, 0], [1.34, 0.58, 0.12]);
  box(THREE, g, mat.metal, 'window_frame_top', [0, 0.81, -0.01], [1.50, 0.055, 0.16]);
  box(THREE, g, mat.metal, 'window_frame_bottom', [0, 0.19, -0.01], [1.50, 0.055, 0.16]);
  box(THREE, g, mat.metal, 'window_frame_left', [-0.70, 0.50, -0.01], [0.055, 0.60, 0.16]);
  box(THREE, g, mat.metal, 'window_frame_right', [0.70, 0.50, -0.01], [0.055, 0.60, 0.16]);
  box(THREE, g, mat.metal, 'window_vertical_bar', [0, 0.50, -0.07], [0.045, 0.54, 0.14]);
  box(THREE, g, mat.metal, 'window_horizontal_bar', [0, 0.50, -0.075], [1.22, 0.038, 0.14]);
  box(THREE, g, mat.dust, 'window_bottom_dust', [0.08, 0.22, -0.12], [1.02, 0.035, 0.06], [0, 0, -0.03]);
  return g;
}

function traderFloorSlab(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'traderFloorSlab', 2, 2, 0.12);
  box(THREE, g, mat.wood, 'single_old_klim_floor_slab_core_2m', [0, 0.06, 0], [2.0, 0.12, 2.0]);
  [-0.60, -0.20, 0.20, 0.60].forEach((x, i) => {
    box(THREE, g, mat.woodDark, `floor_plank_gap_${i}`, [x, 0.128, 0], [0.014, 0.018, 1.84]);
  });
  box(THREE, g, mat.dust, 'floor_sandy_wear_patch', [0.36, 0.136, -0.24], [0.86, 0.014, 0.50], [0, 0.18, 0]);
  box(THREE, g, mat.woodDark, 'floor_split_line', [-0.36, 0.142, 0.44], [0.014, 0.018, 0.68], [0, 0.45, 0]);
  return g;
}

function traderRoofBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'traderRoofBlock', 2, 2, 0.20);
  g.userData.recommendedCenterY = 5.32;
  g.userData.recommendedBottomY = 5.22;
  box(THREE, g, mat.roof, 'single_old_klim_roof_slab_core_2m', [0, 0.10, 0], [2.0, 0.20, 2.0]);
  [-0.66, -0.22, 0.22, 0.66].forEach((x, i) => {
    box(THREE, g, mat.roofRib, `roof_corrugated_rib_${i}`, [x, 0.225, 0], [0.06, 0.055, 1.90]);
  });
  box(THREE, g, mat.woodDark, 'roof_front_dark_lip', [0, 0.08, -0.974], [1.92, 0.12, 0.05]);
  box(THREE, g, mat.woodDark, 'roof_back_dark_lip', [0, 0.08, 0.974], [1.92, 0.12, 0.05]);
  box(THREE, g, mat.dust, 'roof_dust_wear_patch', [0.22, 0.245, -0.20], [0.92, 0.014, 0.54], [0, 0.22, 0]);
  return g;
}

function moduleWallWoodBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'wallWoodBlock', 2, 2, 1);
  box(THREE, g, mat.moduleWood, 'module_wood_wall_block_core_2m', [0, 0.50, 0], [2.0, 1.0, 2.0]);

  const facePlanks = [-0.72, -0.24, 0.24, 0.72];
  facePlanks.forEach((x, i) => {
    box(THREE, g, i % 2 ? mat.moduleWoodLight : mat.moduleWood, `wood_front_vertical_plank_${i}`, [x, 0.52, -0.982], [0.42, 0.88, 0.035]);
    box(THREE, g, i % 2 ? mat.moduleWood : mat.moduleWoodLight, `wood_back_vertical_plank_${i}`, [-x, 0.52, 0.982], [0.42, 0.88, 0.035]);
    box(THREE, g, i % 2 ? mat.moduleWoodLight : mat.moduleWood, `wood_left_vertical_plank_${i}`, [-0.982, 0.52, x], [0.035, 0.88, 0.42]);
    box(THREE, g, i % 2 ? mat.moduleWood : mat.moduleWoodLight, `wood_right_vertical_plank_${i}`, [0.982, 0.52, -x], [0.035, 0.88, 0.42]);
  });
  [-0.48, 0, 0.48].forEach((x, i) => {
    box(THREE, g, mat.moduleWoodDark, `wood_front_plank_gap_${i}`, [x, 0.50, -0.982], [0.025, 0.88, 0.035]);
    box(THREE, g, mat.moduleWoodDark, `wood_back_plank_gap_${i}`, [x, 0.50, 0.982], [0.025, 0.88, 0.035]);
    box(THREE, g, mat.moduleWoodDark, `wood_left_plank_gap_${i}`, [-0.982, 0.50, x], [0.035, 0.88, 0.025]);
    box(THREE, g, mat.moduleWoodDark, `wood_right_plank_gap_${i}`, [0.982, 0.50, x], [0.035, 0.88, 0.025]);
  });
  box(THREE, g, mat.moduleWoodDark, 'wood_front_cross_brace_a', [-0.42, 0.52, -0.970], [0.14, 1.04, 0.055], [0, 0, -0.72]);
  box(THREE, g, mat.moduleWoodDark, 'wood_front_cross_brace_b', [0.42, 0.52, -0.970], [0.14, 1.04, 0.055], [0, 0, 0.72]);
  box(THREE, g, mat.moduleWoodDark, 'wood_top_cap', [0, 0.978, 0], [2.0, 0.040, 2.0]);
  box(THREE, g, mat.dust, 'wood_wall_dust_patch', [0.26, 0.991, -0.18], [0.86, 0.012, 0.56], [0, 0.2, 0]);
  return g;
}

function moduleWallBrickBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'wallBrickBlock', 2, 2, 1);
  box(THREE, g, mat.moduleBrick, 'module_brick_wall_block_core_2m', [0, 0.50, 0], [2.0, 1.0, 2.0]);

  const mortar = 0.018;
  [0.22, 0.42, 0.62, 0.82].forEach((y, i) => {
    box(THREE, g, mat.moduleMortar, `brick_front_horizontal_mortar_${i}`, [0, y, -0.996], [1.82, mortar, 0.027]);
    box(THREE, g, mat.moduleMortar, `brick_back_horizontal_mortar_${i}`, [0, y, 0.996], [1.82, mortar, 0.027]);
    box(THREE, g, mat.moduleMortar, `brick_left_horizontal_mortar_${i}`, [-0.996, y, 0], [0.027, mortar, 1.82]);
    box(THREE, g, mat.moduleMortar, `brick_right_horizontal_mortar_${i}`, [0.996, y, 0], [0.027, mortar, 1.82]);
  });
  [-0.62, 0, 0.62].forEach((x, i) => {
    const y = i % 2 ? 0.52 : 0.72;
    box(THREE, g, mat.moduleMortar, `brick_front_vertical_mortar_${i}`, [x, y, -0.986], [mortar, 0.32, 0.028]);
    box(THREE, g, mat.moduleMortar, `brick_back_vertical_mortar_${i}`, [-x, y, 0.986], [mortar, 0.32, 0.028]);
    box(THREE, g, mat.moduleMortar, `brick_left_vertical_mortar_${i}`, [-0.986, y, x], [0.028, 0.32, mortar]);
    box(THREE, g, mat.moduleMortar, `brick_right_vertical_mortar_${i}`, [0.986, y, -x], [0.028, 0.32, mortar]);
  });
  box(THREE, g, mat.moduleBrickLight, 'brick_chipped_top_edge_a', [-0.52, 0.988, -0.50], [0.72, 0.018, 0.16], [0, 0.2, 0]);
  box(THREE, g, mat.moduleBrickLight, 'brick_chipped_side_patch', [0.982, 0.62, 0.38], [0.034, 0.18, 0.36], [0, 0, 0.12]);
  box(THREE, g, mat.moduleMortar, 'brick_hairline_crack', [0.32, 0.56, -0.985], [0.016, 0.46, 0.03], [0, 0, -0.38]);
  box(THREE, g, mat.dust, 'brick_top_dust_patch', [0.22, 0.991, 0.12], [1.02, 0.012, 0.68], [0, -0.14, 0]);
  return g;
}

function moduleWallMetalBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'wallMetalBlock', 2, 2, 1);
  box(THREE, g, mat.moduleMetal, 'module_metal_wall_block_core_2m', [0, 0.50, 0], [2.0, 1.0, 2.0]);

  [-0.72, -0.36, 0, 0.36, 0.72].forEach((x, i) => {
    box(THREE, g, mat.moduleMetalDark, `metal_front_corrugated_rib_${i}`, [x, 0.52, -0.972], [0.055, 0.88, 0.055]);
    box(THREE, g, mat.moduleMetalDark, `metal_back_corrugated_rib_${i}`, [-x, 0.52, 0.972], [0.055, 0.88, 0.055]);
    box(THREE, g, mat.moduleMetalDark, `metal_left_corrugated_rib_${i}`, [-0.972, 0.52, x], [0.055, 0.88, 0.055]);
    box(THREE, g, mat.moduleMetalDark, `metal_right_corrugated_rib_${i}`, [0.972, 0.52, -x], [0.055, 0.88, 0.055]);
  });
  [0.18, 0.50, 0.82].forEach((y, i) => {
    box(THREE, g, mat.moduleMetalDark, `metal_front_horizontal_band_${i}`, [0, y, -0.977], [1.84, 0.035, 0.045]);
    box(THREE, g, mat.moduleMetalDark, `metal_back_horizontal_band_${i}`, [0, y, 0.977], [1.84, 0.035, 0.045]);
  });
  box(THREE, g, mat.moduleRust, 'metal_rust_patch_front_large', [-0.46, 0.38, -0.982], [0.36, 0.24, 0.035], [0, 0, -0.08]);
  box(THREE, g, mat.moduleRust, 'metal_rust_patch_side', [0.982, 0.72, -0.36], [0.035, 0.22, 0.42], [0, 0, 0.1]);
  box(THREE, g, mat.moduleMetalDark, 'metal_top_cap', [0, 0.978, 0], [2.0, 0.040, 2.0]);
  return g;
}

function moduleRoofWoodBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'roofWoodBlock', 2, 2, 0.20);
  g.userData.recommendedCenterY = 5.32;
  g.userData.recommendedBottomY = 5.22;
  box(THREE, g, mat.moduleRoofWood, 'module_wood_roof_slab_core_2m', [0, 0.10, 0], [2.0, 0.20, 2.0]);
  [-0.60, -0.20, 0.20, 0.60].forEach((x, i) => {
    box(THREE, g, mat.moduleWoodDark, `wood_roof_plank_gap_${i}`, [x, 0.218, 0], [0.018, 0.035, 1.84]);
  });
  [-0.70, 0, 0.70].forEach((z, i) => {
    box(THREE, g, mat.moduleWoodLight, `wood_roof_cross_batten_${i}`, [0, 0.248, z], [1.78, 0.055, 0.10]);
  });
  box(THREE, g, mat.dust, 'wood_roof_sand_patch', [0.20, 0.286, -0.26], [0.94, 0.014, 0.52], [0, 0.18, 0]);
  return g;
}

function moduleRoofMetalBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'roofMetalBlock', 2, 2, 0.20);
  g.userData.recommendedCenterY = 5.32;
  g.userData.recommendedBottomY = 5.22;
  box(THREE, g, mat.moduleRoofMetal, 'module_metal_roof_slab_core_2m', [0, 0.10, 0], [2.0, 0.20, 2.0]);
  [-0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78].forEach((x, i) => {
    box(THREE, g, i % 2 ? mat.moduleMetalDark : mat.moduleMetal, `metal_roof_corrugated_rib_${i}`, [x, 0.245, 0], [0.055, 0.07, 1.90]);
  });
  box(THREE, g, mat.moduleRust, 'metal_roof_rust_patch_a', [-0.34, 0.292, 0.26], [0.42, 0.016, 0.34], [0, 0.3, 0]);
  box(THREE, g, mat.moduleRust, 'metal_roof_rust_patch_b', [0.52, 0.294, -0.42], [0.28, 0.016, 0.46], [0, -0.18, 0]);
  box(THREE, g, mat.moduleMetalDark, 'metal_roof_front_lip', [0, 0.10, -0.974], [1.92, 0.14, 0.052]);
  box(THREE, g, mat.moduleMetalDark, 'metal_roof_back_lip', [0, 0.10, 0.974], [1.92, 0.14, 0.052]);
  return g;
}

function moduleFloorWoodBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'floorWoodBlock', 2, 2, 0.12);
  box(THREE, g, mat.moduleWood, 'module_wood_floor_slab_core_2m', [0, 0.06, 0], [2.0, 0.12, 2.0]);
  [-0.72, -0.36, 0, 0.36, 0.72].forEach((x, i) => {
    box(THREE, g, mat.moduleWoodDark, `wood_floor_plank_gap_${i}`, [x, 0.128, 0], [0.016, 0.018, 1.84]);
  });
  box(THREE, g, mat.moduleWoodLight, 'wood_floor_replaced_board', [0.34, 0.142, -0.18], [0.30, 0.020, 1.54]);
  box(THREE, g, mat.dust, 'wood_floor_dust_patch', [-0.30, 0.154, 0.30], [0.76, 0.014, 0.44], [0, -0.22, 0]);
  return g;
}

function moduleFloorTileBlock(THREE, mat) {
  const g = new THREE.Group();
  tagModularBlock(g, 'floorTileBlock', 2, 2, 0.12);
  box(THREE, g, mat.moduleTile, 'module_tile_floor_slab_core_2m', [0, 0.06, 0], [2.0, 0.12, 2.0]);
  [-0.50, 0, 0.50].forEach((x, i) => {
    box(THREE, g, mat.moduleTileDark, `tile_floor_vertical_grout_${i}`, [x, 0.132, 0], [0.018, 0.018, 1.90]);
    box(THREE, g, mat.moduleTileDark, `tile_floor_horizontal_grout_${i}`, [0, 0.134, x], [1.90, 0.018, 0.018]);
  });
  box(THREE, g, mat.moduleMortar, 'tile_floor_cracked_tile_a', [0.54, 0.150, -0.52], [0.36, 0.016, 0.026], [0, 0.52, 0]);
  box(THREE, g, mat.moduleMortar, 'tile_floor_cracked_tile_b', [-0.36, 0.151, 0.38], [0.44, 0.016, 0.024], [0, -0.34, 0]);
  box(THREE, g, mat.dust, 'tile_floor_dust_patch', [0.18, 0.160, 0.14], [0.70, 0.014, 0.44], [0, 0.12, 0]);
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
