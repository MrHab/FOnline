  function addTraderBuildingInterior(group) {
    // v7.71: interior scaled to a real 12.0 x 8.4 m shop.
    // The player must believe the trader works and stores goods here.
    createBuildingBox(group, 1.35, 0.55, 1.35, 3.45, 0.68, 0.72, mats.realScaleWoodFloor, { kind: 'real-trader-counter-body' });
    createBuildingBox(group, 1.35, 0.96, 1.35, 3.72, 0.12, 0.84, mats.realScaleRoofWood, { kind: 'real-trader-counter-top' });
    createBuildingBox(group, 1.35, 1.38, 1.05, 3.55, 0.15, 0.18, mats.darkMetal, { kind: 'counter-back-rail' });

    // Left and right shop shelves.
    createBuildingBox(group, -4.42, 1.05, 0.70, 0.46, 2.02, 3.55, mats.realScaleRoofWood, { kind: 'left-real-shop-shelf-frame' });
    createBuildingBox(group, 4.42, 1.05, 0.78, 0.46, 2.02, 3.45, mats.realScaleRoofWood, { kind: 'right-real-shop-shelf-frame' });
    [-0.80, 0.05, 0.90].forEach((pz, i) => {
      createBuildingBox(group, -4.10, 0.62 + i * 0.50, pz, 0.64, 0.10, 1.55, mats.realScaleWoodFloor, { kind: 'left-real-shop-shelf-board' });
      createBuildingBox(group, 4.10, 0.62 + i * 0.50, pz, 0.64, 0.10, 1.55, mats.realScaleWoodFloor, { kind: 'right-real-shop-shelf-board' });
    });

    // Rear storage corner inside the shop.
    createBuildingBox(group, -2.35, 0.58, 2.72, 1.32, 0.88, 0.82, mats.realScaleMixedFloor, { kind: 'rear-storage-crate-large' });
    createBuildingBox(group, -1.35, 0.94, 2.80, 0.82, 0.48, 0.62, mats.cloth, { kind: 'rear-storage-cloth-bundle' });
    createBuildingBox(group, 3.30, 0.95, 2.70, 0.88, 1.72, 0.70, mats.darkMetal, { kind: 'rear-metal-safe-cabinet' });
    createBuildingBox(group, 2.35, 0.40, 2.70, 0.82, 0.58, 0.72, mats.realScaleWoodFloor, { kind: 'rear-supply-box' });

    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mats.ember);
    lamp.position.set(0.85, 2.55, 1.00);
    lamp.userData.kind = 'real-shop-warm-lamp';
    group.add(lamp);
    if (!IS_MOBILE_DEVICE && graphicsDetailLevel() >= 0.70) {
      const warm = new THREE.PointLight(0xffc77a, 0.42, 6.5, 1.4);
      warm.position.set(0.85, 2.45, 1.00);
      warm.castShadow = false;
      group.add(warm);
    }
  }




