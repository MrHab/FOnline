"""Build body-fitted B+C scout boots for the current six player bodies.

The approved v21 anatomical boot is retained as the fit base. Original light
field geometry adds a flexible toe guard, external ankle patches, gaiter
collars, stabilising straps, a heel kick pad, pull tabs and separated trail
lugs. Every pair is skinned directly to the exact current 65-bone rig.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


def load_module(filename: str, module_name: str):
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load boot helper: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE = load_module("build_unified_boots_review.py", "realm_boot_base")
REINFORCED = load_module("build_unified_reinforced_boots_review.py", "realm_reinforced_boot_helpers")


def normalized(weights: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, value) for value in weights.values())
    return {
        name: max(0.0, value) / total
        for name, value in weights.items()
        if total > 0.0 and value > 0.0
    }


def add_panel_x(
    builder,
    x_outer: float,
    x_inner: float,
    outline: tuple[tuple[float, float], ...],
    material: int,
    weights: dict[str, float],
) -> None:
    weights = normalized(weights)
    outer = [builder.add_vertex((x_outer, y, z), weights) for y, z in outline]
    inner = [builder.add_vertex((x_inner, y, z), weights) for y, z in outline]
    builder.add_face(tuple(outer), material)
    builder.add_face(tuple(reversed(inner)), material)
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        builder.add_face((outer[index], outer[following], inner[following], inner[index]), material)


def add_panel_y(
    builder,
    y_outer: float,
    y_inner: float,
    outline: tuple[tuple[float, float], ...],
    material: int,
    weights: dict[str, float],
) -> None:
    weights = normalized(weights)
    outer = [builder.add_vertex((x, y_outer, z), weights) for x, z in outline]
    inner = [builder.add_vertex((x, y_inner, z), weights) for x, z in outline]
    builder.add_face(tuple(outer), material)
    builder.add_face(tuple(reversed(inner)), material)
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        builder.add_face((outer[index], outer[following], inner[following], inner[index]), material)


def add_light_toe_guard(
    builder,
    side: str,
    center_x: float,
    half_width: float,
    heel_y: float,
    toe_y: float,
    sole_top: float,
) -> None:
    depth = heel_y - toe_y
    stations = (
        (-0.025, 0.32, sole_top + 0.046, 0.76),
        (0.06, 0.58, sole_top + 0.050, 0.62),
        (0.13, 0.83, sole_top + 0.064, 0.50),
        (0.21, 0.92, sole_top + 0.070, 0.34),
    )
    arcs: list[list[int]] = []
    arc_segments = 8
    for progression, width_factor, top_z, ball_weight in stations:
        y = toe_y + depth * progression
        width = half_width * width_factor
        ring = []
        for index in range(arc_segments + 1):
            angle = 3.141592653589793 - 3.141592653589793 * index / arc_segments
            x = center_x + __import__("math").cos(angle) * width
            z = sole_top + 0.004 + (top_z - sole_top - 0.004) * (__import__("math").sin(angle) ** 0.76)
            ring.append(builder.add_vertex(
                (x, y, z),
                normalized({f"foot_{side}": 1.0 - ball_weight, f"ball_{side}": ball_weight}),
            ))
        arcs.append(ring)
    for station_index in range(len(arcs) - 1):
        for index in range(arc_segments):
            builder.add_face((
                arcs[station_index][index], arcs[station_index + 1][index],
                arcs[station_index + 1][index + 1], arcs[station_index][index + 1],
            ), 0)
    builder.add_face(tuple(reversed(arcs[0])), 0)


def add_scout_details(
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
    materials: list[bpy.types.Material],
) -> tuple[bpy.types.Object, dict[str, object]]:
    builder = BASE.BootMeshBuilder()
    detail_report: dict[str, object] = {}
    for side in ("l", "r"):
        foot_bounds = fit[side]["footBounds"]
        minimum = Vector(foot_bounds["minimum"])
        maximum = Vector(foot_bounds["maximum"])
        sole = fit[side]["sole"]
        center_x = (minimum.x + maximum.x) * 0.5
        half_width = float(sole["halfWidth"])
        heel_y = float(sole["heelY"])
        toe_y = float(sole["toeY"])
        sole_bottom = float(sole["bottomZ"])
        sole_top = float(sole["topZ"])
        ankle_center_y = min(maximum.y - 0.045, 0.082)
        ankle_width = max(0.058, half_width * 0.88)
        direction = 1.0 if side == "l" else -1.0

        add_light_toe_guard(builder, side, center_x, half_width, heel_y, toe_y, sole_top)

        # Low-profile gaiter seals dust without turning the boot into armour.
        BASE.add_elliptic_tube(
            builder,
            side,
            center_x,
            ankle_center_y,
            (
                (0.216, ankle_width * 1.10, 0.072),
                (0.236, ankle_width * 1.15, 0.075),
                (0.256, ankle_width * 1.08, 0.071),
            ),
            1,
            14,
        )

        # Two narrow stabilising straps retain ankle mobility.
        for lower_z in (0.126, 0.174):
            BASE.add_elliptic_tube(
                builder,
                side,
                center_x,
                ankle_center_y,
                (
                    (lower_z, ankle_width * 1.055, 0.067),
                    (lower_z + 0.012, ankle_width * 1.075, 0.069),
                ),
                2,
                14,
            )

        # Outer flexible patch and small navigation-colour marker.
        outer_x = center_x + direction * ankle_width * 1.08
        add_panel_x(
            builder,
            outer_x + direction * 0.004,
            outer_x - direction * 0.004,
            (
                (ankle_center_y - 0.050, 0.128),
                (ankle_center_y - 0.038, 0.205),
                (ankle_center_y + 0.030, 0.216),
                (ankle_center_y + 0.058, 0.188),
                (ankle_center_y + 0.050, 0.132),
            ),
            1,
            {f"calf_{side}": 0.66, f"foot_{side}": 0.34},
        )
        REINFORCED.add_box(
            builder,
            (outer_x + direction * 0.005, ankle_center_y - 0.018, 0.178),
            (0.004, 0.032, 0.020),
            4,
            {f"calf_{side}": 0.72, f"foot_{side}": 0.28},
        )

        # Heel kick pad and pull loop are readable from the isometric camera.
        add_panel_y(
            builder,
            heel_y + 0.010,
            heel_y + 0.002,
            (
                (center_x - half_width * 0.78, 0.060),
                (center_x - half_width * 0.68, 0.116),
                (center_x - half_width * 0.44, 0.136),
                (center_x + half_width * 0.44, 0.136),
                (center_x + half_width * 0.68, 0.116),
                (center_x + half_width * 0.78, 0.060),
            ),
            0,
            {f"foot_{side}": 1.0},
        )
        REINFORCED.add_box(
            builder,
            (center_x, ankle_center_y + 0.074, 0.244),
            (0.024, 0.008, 0.052),
            2,
            {f"calf_{side}": 0.92, f"foot_{side}": 0.08},
        )

        # Separated shallow trail lugs keep the sole light and flexible.
        depth = heel_y - toe_y
        lug_progressions = (0.10, 0.29, 0.50, 0.70, 0.87)
        for index, progression in enumerate(lug_progressions):
            y = heel_y + (toe_y - heel_y) * progression
            width_factor = (0.62, 0.90, 0.96, 0.88, 0.64)[index]
            ball_weight = max(0.0, min(0.72, (progression - 0.45) / 0.46))
            REINFORCED.add_box(
                builder,
                (center_x, y, sole_bottom - 0.003),
                (half_width * 2.0 * width_factor, depth * 0.060, 0.008),
                0,
                normalized({f"foot_{side}": 1.0 - ball_weight, f"ball_{side}": ball_weight}),
            )

        # Two small dull hooks anchor the upper strap.
        for hook_direction in (-1.0, 1.0):
            REINFORCED.add_prism_y(
                builder,
                Vector((center_x + hook_direction * ankle_width * 0.92, ankle_center_y - 0.066, 0.184)),
                0.005,
                0.008,
                3,
                {f"calf_{side}": 0.72, f"foot_{side}": 0.28},
                8,
            )

        detail_report[side] = {
            "toeGuard": True,
            "gaiterCollar": True,
            "ankleStraps": 2,
            "outerFlexiblePatch": True,
            "heelKickPad": True,
            "pullLoop": True,
            "trailLugs": len(lug_progressions),
            "strapHooks": 2,
            "weights": [f"foot_{side}", f"ball_{side}", f"calf_{side}"],
        }

    mesh = bpy.data.meshes.new(f"{asset_id}_scout_details_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.face_materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_scout_details", mesh)
    bpy.context.collection.objects.link(details)
    details.parent = armature
    details.matrix_parent_inverse = Matrix.Identity(4)
    details.matrix_world = armature.matrix_world.copy()
    for material in materials:
        details.data.materials.append(material)
    group_names = sorted({name for weights in builder.weights for name, value in weights.items() if value > 0.0})
    groups = {name: details.vertex_groups.new(name=name) for name in group_names}
    for vertex_index, weights in enumerate(builder.weights):
        for name, value in normalized(weights).items():
            groups[name].add([vertex_index], value, "REPLACE")
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.88, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    details.select_set(False)
    return details, detail_report


def combine_boot_objects(boots, details, asset_id: str):
    bpy.ops.object.select_all(action="DESELECT")
    boots.select_set(True)
    details.select_set(True)
    bpy.context.view_layer.objects.active = boots
    bpy.ops.object.join()
    boots.name = asset_id
    boots.data.name = f"{asset_id}_mesh"
    boots["realm_asset_id"] = asset_id
    boots["realm_item_id"] = "scoutBoots"
    boots["realm_item_name_ru"] = "Разведботинки"
    boots["realm_equipment_slot"] = "boots"
    boots["realm_art_direction"] = "character_geometry_b_materials_c"
    boots["realm_review_only"] = True
    boots["realm_runtime_integration_allowed"] = False
    boots["realm_geometry_provenance"] = "approved v21 anatomical fit with original light field geometry"
    boots.select_set(False)
    return boots


def main() -> None:
    args = REINFORCED.parse_args()
    BASE.clear_scene()
    reference_objects = BASE.import_glb(args.reference_character)
    armature = next((obj for obj in reference_objects if obj.type == "ARMATURE"), None)
    body = next((obj for obj in reference_objects if obj.type == "MESH" and "body" in obj.name.lower()), None)
    if armature is None or body is None:
        raise RuntimeError("Reference character must contain the current armature and body mesh")
    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    for obj in list(reference_objects):
        if obj.type == "MESH" and obj != body:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    materials = {
        "leather": BASE.pbr_material("scout_boots_weathered_dark_leather", (0.145, 0.075, 0.040), 0.90, 0.0),
        "sole": BASE.pbr_material("scout_boots_flexible_black_rubber", (0.050, 0.058, 0.052), 0.94, 0.0),
        "canvas": BASE.pbr_material("scout_boots_faded_olive_canvas", (0.205, 0.220, 0.125), 0.96, 0.0),
        "hardware": BASE.pbr_material("scout_boots_dull_hardware", (0.18, 0.195, 0.180), 0.72, 0.48),
        "gaiter": BASE.pbr_material("scout_boots_dust_gaiter", (0.245, 0.255, 0.155), 0.97, 0.0),
        "webbing": BASE.pbr_material("scout_boots_aged_webbing", (0.205, 0.135, 0.075), 0.92, 0.0),
        "marker": BASE.pbr_material("scout_boots_faded_route_marker", (0.48, 0.245, 0.055), 0.88, 0.0),
    }
    boots, fit = BASE.build_original_body_fitted_boots(body, armature, args.asset_id)
    for name in ("leather", "sole", "canvas", "hardware"):
        boots.data.materials.append(materials[name])
    details, scout_details = add_scout_details(
        armature,
        args.asset_id,
        fit,
        [materials["sole"], materials["gaiter"], materials["webbing"], materials["hardware"], materials["marker"]],
    )
    boots = combine_boot_objects(boots, details, args.asset_id)
    sole_bottom = min(float(fit[side]["sole"]["bottomZ"]) for side in ("l", "r"))

    REINFORCED.set_review_action(armature, None)
    if args.front_render:
        REINFORCED.render_review(args.front_render, (0.70, -2.05, 0.64), (0.0, 0.015, 0.115), 0.66, sole_bottom - 0.014)
    if args.side_render:
        REINFORCED.render_review(args.side_render, (2.0, -0.18, 0.56), (0.0, 0.015, 0.115), 0.66, sole_bottom - 0.014)
    if args.back_render:
        REINFORCED.render_review(args.back_render, (-0.48, 2.05, 0.60), (0.0, 0.035, 0.115), 0.66, sole_bottom - 0.014)
    if args.detail_render:
        REINFORCED.render_review(args.detail_render, (0.48, -1.40, 0.46), (0.125, -0.025, 0.105), 0.42, sole_bottom - 0.014)
    if args.game_render:
        REINFORCED.render_review(args.game_render, (1.55, -2.25, 2.15), (0.0, 0.02, 0.11), 0.72, sole_bottom - 0.014)
    if args.walk_render:
        REINFORCED.set_review_action(armature, "walk", 10)
        minimum, maximum = REINFORCED.evaluated_bounds(boots)
        center = (minimum + maximum) * 0.5
        extent = maximum - minimum
        REINFORCED.render_review(args.walk_render, tuple(center + Vector((0.70, -2.10, 0.52))), tuple(center), max(0.72, extent.z + 0.30), minimum.z - 0.020)
    if args.run_render:
        REINFORCED.set_review_action(armature, "run", 6)
        minimum, maximum = REINFORCED.evaluated_bounds(boots)
        center = (minimum + maximum) * 0.5
        extent = maximum - minimum
        REINFORCED.render_review(args.run_render, tuple(center + Vector((0.86, -2.55, 0.62))), tuple(center), max(0.90, extent.x + 0.42, extent.z + 0.42), minimum.z - 0.020)
    REINFORCED.set_review_action(armature, None)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, boots)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    REINFORCED.export_candidate(args.output, armature, boots)
    actual = REINFORCED.parse_exported_glb(args.output, {bone.name for bone in armature.data.bones})
    report = {
        "assetId": args.asset_id,
        "itemId": "scoutBoots",
        "itemNameRu": "Разведботинки",
        "slot": "boots",
        "bodyId": args.body_id,
        "file": args.output.name,
        "dimensionsMetres": {
            "width": round(boots.dimensions.x, 4),
            "depth": round(boots.dimensions.y, 4),
            "height": round(boots.dimensions.z, 4),
        },
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "scoutDetails": scout_details,
        "animationStress": {
            "walk": {"frame": 10, "rendered": bool(args.walk_render)},
            "run": {"frame": 6, "rendered": bool(args.run_render)},
            "rigCompatibility": actual["bones"] == 65 and actual["skins"] == 1,
        },
        "design": {
            "geometry": "B",
            "materialsAndWear": "C",
            "features": ["лёгкий носовой бампер", "пылезащитная гетра", "гибкая защита лодыжки", "стабилизирующие ремни", "раздельные грунтозацепы", "петля на пятке"],
        },
        "provenance": {
            "license": "Realm of Ashes project asset",
            "base": "approved original equipment boots v21 anatomical fit",
            "rebuild": "original light field geometry and B+C materials on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_SCOUT_BOOTS_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
