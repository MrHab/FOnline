"""Build a body-fitted B+C external-frame backpack for the current player rig."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import cos, pi, sin
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


HERE = Path(__file__).resolve().parent
METAL_PATH = HERE / "build_unified_metal_armor_review.py"
SPEC = importlib.util.spec_from_file_location("realm_metal_review_base", METAL_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared equipment helpers: {METAL_PATH}")
METAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(METAL)
BASE = METAL.BASE

RUNTIME_ARMOR_OFFSETS = {
    "": 0.000,
    "leather": 0.020,
    "metalArmor": 0.040,
    "ballisticVest": 0.035,
    "combatArmor": 0.050,
    "hazmatSuit": 0.030,
    "heavyArmor": 0.070,
    "energySuit": 0.040,
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_backpack_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def closed_ellipse_prism_x(
    builder: BASE.DetailBuilder,
    x0: float,
    x1: float,
    center_yz: tuple[float, float],
    radii_yz: tuple[float, float],
    material: int,
    weights: dict[str, float],
    segments: int = 12,
) -> None:
    rings: list[list[int]] = []
    for x in (x0, x1):
        ring = []
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            ring.append(builder.vertex((
                x,
                center_yz[0] + cos(angle) * radii_yz[0],
                center_yz[1] + sin(angle) * radii_yz[1],
            ), weights))
        rings.append(ring)
    builder.face(tuple(reversed(rings[0])), material)
    builder.face(tuple(rings[1]), material)
    for index in range(segments):
        following = (index + 1) % segments
        builder.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)


def path_ribbon_x(
    builder: BASE.DetailBuilder,
    points: list[tuple[float, float, float]],
    point_weights: list[dict[str, float]],
    width: float,
    thickness: float,
    material: int,
) -> None:
    """Create a solid strap that follows a back-shoulder-front path."""
    if len(points) < 2 or len(points) != len(point_weights):
        raise ValueError("A strap needs matching path points and weights")
    sections: list[list[int]] = []
    half_width = width * 0.5
    half_thickness = thickness * 0.5
    for (x, y, z), weights in zip(points, point_weights):
        sections.append([
            builder.vertex((x - half_width, y - half_thickness, z), weights),
            builder.vertex((x + half_width, y - half_thickness, z), weights),
            builder.vertex((x + half_width, y + half_thickness, z), weights),
            builder.vertex((x - half_width, y + half_thickness, z), weights),
        ])
    builder.face(tuple(reversed(sections[0])), material)
    builder.face(tuple(sections[-1]), material)
    for index in range(len(sections) - 1):
        current = sections[index]
        following = sections[index + 1]
        for edge in range(4):
            next_edge = (edge + 1) % 4
            builder.face((current[edge], current[next_edge], following[next_edge], following[edge]), material)


def build_backpack(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[tuple[bpy.types.Object, bpy.types.Object], dict[str, object]]:
    torso_points = BASE.group_points(body, armature, BASE.TORSO_GROUPS)
    torso_minimum, torso_maximum = BASE.bounds(torso_points)
    half_width = max(abs(torso_minimum.x), abs(torso_maximum.x))
    pack_half_width = min(0.340, max(0.240, half_width * 1.18))
    pack_lower = max(1.005, torso_minimum.z + 0.115)
    pack_upper = min(1.500, torso_maximum.z - 0.025)
    pack_front_y = torso_maximum.y + 0.046
    pack_depth = 0.205
    pack_center_y = pack_front_y + pack_depth * 0.5
    pack_back_y = pack_front_y + pack_depth
    pack_weights = {"spine_02": 0.42, "spine_03": 0.58}
    pack_builder = BASE.DetailBuilder()
    harness_builder = BASE.DetailBuilder()
    builder = pack_builder

    # Main sack is one tapered, faceted volume with a deliberately soft outline.
    outline = [
        (-pack_half_width * 0.72, pack_upper),
        (-pack_half_width * 0.94, pack_upper - 0.075),
        (-pack_half_width, pack_lower + 0.105),
        (-pack_half_width * 0.78, pack_lower),
        (pack_half_width * 0.78, pack_lower),
        (pack_half_width, pack_lower + 0.105),
        (pack_half_width * 0.94, pack_upper - 0.075),
        (pack_half_width * 0.72, pack_upper),
    ]
    METAL.panel_xyz(builder, [(x, pack_center_y, z) for x, z in outline], pack_depth, 0, pack_weights)

    # Roll-top flap and lower compression panel remain separate readable layers.
    flap_top = pack_upper - 0.020
    flap_bottom = pack_upper - 0.175
    flap = [
        (-pack_half_width * 0.73, flap_top),
        (-pack_half_width * 0.86, flap_top - 0.035),
        (-pack_half_width * 0.72, flap_bottom),
        (0.0, flap_bottom - 0.025),
        (pack_half_width * 0.72, flap_bottom),
        (pack_half_width * 0.86, flap_top - 0.035),
        (pack_half_width * 0.73, flap_top),
    ]
    METAL.panel_xyz(builder, [(x, pack_back_y + 0.012, z) for x, z in flap], 0.018, 0, pack_weights)
    builder.prism_xz([
        (-pack_half_width * 0.78, pack_lower + 0.125),
        (-pack_half_width * 0.70, pack_lower + 0.025),
        (pack_half_width * 0.70, pack_lower + 0.025),
        (pack_half_width * 0.78, pack_lower + 0.125),
    ], pack_back_y + 0.014, 0.022, 1, {"spine_01": 0.20, "spine_02": 0.80})

    # External frame and crossbars make the pack visibly load-bearing.
    frame_y = pack_back_y + 0.036
    for x in (-pack_half_width * 0.86, pack_half_width * 0.86):
        builder.box(
            (x, frame_y, (pack_lower + pack_upper) * 0.5),
            (0.030, 0.030, pack_upper - pack_lower + 0.115), 2, pack_weights,
        )
    for z in (pack_lower + 0.035, pack_lower + 0.205, pack_upper - 0.025):
        builder.box((0.0, frame_y + 0.002, z), (pack_half_width * 1.78, 0.028, 0.028), 2, BASE.torso_weights(z))

    # Body-measured shoulder harness: straps travel from the rear frame over
    # each shoulder and down the chest, so the pack never reads as floating.
    builder = harness_builder
    torso_center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    for side, direction in (("l", 1.0), ("r", -1.0)):
        path_ribbon_x(builder, [
            (direction * pack_half_width * 0.34, pack_front_y + 0.010, pack_upper - 0.020),
            (direction * pack_half_width * 0.45, torso_maximum.y + 0.016, pack_upper + 0.010),
            (direction * pack_half_width * 0.52, torso_center_y + 0.005, torso_maximum.z - 0.035),
            (direction * pack_half_width * 0.50, torso_minimum.y - 0.020, pack_upper - 0.080),
            (direction * pack_half_width * 0.38, torso_minimum.y - 0.032, pack_lower + 0.155),
        ], [
            {"spine_03": 0.82, f"clavicle_{side}": 0.18},
            {"spine_03": 0.62, f"clavicle_{side}": 0.38},
            {"spine_03": 0.35, f"clavicle_{side}": 0.65},
            {"spine_03": 0.52, f"clavicle_{side}": 0.48},
            {"spine_02": 0.72, "spine_03": 0.28},
        ], 0.052, 0.016, 1)
        buckle_x = direction * pack_half_width * 0.38
        buckle_z = pack_lower + 0.205
        builder.box(
            (buckle_x, torso_minimum.y - 0.047, buckle_z),
            (0.062, 0.024, 0.055), 2, {"spine_02": 0.78, "spine_03": 0.22},
        )
        pack_builder.box(
            (direction * pack_half_width * 0.43, pack_back_y + 0.050, pack_lower + 0.220),
            (0.045, 0.024, 0.060), 2, {"spine_02": 0.82, "spine_03": 0.18},
        )
    sternum_z = pack_lower + 0.265
    builder.box(
        (0.0, torso_minimum.y - 0.044, sternum_z),
        (pack_half_width * 0.78, 0.018, 0.024), 1,
        {"spine_02": 0.58, "spine_03": 0.42},
    )
    builder.box((0.0, torso_minimum.y - 0.058, sternum_z), (0.056, 0.026, 0.050), 2, {"spine_02": 0.58, "spine_03": 0.42})
    belt_center_y = torso_center_y
    belt_radii = (half_width + 0.050, (torso_maximum.y - torso_minimum.y) * 0.5 + 0.050)
    builder.ellipse_arc_band_z(
        (0.0, belt_center_y), belt_radii,
        pack_lower + 0.040, pack_lower + 0.085,
        0.08, pi - 0.08, 1,
        {"spine_01": 0.74, "spine_02": 0.26}, segments=20,
    )

    # Two side pockets sit outside the arm sweep and use individual buckles.
    builder = pack_builder
    pocket_width = max(0.090, pack_half_width * 0.34)
    pocket_center_z = pack_lower + 0.185
    for direction in (-1.0, 1.0):
        x = direction * (pack_half_width + pocket_width * 0.43)
        builder.box((x, pack_center_y + 0.025, pocket_center_z), (pocket_width, 0.155, 0.230), 0, {"spine_02": 0.92, "spine_03": 0.08})
        builder.box((x, pack_back_y + 0.030, pocket_center_z + 0.055), (pocket_width * 0.72, 0.025, 0.050), 1, {"spine_02": 1.0})
        builder.octahedron((x, pack_back_y + 0.052, pocket_center_z + 0.025), 0.012, 2, {"spine_02": 1.0})

    # Top cargo roll and bottom bedroll have straps wrapped around the roll,
    # rather than decorative bars floating in front of it.
    top_roll_center = (pack_center_y + 0.030, pack_upper + 0.070)
    closed_ellipse_prism_x(
        builder, -pack_half_width * 0.82, pack_half_width * 0.82,
        top_roll_center, (0.090, 0.062), 3, {"spine_03": 1.0}, segments=12,
    )
    bottom_roll_center = (pack_center_y + 0.035, pack_lower - 0.072)
    closed_ellipse_prism_x(
        builder, -pack_half_width * 0.88, pack_half_width * 0.88,
        bottom_roll_center, (0.088, 0.070), 3,
        {"spine_01": 0.20, "spine_02": 0.80}, segments=12,
    )
    for x in (-pack_half_width * 0.50, pack_half_width * 0.50):
        builder.ellipse_band_x(
            x - 0.012, x + 0.012, bottom_roll_center,
            (0.096, 0.078), 1, {"spine_02": 1.0}, segments=12,
        )

    # Scale cues and field repairs survive the isometric camera.
    builder.box((0.0, pack_back_y + 0.050, (flap_top + flap_bottom) * 0.5), (0.040, 0.024, flap_top - flap_bottom - 0.010), 1, {"spine_03": 0.72, "spine_02": 0.28})
    for x in (-pack_half_width * 0.45, 0.0, pack_half_width * 0.45):
        builder.octahedron((x, pack_back_y + 0.054, flap_bottom + 0.025), 0.011, 2, {"spine_03": 0.58, "spine_02": 0.42})
    patch = [
        (pack_half_width * 0.20, pack_lower + 0.255),
        (pack_half_width * 0.62, pack_lower + 0.242),
        (pack_half_width * 0.58, pack_lower + 0.340),
        (pack_half_width * 0.24, pack_lower + 0.330),
    ]
    builder.prism_xz(patch, pack_back_y + 0.052, 0.012, 4, {"spine_02": 0.62, "spine_03": 0.38})
    # Carry handle is a three-part arch connected to the top frame.
    handle_z = pack_upper + 0.122
    builder.box((-0.070, pack_back_y + 0.018, handle_z - 0.025), (0.026, 0.026, 0.075), 1, {"spine_03": 1.0})
    builder.box((0.070, pack_back_y + 0.018, handle_z - 0.025), (0.026, 0.026, 0.075), 1, {"spine_03": 1.0})
    builder.box((0.0, pack_back_y + 0.018, handle_z + 0.010), (0.155, 0.026, 0.026), 1, {"spine_03": 1.0})

    def make_layer(layer_builder: BASE.DetailBuilder, suffix: str, layer: str) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{asset_id}_{suffix}_mesh")
        mesh.from_pydata(layer_builder.vertices, [], layer_builder.faces)
        mesh.update()
        for polygon, material_index in zip(mesh.polygons, layer_builder.materials):
            polygon.material_index = material_index
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f"{asset_id}_{suffix}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = armature
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = armature.matrix_world.copy()
        group_names = sorted({name for weights in layer_builder.weights for name, weight in weights.items() if weight > 0.0})
        vertex_groups = {name: obj.vertex_groups.new(name=name) for name in group_names}
        for vertex_index, weights in enumerate(layer_builder.weights):
            total = sum(weights.values())
            for name, weight in weights.items():
                if total > 0.0 and weight > 0.0:
                    vertex_groups[name].add([vertex_index], weight / total, "REPLACE")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bevel = obj.modifiers.new("pack_edge_softening", "BEVEL")
        bevel.width = 0.004
        bevel.segments = 2
        bevel.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        modifier = obj.modifiers.new("current_player_rig", "ARMATURE")
        modifier.object = armature
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=0.84, island_margin=0.018)
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.shade_flat()
        obj.select_set(False)
        obj["realm_asset_id"] = asset_id
        obj["realm_item_id"] = "backpack"
        obj["realm_equipment_slot"] = "backpack"
        obj["realm_backpack_layer"] = layer
        obj["realm_art_direction"] = "character_geometry_b_materials_c"
        obj["realm_review_only"] = True
        obj["realm_runtime_integration_allowed"] = False
        return obj

    pack_shell = make_layer(pack_builder, "external_frame_pack_shell", "pack")
    body_harness = make_layer(harness_builder, "body_harness", "harness")
    return (pack_shell, body_harness), {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "packHalfWidth": round(pack_half_width, 5),
        "packLowerZ": round(pack_lower, 5),
        "packUpperZ": round(pack_upper, 5),
        "packFrontY": round(pack_front_y, 5),
        "packBackY": round(pack_back_y, 5),
        "baseBodyClearance": round(pack_front_y - torso_maximum.y, 5),
        "runtimeArmorOffsets": RUNTIME_ARMOR_OFFSETS,
        "sidePockets": 2,
        "frameRails": 2,
        "frameCrossbars": 3,
        "cargoRolls": 2,
        "shoulderStraps": 2,
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
        BASE.pbr_material("backpack_faded_olive_canvas", (0.115, 0.125, 0.075), 0.94, 0.0, f"{args.body_id}:canvas", 0.13),
        BASE.pbr_material("backpack_aged_brown_webbing", (0.095, 0.050, 0.026), 0.90, 0.0, f"{args.body_id}:webbing", 0.11),
        BASE.pbr_material("backpack_oxidised_frame_steel", (0.170, 0.180, 0.160), 0.63, 0.58, f"{args.body_id}:frame", 0.10),
        BASE.pbr_material("backpack_dusty_blanket_roll", (0.230, 0.135, 0.070), 0.92, 0.0, f"{args.body_id}:blanket", 0.13),
        BASE.pbr_material("backpack_faded_field_patch", (0.285, 0.155, 0.055), 0.88, 0.0, f"{args.body_id}:patch", 0.11),
    )
    backpack_layers, fit = build_backpack(body, armature, args.asset_id)
    pack_shell, body_harness = backpack_layers
    for obj in backpack_layers:
        for material in materials:
            obj.data.materials.append(material)

    helpers = BASE.pose_review(armature)
    if args.front_render:
        BASE.render_review(armature, args.front_render, (2.35, -4.1, 2.05), (0.0, 0.0, 1.04), 2.05)
    if args.back_render:
        BASE.render_review(armature, args.back_render, (-2.55, 4.25, 2.15), (0.0, 0.02, 1.08), 2.08)
    if args.detail_render:
        BASE.render_review(armature, args.detail_render, (-1.35, 3.25, 1.82), (0.0, 0.05, 1.22), 1.35)
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    BASE.reset_pose(armature, helpers)
    for obj in list(reference_objects):
        if obj != armature and obj not in backpack_layers and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, pack_shell, body_harness)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    BASE.export_candidate(args.output, armature, list(backpack_layers))
    actual = BASE.parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "itemId": "backpack",
        "slot": "backpack",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-measured B geometry with B+C canvas, external frame, compression straps, pockets and cargo rolls on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_BACKPACK_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
