"""Build the B+C tactical helmet review asset on the current player rig.

The asset is deliberately review-only.  It uses the exact shipped head bounds,
is weighted to the current ``head`` bone and keeps the runtime hair-hiding
policy used by the other helmets.  The silhouette is a compact high-cut
composite shell with side rails, a rear fit dial, a low-profile device mount
and a lowered smoked visor that leaves the mouth and jaw unobstructed.
"""

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


BASE_FILE = Path(__file__).with_name("build_unified_steel_helmet_review.py")
SPEC = importlib.util.spec_from_file_location("realm_steel_helmet_base", BASE_FILE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load helmet helper module: {BASE_FILE}")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_tactical_helmet_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--side-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def visor_material() -> bpy.types.Material:
    material = bpy.data.materials.new("tactical_helmet_scratched_smoked_visor")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.035, 0.075, 0.078, 0.42)
    bsdf.inputs["Metallic"].default_value = 0.08
    bsdf.inputs["Roughness"].default_value = 0.24
    bsdf.inputs["Alpha"].default_value = 0.42
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.28
    material.diffuse_color = (0.035, 0.075, 0.078, 0.42)
    material.surface_render_method = "DITHERED"
    material.use_transparency_overlap = False
    return material


def tactical_dimensions(minimum: Vector, maximum: Vector) -> dict[str, float]:
    dimensions = BASE.helmet_dimensions(minimum, maximum)
    dimensions["topZ"] = maximum.z + 0.024
    dimensions["rimZ"] = maximum.z - 0.132
    dimensions["radiusX"] = max(abs(minimum.x), abs(maximum.x)) + 0.028
    dimensions["frontRadius"] = dimensions["centerY"] - minimum.y + 0.025
    dimensions["backRadius"] = maximum.y - dimensions["centerY"] + 0.029
    dimensions["shellThickness"] = 0.0055
    return dimensions


def edge_height(dimensions: dict[str, float], angle: float) -> float:
    side = abs(cos(angle))
    rear = max(0.0, sin(angle))
    front = max(0.0, -sin(angle))
    return dimensions["rimZ"] + 0.038 * side - 0.012 * rear - 0.003 * front


def shell_point(
    dimensions: dict[str, float],
    angle: float,
    progression: float,
    inset: float = 0.0,
) -> Vector:
    profile = 0.20 + 0.80 * sin(progression * pi * 0.5) ** 0.47
    x_radius = dimensions["radiusX"] - inset
    y_radius = (
        dimensions["backRadius"] if sin(angle) >= 0.0 else dimensions["frontRadius"]
    ) - inset
    rim_z = edge_height(dimensions, angle)
    z = dimensions["topZ"] - (dimensions["topZ"] - rim_z) * progression
    z -= 0.005 * progression * progression
    return Vector((
        dimensions["centerX"] + cos(angle) * x_radius * profile,
        dimensions["centerY"] + sin(angle) * y_radius * profile,
        z,
    ))


def add_curved_visor(
    builder: BASE.MeshBuilder,
    dimensions: dict[str, float],
    minimum: Vector,
) -> tuple[float, float, float, float]:
    columns = 12
    rows = 4
    half_width = dimensions["radiusX"] * 0.84
    top_z = dimensions["rimZ"] + 0.042
    bottom_z = max(minimum.z + 0.083, dimensions["rimZ"] - 0.022)
    grid: list[list[int]] = []
    points: list[list[Vector]] = []
    for row in range(rows + 1):
        v = row / rows
        point_row: list[Vector] = []
        index_row: list[int] = []
        for column in range(columns + 1):
            u = -1.0 + 2.0 * column / columns
            edge_curve = abs(u) ** 1.65
            point = Vector((
                dimensions["centerX"] + u * half_width,
                dimensions["centerY"] - dimensions["frontRadius"] - 0.030 + 0.018 * edge_curve,
                top_z - (top_z - bottom_z) * v + 0.009 * edge_curve * v,
            ))
            point_row.append(point)
            index_row.append(builder.vertex(point))
        points.append(point_row)
        grid.append(index_row)
    for row in range(rows):
        for column in range(columns):
            builder.face((
                grid[row][column], grid[row + 1][column],
                grid[row + 1][column + 1], grid[row][column + 1],
            ), 5)

    # A slim polymer gasket makes the visor readable without turning it into
    # the oversized rectangular face shields used by the old placeholder.
    for column in range(columns):
        builder.box_between(points[0][column], points[0][column + 1], Vector((0, 0, 1)), 0.006, 0.005, 2)
        builder.box_between(points[-1][column], points[-1][column + 1], Vector((0, 0, 1)), 0.0045, 0.0035, 2)
    for row in range(rows):
        builder.box_between(points[row][0], points[row + 1][0], Vector((1, 0, 0)), 0.005, 0.004, 2)
        builder.box_between(points[row][-1], points[row + 1][-1], Vector((1, 0, 0)), 0.005, 0.004, 2)
    return (-half_width, half_width, bottom_z, top_z)


def build_tactical_helmet(
    armature: bpy.types.Object,
    asset_id: str,
    dimensions: dict[str, float],
    minimum: Vector,
    materials: list[bpy.types.Material],
) -> tuple[bpy.types.Object, dict[str, object]]:
    builder = BASE.MeshBuilder()
    segments = 24
    ring_count = 7
    rings: list[list[int]] = []
    for ring_index in range(ring_count + 1):
        progression = ring_index / ring_count
        rings.append([
            builder.vertex(shell_point(dimensions, 2.0 * pi * index / segments, progression))
            for index in range(segments)
        ])
    builder.face(tuple(reversed(rings[0])), 0)
    for ring_index in range(ring_count):
        for index in range(segments):
            following = (index + 1) % segments
            builder.face((
                rings[ring_index][index], rings[ring_index][following],
                rings[ring_index + 1][following], rings[ring_index + 1][index],
            ), 0)

    inner = [
        builder.vertex(shell_point(dimensions, 2.0 * pi * index / segments, 1.0, dimensions["shellThickness"]))
        for index in range(segments)
    ]
    for index in range(segments):
        following = (index + 1) % segments
        builder.face((rings[-1][index], inner[index], inner[following], rings[-1][following]), 1)

    # Faceted rubber edge roll follows the high-cut opening.
    tube_sides = 5
    edge_rings: list[list[int]] = []
    for index in range(segments):
        angle = 2.0 * pi * index / segments
        center = Vector(builder.vertices[rings[-1][index]])
        radial = Vector((cos(angle), sin(angle), 0.0)).normalized()
        edge_rings.append([
            builder.vertex(
                center
                + radial * cos(2.0 * pi * tube_index / tube_sides) * 0.0044
                + Vector((0, 0, 1)) * sin(2.0 * pi * tube_index / tube_sides) * 0.0044
            )
            for tube_index in range(tube_sides)
        ])
    for index in range(segments):
        following = (index + 1) % segments
        for tube_index in range(tube_sides):
            next_tube = (tube_index + 1) % tube_sides
            builder.face((
                edge_rings[index][tube_index], edge_rings[following][tube_index],
                edge_rings[following][next_tube], edge_rings[index][next_tube],
            ), 1)

    # Side accessory rails follow the temple instead of floating as straight
    # blocks.  Small ports and bolts keep the silhouette functional at game scale.
    rail_centers: dict[float, list[Vector]] = {}
    for side in (-1.0, 1.0):
        x = dimensions["centerX"] + side * (dimensions["radiusX"] + 0.005)
        rail_points = [
            Vector((x, dimensions["centerY"] - dimensions["frontRadius"] * 0.50, dimensions["rimZ"] + 0.043)),
            Vector((x + side * 0.004, dimensions["centerY"] - 0.006, dimensions["rimZ"] + 0.048)),
            Vector((x - side * 0.001, dimensions["centerY"] + dimensions["backRadius"] * 0.53, dimensions["rimZ"] + 0.030)),
        ]
        rail_centers[side] = rail_points
        for start, end in zip(rail_points, rail_points[1:]):
            builder.box_between(start, end, Vector((0, 0, 1)), 0.022, 0.010, 2)
        normal = Vector((side, 0, 0))
        for point in rail_points:
            builder.surface_disc(point + normal * 0.006, normal, 0.0052, 4, 8)
        # Two recessed attachment slots.
        for fraction in (0.34, 0.69):
            point = rail_points[0].lerp(rail_points[-1], fraction)
            builder.box_between(
                point + Vector((0, -0.012, 0)), point + Vector((0, 0.012, 0)),
                Vector((0, 0, 1)), 0.006, 0.012, 4,
            )

    # Low-profile front device mount and its two braces.
    front_y = dimensions["centerY"] - dimensions["frontRadius"] - 0.011
    mount_z = dimensions["rimZ"] + 0.073
    mount_left = Vector((dimensions["centerX"] - 0.025, front_y, mount_z))
    mount_right = Vector((dimensions["centerX"] + 0.025, front_y, mount_z))
    builder.box_between(mount_left, mount_right, Vector((0, 0, 1)), 0.032, 0.010, 2)
    for side in (-1.0, 1.0):
        start = Vector((dimensions["centerX"] + side * 0.018, front_y + 0.002, mount_z - 0.012))
        end = Vector((dimensions["centerX"] + side * 0.036, front_y + 0.015, mount_z + 0.024))
        builder.box_between(start, end, Vector((1, 0, 0)), 0.006, 0.006, 4)
    builder.surface_disc(Vector((dimensions["centerX"], front_y - 0.006, mount_z)), Vector((0, -1, 0)), 0.006, 4, 8)

    visor_bounds = add_curved_visor(builder, dimensions, minimum)

    # Visor pivots connect to both rails and clearly explain how the closed
    # shield can be raised in a future animation.
    for side in (-1.0, 1.0):
        hinge = Vector((
            dimensions["centerX"] + side * (dimensions["radiusX"] + 0.012),
            dimensions["centerY"] - dimensions["frontRadius"] * 0.35,
            dimensions["rimZ"] + 0.034,
        ))
        builder.surface_disc(hinge + Vector((side * 0.004, 0, 0)), Vector((side, 0, 0)), 0.010, 2, 10)
        builder.surface_disc(hinge + Vector((side * 0.008, 0, 0)), Vector((side, 0, 0)), 0.0045, 4, 8)
        visor_corner = Vector((
            dimensions["centerX"] + side * dimensions["radiusX"] * 0.84,
            dimensions["centerY"] - dimensions["frontRadius"] - 0.012,
            dimensions["rimZ"] + 0.027,
        ))
        builder.box_between(hinge, visor_corner, Vector((0, 0, 1)), 0.007, 0.005, 2)

    # Four-point textile retention and a compact chin cup.
    jaw_y = dimensions["centerY"] - dimensions["frontRadius"] * 0.37
    for side in (-1.0, 1.0):
        temple = Vector((dimensions["centerX"] + side * (dimensions["radiusX"] - 0.004), dimensions["centerY"] - 0.005, dimensions["rimZ"] + 0.009))
        rear = Vector((dimensions["centerX"] + side * (dimensions["radiusX"] * 0.72), dimensions["centerY"] + dimensions["backRadius"] * 0.53, dimensions["rimZ"] - 0.015))
        jaw = Vector((dimensions["centerX"] + side * 0.039, jaw_y, dimensions["rimZ"] - 0.094))
        builder.box_between(temple, jaw, Vector((0, 1, 0)), 0.009, 0.0035, 3)
        builder.box_between(rear, jaw, Vector((0, 1, 0)), 0.009, 0.0035, 3)
    cup_left = Vector((dimensions["centerX"] - 0.036, jaw_y - 0.005, dimensions["rimZ"] - 0.096))
    cup_right = Vector((dimensions["centerX"] + 0.036, jaw_y - 0.005, dimensions["rimZ"] - 0.096))
    builder.box_between(cup_left, cup_right, Vector((0, 0, 1)), 0.015, 0.007, 2)

    # Rear suspension dial and short nape pad.
    dial = Vector((dimensions["centerX"], dimensions["centerY"] + dimensions["backRadius"] + 0.018, dimensions["rimZ"] - 0.001))
    builder.surface_disc(dial, Vector((0, 1, 0)), 0.024, 2, 12)
    builder.surface_disc(dial + Vector((0, 0.003, 0)), Vector((0, 1, 0)), 0.010, 4, 10)
    nape_left = Vector((dimensions["centerX"] - 0.050, dial.y - 0.003, dimensions["rimZ"] - 0.040))
    nape_right = Vector((dimensions["centerX"] + 0.050, dial.y - 0.003, dimensions["rimZ"] - 0.040))
    builder.box_between(nape_left, nape_right, Vector((0, 0, 1)), 0.016, 0.008, 3)

    # Restrained wear: exposed edge scars and one field-repair strip.
    for angle, progression, radius in ((-1.05, 0.57, 0.006), (0.76, 0.70, 0.005), (2.30, 0.76, 0.0045)):
        point = shell_point(dimensions, angle, progression) + Vector((0, 0, 0.002))
        normal = Vector((point.x - dimensions["centerX"], point.y - dimensions["centerY"], 0.35)).normalized()
        builder.surface_patch(point, normal, radius, 1)
    repair = shell_point(dimensions, 2.62, 0.71) + Vector((0, 0, 0.003))
    builder.box_between(repair + Vector((-0.018, 0, -0.007)), repair + Vector((0.018, 0, 0.007)), Vector((0, 1, 0)), 0.012, 0.003, 4)

    mesh = bpy.data.meshes.new(f"{asset_id}_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()

    helmet = bpy.data.objects.new(asset_id, mesh)
    bpy.context.collection.objects.link(helmet)
    helmet.parent = armature
    helmet.matrix_parent_inverse = Matrix.Identity(4)
    helmet.matrix_world = armature.matrix_world.copy()
    for material in materials:
        helmet.data.materials.append(material)
    group = helmet.vertex_groups.new(name="head")
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    modifier = helmet.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = helmet
    helmet.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.82, island_margin=0.014)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in helmet.data.polygons:
        polygon.use_smooth = polygon.material_index in {0, 1, 5}
    helmet.select_set(False)
    helmet["realm_asset_id"] = asset_id
    helmet["realm_item_id"] = "tacticalHelmet"
    helmet["realm_item_name_ru"] = "Тактический шлем"
    helmet["realm_art_direction"] = "character_geometry_b_materials_c"
    helmet["realm_review_only"] = True
    helmet["realm_runtime_integration_allowed"] = False
    helmet["realm_closed_visor"] = True
    metrics = {
        "vertexCount": len(mesh.vertices),
        "polygonCount": len(mesh.polygons),
        "visorBounds": [round(value, 6) for value in visor_bounds],
        "railPointCount": sum(len(points) for points in rail_centers.values()),
        "headBoneWeight": 1.0,
    }
    return helmet, metrics


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
    BASE.hide_hair(reference_objects)
    bpy.context.view_layer.update()

    minimum, maximum, head_vertex_count = BASE.head_bounds(body, armature)
    dimensions = tactical_dimensions(minimum, maximum)
    materials = [
        BASE.pbr_material("tactical_helmet_weathered_olive_composite", (0.105, 0.128, 0.095), 0.72, 0.10, args.body_id, 0.18),
        BASE.pbr_material("tactical_helmet_exposed_composite_edge", (0.245, 0.225, 0.155), 0.81, 0.05, args.body_id, 0.16),
        BASE.pbr_material("tactical_helmet_aged_black_polymer", (0.025, 0.030, 0.029), 0.69, 0.0, args.body_id, 0.12),
        BASE.pbr_material("tactical_helmet_dusty_retention_webbing", (0.095, 0.082, 0.057), 0.91, 0.0, args.body_id, 0.20),
        BASE.pbr_material("tactical_helmet_tarnished_hardware", (0.185, 0.205, 0.195), 0.47, 0.72, args.body_id, 0.10),
        visor_material(),
    ]
    helmet, metrics = build_tactical_helmet(armature, args.asset_id, dimensions, minimum, materials)

    target = (dimensions["centerX"], dimensions["centerY"] - 0.018, maximum.z - 0.079)
    if args.front_render:
        BASE.render_review(args.front_render, (0.72, -2.65, maximum.z + 0.18), target, 0.67)
    if args.side_render:
        BASE.render_review(args.side_render, (2.65, -0.18, maximum.z + 0.12), target, 0.67)
    if args.back_render:
        BASE.render_review(args.back_render, (-0.36, 2.65, maximum.z + 0.17), target, 0.67)
    if args.detail_render:
        BASE.render_review(args.detail_render, (0.48, -2.12, maximum.z + 0.26), (target[0], target[1], maximum.z - 0.010), 0.46)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    for obj in list(reference_objects):
        if obj != armature and obj != helmet and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, helmet)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    BASE.export_candidate(args.output, armature, helmet)
    fit = BASE.fit_report(args.body_id, minimum, maximum, dimensions, head_vertex_count)
    fit["highCutEarClearance"] = round(edge_height(dimensions, 0.0) - dimensions["rimZ"], 6)
    fit["closedVisorBottomAboveHeadMinimum"] = round(metrics["visorBounds"][2] - minimum.z, 6)
    report = {
        "assetId": args.asset_id,
        "itemId": "tacticalHelmet",
        "itemNameRu": "Тактический шлем",
        "bodyId": args.body_id,
        "file": args.output.name,
        "actualGlb": BASE.parse_exported_glb(args.output),
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "materials": [material.name for material in materials],
        "metrics": metrics,
        "fit": fit,
        "design": {
            "geometry": "B",
            "materialsAndWear": "C",
            "features": [
                "компактная high-cut композитная чаша",
                "боковые рельсы с крепежом",
                "затылочный регулятор и четырёхточечный подвес",
                "низкопрофильное переднее крепление",
                "закрытый дымчатый визор до уровня скул",
                "сдержанные сколы, пыль и полевой ремонт",
            ],
        },
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original fitted B geometry and authored C materials on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_TACTICAL_HELMET_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
