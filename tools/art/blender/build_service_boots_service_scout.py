"""Build the production-shaped Service Scout boot review GLBs.

The artistic source is the user-review Blender scene.  This builder extracts
only the approved-looking final collection, removes the oversized split sole
and rear counter, builds a compact continuous outsole, reduces the geometry,
skins it to a clean humanoid_v1 scaffold and exports a contract-shaped GLB.

Run through Blender:

    blender SOURCE.blend --background --python SCRIPT -- \
      --scaffold service_boots_female_medium_lod0.glb \
      --output service_boots_female_medium_service_scout_lod0.glb \
      --sex female --body-type medium --lod lod0
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SOURCE_COLLECTION = "SERVICE_SCOUT_FINAL_REVIEW"
REQUIRED_JOINT_COUNT = 65
REFERENCE_FOOT_X = 0.11139995
REFERENCE_FOOT_Y = 0.07650032
REFERENCE_OLD_SIDE_WIDTH = 0.14376062
REFERENCE_OLD_LENGTH = 0.30453398
REFERENCE_OLD_HEIGHT = 0.27448034
TARGET_TRIANGLES = {
    "lod0": 3900,
    "lod1": 2000,
    "lod2": 1100,
}
SKIP_NAME_PARTS = (
    "_outsole",
    "_welt",
    "_lug_",
    "_heel_counter",
)
UPPER_COLOURS = {
    "canvas_olive": (0.36, 0.36, 0.25, 1.0),
    "canvas_sun_faded": (0.46, 0.47, 0.31, 1.0),
    "leather_dark": (0.23, 0.16, 0.13, 1.0),
    "leather_local_wear": (0.41, 0.28, 0.20, 1.0),
    "leather_strap": (0.29, 0.19, 0.14, 1.0),
    "leather_textured": (0.31, 0.20, 0.15, 1.0),
    "metal_dull": (0.45, 0.47, 0.46, 1.0),
    "lace_dust": (0.72, 0.64, 0.47, 1.0),
}
UPPER_TAGS = tuple(UPPER_COLOURS)
SOLE_COLOURS = (
    (0.08, 0.09, 0.09, 1.0),
    (0.30, 0.25, 0.17, 1.0),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--scaffold", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sex", choices=("female", "male"), required=True)
    parser.add_argument("--model-id")
    parser.add_argument("--release-approved", action="store_true")
    parser.add_argument(
        "--body-type",
        choices=("slim", "medium", "large"),
        required=True,
    )
    parser.add_argument(
        "--lod",
        choices=("lod0", "lod1", "lod2"),
        required=True,
    )
    return parser.parse_args(argv)


def load_first_outfit_helper():
    helper_file = Path(__file__).with_name(
        "build_character_bc_first_outfit_review.py"
    )
    spec = importlib.util.spec_from_file_location(
        "_realm_first_outfit_helper",
        helper_file,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import Blender helper: {helper_file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def recursive_objects(collection: bpy.types.Collection) -> list[bpy.types.Object]:
    rows = list(collection.objects)
    for child in collection.children:
        rows.extend(recursive_objects(child))
    return list({obj.as_pointer(): obj for obj in rows}.values())


def append_art_source(path: Path) -> None:
    source_path = path.resolve()
    with bpy.data.libraries.load(str(source_path), link=False) as (
        available,
        requested,
    ):
        if SOURCE_COLLECTION not in available.collections:
            raise RuntimeError(
                f"{source_path} is missing collection {SOURCE_COLLECTION}"
            )
        requested.collections = [SOURCE_COLLECTION]
    collection = bpy.data.collections.get(SOURCE_COLLECTION)
    if collection is None:
        raise RuntimeError(
            f"Cannot append collection {SOURCE_COLLECTION} from {source_path}"
        )
    if collection.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(collection)


def compact_source_point(point: Vector) -> tuple[float, float, float]:
    side = -1.0 if point.x < 0.0 else 1.0
    foot_center = side * 0.113
    width_scale = 0.82 if point.z < 0.14 else 0.88
    x = foot_center + (point.x - foot_center) * width_scale
    y_anchor = -0.02
    y_scale = 0.82 if point.y < y_anchor else 0.88
    y = y_anchor + (point.y - y_anchor) * y_scale
    z_anchor = 0.04
    z = z_anchor + (point.z - z_anchor) * 0.78
    return (x, y, max(0.0, z))


def material_key(name: str) -> str:
    normalized = name.lower()
    for key in UPPER_COLOURS:
        if key in normalized:
            return key
    return "leather_textured"


def apply_palette_to_basecolor(
    material: bpy.types.Material,
    palette: tuple[tuple[float, float, float, float], ...],
) -> None:
    node = material.node_tree.nodes.get("basecolor")
    image = node.image if node is not None else None
    if image is None:
        raise RuntimeError(f"{material.name} is missing a basecolor image")
    width, height = image.size
    pixels = []
    for y in range(height):
        for x in range(width):
            palette_index = min(
                len(palette) - 1,
                int((x / max(1, width)) * len(palette)),
            )
            colour = palette[palette_index]
            grain = (
                math.sin((x + palette_index * 17) * 0.17)
                + math.cos((y - palette_index * 13) * 0.21)
            ) * 0.018
            pixels.extend(
                [
                    min(1.0, max(0.0, colour[channel] + grain))
                    for channel in range(3)
                ]
                + [1.0]
            )
    image.pixels.foreach_set(pixels)
    image.update()
    image.pack()


def append_box(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    tags: list[str],
    vertex_components: list[int],
    minimum: tuple[float, float, float],
    maximum: tuple[float, float, float],
    tag: str,
    component: int,
) -> None:
    x0, y0, z0 = minimum
    x1, y1, z1 = maximum
    offset = len(vertices)
    vertices.extend(
        [
            (x0, y0, z0),
            (x1, y0, z0),
            (x1, y1, z0),
            (x0, y1, z0),
            (x0, y0, z1),
            (x1, y0, z1),
            (x1, y1, z1),
            (x0, y1, z1),
        ]
    )
    vertex_components.extend([component] * 8)
    local_faces = (
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    )
    for face in local_faces:
        faces.append(tuple(offset + index for index in face))
        tags.append(tag)


def append_continuous_sole(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    tags: list[str],
    vertex_components: list[int],
    side: float,
    component: int,
) -> None:
    center = side * 0.113
    outline = [
        (center, -0.128),
        (center + 0.045, -0.120),
        (center + 0.056, -0.090),
        (center + 0.058, -0.043),
        (center + 0.053, 0.026),
        (center + 0.047, 0.088),
        (center + 0.038, 0.100),
        (center - 0.038, 0.100),
        (center - 0.047, 0.088),
        (center - 0.053, 0.026),
        (center - 0.058, -0.043),
        (center - 0.056, -0.090),
        (center - 0.045, -0.120),
    ]
    if side < 0.0:
        outline = [(2.0 * center - x, y) for x, y in reversed(outline)]
    offset = len(vertices)
    bottom_z = 0.009
    top_z = 0.034
    vertices.extend(
        (
            center + (x - center) * 0.94,
            -0.01 + (y + 0.01) * 0.96,
            bottom_z,
        )
        for x, y in outline
    )
    vertices.extend((x, y, top_z) for x, y in outline)
    vertex_components.extend([component] * (len(outline) * 2))
    count = len(outline)
    faces.append(tuple(offset + index for index in reversed(range(count))))
    tags.append("rubber_black")
    faces.append(tuple(offset + count + index for index in range(count)))
    tags.append("rubber_black")
    for index in range(count):
        following = (index + 1) % count
        faces.append(
            (
                offset + index,
                offset + following,
                offset + count + following,
                offset + count + index,
            )
        )
        tags.append("rubber_black")

    lug_centers = (-0.101, -0.069, -0.036, 0.051, 0.079)
    for index, y in enumerate(lug_centers):
        half_width = 0.045 if index < 3 else 0.039
        append_box(
            vertices,
            faces,
            tags,
            vertex_components,
            (center - half_width, y - 0.006, 0.0),
            (center + half_width, y + 0.006, bottom_z),
            "rubber_dust",
            component + index + 1,
        )


def capture_art_source() -> dict[str, list]:
    collection = bpy.data.collections.get(SOURCE_COLLECTION)
    if collection is None:
        raise RuntimeError(f"Missing source collection: {SOURCE_COLLECTION}")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    tags: list[str] = []
    vertex_components: list[int] = []
    captured_objects: list[str] = []
    for source in recursive_objects(collection):
        if source.type not in {"MESH", "CURVE"}:
            continue
        lowered = source.name.lower()
        if any(part in lowered for part in SKIP_NAME_PARTS):
            continue
        evaluated = source.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh(
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
        if mesh is None:
            continue
        captured_objects.append(source.name)
        component = len(captured_objects)
        offset = len(vertices)
        vertices.extend(
            compact_source_point(evaluated.matrix_world @ vertex.co)
            for vertex in mesh.vertices
        )
        vertex_components.extend([component] * len(mesh.vertices))
        slots = list(evaluated.material_slots)
        for polygon in mesh.polygons:
            faces.append(tuple(offset + index for index in polygon.vertices))
            material = (
                slots[polygon.material_index].material
                if polygon.material_index < len(slots)
                else None
            )
            tags.append(material_key(material.name if material else ""))
        evaluated.to_mesh_clear()
    procedural_component = len(captured_objects) + 1
    append_continuous_sole(
        vertices,
        faces,
        tags,
        vertex_components,
        -1.0,
        procedural_component,
    )
    append_continuous_sole(
        vertices,
        faces,
        tags,
        vertex_components,
        1.0,
        procedural_component + 8,
    )
    if not vertices or not faces or len(faces) != len(tags):
        raise RuntimeError("Captured Service Scout source is incomplete")
    if len(vertices) != len(vertex_components):
        raise RuntimeError("Captured component map is incomplete")
    return {
        "vertices": vertices,
        "faces": faces,
        "tags": tags,
        "vertex_components": vertex_components,
        "protected_components": set(
            range(procedural_component, procedural_component + 14)
        ),
        "objects": captured_objects,
    }


def triangle_count(faces: list[tuple[int, ...]]) -> int:
    return sum(max(0, len(face) - 2) for face in faces)


def cluster_source(
    source: dict[str, list],
    target: int,
) -> dict[str, list]:
    """Build deterministic lower LODs without Blender's unstable decimator.

    Vertex clustering is kept inside each authored component.  It preserves
    the two material tags and the deliberate layered construction while
    removing sub-pixel loops from the lower-detail exports.
    """

    if triangle_count(source["faces"]) <= target:
        return source

    def clustered(cell: float) -> dict[str, list]:
        buckets: dict[tuple[int, int, int, int], list[float]] = {}
        vertex_keys = []
        for point, component in zip(
            source["vertices"],
            source["vertex_components"],
        ):
            component_cell = (
                0.0001
                if component in source["protected_components"]
                else cell
            )
            key = (
                component,
                round(point[0] / component_cell),
                round(point[1] / component_cell),
                round(point[2] / component_cell),
            )
            vertex_keys.append(key)
            row = buckets.setdefault(key, [0.0, 0.0, 0.0, 0.0])
            row[0] += point[0]
            row[1] += point[1]
            row[2] += point[2]
            row[3] += 1.0

        keys = sorted(buckets)
        index_by_key = {key: index for index, key in enumerate(keys)}
        vertices = [
            (
                buckets[key][0] / buckets[key][3],
                buckets[key][1] / buckets[key][3],
                buckets[key][2] / buckets[key][3],
            )
            for key in keys
        ]
        faces = []
        tags = []
        seen_faces = set()
        for face, tag in zip(source["faces"], source["tags"]):
            mapped = [index_by_key[vertex_keys[index]] for index in face]
            compact = []
            for index in mapped:
                if not compact or compact[-1] != index:
                    compact.append(index)
            if len(compact) > 1 and compact[0] == compact[-1]:
                compact.pop()
            unique = []
            seen = set()
            for index in compact:
                if index not in seen:
                    unique.append(index)
                    seen.add(index)
            if len(unique) >= 3:
                anchor = Vector(vertices[unique[0]])
                for offset in range(1, len(unique) - 1):
                    triangle = (
                        unique[0],
                        unique[offset],
                        unique[offset + 1],
                    )
                    edge_a = Vector(vertices[triangle[1]]) - anchor
                    edge_b = Vector(vertices[triangle[2]]) - anchor
                    if edge_a.cross(edge_b).length_squared <= 1e-14:
                        continue
                    canonical = tuple(sorted(triangle))
                    if canonical in seen_faces:
                        continue
                    seen_faces.add(canonical)
                    faces.append(triangle)
                    tags.append(tag)
        return {
            "vertices": vertices,
            "faces": faces,
            "tags": tags,
            "objects": source["objects"],
            "protected_components": source["protected_components"],
            "vertex_components": [
                key[0]
                for key in keys
            ],
        }

    low = 0.0001
    high = 0.004
    candidate = clustered(high)
    while triangle_count(candidate["faces"]) > target and high < 0.08:
        high *= 1.5
        candidate = clustered(high)
    if triangle_count(candidate["faces"]) > target:
        raise RuntimeError(
            f"Cannot cluster source below {target} triangles"
        )
    for _ in range(18):
        middle = (low + high) * 0.5
        row = clustered(middle)
        if triangle_count(row["faces"]) <= target:
            high = middle
            candidate = row
        else:
            low = middle
    return candidate


def world_bounds_by_side(
    objects: list[bpy.types.Object],
) -> dict[int, tuple[Vector, Vector]]:
    rows: dict[int, list[Vector]] = {-1: [], 1: []}
    for obj in objects:
        if obj.type != "MESH":
            continue
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            rows[-1 if point.x < 0.0 else 1].append(point)
    result = {}
    for side, points in rows.items():
        if not points:
            raise RuntimeError(f"Scaffold has no geometry for side {side}")
        result[side] = (
            Vector(
                (
                    min(point.x for point in points),
                    min(point.y for point in points),
                    min(point.z for point in points),
                )
            ),
            Vector(
                (
                    max(point.x for point in points),
                    max(point.y for point in points),
                    max(point.z for point in points),
                )
            ),
        )
    return result


def transform_for_variant(
    points: list[tuple[float, float, float]],
    armature: bpy.types.Object,
    scaffold_bounds: dict[int, tuple[Vector, Vector]],
) -> list[tuple[float, float, float]]:
    output = []
    for row in points:
        point = Vector(row)
        side = -1 if point.x < 0.0 else 1
        minimum, maximum = scaffold_bounds[side]
        width_scale = (maximum.x - minimum.x) / REFERENCE_OLD_SIDE_WIDTH
        length_scale = (maximum.y - minimum.y) / REFERENCE_OLD_LENGTH
        height_scale = max(0.75, maximum.z / REFERENCE_OLD_HEIGHT)
        bone_name = "foot_l" if side > 0 else "foot_r"
        foot = armature.data.bones.get(bone_name)
        if foot is None:
            raise RuntimeError(f"Scaffold is missing {bone_name}")
        x = foot.head_local.x + (
            point.x - side * REFERENCE_FOOT_X
        ) * width_scale
        y = point.y * length_scale + (
            foot.head_local.y - REFERENCE_FOOT_Y
        )
        z = max(0.0, point.z * height_scale)
        output.append((x, y, z))
    return output


def make_mesh(
    model_id: str,
    source: dict[str, list],
    armature: bpy.types.Object,
    scaffold_bounds: dict[int, tuple[Vector, Vector]],
    upper: bpy.types.Material,
    sole: bpy.types.Material,
) -> bpy.types.Object:
    points = transform_for_variant(
        source["vertices"],
        armature,
        scaffold_bounds,
    )
    print(
        f"service-scout: mesh input {len(points)} vertices, "
        f"{len(source['faces'])} faces",
        flush=True,
    )
    rubber_areas = []
    for face, tag in zip(source["faces"], source["tags"]):
        if tag.startswith("rubber_") and len(face) == 3:
            a, b, c = (Vector(points[index]) for index in face)
            rubber_areas.append((b - a).cross(c - a).length_squared)
    if rubber_areas:
        print(
            "service-scout: sole triangle areas "
            f"min={min(rubber_areas):.8g} max={max(rubber_areas):.8g} "
            f"zero={sum(area <= 1e-14 for area in rubber_areas)}",
            flush=True,
        )
    mesh = bpy.data.meshes.new(f"mesh_{model_id}")
    mesh.from_pydata(points, [], source["faces"])
    mesh.validate(verbose=False, clean_customdata=False)
    mesh.update(calc_edges=True)
    print("service-scout: mesh topology created", flush=True)
    mesh.materials.append(upper)
    mesh.materials.append(sole)
    for polygon, tag in zip(mesh.polygons, source["tags"]):
        polygon.material_index = 1 if tag.startswith("rubber_") else 0
        polygon.use_smooth = True

    uv = mesh.uv_layers.new(name="UVMap")
    print("service-scout: writing palette UVs", flush=True)
    uv_values = [0.0] * (len(mesh.loops) * 2)
    for polygon, tag in zip(mesh.polygons, source["tags"]):
        palette_u = (
            0.75
            if tag == "rubber_dust"
            else 0.25
            if tag == "rubber_black"
            else (
                UPPER_TAGS.index(tag)
                + 0.5
            )
            / len(UPPER_TAGS)
        )
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_values[loop_index * 2] = palette_u
            uv_values[loop_index * 2 + 1] = min(
                1.0,
                max(0.0, (point.y + 0.18) / 0.36),
            )
    uv.data.foreach_set("uv", uv_values)
    mesh.validate(verbose=False, clean_customdata=False)
    mesh.update()
    print(
        "service-scout: material indices "
        f"upper={sum(p.material_index == 0 for p in mesh.polygons)} "
        f"sole={sum(p.material_index == 1 for p in mesh.polygons)}",
        flush=True,
    )
    print("service-scout: mesh data validated", flush=True)

    obj = bpy.data.objects.new(f"mesh_{model_id}", mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def reduce_geometry(obj: bpy.types.Object, target: int) -> int:
    obj.data.calc_loop_triangles()
    current = len(obj.data.loop_triangles)
    if current > target:
        modifier = obj.modifiers.new(name="lod_reduction", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = max(0.01, min(1.0, target / current))
        modifier.use_collapse_triangulate = True
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(depsgraph)
        reduced = bpy.data.meshes.new_from_object(
            evaluated,
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
        old = obj.data
        obj.modifiers.clear()
        obj.data = reduced
        bpy.data.meshes.remove(old)
        reduced.name = obj.name
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def skin_to_humanoid(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
) -> None:
    for name in ("foot_l", "foot_r", "calf_l", "calf_r"):
        if armature.data.bones.get(name) is None:
            raise RuntimeError(f"Scaffold is missing required deform bone {name}")
    groups = {
        name: obj.vertex_groups.new(name=name)
        for name in ("foot_l", "foot_r", "calf_l", "calf_r")
    }
    for vertex in obj.data.vertices:
        side = "l" if vertex.co.x >= 0.0 else "r"
        blend = min(
            0.86,
            max(0.04, (vertex.co.z - 0.085) / 0.17),
        )
        groups[f"foot_{side}"].add(
            [vertex.index],
            1.0 - blend,
            "REPLACE",
        )
        groups[f"calf_{side}"].add(
            [vertex.index],
            blend,
            "REPLACE",
        )
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()
    obj.matrix_local.identity()
    modifier = obj.modifiers.new(name="humanoid_v1_skin", type="ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True


def annotate(
    armature: bpy.types.Object,
    obj: bpy.types.Object,
    model_id: str,
    args: argparse.Namespace,
) -> None:
    armature.name = f"{model_id}_root"
    armature.data.name = "rig_humanoid_v1"
    for key in list(armature.keys()):
        del armature[key]
    approval_status = "approved" if args.release_approved else "review"
    metadata = {
        "realm_asset_schema": "realm.production-asset.v1",
        "realm_asset_id": "service_boots",
        "realm_asset_class": "humanoid_skinned_equipment",
        "realm_lod": args.lod,
        "realm_origin_profile": "rig_root_ground",
        "realm_approval_status": approval_status,
        "realm_provenance_type": "original",
        "realm_provenance_id": "realm_of_ashes_original",
        "realm_rig_id": "humanoid_v1",
        "realm_visual_slot": "feet",
        "realm_sex": args.sex,
        "realm_body_type": args.body_type,
        "realm_hide_body_regions": ["foot_l", "foot_r"],
        "realm_art_direction": "geometry_b_materials_c",
        "realm_geometry_direction": "graphic_faceted_b",
        "realm_material_direction": "retro_modern_c",
        "realm_wear_policy": "localized_dust_sun_bleaching",
        "realm_design_revision": "service_scout_compact_v2",
        "realm_review_only": not args.release_approved,
        "realm_runtime_integration_allowed": args.release_approved,
        "realm_pull_request_allowed": args.release_approved,
    }
    for key, value in metadata.items():
        armature[key] = value
    obj["realm_visual_slot"] = "feet"
    obj["realm_module_id"] = "service_boots"
    obj["realm_design_revision"] = "service_scout_compact_v2"


def import_scaffold(path: Path) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(
            f"Expected one scaffold armature, got {len(armatures)}"
        )
    armature = armatures[0]
    meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.name.startswith("mesh_service_boots_")
    ]
    if not meshes:
        raise RuntimeError("Scaffold contains no equipment meshes")
    if len(armature.data.bones) != REQUIRED_JOINT_COUNT:
        raise RuntimeError(
            f"Expected {REQUIRED_JOINT_COUNT} joints, "
            f"got {len(armature.data.bones)}"
        )
    return armature, meshes


def export_glb(
    output: Path,
    armature: bpy.types.Object,
    obj: bpy.types.Object,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Realm of Ashes original Service Scout boots. "
            "Geometry, textures and rig adaptation generated in Blender "
            "for the B+C art direction."
        ),
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="NAME",
        export_vertex_color_name="realm_base_color",
        export_all_vertex_colors=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_def_bones=True,
        export_leaf_bone=False,
        export_armature_object_remove=False,
        export_skins=True,
        export_all_influences=False,
        export_morph=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export {output}: {result}")


def build_lod(
    args: argparse.Namespace,
    helper,
    source: dict[str, list],
    output: Path,
    armature: bpy.types.Object,
    bounds: dict[int, tuple[Vector, Vector]],
    upper: bpy.types.Material,
    sole: bpy.types.Material,
) -> tuple[dict[str, object], bpy.types.Object]:
    model_id = args.model_id or (
        f"service_boots_{args.sex}_{args.body_type}_service_scout"
    )
    lod_source = (
        source
        if args.lod == "lod0"
        else cluster_source(source, TARGET_TRIANGLES[args.lod])
    )
    print(
        "service-scout: material face split "
        f"upper={sum(not tag.startswith('rubber_') for tag in lod_source['tags'])} "
        f"sole={sum(tag.startswith('rubber_') for tag in lod_source['tags'])}",
        flush=True,
    )
    print("service-scout: building compact mesh", flush=True)
    obj = make_mesh(
        model_id,
        lod_source,
        armature,
        bounds,
        upper,
        sole,
    )
    if args.lod == "lod0":
        print("service-scout: reducing LOD0 with Blender Decimate", flush=True)
        triangles = reduce_geometry(obj, TARGET_TRIANGLES[args.lod])
    else:
        triangles = triangle_count(lod_source["faces"])
        print(
            f"service-scout: clustered {args.lod} to {triangles} triangles",
            flush=True,
        )
    print("service-scout: binding humanoid skin", flush=True)
    skin_to_humanoid(obj, armature)
    helper.normalize_skin_weights(obj)
    annotate(armature, obj, model_id, args)
    print("service-scout: exporting GLB", flush=True)
    export_glb(output.resolve(), armature, obj)
    report = {
        "output": str(output.resolve()),
        "modelId": model_id,
        "lod": args.lod,
        "triangles": triangles,
        "materials": 2,
        "joints": len(armature.data.bones),
        "capturedObjects": len(source["objects"]),
        "sourceCollection": SOURCE_COLLECTION,
        "designRevision": "service_scout_compact_v2",
    }
    return report, obj


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print("service-scout: appending artistic source collection", flush=True)
    append_art_source(args.source_blend)
    print("service-scout: loading helper", flush=True)
    helper = load_first_outfit_helper()
    print("service-scout: capturing artistic source", flush=True)
    source = capture_art_source()
    print(
        f"service-scout: captured {len(source['vertices'])} vertices "
        f"and {len(source['faces'])} faces",
        flush=True,
    )
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print("service-scout: importing humanoid scaffold", flush=True)
    armature, scaffold_meshes = import_scaffold(args.scaffold)
    print("service-scout: measuring scaffold", flush=True)
    bounds = world_bounds_by_side(scaffold_meshes)
    for obj in scaffold_meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    print(
        f"service-scout: generating two PBR materials for {args.lod}",
        flush=True,
    )
    material_id = "service_boots"
    upper = helper.make_pbr_material(
        material_id,
        "upper",
        "#FFFFFF",
        "cracked_service_leather",
    )
    sole = helper.make_pbr_material(
        material_id,
        "sole",
        "#1A1D1D",
        "service_rubber",
    )
    apply_palette_to_basecolor(
        upper,
        tuple(UPPER_COLOURS[tag] for tag in UPPER_TAGS),
    )
    apply_palette_to_basecolor(sole, SOLE_COLOURS)
    report, obj = build_lod(
        args,
        helper,
        source,
        args.output,
        armature,
        bounds,
        upper,
        sole,
    )
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
    # Blender 4.5.12 can hit an allocator mismatch while destroying packed
    # images created by the glTF export helper.  The GLB is already closed and
    # flushed at this point, so skip only the faulty process teardown.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
