"""Build the B+C assault helmet review asset on the current player rig.

The assault helmet develops the approved tactical helmet language into a
heavier 2.8 kg class: a thicker composite shell, laminated eye shield,
segmented brow and cheek armour, protected ears and an occipital plate.  The
mouth stays open, preserving a human silhouette and avoiding a sci-fi mask.
The result is review-only and is not wired into the runtime by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import bmesh
import bpy
from math import pi
from mathutils import Matrix, Vector


TACTICAL_FILE = Path(__file__).with_name("build_unified_tactical_helmet_review.py")
SPEC = importlib.util.spec_from_file_location("realm_tactical_helmet_base", TACTICAL_FILE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load tactical helmet helper module: {TACTICAL_FILE}")
TACTICAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TACTICAL)
BASE = TACTICAL.BASE


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_prewar_helmet_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--side-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def assault_dimensions(minimum: Vector, maximum: Vector) -> dict[str, float]:
    dimensions = TACTICAL.tactical_dimensions(minimum, maximum)
    dimensions["topZ"] = maximum.z + 0.029
    dimensions["rimZ"] = maximum.z - 0.137
    dimensions["radiusX"] = max(abs(minimum.x), abs(maximum.x)) + 0.033
    dimensions["frontRadius"] = dimensions["centerY"] - minimum.y + 0.030
    dimensions["backRadius"] = maximum.y - dimensions["centerY"] + 0.035
    dimensions["shellThickness"] = 0.007
    return dimensions


def assault_visor_material() -> bpy.types.Material:
    material = TACTICAL.visor_material()
    material.name = "prewar_helmet_laminated_amber_visor"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.115, 0.070, 0.020, 0.50)
    bsdf.inputs["Roughness"].default_value = 0.20
    bsdf.inputs["Alpha"].default_value = 0.50
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.38
    material.diffuse_color = (0.115, 0.070, 0.020, 0.50)
    return material


def extruded_panel(
    builder: BASE.MeshBuilder,
    front: list[Vector],
    extrusion: Vector,
    face_material: int,
    edge_material: int,
) -> None:
    front_indices = [builder.vertex(point) for point in front]
    back_indices = [builder.vertex(point + extrusion) for point in front]
    builder.face(tuple(front_indices), face_material)
    builder.face(tuple(reversed(back_indices)), face_material)
    for index in range(len(front)):
        following = (index + 1) % len(front)
        builder.face((
            front_indices[index], front_indices[following],
            back_indices[following], back_indices[index],
        ), edge_material)


def build_assault_details(
    armature: bpy.types.Object,
    asset_id: str,
    dimensions: dict[str, float],
    minimum: Vector,
    materials: list[bpy.types.Material],
) -> tuple[bpy.types.Object, dict[str, object]]:
    builder = BASE.MeshBuilder()
    visor_top = dimensions["rimZ"] + 0.042
    visor_bottom = max(minimum.z + 0.083, dimensions["rimZ"] - 0.022)
    front_y = dimensions["centerY"] - dimensions["frontRadius"] - 0.032
    half_width = dimensions["radiusX"] * 0.84

    # The brow plate is split by a shallow central notch so the silhouette
    # remains authored and readable rather than a single rectangular slab.
    brow = [
        Vector((-half_width - 0.008, front_y + 0.007, visor_top + 0.002)),
        Vector((-half_width * 0.67, front_y, visor_top + 0.035)),
        Vector((-0.020, front_y - 0.002, visor_top + 0.042)),
        Vector((0.0, front_y - 0.002, visor_top + 0.033)),
        Vector((0.020, front_y - 0.002, visor_top + 0.042)),
        Vector((half_width * 0.67, front_y, visor_top + 0.035)),
        Vector((half_width + 0.008, front_y + 0.007, visor_top + 0.002)),
        Vector((half_width * 0.70, front_y - 0.002, visor_top - 0.006)),
        Vector((-half_width * 0.70, front_y - 0.002, visor_top - 0.006)),
    ]
    extruded_panel(builder, brow, Vector((0, 0.010, 0)), 0, 1)

    # Mirrored ceramic cheek plates protect the temples and cheekbones while
    # leaving the nose, mouth and lower jaw unobstructed.
    cheek_panels: list[list[Vector]] = []
    for side in (-1.0, 1.0):
        cheek = [
            Vector((side * (half_width + 0.007), front_y + 0.010, visor_bottom + 0.008)),
            Vector((side * (half_width * 0.60), front_y - 0.002, visor_bottom + 0.002)),
            Vector((side * (half_width * 0.38), front_y + 0.002, visor_bottom - 0.030)),
            Vector((side * (half_width * 0.54), front_y + 0.010, visor_bottom - 0.066)),
            Vector((side * (half_width * 0.83), front_y + 0.019, visor_bottom - 0.051)),
            Vector((side * (half_width + 0.013), front_y + 0.024, visor_bottom - 0.017)),
        ]
        cheek_panels.append(cheek)
        extruded_panel(builder, cheek, Vector((0, 0.009, 0)), 0, 1)
        # A layered lower rim and two recessed vents break up each plate.
        builder.box_between(cheek[3], cheek[4], Vector((0, 0, 1)), 0.007, 0.006, 1)
        vent_center = cheek[1].lerp(cheek[4], 0.57) + Vector((0, -0.006, 0))
        for offset in (-0.008, 0.008):
            start = vent_center + Vector((side * -0.014, 0, offset))
            end = vent_center + Vector((side * 0.014, 0, offset + 0.004))
            builder.box_between(start, end, Vector((0, 0, 1)), 0.004, 0.004, 2)

    # A flexible jaw bridge links the side armour without sealing the mouth.
    for side, cheek in zip((-1.0, 1.0), cheek_panels):
        jaw_end = Vector((side * 0.027, front_y + 0.030, visor_bottom - 0.079))
        builder.box_between(cheek[3], jaw_end, Vector((0, 1, 0)), 0.010, 0.006, 2)

    # Ear protection uses shallow faceted pods, not oversized sci-fi boxes.
    ear_centers = []
    for side in (-1.0, 1.0):
        center = Vector((
            dimensions["centerX"] + side * (dimensions["radiusX"] + 0.021),
            dimensions["centerY"] + 0.007,
            dimensions["rimZ"] + 0.006,
        ))
        ear_centers.append(center)
        shape = ((-0.030, 0.012), (-0.019, 0.034), (0.018, 0.036), (0.032, 0.015), (0.030, -0.025), (0.0, -0.038), (-0.028, -0.024))
        front = [Vector((center.x, center.y + y, center.z + z)) for y, z in shape]
        extruded_panel(builder, front, Vector((-side * 0.013, 0, 0)), 0, 1)
        inner_shape = tuple((y * 0.58, z * 0.58) for y, z in shape)
        outer_x = center.x + side * 0.003
        inner = [Vector((outer_x, center.y + y, center.z + z)) for y, z in inner_shape]
        extruded_panel(builder, inner, Vector((-side * 0.006, 0, 0)), 2, 4)
        normal = Vector((side, 0, 0))
        builder.surface_disc(Vector((outer_x + side * 0.002, center.y, center.z)), normal, 0.006, 4, 8)

    # A separate rear plate protects the suspension dial and occipital area.
    rear_y = dimensions["centerY"] + dimensions["backRadius"] + 0.022
    rear = [
        Vector((-0.070, rear_y, dimensions["rimZ"] + 0.024)),
        Vector((-0.090, rear_y - 0.003, dimensions["rimZ"] - 0.004)),
        Vector((-0.060, rear_y, dimensions["rimZ"] - 0.050)),
        Vector((0.0, rear_y + 0.004, dimensions["rimZ"] - 0.061)),
        Vector((0.060, rear_y, dimensions["rimZ"] - 0.050)),
        Vector((0.090, rear_y - 0.003, dimensions["rimZ"] - 0.004)),
        Vector((0.070, rear_y, dimensions["rimZ"] + 0.024)),
    ]
    extruded_panel(builder, rear, Vector((0, -0.010, 0)), 0, 1)
    # Polymer shock pad and three service fasteners.
    pad_left = Vector((-0.050, rear_y + 0.003, dimensions["rimZ"] - 0.035))
    pad_right = Vector((0.050, rear_y + 0.003, dimensions["rimZ"] - 0.035))
    builder.box_between(pad_left, pad_right, Vector((0, 0, 1)), 0.018, 0.006, 2)
    for x in (-0.048, 0.0, 0.048):
        builder.surface_disc(Vector((x, rear_y + 0.006, dimensions["rimZ"] + 0.002)), Vector((0, 1, 0)), 0.005, 4, 8)

    # Small edge scars and a mismatched replacement fastener carry wear C.
    # Довоенное качество: один сдержанный шрам вместо россыпи.
    builder.surface_patch(
        cheek_panels[0][4].lerp(cheek_panels[0][5], 0.50) + Vector((0, -0.002, 0)),
        Vector((0, -1, 0)), 0.0050, 1,
    )

    # Личность пятого тира: белая маркировочная полоса через купол чуть левее
    # осевой и антенна связи на правом наушнике.
    stripe_x = -0.028
    stripe_points = []
    for index in range(9):
        y_factor = -0.86 + 1.72 * index / 8
        progression = abs(y_factor) * 0.80
        angle = -pi * 0.5 if y_factor < 0 else pi * 0.5
        point = BASE.dome_point(dimensions, angle, progression)
        point.x = dimensions["centerX"] + stripe_x
        point.z += 0.006
        stripe_points.append(point)
    for start, end in zip(stripe_points, stripe_points[1:]):
        builder.box_between(start, end, Vector((1, 0, 0)), 0.024, 0.0035, 1)
    antenna_base = ear_centers[1] + Vector((0.014, -0.006, 0.020))
    antenna_tip = antenna_base + Vector((0.008, -0.004, 0.108))
    builder.box_between(antenna_base, antenna_tip, Vector((0, 1, 0)), 0.007, 0.006, 4)
    builder.surface_disc(antenna_tip + Vector((0.001, 0, 0.004)), Vector((0, 0, 1)), 0.0065, 2, 8)

    mesh = bpy.data.meshes.new(f"{asset_id}_face_and_impact_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_face_and_impact_armor", mesh)
    bpy.context.collection.objects.link(details)
    details.parent = armature
    details.matrix_parent_inverse = Matrix.Identity(4)
    details.matrix_world = armature.matrix_world.copy()
    for material in materials:
        details.data.materials.append(material)
    group = details.vertex_groups.new(name="head")
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.82, island_margin=0.014)
    bpy.ops.object.mode_set(mode="OBJECT")
    details.select_set(False)
    details["realm_asset_id"] = asset_id
    details["realm_item_id"] = "preWarHelmet"
    details["realm_item_name_ru"] = "Довоенный боевой шлем"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details, {
        "detailVertices": len(mesh.vertices),
        "detailPolygons": len(mesh.polygons),
        "cheekPanelCount": len(cheek_panels),
        "earPodCount": len(ear_centers),
        "mouthOpeningPreserved": True,
        "visorBottom": round(visor_bottom, 6),
    }


def export_candidate(
    output: Path,
    armature: bpy.types.Object,
    helmet: bpy.types.Object,
    details: bpy.types.Object,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (armature, helmet, details):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = helmet
    bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
    )


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
    dimensions = assault_dimensions(minimum, maximum)
    materials = [
        BASE.pbr_material("prewar_helmet_preserved_olive_enamel", (0.082, 0.104, 0.060), 0.52, 0.14, args.body_id, 0.06),
        BASE.pbr_material("prewar_helmet_ivory_marking", (0.300, 0.285, 0.235), 0.60, 0.02, args.body_id, 0.05),
        BASE.pbr_material("prewar_helmet_black_polymer", (0.020, 0.024, 0.023), 0.66, 0.0, args.body_id, 0.07),
        BASE.pbr_material("prewar_helmet_olive_webbing", (0.078, 0.086, 0.050), 0.90, 0.0, args.body_id, 0.08),
        BASE.pbr_material("prewar_helmet_bright_hardware", (0.220, 0.235, 0.228), 0.38, 0.82, args.body_id, 0.05),
        assault_visor_material(),
    ]
    helmet, base_metrics = TACTICAL.build_tactical_helmet(armature, args.asset_id, dimensions, minimum, materials)
    helmet["realm_item_id"] = "preWarHelmet"
    helmet["realm_item_name_ru"] = "Штурмовой шлем"
    helmet["realm_heavy_face_protection"] = True
    details, detail_metrics = build_assault_details(armature, args.asset_id, dimensions, minimum, materials)

    target = (dimensions["centerX"], dimensions["centerY"] - 0.020, maximum.z - 0.082)
    if args.front_render:
        BASE.render_review(args.front_render, (0.70, -2.65, maximum.z + 0.17), target, 0.69)
    if args.side_render:
        BASE.render_review(args.side_render, (2.65, -0.20, maximum.z + 0.11), target, 0.69)
    if args.back_render:
        BASE.render_review(args.back_render, (-0.36, 2.65, maximum.z + 0.16), target, 0.69)
    if args.detail_render:
        BASE.render_review(args.detail_render, (0.47, -2.12, maximum.z + 0.25), (target[0], target[1], maximum.z - 0.015), 0.47)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    for obj in list(reference_objects):
        if obj not in (armature, helmet, details) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, helmet, details)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    export_candidate(args.output, armature, helmet, details)

    fit = BASE.fit_report(args.body_id, minimum, maximum, dimensions, head_vertex_count)
    fit["highCutEarClearance"] = round(TACTICAL.edge_height(dimensions, 0.0) - dimensions["rimZ"], 6)
    fit["armoredVisorBottomAboveHeadMinimum"] = round(detail_metrics["visorBottom"] - minimum.z, 6)
    report = {
        "assetId": args.asset_id,
        "itemId": "preWarHelmet",
        "itemNameRu": "Штурмовой шлем",
        "bodyId": args.body_id,
        "file": args.output.name,
        "actualGlb": BASE.parse_exported_glb(args.output),
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "materials": [material.name for material in materials],
        "metrics": {**base_metrics, **detail_metrics},
        "fit": fit,
        "design": {
            "geometry": "B",
            "materialsAndWear": "C",
            "features": [
                "утолщённая композитная чаша",
                "секционная надбровная плита",
                "ламинированный янтарный визор",
                "парные скуловые баллистические панели",
                "негромоздкие ушные модули",
                "затылочная противоосколочная секция",
                "открытая центральная часть рта",
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
    print("REALM_UNIFIED_PREWAR_HELMET_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
