"""Build an original B+C ash-wolf creature golden master for critic review."""

from __future__ import annotations

import argparse
import hashlib
import json
from math import pi, sin
from pathlib import Path
import random
import struct
import sys

import bpy
import bmesh
from mathutils import Euler, Vector


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")

BONES = (
    ("root", (0.0, 0.0, 0.08), (0.0, 0.0, 0.22), None),
    ("pelvis", (0.0, 0.30, 0.70), (0.0, 0.08, 0.75), "root"),
    ("spine", (0.0, 0.08, 0.75), (0.0, -0.28, 0.82), "pelvis"),
    ("neck", (0.0, -0.28, 0.82), (0.0, -0.50, 1.03), "spine"),
    ("head", (0.0, -0.50, 1.03), (0.0, -0.88, 1.00), "neck"),
    ("jaw", (0.0, -0.64, 0.975), (0.0, -0.90, 0.925), "head"),
    ("tail_1", (0.0, 0.43, 0.73), (0.0, 0.66, 0.70), "pelvis"),
    ("tail_2", (0.0, 0.66, 0.70), (0.0, 0.88, 0.55), "tail_1"),
    ("tail_3", (0.0, 0.88, 0.55), (0.0, 1.08, 0.35), "tail_2"),
    ("upper_front_l", (0.22, -0.25, 0.75), (0.22, -0.29, 0.43), "spine"),
    ("lower_front_l", (0.22, -0.29, 0.43), (0.22, -0.31, 0.15), "upper_front_l"),
    ("paw_front_l", (0.22, -0.31, 0.15), (0.22, -0.47, 0.08), "lower_front_l"),
    ("upper_front_r", (-0.22, -0.25, 0.75), (-0.22, -0.29, 0.43), "spine"),
    ("lower_front_r", (-0.22, -0.29, 0.43), (-0.22, -0.31, 0.15), "upper_front_r"),
    ("paw_front_r", (-0.22, -0.31, 0.15), (-0.22, -0.47, 0.08), "lower_front_r"),
    ("upper_hind_l", (0.22, 0.30, 0.68), (0.23, 0.18, 0.40), "pelvis"),
    ("lower_hind_l", (0.23, 0.18, 0.40), (0.22, 0.34, 0.15), "upper_hind_l"),
    ("paw_hind_l", (0.22, 0.34, 0.15), (0.22, 0.16, 0.08), "lower_hind_l"),
    ("upper_hind_r", (-0.22, 0.30, 0.68), (-0.23, 0.18, 0.40), "pelvis"),
    ("lower_hind_r", (-0.23, 0.18, 0.40), (-0.22, 0.34, 0.15), "upper_hind_r"),
    ("paw_hind_r", (-0.22, 0.34, 0.15), (-0.22, 0.16, 0.08), "lower_hind_r"),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--asset-id", default="creature_ash_wolf_unified_v7")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.metaballs,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.actions,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def texture_image(
    name: str,
    base: tuple[float, float, float],
    kind: str,
    size: int = 512,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-ash-wolf-golden-master-v7:{name}:{kind}")
    pixels: list[float] = []
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.048 + y * 0.021) * 0.42
            directional = sin(y * 0.245 + sin(x * 0.031) * 2.2) * 0.31
            noise = (rng.random() - 0.5) * 0.20
            edge = 0.05 if x < 10 or x > size - 11 else 0.0
            if kind == "albedo":
                variation = broad * 0.10 + directional * 0.08 + noise * 0.045
                values = tuple(
                    max(0.02, min(0.95, channel * (1.0 + variation) + edge))
                    for channel in base
                )
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(
                    0.30,
                    min(0.99, base[0] + broad * 0.06 + directional * 0.04),
                )
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend(
                    (
                        0.5 + broad * 0.020 + directional * 0.014,
                        0.5 + noise * 0.020,
                        1.0,
                        1.0,
                    )
                )
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float = 0.0,
    normal_strength: float = 0.22,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = texture_image(f"{name}_albedo", base, "albedo")
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = texture_image(
        f"{name}_roughness",
        (roughness,) * 3,
        "roughness",
    )
    rough.image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = texture_image(
        f"{name}_normal",
        (0.5, 0.5, 1.0),
        "normal",
    )
    normal_texture.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def add_meta_ellipsoid(
    data: bpy.types.MetaBall,
    co: tuple[float, float, float],
    size: tuple[float, float, float],
    stiffness: float = 2.0,
) -> None:
    element = data.elements.new()
    element.type = "ELLIPSOID"
    element.co = co
    element.radius = 1.0
    element.size_x = size[0]
    element.size_y = size[1]
    element.size_z = size[2]
    element.stiffness = stiffness


def append_radial_loft(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    centers: tuple[tuple[float, float, float], ...],
    radii: tuple[tuple[float, float], ...],
    sides: int = 14,
) -> None:
    if len(centers) != len(radii) or len(centers) < 2:
        raise ValueError("Loft needs matching center and radius rows")
    base = len(vertices)
    center_vectors = tuple(Vector(center) for center in centers)
    for ring_index, (center, radius) in enumerate(zip(center_vectors, radii)):
        if ring_index == 0:
            tangent = center_vectors[1] - center
        elif ring_index == len(center_vectors) - 1:
            tangent = center - center_vectors[ring_index - 1]
        else:
            tangent = center_vectors[ring_index + 1] - center_vectors[ring_index - 1]
        tangent.normalize()
        side_axis = Vector((1.0, 0.0, 0.0))
        if abs(tangent.dot(side_axis)) > 0.92:
            side_axis = Vector((0.0, 1.0, 0.0))
        normal_axis = tangent.cross(side_axis).normalized()
        side_axis = normal_axis.cross(tangent).normalized()
        for side_index in range(sides):
            angle = side_index * (2.0 * pi / sides)
            point = (
                center
                + side_axis * (sin(angle + pi * 0.5) * radius[0])
                + normal_axis * (sin(angle) * radius[1])
            )
            vertices.append(tuple(point))
    for ring_index in range(len(centers) - 1):
        row = base + ring_index * sides
        next_row = row + sides
        for side_index in range(sides):
            next_side = (side_index + 1) % sides
            if (ring_index + side_index) % 2:
                faces.extend(
                    (
                        (row + side_index, next_row + side_index, row + next_side),
                        (row + next_side, next_row + side_index, next_row + next_side),
                    )
                )
            else:
                faces.extend(
                    (
                        (row + side_index, next_row + side_index, next_row + next_side),
                        (row + side_index, next_row + next_side, row + next_side),
                    )
                )
    start_center = len(vertices)
    vertices.append(centers[0])
    end_center = len(vertices)
    vertices.append(centers[-1])
    for side_index in range(sides):
        next_side = (side_index + 1) % sides
        faces.append((start_center, base + next_side, base + side_index))
        last_row = base + (len(centers) - 1) * sides
        faces.append((end_center, last_row + side_index, last_row + next_side))


def build_continuous_body(
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    append_radial_loft(
        vertices,
        faces,
        (
            (0.0, 1.08, 0.35),
            (0.0, 0.99, 0.45),
            (0.0, 0.86, 0.58),
            (0.0, 0.71, 0.70),
            (0.0, 0.56, 0.76),
            (0.0, 0.43, 0.75),
            (0.0, 0.30, 0.74),
            (0.0, 0.08, 0.75),
            (0.0, -0.14, 0.77),
            (0.0, -0.30, 0.80),
            (0.0, -0.41, 0.91),
            (0.0, -0.50, 1.03),
            (0.0, -0.59, 1.08),
            (0.0, -0.66, 1.04),
            (0.0, -0.74, 1.00),
            (0.0, -0.86, 0.99),
            (0.0, -0.95, 0.985),
        ),
        (
            (0.040, 0.040),
            (0.055, 0.052),
            (0.085, 0.080),
            (0.100, 0.095),
            (0.108, 0.102),
            (0.185, 0.185),
            (0.235, 0.215),
            (0.250, 0.220),
            (0.275, 0.245),
            (0.260, 0.245),
            (0.220, 0.225),
            (0.215, 0.220),
            (0.205, 0.195),
            (0.185, 0.165),
            (0.120, 0.105),
            (0.102, 0.086),
            (0.060, 0.055),
        ),
        sides=16,
    )
    for x in (0.205, -0.205):
        append_radial_loft(
            vertices,
            faces,
            (
                (x, -0.27, 0.79),
                (x, -0.25, 0.64),
                (x, -0.27, 0.50),
                (x, -0.31, 0.36),
                (x, -0.31, 0.20),
                (x, -0.39, 0.090),
                (x, -0.51, 0.045),
            ),
            (
                (0.115, 0.120),
                (0.105, 0.105),
                (0.090, 0.090),
                (0.065, 0.070),
                (0.052, 0.055),
                (0.070, 0.060),
                (0.075, 0.045),
            ),
            sides=12,
        )
        append_radial_loft(
            vertices,
            faces,
            (
                (x, 0.30, 0.72),
                (x, 0.22, 0.60),
                (x, 0.10, 0.48),
                (x, 0.16, 0.35),
                (x, 0.30, 0.20),
                (x, 0.26, 0.10),
                (x, 0.13, 0.045),
            ),
            (
                (0.135, 0.130),
                (0.120, 0.115),
                (0.100, 0.095),
                (0.075, 0.072),
                (0.055, 0.055),
                (0.055, 0.050),
                (0.075, 0.045),
            ),
            sides=12,
        )
    mesh = bpy.data.meshes.new("ash_wolf_body_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    body = bpy.data.objects.new("ash_wolf_body", mesh)
    bpy.context.collection.objects.link(body)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    body.data.remesh_voxel_size = 0.027
    body.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    current_triangles = sum(
        max(1, len(polygon.vertices) - 2)
        for polygon in body.data.polygons
    )
    if current_triangles > 6200:
        modifier = body.modifiers.new("controlled_low_poly_facets", "DECIMATE")
        modifier.ratio = 6200 / current_triangles
        modifier.decimate_type = "COLLAPSE"
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    body.select_set(False)
    body.data.materials.append(materials["fur"])
    body.data.materials.append(materials["underfur"])
    for polygon in body.data.polygons:
        center = sum(
            (body.data.vertices[index].co for index in polygon.vertices),
            Vector(),
        ) / len(polygon.vertices)
        belly = (
            center.z < 0.69
            and abs(center.x) < 0.27
            and center.y < 0.48
        )
        contact_dust = center.z < 0.18
        muzzle_dust = center.y < -0.72 and center.z < 1.04
        joint_dust = (
            0.14 < center.z < 0.50
            and abs(center.x) > 0.13
            and (
                abs(center.y + 0.30) < 0.17
                or abs(center.y - 0.22) < 0.18
            )
        )
        polygon.material_index = (
            1 if belly or contact_dust or muzzle_dust or joint_dust else 0
        )
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.90, island_margin=0.015)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    body.select_set(False)
    return body


def create_armature(asset_id: str) -> bpy.types.Object:
    data = bpy.data.armatures.new("ash_wolf_rig")
    armature = bpy.data.objects.new("ash_wolf_root", data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent_name in BONES:
        bone = data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_deform = True
        if parent_name:
            bone.parent = data.edit_bones[parent_name]
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)
    armature["realm_schema"] = "realm.creature-review.v7"
    armature["realm_connected_anatomy"] = True
    armature["realm_asset_id"] = asset_id
    armature["realm_category"] = "creature"
    armature["realm_species"] = "ash_wolf"
    armature["realm_art_direction"] = "character_geometry_b_materials_c"
    armature["realm_continuous_anatomy"] = True
    armature["realm_review_only"] = True
    armature["realm_runtime_integration_allowed"] = False
    armature["realm_geometry_provenance"] = "original project geometry"
    return armature


def point_segment_distance(
    point: Vector,
    start: Vector,
    end: Vector,
) -> float:
    segment = end - start
    length_squared = segment.length_squared
    if length_squared <= 1e-9:
        return (point - start).length
    factor = max(0.0, min(1.0, (point - start).dot(segment) / length_squared))
    return (point - (start + segment * factor)).length


def candidate_bones(point: Vector) -> tuple[str, ...]:
    if point.y > 0.47 and point.z > 0.45:
        return ("pelvis", "tail_1", "tail_2", "tail_3")
    if point.y < -0.49 and point.z > 0.70:
        return ("spine", "neck", "head")
    if point.z < 0.66 and abs(point.x) > 0.08:
        side = "l" if point.x >= 0 else "r"
        region = "front" if point.y < -0.04 else "hind"
        names = (
            f"upper_{region}_{side}",
            f"lower_{region}_{side}",
            f"paw_{region}_{side}",
        )
        if point.z > 0.52:
            return (*names, "spine" if region == "front" else "pelvis")
        return names
    if point.y < -0.18:
        return ("spine", "neck", "head")
    return ("pelvis", "spine", "neck")


def skin_continuous_body(
    body: bpy.types.Object,
    armature: bpy.types.Object,
) -> None:
    segments = {
        name: (
            Vector(head),
            Vector(tail),
        )
        for name, head, tail, _ in BONES
    }
    groups = {
        name: body.vertex_groups.new(name=name)
        for name, *_ in BONES
    }
    for vertex in body.data.vertices:
        names = candidate_bones(vertex.co)
        distances = sorted(
            (
                (
                    name,
                    point_segment_distance(
                        vertex.co,
                        segments[name][0],
                        segments[name][1],
                    ),
                )
                for name in names
            ),
            key=lambda row: row[1],
        )[:2]
        weights = [
            (name, 1.0 / max(0.025, distance) ** 2)
            for name, distance in distances
        ]
        total = sum(weight for _, weight in weights)
        for name, weight in weights:
            groups[name].add([vertex.index], weight / total, "REPLACE")
    modifier = body.modifiers.new("ash_wolf_skin", "ARMATURE")
    modifier.object = armature
    body.parent = armature


def beveled_ear(
    name: str,
    x: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    tip_x = x + (0.030 if x > 0.0 else -0.030)
    vertices = [
        (x - 0.052, -0.67, 1.105),
        (x + 0.052, -0.67, 1.105),
        (x + 0.044, -0.56, 1.100),
        (x - 0.044, -0.56, 1.100),
        (tip_x, -0.605, 1.345),
    ]
    faces = [
        (0, 1, 4),
        (1, 2, 4),
        (2, 3, 4),
        (3, 0, 4),
        (0, 3, 2, 1),
    ]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def create_loft_object(
    name: str,
    centers: tuple[tuple[float, float, float], ...],
    radii: tuple[tuple[float, float], ...],
    material: bpy.types.Material,
    sides: int = 12,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    append_radial_loft(vertices, faces, centers, radii, sides=sides)
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def create_ico(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=1,
        radius=1.0,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bpy.ops.object.shade_flat()
    return obj


def create_spike(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    rotation: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=5,
        radius1=1.0,
        radius2=0.18,
        depth=1.0,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bpy.ops.object.shade_flat()
    return obj


def assign_rigid_skin(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
) -> None:
    group = obj.vertex_groups.new(name=bone_name)
    group.add([vertex.index for vertex in obj.data.vertices], 1.0, "REPLACE")
    modifier = obj.modifiers.new("ash_wolf_skin", "ARMATURE")
    modifier.object = armature
    obj.parent = armature


def join_skinned(
    objects: list[bpy.types.Object],
    name: str,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.data.name = f"{name}_mesh"
    result.parent = armature
    if not any(modifier.type == "ARMATURE" for modifier in result.modifiers):
        modifier = result.modifiers.new("ash_wolf_skin", "ARMATURE")
        modifier.object = armature
    bpy.context.view_layer.objects.active = result
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.90, island_margin=0.015)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    result.select_set(False)
    return result


def build_details(
    materials: dict[str, bpy.types.Material],
    armature: bpy.types.Object,
) -> list[bpy.types.Object]:
    dark_objects = [
        beveled_ear("ear_l", 0.120, materials["dark"]),
        beveled_ear("ear_r", -0.120, materials["dark"]),
        create_ico(
            "nose",
            (0.0, -0.970, 0.985),
            (0.065, 0.035, 0.050),
            materials["dark"],
        ),
    ]
    for obj in dark_objects:
        assign_rigid_skin(obj, armature, "head")
    for index, (x, y) in enumerate(
        ((-0.060, -0.755), (0.060, -0.755), (-0.050, -0.845), (0.050, -0.845))
    ):
        tooth = create_spike(
            f"upper_tooth_{index}",
            (x, y, 0.920),
            (0.014, 0.014, 0.036),
            (pi, 0.0, 0.0),
            materials["teeth"],
        )
        assign_rigid_skin(tooth, armature, "head")
        dark_objects.append(tooth)
    for side, x in (("l", 0.22), ("r", -0.22)):
        for region, y, bone_name in (
            ("front", -0.51, f"paw_front_{side}"),
            ("hind", 0.10, f"paw_hind_{side}"),
        ):
            for index, offset in enumerate((-0.045, 0.0, 0.045)):
                claw = create_spike(
                    f"claw_{region}_{side}_{index}",
                    (x + offset, y, 0.075),
                    (0.016, 0.016, 0.070),
                    (pi * 0.5, 0.0, 0.0),
                    materials["dark"],
                )
                assign_rigid_skin(claw, armature, bone_name)
                dark_objects.append(claw)
    dark = join_skinned(dark_objects, "ash_wolf_dark_details", armature)

    jaw_objects = [
        create_loft_object(
            "lower_jaw",
            (
                (0.0, -0.64, 0.970),
                (0.0, -0.76, 0.925),
                (0.0, -0.89, 0.925),
            ),
            (
                (0.112, 0.044),
                (0.092, 0.038),
                (0.052, 0.028),
            ),
            materials["underfur"],
        ),
        create_ico(
            "mouth_floor",
            (0.0, -0.765, 0.975),
            (0.100, 0.140, 0.018),
            materials["dark"],
        ),
    ]
    for obj in jaw_objects:
        assign_rigid_skin(obj, armature, "jaw")
    for index, (x, y) in enumerate(
        ((-0.052, -0.750), (0.052, -0.750), (-0.042, -0.835), (0.042, -0.835))
    ):
        tooth = create_spike(
            f"lower_tooth_{index}",
            (x, y, 0.995),
            (0.012, 0.012, 0.032),
            (0.0, 0.0, 0.0),
            materials["teeth"],
        )
        assign_rigid_skin(tooth, armature, "jaw")
        jaw_objects.append(tooth)
    jaw_mesh = join_skinned(jaw_objects, "ash_wolf_jaw", armature)

    eyes = []
    for side, x in (("l", 0.150), ("r", -0.150)):
        eye = create_ico(
            f"eye_{side}",
            (x, -0.655, 1.095),
            (0.024, 0.018, 0.024),
            materials["eyes"],
        )
        assign_rigid_skin(eye, armature, "head")
        eyes.append(eye)
    eye_mesh = join_skinned(eyes, "ash_wolf_eyes", armature)
    return [dark, eye_mesh, jaw_mesh]


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)


def make_action(
    armature: bpy.types.Object,
    name: str,
    frames: tuple[
        tuple[int, dict[str, dict[str, tuple[float, float, float]]]],
        ...,
    ],
    interpolation: str = "BEZIER",
) -> None:
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    bone_names = tuple(sorted(bone.name for bone in armature.pose.bones))
    for frame, pose in frames:
        bpy.context.scene.frame_set(frame)
        reset_pose(armature)
        for bone_name, transform in pose.items():
            bone = armature.pose.bones[bone_name]
            if "location" in transform:
                bone.location = transform["location"]
            if "rotation" in transform:
                bone.rotation_quaternion = Euler(
                    transform["rotation"],
                    "XYZ",
                ).to_quaternion()
        for bone_name in bone_names:
            bone = armature.pose.bones[bone_name]
            bone.keyframe_insert("location", frame=frame, group=bone_name)
            bone.keyframe_insert(
                "rotation_quaternion",
                frame=frame,
                group=bone_name,
            )
            bone.keyframe_insert("scale", frame=frame, group=bone_name)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = interpolation
    action.frame_start = frames[0][0]
    action.frame_end = frames[-1][0]
    armature.animation_data.action = None
    reset_pose(armature)


def add_actions(armature: bpy.types.Object) -> None:
    idle_a = {
        "spine": {"rotation": (0.015, 0.0, -0.020)},
        "neck": {"rotation": (-0.025, 0.0, 0.025)},
        "head": {"rotation": (0.015, 0.0, -0.025)},
        "tail_1": {"rotation": (0.0, 0.0, 0.10)},
        "tail_2": {"rotation": (0.0, 0.0, -0.12)},
        "tail_3": {"rotation": (0.0, 0.0, 0.14)},
    }
    idle_b = {
        "root": {"location": (0.0, 0.0, 0.0)},
        "spine": {"rotation": (-0.020, 0.0, 0.020)},
        "neck": {"rotation": (0.030, 0.0, -0.025)},
        "head": {"rotation": (-0.020, 0.0, 0.030)},
        "tail_1": {"rotation": (0.0, 0.0, -0.10)},
        "tail_2": {"rotation": (0.0, 0.0, 0.12)},
        "tail_3": {"rotation": (0.0, 0.0, -0.14)},
    }
    make_action(armature, "idle", ((1, idle_a), (16, idle_b), (31, idle_a)))

    walk_frames = []
    run_frames = []
    leg_names = (
        "upper_front_l",
        "upper_front_r",
        "upper_hind_l",
        "upper_hind_r",
    )
    for frame, phase in ((1, 1), (8, 0), (16, -1), (24, 0), (31, 1)):
        root_lift = 0.0085
        if phase > 0:
            root_lift = 0.0345
        elif phase < 0:
            root_lift = 0.0305
        pose = {
            "root": {
                "location": (0.0, root_lift, 0.0),
            },
            "spine": {"rotation": (phase * 0.018, 0.0, -phase * 0.025)},
            "neck": {"rotation": (-phase * 0.020, 0.0, phase * 0.020)},
            "tail_1": {"rotation": (0.0, 0.0, phase * 0.11)},
            "tail_2": {"rotation": (0.0, 0.0, -phase * 0.13)},
        }
        for index, bone_name in enumerate(leg_names):
            direction = phase if index in (0, 3) else -phase
            pose[bone_name] = {"rotation": (direction * 0.38, 0.0, 0.0)}
            side = "l" if bone_name.endswith("_l") else "r"
            region = "front" if "front" in bone_name else "hind"
            flex = 0.34 if direction < 0 else 0.08
            pose[f"lower_{region}_{side}"] = {
                "rotation": (flex, 0.0, 0.0),
            }
            pose[f"paw_{region}_{side}"] = {
                "rotation": (-flex * 0.55, 0.0, 0.0),
            }
        walk_frames.append((frame, pose))
    make_action(armature, "walk", tuple(walk_frames), interpolation="LINEAR")

    for frame, phase in ((1, 1), (6, 0), (12, -1), (18, 0), (24, 1)):
        pose = {
            "root": {
                "location": (0.0, -0.0145 if phase == 0 else 0.0, 0.0),
            },
            "spine": {"rotation": (-0.08 + phase * 0.035, 0.0, -phase * 0.035)},
            "neck": {"rotation": (0.07 - phase * 0.025, 0.0, phase * 0.025)},
            "tail_1": {"rotation": (-0.05, 0.0, phase * 0.15)},
            "tail_2": {"rotation": (0.03, 0.0, -phase * 0.17)},
        }
        for index, bone_name in enumerate(leg_names):
            direction = phase if index in (0, 3) else -phase
            pose[bone_name] = {"rotation": (direction * 0.68, 0.0, 0.0)}
            side = "l" if bone_name.endswith("_l") else "r"
            region = "front" if "front" in bone_name else "hind"
            flex = 0.58 if direction < 0 else 0.16
            pose[f"lower_{region}_{side}"] = {
                "rotation": (flex, 0.0, 0.0),
            }
            pose[f"paw_{region}_{side}"] = {
                "rotation": (-flex * 0.60, 0.0, 0.0),
            }
        run_frames.append((frame, pose))
    make_action(armature, "run", tuple(run_frames), interpolation="LINEAR")

    make_action(
        armature,
        "attack",
        (
            (1, idle_a),
            (
                7,
                {
                    "root": {"location": (0.0, 0.082, -0.080)},
                    "spine": {"rotation": (0.16, 0.0, 0.0)},
                    "neck": {"rotation": (-0.18, 0.0, 0.0)},
                    "head": {"rotation": (-0.20, 0.0, 0.0)},
                    "jaw": {"rotation": (0.10, 0.0, 0.0)},
                    "tail_1": {"rotation": (0.10, 0.0, 0.0)},
                },
            ),
            (
                12,
                {
                    "root": {"location": (0.0, 0.120, 0.300)},
                    "spine": {"rotation": (-0.16, 0.0, 0.0)},
                    "neck": {"rotation": (0.32, 0.0, 0.0)},
                    "head": {"rotation": (0.30, 0.0, 0.0)},
                    "jaw": {"rotation": (0.32, 0.0, 0.0)},
                    "upper_front_l": {"rotation": (-0.55, 0.0, 0.0)},
                    "upper_front_r": {"rotation": (-0.55, 0.0, 0.0)},
                    "lower_front_l": {"rotation": (0.85, 0.0, 0.0)},
                    "lower_front_r": {"rotation": (0.85, 0.0, 0.0)},
                    "paw_front_l": {"rotation": (-0.45, 0.0, 0.0)},
                    "paw_front_r": {"rotation": (-0.45, 0.0, 0.0)},
                    "upper_hind_l": {"rotation": (0.20, 0.0, 0.0)},
                    "upper_hind_r": {"rotation": (0.20, 0.0, 0.0)},
                    "lower_hind_l": {"rotation": (0.25, 0.0, 0.0)},
                    "lower_hind_r": {"rotation": (0.25, 0.0, 0.0)},
                    "paw_hind_l": {"rotation": (-0.15, 0.0, 0.0)},
                    "paw_hind_r": {"rotation": (-0.15, 0.0, 0.0)},
                    "tail_1": {"rotation": (-0.18, 0.0, 0.0)},
                },
            ),
            (
                16,
                {
                    "root": {"location": (0.0, -0.004, 0.260)},
                    "spine": {"rotation": (-0.10, 0.0, 0.0)},
                    "neck": {"rotation": (0.24, 0.0, 0.0)},
                    "head": {"rotation": (0.18, 0.0, 0.0)},
                    "jaw": {"rotation": (0.08, 0.0, 0.0)},
                    "upper_front_l": {"rotation": (-0.18, 0.0, 0.0)},
                    "upper_front_r": {"rotation": (-0.18, 0.0, 0.0)},
                    "lower_front_l": {"rotation": (0.18, 0.0, 0.0)},
                    "lower_front_r": {"rotation": (0.18, 0.0, 0.0)},
                    "paw_front_l": {"rotation": (-0.08, 0.0, 0.0)},
                    "paw_front_r": {"rotation": (-0.08, 0.0, 0.0)},
                    "upper_hind_l": {"rotation": (0.10, 0.0, 0.0)},
                    "upper_hind_r": {"rotation": (0.10, 0.0, 0.0)},
                    "lower_hind_l": {"rotation": (0.12, 0.0, 0.0)},
                    "lower_hind_r": {"rotation": (0.12, 0.0, 0.0)},
                    "paw_hind_l": {"rotation": (-0.08, 0.0, 0.0)},
                    "paw_hind_r": {"rotation": (-0.08, 0.0, 0.0)},
                    "tail_1": {"rotation": (-0.10, 0.0, 0.0)},
                },
            ),
            (22, idle_a),
        ),
        interpolation="LINEAR",
    )
    make_action(
        armature,
        "hurt",
        (
            (1, idle_a),
            (
                5,
                {
                    "root": {"location": (0.04, 0.053, -0.040)},
                    "spine": {"rotation": (0.12, 0.08, 0.18)},
                    "neck": {"rotation": (-0.14, -0.05, -0.18)},
                    "head": {"rotation": (0.10, 0.05, -0.22)},
                    "upper_front_l": {"rotation": (0.25, 0.0, 0.18)},
                    "lower_front_l": {"rotation": (0.35, 0.0, 0.0)},
                    "paw_front_l": {"rotation": (-0.15, 0.0, 0.0)},
                    "upper_front_r": {"rotation": (-0.15, 0.0, -0.12)},
                    "lower_front_r": {"rotation": (0.18, 0.0, 0.0)},
                    "paw_front_r": {"rotation": (-0.08, 0.0, 0.0)},
                    "upper_hind_l": {"rotation": (-0.20, 0.0, 0.10)},
                    "lower_hind_l": {"rotation": (0.35, 0.0, 0.0)},
                    "paw_hind_l": {"rotation": (-0.15, 0.0, 0.0)},
                    "upper_hind_r": {"rotation": (0.12, 0.0, -0.08)},
                    "lower_hind_r": {"rotation": (0.20, 0.0, 0.0)},
                    "paw_hind_r": {"rotation": (-0.10, 0.0, 0.0)},
                    "tail_1": {"rotation": (0.0, 0.0, 0.18)},
                },
            ),
            (14, idle_a),
        ),
    )
    make_action(
        armature,
        "death",
        (
            (1, idle_a),
            (
                10,
                {
                    "root": {
                        "location": (0.08, 0.201, 0.0),
                        "rotation": (0.0, 0.0, 0.52),
                    },
                    "spine": {"rotation": (0.12, 0.08, 0.20)},
                    "neck": {"rotation": (-0.18, 0.0, -0.16)},
                    "head": {"rotation": (-0.08, 0.0, -0.10)},
                    "upper_front_l": {"rotation": (0.18, 0.0, -0.08)},
                    "lower_front_l": {"rotation": (0.28, 0.0, 0.0)},
                    "paw_front_l": {"rotation": (-0.12, 0.0, 0.0)},
                    "upper_front_r": {"rotation": (-0.10, 0.0, 0.06)},
                    "lower_front_r": {"rotation": (0.34, 0.0, 0.0)},
                    "paw_front_r": {"rotation": (-0.16, 0.0, 0.0)},
                    "upper_hind_l": {"rotation": (0.14, 0.0, -0.06)},
                    "lower_hind_l": {"rotation": (0.30, 0.0, 0.0)},
                    "paw_hind_l": {"rotation": (-0.12, 0.0, 0.0)},
                    "upper_hind_r": {"rotation": (-0.16, 0.0, 0.08)},
                    "lower_hind_r": {"rotation": (0.25, 0.0, 0.0)},
                    "paw_hind_r": {"rotation": (-0.10, 0.0, 0.0)},
                    "tail_1": {"rotation": (0.08, 0.0, 0.10)},
                    "tail_2": {"rotation": (-0.06, 0.0, -0.08)},
                    "tail_3": {"rotation": (0.04, 0.0, 0.05)},
                },
            ),
            (
                26,
                {
                    "root": {
                        "location": (0.20, 0.260, 0.0),
                        "rotation": (0.0, 0.0, 1.48),
                    },
                    "spine": {"rotation": (0.10, 0.10, 0.18)},
                    "neck": {"rotation": (-0.20, 0.0, -0.20)},
                    "head": {"rotation": (-0.12, 0.0, -0.18)},
                    "tail_1": {"rotation": (0.12, 0.0, 0.14)},
                    "tail_2": {"rotation": (-0.10, 0.0, -0.10)},
                    "tail_3": {"rotation": (0.08, 0.0, 0.06)},
                    "upper_front_l": {"rotation": (0.35, 0.0, -0.16)},
                    "lower_front_l": {"rotation": (0.55, 0.0, 0.0)},
                    "paw_front_l": {"rotation": (-0.25, 0.0, 0.0)},
                    "upper_front_r": {"rotation": (-0.20, 0.0, 0.10)},
                    "lower_front_r": {"rotation": (0.70, 0.0, 0.0)},
                    "paw_front_r": {"rotation": (-0.35, 0.0, 0.0)},
                    "upper_hind_l": {"rotation": (0.25, 0.0, -0.12)},
                    "lower_hind_l": {"rotation": (0.65, 0.0, 0.0)},
                    "paw_hind_l": {"rotation": (-0.25, 0.0, 0.0)},
                    "upper_hind_r": {"rotation": (-0.30, 0.0, 0.14)},
                    "lower_hind_r": {"rotation": (0.50, 0.0, 0.0)},
                    "paw_hind_r": {"rotation": (-0.20, 0.0, 0.0)},
                },
            ),
        ),
    )


def evaluated_bounds(
    meshes: list[bpy.types.Object],
) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[Vector] = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            points.extend(
                evaluated.matrix_world @ vertex.co for vertex in mesh.vertices
            )
        finally:
            evaluated.to_mesh_clear()
    minimum = Vector(
        tuple(min(point[axis] for point in points) for axis in range(3))
    )
    maximum = Vector(
        tuple(max(point[axis] for point in points) for axis in range(3))
    )
    return minimum, maximum


def connected_component_count(obj: bpy.types.Object) -> int:
    adjacency = [set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        first, second = edge.vertices
        adjacency[first].add(second)
        adjacency[second].add(first)
    remaining = set(range(len(adjacency)))
    components = 0
    while remaining:
        components += 1
        stack = [remaining.pop()]
        while stack:
            vertex = stack.pop()
            neighbors = adjacency[vertex] & remaining
            remaining.difference_update(neighbors)
            stack.extend(neighbors)
    return components


def parse_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(
        data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0")
    )
    accessors = gltf.get("accessors", [])
    vertices = 0
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position = primitive.get("attributes", {}).get("POSITION")
            if position is not None:
                vertices += accessors[position]["count"]
            indices = primitive.get("indices")
            if indices is not None:
                triangles += accessors[indices]["count"] // 3
    skins = gltf.get("skins", [])
    return {
        "meshDefinitions": len(gltf.get("meshes", [])),
        "positionVertices": vertices,
        "triangles": triangles,
        "materials": len(gltf.get("materials", [])),
        "textures": len(gltf.get("textures", [])),
        "skins": len(skins),
        "skinJointCounts": [len(skin.get("joints", [])) for skin in skins],
        "animations": [
            animation.get("name", "") for animation in gltf.get("animations", [])
        ],
        "nodes": [node.get("name", "") for node in gltf.get("nodes", [])],
    }


def export_candidate(
    output: Path,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Original Realm of Ashes ash-wolf geometry, rig, textures and "
            "animations. Project asset."
        ),
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_force_sampling=True,
        export_def_bones=True,
        export_leaf_bone=False,
        export_armature_object_remove=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_skins=True,
        export_all_influences=False,
        export_morph=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot export {output}: {result}")


def main() -> None:
    args = parse_args()
    clear_scene()
    materials = {
        "fur": pbr_material(
            "ash_wolf_weathered_fur",
            (0.285, 0.265, 0.225),
            0.96,
            normal_strength=0.30,
        ),
        "underfur": pbr_material(
            "ash_wolf_dusty_underfur",
            (0.525, 0.425, 0.270),
            0.97,
            normal_strength=0.24,
        ),
        "dark": pbr_material(
            "ash_wolf_charred_mane_claws",
            (0.160, 0.140, 0.115),
            0.91,
            normal_strength=0.20,
        ),
        "teeth": pbr_material(
            "ash_wolf_worn_teeth",
            (0.455, 0.385, 0.255),
            0.90,
            normal_strength=0.12,
        ),
        "eyes": pbr_material(
            "ash_wolf_amber_eyes",
            (0.520, 0.175, 0.020),
            0.72,
            normal_strength=0.08,
        ),
    }
    armature = create_armature(args.asset_id)
    body = build_continuous_body(materials)
    skin_continuous_body(body, armature)
    details = build_details(materials, armature)
    meshes = [body, *details]

    reset_pose(armature)
    bpy.context.view_layer.update()
    minimum, _ = evaluated_bounds(meshes)
    armature.location.z -= minimum.z
    bpy.context.view_layer.update()
    add_actions(armature)
    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    minimum, _ = evaluated_bounds(meshes)
    armature.location.z -= minimum.z
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    armature["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }
    export_candidate(args.output, armature, meshes)
    actual = parse_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "boundsIdleMetres": {
            "minimum": [round(value, 6) for value in minimum],
            "maximum": [round(value, 6) for value in maximum],
            "size": [round(value, 6) for value in size],
        },
        "collider": {
            "type": "box",
            "size": [round(value, 6) for value in size],
            "center": [round(value, 6) for value in center],
        },
        "rig": {
            "armatures": 1,
            "boneCount": len(armature.data.bones),
            "bones": sorted(bone.name for bone in armature.data.bones),
        },
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "geometryAnalysis": {
            "primaryBodyConnectedComponents": connected_component_count(body),
            "primaryBodyTopology": "voxel-unified radial-loft anatomy",
        },
        "provenance": {
            "license": "Realm of Ashes project asset",
            "geometry": "original authored radial-loft project topology",
            "rig": "original project rig",
            "animations": "original project keyframes",
            "externalDonor": None,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_UNIFIED_CREATURE_BUILD=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
