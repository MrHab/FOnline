"""Build body-fitted B+C scavenged metal armour for the current player rig."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import pi
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


HERE = Path(__file__).resolve().parent
BASE_PATH = HERE / "build_unified_leather_jacket_review.py"
SPEC = importlib.util.spec_from_file_location("realm_leather_review_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared equipment helpers: {BASE_PATH}")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_metal_armor_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def measured_arm_band(
    builder: BASE.DetailBuilder,
    body: bpy.types.Object,
    armature: bpy.types.Object,
    side: str,
    region: str,
    progression: float,
    length: float,
    clearance: float,
    material: int,
    weights: dict[str, float],
) -> tuple[float, float, float]:
    points = BASE.group_points(body, armature, {f"{region}_{side}"})
    minimum, maximum = BASE.bounds(points)
    direction = 1.0 if side == "l" else -1.0
    inner = min(abs(minimum.x), abs(maximum.x))
    outer = max(abs(minimum.x), abs(maximum.x))
    center_x = direction * (inner + (outer - inner) * progression)
    sample = [point for point in points if abs(point.x - center_x) <= max(0.035, length * 0.75)]
    sample_minimum, sample_maximum = BASE.bounds(sample or points)
    center_yz = (
        (sample_minimum.y + sample_maximum.y) * 0.5,
        (sample_minimum.z + sample_maximum.z) * 0.5,
    )
    radii = (
        (sample_maximum.y - sample_minimum.y) * 0.5 + clearance,
        (sample_maximum.z - sample_minimum.z) * 0.5 + clearance,
    )
    x0, x1 = sorted((center_x - length * 0.5, center_x + length * 0.5))
    builder.ellipse_band_x(x0, x1, center_yz, radii, material, weights, segments=16)
    return center_x, center_yz[0], center_yz[1]


def panel_xyz(
    builder: BASE.DetailBuilder,
    points: list[tuple[float, float, float]],
    thickness: float,
    material: int,
    weights: dict[str, float],
) -> None:
    """Extrude a faceted body-wrapping panel along local Y."""
    front = [builder.vertex((x, y - thickness * 0.5, z), weights) for x, y, z in points]
    back = [builder.vertex((x, y + thickness * 0.5, z), weights) for x, y, z in points]
    builder.face(tuple(reversed(front)), material)
    builder.face(tuple(back), material)
    for index in range(len(points)):
        following = (index + 1) % len(points)
        builder.face((front[index], front[following], back[following], back[index]), material)


def build_armour_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x)) + 0.030
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    radius_y = (torso_maximum.y - torso_minimum.y) * 0.5 + 0.032
    front_y = torso_minimum.y - 0.038
    back_y = torso_maximum.y + 0.034
    lower = max(1.055, float(fit["lowerHemZ"]) - 0.025)
    upper = min(1.515, float(fit["upperLimitZ"]) + 0.018)
    builder = BASE.DetailBuilder()

    # Main breastplate: one readable cuirass instead of disconnected boxes.
    chest_bottom = lower + 0.105
    chest_top = upper - 0.008
    chest_outline = [
        (-half_width * 0.67, chest_top),
        (-half_width * 0.94, chest_top - 0.075),
        (-half_width, chest_bottom + 0.090),
        (-half_width * 0.82, chest_bottom),
        (0.0, chest_bottom - 0.028),
        (half_width * 0.82, chest_bottom),
        (half_width, chest_bottom + 0.090),
        (half_width * 0.94, chest_top - 0.075),
        (half_width * 0.67, chest_top),
    ]
    curved_chest = [
        (x, front_y + 0.026 * (abs(x) / max(0.001, half_width)) ** 1.35, z)
        for x, z in chest_outline
    ]
    panel_xyz(builder, curved_chest, 0.030, 1, {"spine_02": 0.38, "spine_03": 0.62})

    # Back plate has a high centre ridge and leaves room for shoulder rotation.
    back_outline = [
        (-half_width * 0.70, chest_top - 0.018),
        (-half_width * 0.96, chest_top - 0.092),
        (-half_width * 0.88, chest_bottom + 0.015),
        (0.0, chest_bottom - 0.020),
        (half_width * 0.88, chest_bottom + 0.015),
        (half_width * 0.96, chest_top - 0.092),
        (half_width * 0.70, chest_top - 0.018),
        (0.0, chest_top + 0.018),
    ]
    curved_back = [
        (x, back_y - 0.020 * (abs(x) / max(0.001, half_width)) ** 1.30, z)
        for x, z in back_outline
    ]
    panel_xyz(builder, curved_back, 0.026, 1, {"spine_02": 0.34, "spine_03": 0.66})

    # Three overlapping abdominal lames keep the waist mobile in walk/run.
    lame_height = 0.060
    lame_centres: list[float] = []
    for index in range(3):
        z = lower + 0.030 + index * 0.052
        lame_centres.append(z)
        width = half_width * (0.83 + index * 0.045)
        outline = [
            (-width, z + lame_height * 0.48),
            (-width * 0.91, z - lame_height * 0.50),
            (0.0, z - lame_height * 0.62),
            (width * 0.91, z - lame_height * 0.50),
            (width, z + lame_height * 0.48),
        ]
        builder.prism_xz(outline, front_y - 0.006 - index * 0.003, 0.024, 2, BASE.torso_weights(z))

    # Broad side straps visually connect front and rear plates.
    for z in (lower + 0.030, chest_bottom + 0.145, chest_top - 0.105):
        builder.ellipse_band_z(
            (0.0, center_y),
            (half_width * 0.99, radius_y * 1.01),
            z - 0.018,
            z + 0.018,
            3,
            BASE.torso_weights(z),
            segments=22,
        )

    # Rear neck guard reads clearly from the game's high camera.
    builder.ellipse_arc_band_z(
        (0.0, center_y + 0.006),
        (half_width * 0.61, radius_y * 0.94),
        chest_top - 0.015,
        chest_top + 0.080,
        0.12,
        pi - 0.12,
        2,
        {"spine_03": 0.82, "neck_01": 0.18},
        segments=14,
    )

    # Shoulder cops and forearm bracers are body-measured for all six rigs.
    arm_centres: list[tuple[str, str, tuple[float, float, float]]] = []
    for side in ("l", "r"):
        shoulder = measured_arm_band(
            builder, body, armature, side, "upperarm", 0.20, 0.105, 0.030, 1,
            {f"clavicle_{side}": 0.28, f"upperarm_{side}": 0.72},
        )
        arm_centres.append((side, "shoulder", shoulder))
        forearm = measured_arm_band(
            builder, body, armature, side, "lowerarm", 0.48, 0.125, 0.020, 2,
            {f"lowerarm_{side}": 1.0},
        )
        arm_centres.append((side, "forearm", forearm))

        direction = 1.0 if side == "l" else -1.0
        # Flat top cap breaks the tubular silhouette of the measured band.
        builder.box(
            (shoulder[0], shoulder[1] - 0.004, shoulder[2] + 0.055),
            (0.132, 0.138, 0.034),
            1,
            {f"clavicle_{side}": 0.22, f"upperarm_{side}": 0.78},
        )
        for offset in (-0.040, 0.040):
            builder.octahedron(
                (shoulder[0] + direction * offset, shoulder[1] - 0.076, shoulder[2] + 0.045),
                0.009,
                2,
                {f"upperarm_{side}": 1.0},
            )

    # Raised centre rib, lower flange and asymmetric field repair.
    builder.box((0.0, front_y - 0.020, (chest_bottom + chest_top) * 0.5), (0.020, 0.018, chest_top - chest_bottom - 0.035), 2, {"spine_02": 0.40, "spine_03": 0.60})
    builder.box((0.0, front_y - 0.022, chest_bottom + 0.012), (half_width * 1.58, 0.020, 0.027), 2, {"spine_02": 0.80, "spine_03": 0.20})
    patch = [
        (-half_width * 0.73, chest_bottom + 0.085),
        (-half_width * 0.25, chest_bottom + 0.075),
        (-half_width * 0.30, chest_bottom + 0.195),
        (-half_width * 0.76, chest_bottom + 0.178),
    ]
    builder.prism_xz(patch, front_y - 0.025, 0.013, 2, {"spine_02": 0.72, "spine_03": 0.28})

    # Rivets remain large enough to survive the isometric camera.
    rivet_points: list[tuple[float, float, float]] = []
    for x in (-half_width * 0.78, half_width * 0.78):
        for z in (chest_bottom + 0.055, chest_bottom + 0.185, chest_top - 0.070):
            rivet_points.append((x, front_y - 0.034, z))
            builder.octahedron((x, front_y - 0.034, z), 0.010, 2, BASE.torso_weights(z))
    for x in (-half_width * 0.68, 0.0, half_width * 0.68):
        builder.octahedron((x, back_y + 0.027, chest_bottom + 0.055), 0.009, 2, {"spine_02": 0.75, "spine_03": 0.25})

    mesh = bpy.data.meshes.new(f"{asset_id}_plates_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_plates", mesh)
    bpy.context.collection.objects.link(details)
    details.parent = armature
    details.matrix_parent_inverse = Matrix.Identity(4)
    details.matrix_world = armature.matrix_world.copy()
    group_names = sorted({name for weights in builder.weights for name, weight in weights.items() if weight > 0.0})
    vertex_groups = {name: details.vertex_groups.new(name=name) for name in group_names}
    for vertex_index, weights in enumerate(builder.weights):
        total = sum(weights.values())
        for name, weight in weights.items():
            if total > 0.0 and weight > 0.0:
                vertex_groups[name].add([vertex_index], weight / total, "REPLACE")
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bevel = details.modifiers.new("softened_plate_edges", "BEVEL")
    bevel.width = 0.0045
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.82, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    details.select_set(False)
    details["realm_asset_id"] = asset_id
    details["realm_item_id"] = "metalArmor"
    details["realm_equipment_slot"] = "armor"
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details, {
        "plateThickness": 0.030,
        "chestOutlinePoints": len(chest_outline),
        "backOutlinePoints": len(back_outline),
        "abdominalLames": len(lame_centres),
        "measuredArmPieces": len(arm_centres),
        "rivetCount": len(rivet_points) + 3,
        "halfWidth": round(half_width, 5),
        "frontY": round(front_y, 5),
        "backY": round(back_y, 5),
    }


def main() -> None:
    args = parse_args()
    BASE.clear_scene()
    reference_objects = BASE.import_glb(args.reference_character)
    armature = next((obj for obj in reference_objects if obj.type == "ARMATURE"), None)
    body = next((obj for obj in reference_objects if obj.type == "MESH" and "body" in obj.name.lower()), None)
    if armature is None or body is None:
        raise RuntimeError("Reference character must contain the current armature and body mesh")
    armature.data.pose_position = "REST"
    if armature.animation_data:
        armature.animation_data_clear()
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()

    materials = (
        BASE.pbr_material("metal_armour_charcoal_padding", (0.060, 0.068, 0.061), 0.92, 0.0, f"{args.body_id}:padding", 0.07),
        BASE.pbr_material("metal_armour_worn_steel", (0.185, 0.205, 0.195), 0.58, 0.72, f"{args.body_id}:steel", 0.12),
        BASE.pbr_material("metal_armour_oxidised_edges", (0.205, 0.090, 0.035), 0.79, 0.38, f"{args.body_id}:rust", 0.10),
        BASE.pbr_material("metal_armour_aged_straps", (0.095, 0.046, 0.025), 0.88, 0.0, f"{args.body_id}:strap", 0.09),
    )
    liner, fit = BASE.build_shell(body, armature, args.asset_id)
    liner.name = f"{args.asset_id}_padded_liner"
    liner["realm_item_id"] = "metalArmor"
    liner["realm_equipment_slot"] = "armor"
    details, detail_report = build_armour_details(body, armature, args.asset_id, fit)
    for obj in (liner, details):
        for material in materials:
            obj.data.materials.append(material)

    helpers = BASE.pose_review(armature)
    if args.front_render:
        BASE.render_review(armature, args.front_render, (2.35, -4.1, 2.05), (0.0, 0.0, 1.04), 2.05)
    if args.back_render:
        BASE.render_review(armature, args.back_render, (-2.45, 4.0, 2.12), (0.0, 0.0, 1.06), 2.05)
    if args.detail_render:
        BASE.render_review(armature, args.detail_render, (1.32, -3.15, 1.78), (0.0, -0.02, 1.28), 1.18)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    BASE.reset_pose(armature, helpers)
    for obj in list(reference_objects):
        if obj != armature and obj not in (liner, details) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, liner, details)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    BASE.export_candidate(args.output, armature, [liner, details])
    actual = BASE.parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "itemId": "metalArmor",
        "slot": "armor",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "details": detail_report,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-fitted B geometry with authored B+C scavenged steel plates on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_METAL_ARMOR_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
