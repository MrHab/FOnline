"""Build the B+C field-worker clothing modules for visual review.

The generated GLBs are deliberately kept outside runtime directories. Geometry
is rebuilt from the approved Realm body surface and original modular details;
the audited CC0 outfit package is used only as a rig/topology reference.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Vector


MODULES = {
    "field_shirt": {
        "slot": "torso_inner",
        "hide_body_regions": ["torso_upper"],
        "clearance": 0.018,
        "main_color": "#496D69",
        "accent_color": "#26383B",
        "surface": "sun_bleached_canvas",
    },
    "work_trousers": {
        "slot": "legs_inner",
        "hide_body_regions": [
            "pelvis",
            "thigh_l",
            "thigh_r",
            "lower_leg_l",
            "lower_leg_r",
        ],
        "clearance": 0.016,
        "main_color": "#5B5C40",
        "accent_color": "#26383B",
        "surface": "dusty_work_twill",
    },
    "service_boots": {
        "slot": "feet",
        "hide_body_regions": ["foot_l", "foot_r"],
        "clearance": 0.019,
        "main_color": "#3B2922",
        "accent_color": "#1A1D1D",
        "surface": "cracked_service_leather",
    },
}
SEXES = ("female", "male")
BODY_TYPES = ("slim", "medium", "large")
LODS = ("lod0", "lod1", "lod2")
LOD_RATIOS = {"lod0": 0.44, "lod1": 0.22, "lod2": 0.29}
TEXTURE_SIZE = 256
PROVENANCE_ID = "Modular Character Outfits - Fantasy"
REQUIRED_JOINT_COUNT = 65


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(
        description="Build one Realm B+C field-worker clothing module GLB"
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--module", choices=tuple(MODULES), required=True)
    parser.add_argument("--sex", choices=SEXES, required=True)
    parser.add_argument("--body-type", choices=BODY_TYPES, required=True)
    parser.add_argument("--lod", choices=LODS, required=True)
    return parser.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_body(
    input_file: Path,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    result = bpy.ops.import_scene.gltf(filepath=str(input_file))
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot import approved body: {input_file}")
    armatures = [
        obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"
    ]
    if len(armatures) != 1:
        raise RuntimeError(
            f"Expected exactly one approved-body armature, got {len(armatures)}"
        )
    armature = armatures[0]
    body_candidates = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and (
            obj.name == "body_base"
            or "body" in obj.data.name.lower()
        )
        and obj.name not in {"Cube", "Icosphere"}
    ]
    if len(body_candidates) != 1:
        raise RuntimeError(
            f"Expected exactly one approved body mesh, got {len(body_candidates)}"
        )
    body = body_candidates[0]

    armature.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    # The approved review roots use a small uniform presentation scale.
    # Applying it preserves the reviewed dimensions while producing the
    # identity root required by production-compatible modular assets.
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(
        location=False,
        rotation=False,
        scale=True,
    )
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(
        location=False,
        rotation=False,
        scale=True,
    )
    body.data.update()

    for obj in list(bpy.context.scene.objects):
        if obj not in {armature, body}:
            bpy.data.objects.remove(obj, do_unlink=True)
    return armature, body


def srgb_channel_to_linear(value: float) -> float:
    return (
        value / 12.92
        if value <= 0.04045
        else ((value + 0.055) / 1.055) ** 2.4
    )


def hex_to_srgb(hex_value: str) -> tuple[float, float, float]:
    value = hex_value.lstrip("#")
    return tuple(
        int(value[index : index + 2], 16) / 255.0
        for index in (0, 2, 4)
    )


def deterministic_surface_value(
    x: int,
    y: int,
    seed: int,
) -> float:
    value = (
        math.sin((x + seed * 11) * 0.173)
        + math.cos((y - seed * 7) * 0.219)
        + math.sin((x + y + seed * 5) * 0.071)
    )
    return value / 3.0


def make_generated_image(
    name: str,
    role: str,
    color: tuple[float, float, float],
    seed: int,
    surface: str,
) -> bpy.types.Image:
    # Blender's glTF exporter strips one filename extension from image names.
    # The doubled source suffix keeps the required embedded `*_role.png` name.
    exporter_name = f"{name}.png"
    image = bpy.data.images.new(
        name=exporter_name,
        width=TEXTURE_SIZE,
        height=TEXTURE_SIZE,
        alpha=True,
        float_buffer=False,
    )
    image.file_format = "PNG"
    image.filepath_raw = f"//{exporter_name}"
    image.colorspace_settings.name = (
        "sRGB" if role == "basecolor" else "Non-Color"
    )
    pixels: list[float] = []
    for y in range(TEXTURE_SIZE):
        for x in range(TEXTURE_SIZE):
            grain = deterministic_surface_value(x, y, seed)
            weave = (
                math.sin(x * math.pi * 0.5)
                * math.sin(y * math.pi * 0.5)
            )
            dust_wave = (
                math.sin((x + seed) * 0.029)
                + math.cos((y - seed) * 0.023)
            )
            dust = max(0.0, dust_wave * 0.5 - 0.58)
            if role == "basecolor":
                wear = 0.94 + grain * 0.055 + dust * 0.035
                if surface == "cracked_service_leather":
                    wear -= abs(math.sin((x * 0.19) + (y * 0.11))) * 0.025
                pixels.extend(
                    [
                        min(1.0, max(0.0, color[channel] * wear))
                        for channel in range(3)
                    ]
                    + [1.0]
                )
            elif role == "normal":
                strength = 0.018 if "leather" in surface else 0.028
                nx = 0.5 + weave * strength + grain * 0.006
                ny = 0.5 - weave * strength + grain * 0.006
                pixels.extend([nx, ny, 1.0, 1.0])
            elif role == "orm":
                roughness = (
                    0.78
                    if surface == "cracked_service_leather"
                    else 0.88
                )
                roughness = min(
                    0.98,
                    max(0.62, roughness + grain * 0.045 + dust * 0.035),
                )
                occlusion = min(1.0, max(0.76, 0.96 - dust * 0.08))
                pixels.extend([occlusion, roughness, 0.0, 1.0])
            else:
                raise RuntimeError(f"Unknown generated map role: {role}")
    image.pixels.foreach_set(pixels)
    image.update()
    image.pack()
    return image


def make_gltf_occlusion_group() -> bpy.types.NodeTree:
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is not None:
        return group
    group = bpy.data.node_groups.new(
        "glTF Material Output",
        "ShaderNodeTree",
    )
    group.interface.new_socket(
        name="Occlusion",
        in_out="INPUT",
        socket_type="NodeSocketFloat",
    )
    return group


def make_pbr_material(
    module_id: str,
    role: str,
    color_hex: str,
    surface: str,
) -> bpy.types.Material:
    prefix = f"{module_id}_{role}"
    color = hex_to_srgb(color_hex)
    seed = sum(ord(character) for character in prefix)
    base = make_generated_image(
        f"{prefix}_basecolor.png",
        "basecolor",
        color,
        seed,
        surface,
    )
    normal = make_generated_image(
        f"{prefix}_normal.png",
        "normal",
        color,
        seed + 17,
        surface,
    )
    orm = make_generated_image(
        f"{prefix}_orm.png",
        "orm",
        color,
        seed + 37,
        surface,
    )

    material = bpy.data.materials.new(name=f"mat_{module_id}_{role}")
    material.use_nodes = True
    material.use_backface_culling = False
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (780, 80)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (500, 80)
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    base_node = nodes.new("ShaderNodeTexImage")
    base_node.name = "basecolor"
    base_node.image = base
    base_node.location = (-620, 260)
    links.new(base_node.outputs["Color"], principled.inputs["Base Color"])

    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = "normal"
    normal_node.image = normal
    normal_node.location = (-620, 20)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.space = "TANGENT"
    normal_map.inputs["Strength"].default_value = 0.72
    normal_map.location = (180, -20)
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

    orm_node = nodes.new("ShaderNodeTexImage")
    orm_node.name = "orm"
    orm_node.image = orm
    orm_node.location = (-620, -270)
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.location = (-310, -250)
    links.new(orm_node.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled.inputs["Roughness"])
    links.new(separate.outputs["Blue"], principled.inputs["Metallic"])
    occlusion = nodes.new("ShaderNodeGroup")
    occlusion.name = "glTF Material Output"
    occlusion.node_tree = make_gltf_occlusion_group()
    occlusion.location = (40, -340)
    links.new(separate.outputs["Red"], occlusion.inputs["Occlusion"])

    material.diffuse_color = (*color, 1.0)
    material["realm_material_style"] = "retro_modern_c"
    material["realm_surface_profile"] = surface
    material["realm_wear_policy"] = "localized_dust_sun_bleaching"
    return material


def vertex_weights(
    body: bpy.types.Object,
    vertex_index: int,
) -> dict[str, float]:
    names = {
        group.index: group.name
        for group in body.vertex_groups
    }
    return {
        names[membership.group]: float(membership.weight)
        for membership in body.data.vertices[vertex_index].groups
        if membership.group in names and membership.weight > 0.0
    }


def weight_sum(weights: dict[str, float], names: set[str]) -> float:
    return sum(weights.get(name, 0.0) for name in names)


def selected_face_indices(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    module_id: str,
) -> list[int]:
    bones = armature.data.bones
    pelvis = bones.get("pelvis")
    neck = bones.get("neck_01")
    upperarm_l = bones.get("upperarm_l")
    calf_l = bones.get("calf_l")
    foot_l = bones.get("foot_l")
    if not all([pelvis, neck, upperarm_l, calf_l, foot_l]):
        raise RuntimeError("Approved humanoid rig is missing outfit reference bones")

    shirt_bottom = pelvis.tail_local.z - 0.065
    # Use the upper neck landmark instead of the neck head. On the broader
    # male base, shoulder polygons sit above neck.head and were otherwise
    # omitted, leaving an unintended bare collar/shoulder band.
    shirt_top = neck.tail_local.z - 0.025
    torso_extent = abs(upperarm_l.head_local.x) + 0.052
    # Reach far enough along the upper-arm rest axis to keep the sleeve
    # boundary outside broad male shoulders after the shared idle pose.
    sleeve_extent = abs(upperarm_l.head_local.x) + 0.240
    sleeve_bottom = pelvis.tail_local.z + 0.205
    trouser_bottom = foot_l.head_local.z + 0.055
    trouser_top = pelvis.tail_local.z + 0.035
    boot_top = calf_l.tail_local.z + 0.155

    selected: list[int] = []
    for polygon in body.data.polygons:
        vertices = [body.data.vertices[index] for index in polygon.vertices]
        center = sum((vertex.co for vertex in vertices), Vector()) / len(vertices)

        include = False
        if module_id == "field_shirt":
            include = (
                shirt_bottom <= center.z <= shirt_top
                and (
                    abs(center.x) <= torso_extent
                    or (
                        abs(center.x) <= sleeve_extent
                        and center.z >= sleeve_bottom
                    )
                )
            )
        elif module_id == "work_trousers":
            include = trouser_bottom <= center.z <= trouser_top
        elif module_id == "service_boots":
            include = center.z <= boot_top
        if include:
            selected.append(polygon.index)
    if len(selected) < 12:
        raise RuntimeError(
            f"{module_id}: body-surface extraction selected only "
            f"{len(selected)} faces"
        )
    return selected


def closest_point_on_segment(
    point: Vector,
    start: Vector,
    end: Vector,
) -> Vector:
    direction = end - start
    length_squared = direction.length_squared
    if length_squared <= 0.0000001:
        return start.copy()
    factor = max(
        0.0,
        min(1.0, (point - start).dot(direction) / length_squared),
    )
    return start + direction * factor


def garment_offset(
    point: Vector,
    armature: bpy.types.Object,
    module_id: str,
    clearance: float,
) -> Vector:
    bone_names = {
        "field_shirt": (
            "spine_01",
            "spine_02",
            "spine_03",
            "clavicle_l",
            "clavicle_r",
            "upperarm_l",
            "upperarm_r",
        ),
        "work_trousers": (
            "pelvis",
            "thigh_l",
            "thigh_r",
            "calf_l",
            "calf_r",
        ),
        "service_boots": (
            "calf_l",
            "calf_r",
            "foot_l",
            "foot_r",
            "ball_l",
            "ball_r",
        ),
    }[module_id]
    nearest = None
    nearest_distance = math.inf
    for name in bone_names:
        bone = armature.data.bones.get(name)
        if bone is None:
            continue
        candidate = closest_point_on_segment(
            point,
            bone.head_local,
            bone.tail_local,
        )
        distance = (point - candidate).length_squared
        if distance < nearest_distance:
            nearest = candidate
            nearest_distance = distance
    if nearest is None:
        raise RuntimeError(f"{module_id}: no offset reference bones")
    direction = point - nearest
    if direction.length_squared <= 0.0000001:
        direction = Vector((point.x, point.y, 0.0))
    if direction.length_squared <= 0.0000001:
        direction = Vector((0.0, -1.0, 0.0))
    return direction.normalized() * clearance


def build_surface_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    module_id: str,
    lod: str,
    materials: tuple[bpy.types.Material, bpy.types.Material],
) -> bpy.types.Object:
    selected = selected_face_indices(body, armature, module_id)
    old_uv = body.data.uv_layers.active
    if old_uv is None:
        raise RuntimeError("Approved body has no UV layer")

    old_to_new: dict[int, int] = {}
    source_indices: list[int] = []
    faces: list[list[int]] = []
    source_polygons: list[bpy.types.MeshPolygon] = []
    for polygon_index in selected:
        polygon = body.data.polygons[polygon_index]
        new_face = []
        for old_index in polygon.vertices:
            if old_index not in old_to_new:
                old_to_new[old_index] = len(source_indices)
                source_indices.append(old_index)
            new_face.append(old_to_new[old_index])
        faces.append(new_face)
        source_polygons.append(polygon)

    clearance = float(MODULES[module_id]["clearance"])
    vertices = []
    for old_index in source_indices:
        source = body.data.vertices[old_index]
        position = source.co + garment_offset(
            source.co,
            armature,
            module_id,
            clearance,
        )
        if module_id == "field_shirt":
            pelvis = armature.data.bones["pelvis"]
            hem_limit = pelvis.tail_local.z + 0.025
            if position.z < hem_limit:
                factor = max(0.0, min(1.0, (hem_limit - position.z) / 0.12))
                position.x += math.copysign(0.009 * factor, position.x or 1.0)
                position.y += math.copysign(0.006 * factor, position.y or 1.0)
        vertices.append(tuple(position))

    mesh = bpy.data.meshes.new(f"mesh_{module_id}_00_shell")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    shell = bpy.data.objects.new(f"mesh_{module_id}_00_shell", mesh)
    bpy.context.scene.collection.objects.link(shell)
    shell.data.materials.append(materials[0])
    shell.data.materials.append(materials[1])

    new_uv = mesh.uv_layers.new(name="UVMap")
    for new_polygon, source_polygon in zip(
        mesh.polygons,
        source_polygons,
        strict=True,
    ):
        source_loops = list(
            range(
                source_polygon.loop_start,
                source_polygon.loop_start + source_polygon.loop_total,
            )
        )
        for new_loop_index, source_loop_index in zip(
            new_polygon.loop_indices,
            source_loops,
            strict=True,
        ):
            new_uv.data[new_loop_index].uv = old_uv.data[source_loop_index].uv

    for group in body.vertex_groups:
        target_group = shell.vertex_groups.new(name=group.name)
        for new_index, old_index in enumerate(source_indices):
            membership = next(
                (
                    item
                    for item in body.data.vertices[old_index].groups
                    if item.group == group.index
                ),
                None,
            )
            if membership is not None and membership.weight > 0.0:
                target_group.add(
                    [new_index],
                    float(membership.weight),
                    "REPLACE",
                )

    # The approved faceted body intentionally carries split vertices. They
    # must be welded after the radial offset; otherwise every triangle is
    # thickened separately and the garment becomes a field of loose shards.
    edit_mesh = bmesh.new()
    edit_mesh.from_mesh(mesh)
    bmesh.ops.remove_doubles(
        edit_mesh,
        verts=list(edit_mesh.verts),
        dist=0.00001,
    )
    edit_mesh.to_mesh(mesh)
    edit_mesh.free()
    mesh.update()

    if LOD_RATIOS[lod] < 1.0:
        bpy.context.view_layer.objects.active = shell
        shell.select_set(True)
        decimate = shell.modifiers.new(name=f"{lod}_reduction", type="DECIMATE")
        decimate.decimate_type = "COLLAPSE"
        decimate.ratio = LOD_RATIOS[lod]
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        shell.select_set(False)

    if lod != "lod2":
        bpy.context.view_layer.objects.active = shell
        shell.select_set(True)
        solidify = shell.modifiers.new(
            name="garment_thickness",
            type="SOLIDIFY",
        )
        solidify.thickness = 0.004
        solidify.offset = -0.2
        solidify.use_rim = True
        bpy.ops.object.modifier_apply(modifier=solidify.name)
        shell.select_set(False)

    attach_to_armature(shell, armature)
    return shell


def attach_to_armature(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
) -> None:
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()
    modifier = obj.modifiers.new(name="humanoid_v1_skin", type="ARMATURE")
    modifier.object = armature


def apply_mesh_transforms(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(
        location=False,
        rotation=False,
        scale=True,
    )
    obj.select_set(False)


def assign_uniform_weights(
    obj: bpy.types.Object,
    weights: dict[str, float],
) -> None:
    total = sum(weights.values())
    if total <= 0.0:
        raise RuntimeError(f"{obj.name}: uniform skin weights are empty")
    for name, value in weights.items():
        group = obj.vertex_groups.new(name=name)
        group.add(
            range(len(obj.data.vertices)),
            value / total,
            "REPLACE",
        )


def add_box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    rotation: tuple[float, float, float],
    weights: dict[str, float],
    armature: bpy.types.Object,
    material: bpy.types.Material,
    lod: str,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.dimensions = dimensions
    apply_mesh_transforms(obj)
    if lod != "lod2":
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bevel = obj.modifiers.new(name="softened_edges", type="BEVEL")
        bevel.width = min(dimensions) * 0.16
        bevel.segments = 2 if lod == "lod0" else 1
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        obj.select_set(False)
    obj.data.materials.append(material)
    assign_uniform_weights(obj, weights)
    attach_to_armature(obj, armature)
    return obj


def add_button(
    name: str,
    location: tuple[float, float, float],
    weights: dict[str, float],
    armature: bpy.types.Object,
    material: bpy.types.Material,
    lod: str,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices={"lod0": 10, "lod1": 8, "lod2": 6}[lod],
        radius=0.0085,
        depth=0.006,
        end_fill_type="NGON",
        location=location,
        rotation=(math.pi / 2.0, 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    apply_mesh_transforms(obj)
    obj.data.materials.append(material)
    assign_uniform_weights(obj, weights)
    attach_to_armature(obj, armature)
    return obj


def add_torus_band(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    scale: tuple[float, float, float],
    rotation: tuple[float, float, float],
    weights: dict[str, float],
    armature: bpy.types.Object,
    material: bpy.types.Material,
    lod: str,
) -> bpy.types.Object:
    major_segments = {"lod0": 16, "lod1": 10, "lod2": 7}[lod]
    minor_segments = {"lod0": 5, "lod1": 4, "lod2": 3}[lod]
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
        major_radius=major_radius,
        minor_radius=minor_radius,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.scale = scale
    apply_mesh_transforms(obj)
    obj.data.materials.append(material)
    assign_uniform_weights(obj, weights)
    attach_to_armature(obj, armature)
    return obj


def region_bounds(
    body: bpy.types.Object,
    names: set[str],
    minimum_score: float,
    z_range: tuple[float, float] | None = None,
    side: str | None = None,
) -> tuple[Vector, Vector]:
    points = []
    for vertex in body.data.vertices:
        weights = vertex_weights(body, vertex.index)
        if weight_sum(weights, names) < minimum_score:
            continue
        if z_range and not z_range[0] <= vertex.co.z <= z_range[1]:
            continue
        if side == "l" and vertex.co.x <= 0.0:
            continue
        if side == "r" and vertex.co.x >= 0.0:
            continue
        points.append(vertex.co)
    if not points:
        raise RuntimeError(f"Cannot resolve body bounds for {sorted(names)}")
    minimum = Vector(
        tuple(min(point[axis] for point in points) for axis in range(3))
    )
    maximum = Vector(
        tuple(max(point[axis] for point in points) for axis in range(3))
    )
    return minimum, maximum


def add_shirt_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    lod: str,
    main: bpy.types.Material,
    accent: bpy.types.Material,
) -> list[bpy.types.Object]:
    bones = armature.data.bones
    pelvis = bones["pelvis"]
    neck = bones["neck_01"]
    upperarm_l = bones["upperarm_l"]
    torso_min, torso_max = region_bounds(
        body,
        {"spine_01", "spine_02", "spine_03"},
        0.45,
        (pelvis.tail_local.z - 0.04, neck.head_local.z),
    )
    front_y = torso_min.y - 0.024
    shirt_bottom = pelvis.tail_local.z - 0.055
    shirt_top = neck.head_local.z - 0.02
    height = shirt_top - shirt_bottom
    width = torso_max.x - torso_min.x
    details = [
        add_box(
            "mesh_field_shirt_placket",
            (0.0, front_y, shirt_bottom + height * 0.52),
            (0.022, 0.009, height * 0.72),
            (0.0, 0.0, 0.0),
            {"spine_02": 0.55, "spine_03": 0.45},
            armature,
            accent,
            lod,
        )
    ]
    for side, sign in (("l", 1.0), ("r", -1.0)):
        details.append(
            add_torus_band(
                f"mesh_field_shirt_cuff_{side}",
                (
                    sign * (abs(upperarm_l.head_local.x) + 0.118),
                    upperarm_l.head_local.y,
                    upperarm_l.head_local.z,
                ),
                0.055,
                0.005,
                (1.0, 0.82, 1.0),
                (0.0, math.pi / 2.0, 0.0),
                {f"upperarm_{side}": 1.0},
                armature,
                accent,
                lod,
            )
        )
    # Chest pockets stay in the material treatment. A rigid box follows one
    # spine bone and separates from the breast/pectoral surface in the idle
    # pose, while the shirt shell itself is smoothly skinned.
    button_count = {"lod0": 5, "lod1": 3, "lod2": 1}[lod]
    for index in range(button_count):
        fraction = (index + 1) / (button_count + 1)
        details.append(
            add_button(
                f"mesh_field_shirt_button_{index + 1}",
                (
                    0.0,
                    front_y - 0.011,
                    shirt_bottom + height * (0.2 + fraction * 0.62),
                ),
                {"spine_02": 0.55, "spine_03": 0.45},
                armature,
                accent,
                lod,
            )
        )
    return details


def add_trouser_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    lod: str,
    main: bpy.types.Material,
    accent: bpy.types.Material,
) -> list[bpy.types.Object]:
    bones = armature.data.bones
    pelvis = bones["pelvis"]
    thigh_l = bones["thigh_l"]
    calf_l = bones["calf_l"]
    pelvis_min, pelvis_max = region_bounds(
        body,
        {"pelvis", "thigh_l", "thigh_r"},
        0.42,
        (pelvis.head_local.z - 0.08, pelvis.tail_local.z + 0.06),
    )
    width = max(abs(pelvis_min.x), abs(pelvis_max.x))
    depth = max(abs(pelvis_min.y), abs(pelvis_max.y))
    details = [
        add_box(
            "mesh_work_trousers_waist_tab",
            (0.0, pelvis_min.y - 0.002, pelvis.tail_local.z - 0.012),
            (max(0.16, width * 1.25), 0.008, 0.026),
            (0.0, 0.0, 0.0),
            {"pelvis": 1.0},
            armature,
            accent,
            lod,
        )
    ]
    # Cargo pockets and hard knee plates are intentionally expressed by the
    # worn material instead of rigid boxes. Rigid add-ons drifted away from the
    # skinned trouser shell in crouch and combat poses.
    return details


def add_boot_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    lod: str,
    main: bpy.types.Material,
    accent: bpy.types.Material,
) -> list[bpy.types.Object]:
    bones = armature.data.bones
    details = []
    for side, sign in (("l", 1.0), ("r", -1.0)):
        foot_min, foot_max = region_bounds(
            body,
            {f"foot_{side}", f"ball_{side}"},
            0.42,
            None,
            side=side,
        )
        center = (foot_min + foot_max) * 0.5
        dimensions = foot_max - foot_min
        details.append(
            add_box(
                f"mesh_service_boots_sole_{side}",
                (
                    center.x,
                    center.y,
                    max(0.014, foot_min.z + 0.004),
                ),
                (
                    max(0.085, dimensions.x + 0.010),
                    max(0.170, dimensions.y + 0.006),
                    0.016,
                ),
                (0.0, 0.0, 0.0),
                {f"foot_{side}": 1.0},
                armature,
                accent,
                lod,
            )
        )
        # The leather upper already carries the silhouette. Extra rigid ankle
        # rings and toe boxes looked detached once the shared rig was posed.
    return details


def add_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    module_id: str,
    lod: str,
    main: bpy.types.Material,
    accent: bpy.types.Material,
) -> list[bpy.types.Object]:
    if module_id == "field_shirt":
        return add_shirt_details(body, armature, lod, main, accent)
    if module_id == "work_trousers":
        return add_trouser_details(body, armature, lod, main, accent)
    if module_id == "service_boots":
        return add_boot_details(body, armature, lod, main, accent)
    raise RuntimeError(f"Unknown module: {module_id}")


def annotate(
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    module_id: str,
    sex: str,
    body_type: str,
    lod: str,
) -> str:
    config = MODULES[module_id]
    model_id = f"{module_id}_{sex}_{body_type}"
    armature.name = f"{model_id}_root"
    armature.data.name = "rig_humanoid_v1"
    for key in list(armature.keys()):
        del armature[key]
    metadata = {
        "realm_asset_schema": "realm.production-asset.v1",
        "realm_asset_id": module_id,
        "realm_asset_class": "humanoid_skinned_equipment",
        "realm_lod": lod,
        "realm_origin_profile": "rig_root_ground",
        "realm_approval_status": "review",
        "realm_provenance_type": "derived",
        "realm_provenance_id": PROVENANCE_ID,
        "realm_rig_id": "humanoid_v1",
        "realm_visual_slot": config["slot"],
        "realm_sex": sex,
        "realm_body_type": body_type,
        "realm_hide_body_regions": config["hide_body_regions"],
        "realm_art_direction": "geometry_b_materials_c",
        "realm_geometry_direction": "graphic_faceted_b",
        "realm_material_direction": "retro_modern_c",
        "realm_wear_policy": "localized_dust_sun_bleaching",
        "realm_review_only": True,
        "realm_runtime_integration_allowed": False,
        "realm_pull_request_allowed": False,
    }
    for key, value in metadata.items():
        armature[key] = value
    if len(armature.data.bones) != REQUIRED_JOINT_COUNT:
        raise RuntimeError(
            f"{module_id}: expected {REQUIRED_JOINT_COUNT} bones, "
            f"got {len(armature.data.bones)}"
        )
    for obj in meshes:
        obj["realm_visual_slot"] = config["slot"]
        obj["realm_module_id"] = module_id
        obj["realm_art_direction"] = "geometry_b_materials_c"
    return model_id


def triangle_count(objects: list[bpy.types.Object]) -> int:
    count = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        count += len(obj.data.loop_triangles)
    return count


def normalize_skin_weights(obj: bpy.types.Object) -> None:
    groups = {
        group.index: group
        for group in obj.vertex_groups
    }
    for vertex in obj.data.vertices:
        memberships = sorted(
            (
                (item.group, float(item.weight))
                for item in vertex.groups
                if item.group in groups and item.weight > 0.000001
            ),
            key=lambda row: row[1],
            reverse=True,
        )
        if not memberships:
            raise RuntimeError(f"{obj.name}: vertex {vertex.index} is unskinned")
        kept = memberships[:4]
        kept_ids = {group_id for group_id, _weight in kept}
        for group_id, _weight in memberships[4:]:
            groups[group_id].remove([vertex.index])
        total = sum(weight for _group_id, weight in kept)
        for group_id, weight in kept:
            groups[group_id].add(
                [vertex.index],
                weight / total,
                "REPLACE",
            )
        for group_id in set(groups) - kept_ids:
            membership = next(
                (
                    item
                    for item in vertex.groups
                    if item.group == group_id
                ),
                None,
            )
            if membership is not None and membership.weight <= 0.000001:
                groups[group_id].remove([vertex.index])


def export_glb(
    output: Path,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    for obj in meshes:
        normalize_skin_weights(obj)
        obj.data.validate(verbose=False, clean_customdata=False)
        obj.data.update()
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in meshes:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Realm of Ashes B+C field-worker rebuild. Rig/topology reference: "
            "Quaternius Modular Character Outfits - Fantasy, CC0-1.0. "
            "Geometry, textures, wear and presentation rebuilt for Realm."
        ),
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="ACTIVE",
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


def main() -> None:
    args = parse_args()
    reset_scene()
    armature, body = import_body(args.input.resolve())
    config = MODULES[args.module]
    main_material = make_pbr_material(
        args.module,
        "main",
        config["main_color"],
        config["surface"],
    )
    accent_material = make_pbr_material(
        args.module,
        "accent",
        config["accent_color"],
        config["surface"],
    )
    shell = build_surface_shell(
        body,
        armature,
        args.module,
        args.lod,
        (main_material, accent_material),
    )
    details = add_details(
        body,
        armature,
        args.module,
        args.lod,
        main_material,
        accent_material,
    )
    meshes = [shell, *details]
    model_id = annotate(
        armature,
        meshes,
        args.module,
        args.sex,
        args.body_type,
        args.lod,
    )
    bpy.data.objects.remove(body, do_unlink=True)
    triangles = triangle_count(meshes)
    export_glb(args.output.resolve(), armature, meshes)
    print(
        json.dumps(
            {
                "module": args.module,
                "model_id": model_id,
                "sex": args.sex,
                "body_type": args.body_type,
                "lod": args.lod,
                "triangles": triangles,
                "meshes": len(meshes),
                "materials": 2,
                "textures": 6,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
