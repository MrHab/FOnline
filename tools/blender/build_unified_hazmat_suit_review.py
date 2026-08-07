"""Build the B+C hazmat-suit review asset for the current player rig.

The suit keeps the exact skin weights from each shipped body, then reshapes
the sampled surface into a loose coverall envelope instead of copying visible
anatomy.  Original project geometry adds the compact helmet-compatible hood,
panoramic visor, respirator filters, taped seams and field repairs.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from math import atan2, cos, pi, sin
from pathlib import Path
import random
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


BASE_PATH = Path(__file__).with_name("build_unified_leather_jacket_review.py")
BASE_SPEC = importlib.util.spec_from_file_location("realm_leather_review_base", BASE_PATH)
if BASE_SPEC is None or BASE_SPEC.loader is None:
    raise RuntimeError(f"Cannot load shared equipment helpers from {BASE_PATH}")
BASE = importlib.util.module_from_spec(BASE_SPEC)
BASE_SPEC.loader.exec_module(BASE)


TORSO_GROUPS = {"root", "pelvis", "spine_01", "spine_02", "spine_03"}
ARM_GROUPS = {
    "clavicle_l", "upperarm_l", "lowerarm_l",
    "clavicle_r", "upperarm_r", "lowerarm_r",
}
LEG_GROUPS = {"thigh_l", "calf_l", "thigh_r", "calf_r"}
FOOT_GROUPS = {"foot_l", "ball_l", "ball_leaf_l", "foot_r", "ball_r", "ball_leaf_r"}
HAND_PREFIXES = ("hand_", "index_", "middle_", "pinky_", "ring_", "thumb_")
SUIT_GROUPS = TORSO_GROUPS | ARM_GROUPS | LEG_GROUPS | FOOT_GROUPS


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_hazmat_suit_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def dominant_group(body: bpy.types.Object, vertex_index: int) -> str | None:
    return BASE.dominant_group(body, vertex_index)


def is_hand_group(name: str | None) -> bool:
    return bool(name and name.startswith(HAND_PREFIXES))


def textured_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float,
    seed: str,
    texture_kind: str,
    normal_strength: float,
) -> bpy.types.Material:
    size = 384
    rng = random.Random(f"realm-hazmat-v1:{seed}:{name}")
    scratches = [
        (rng.randrange(size), rng.randrange(size), rng.randrange(12, 48), rng.choice((-1, 1)))
        for _ in range(34)
    ]

    def make_image(suffix: str) -> bpy.types.Image:
        image = bpy.data.images.new(f"{name}_{suffix}", width=size, height=size, alpha=False)
        pixels: list[float] = []
        local_rng = random.Random(f"realm-hazmat-v1:{seed}:{name}:{suffix}")
        for y in range(size):
            for x in range(size):
                broad = sin(x * 0.031 + y * 0.019) * 0.55 + sin(y * 0.057 - x * 0.011) * 0.28
                weave = sin(x * 0.72) * sin(y * 0.68) * 0.18
                noise = local_rng.random() - 0.5
                abrasion = 0.0
                for sx, sy, length, direction in scratches:
                    dx = x - sx
                    dy = y - sy
                    if abs(dy - direction * dx * 0.12) < 0.65 and abs(dx) < length:
                        abrasion = max(abrasion, 1.0 - abs(dx) / max(1, length))
                if suffix == "albedo":
                    age = broad * 0.025 + weave * 0.018 + noise * 0.012
                    if texture_kind == "rubber":
                        age *= 0.45
                    values = tuple(
                        max(0.012, min(0.95, component * (1.0 + age) + abrasion * 0.028))
                        for component in base
                    )
                    pixels.extend((*values, 1.0))
                elif suffix == "roughness":
                    value = max(0.20, min(0.99, roughness + broad * 0.018 + noise * 0.012 - abrasion * 0.055))
                    pixels.extend((value, value, value, 1.0))
                else:
                    strength = 0.010 if texture_kind == "coated_canvas" else 0.006
                    pixels.extend((0.5 + weave * strength, 0.5 + broad * strength, 1.0, 1.0))
        image.pixels.foreach_set(pixels)
        image.pack()
        return image

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = make_image("albedo")
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = make_image("roughness")
    rough.image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = make_image("normal")
    normal_texture.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    material.diffuse_color = (*base, 1.0)
    return material


def plain_material(
    name: str,
    color: tuple[float, float, float],
    roughness: float,
    metallic: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    material.diffuse_color = (*color, alpha)
    if alpha < 1.0:
        material.surface_render_method = "DITHERED"
        material.use_transparency_overlap = False
    return material


def copy_shell_weights(
    body: bpy.types.Object,
    shell: bpy.types.Object,
    source_indices: list[int],
) -> None:
    required_groups = sorted({
        body.vertex_groups[assignment.group].name
        for source_index in source_indices
        for assignment in body.data.vertices[source_index].groups
        if assignment.weight > 0.0
    })
    vertex_groups = {name: shell.vertex_groups.new(name=name) for name in required_groups}
    for new_index, source_index in enumerate(source_indices):
        for assignment in body.data.vertices[source_index].groups:
            name = body.vertex_groups[assignment.group].name
            if assignment.weight > 0.0:
                vertex_groups[name].add([new_index], assignment.weight, "REPLACE")


def local_section_bounds(
    points: list[Vector],
    axis: int,
    value: float,
    cache: dict[tuple[int, int], tuple[Vector, Vector]],
) -> tuple[Vector, Vector]:
    """Measure a stable local cross-section without preserving muscle bumps."""
    key = (axis, round(value / 0.025))
    cached = cache.get(key)
    if cached is not None:
        return cached
    nearby = [point for point in points if abs(point[axis] - value) <= 0.045]
    if len(nearby) < 16:
        nearby = sorted(points, key=lambda point: abs(point[axis] - value))[:64]
    measured = BASE.bounds(nearby)
    cache[key] = measured
    return measured


def regularize_coverall_position(
    position: Vector,
    group: str | None,
    torso_minimum: Vector,
    torso_maximum: Vector,
    arm_points: dict[str, list[Vector]],
    leg_points: dict[str, list[Vector]],
    section_caches: dict[str, dict[tuple[int, int], tuple[Vector, Vector]]],
    profile: str,
) -> Vector:
    """Project body-derived points toward smooth, deliberately loose sections."""
    structured = profile == "energy"
    torso_clearance = 0.026 if structured else 0.036
    limb_clearance = 0.020 if structured else 0.029
    strength = 0.84 if structured else 0.78
    torso_center_y = (torso_minimum.y + torso_maximum.y) * 0.5

    # The donor's centreline cap is useful for keeping the mesh watertight but
    # visually reads as anatomy.  Tuck it inside the loose pelvis yoke; the
    # outer yoke supplies the garment silhouette while this hidden surface
    # continues to close the suit between the legs during animation.
    if 0.74 < position.z < 1.09 and abs(position.x) < 0.19:
        position = position.copy()
        position.y = max(torso_center_y - 0.072, min(torso_center_y + 0.072, position.y))

    if group in TORSO_GROUPS or (group and group.startswith("clavicle_")):
        center_y = torso_center_y
        source_radius_x = max(abs(torso_minimum.x), abs(torso_maximum.x))
        source_radius_y = max(
            abs(torso_minimum.y - center_y),
            abs(torso_maximum.y - center_y),
        )
        height = max(0.001, torso_maximum.z - torso_minimum.z)
        progression = max(0.0, min(1.0, (position.z - torso_minimum.z) / height))
        # Straight coverall sides, with only enough taper to keep the waist from
        # reading as a barrel.  Constant depth suppresses chest/seat anatomy.
        waist_taper = 0.94 + 0.06 * min(1.0, abs(progression - 0.34) / 0.34)
        target_radius_x = (source_radius_x + torso_clearance) * waist_taper
        target_radius_y = (source_radius_y + torso_clearance) * (0.97 + progression * 0.03)
        angle = atan2(
            (position.y - center_y) / max(0.001, source_radius_y),
            position.x / max(0.001, source_radius_x),
        )
        target = Vector((
            cos(angle) * target_radius_x,
            center_y + sin(angle) * target_radius_y,
            position.z,
        ))
        if position.z > 1.16 and position.y < center_y:
            centrality = max(0.0, 1.0 - abs(position.x) / max(0.001, target_radius_x * 0.90))
            front_plane_y = center_y - target_radius_y
            plane_strength = centrality * (0.82 if structured else 0.76)
            target.y = target.y * (1.0 - plane_strength) + front_plane_y * plane_strength
        if group in {"root", "pelvis"} and position.z < 1.04:
            centrality = max(0.0, 1.0 - abs(position.x) / max(0.001, target_radius_x * 0.78))
            plane_y = center_y + (-target_radius_y if position.y < center_y else target_radius_y)
            target.y = target.y * (1.0 - centrality * 0.72) + plane_y * centrality * 0.72
        result = position.lerp(target, strength)
        source_radius = Vector((position.x, position.y - center_y)).length
        result_radius = Vector((result.x, result.y - center_y)).length
        # The pelvis receives a separate loose coverall yoke below.  Let this
        # inner shell lose the donor body's seat/crotch silhouette here instead
        # of re-expanding every smoothed point back to the anatomical radius.
        preserve_source_radius = not (
            group in {"root", "pelvis"}
            and position.z < 1.12
        )
        if preserve_source_radius and result_radius < source_radius and result_radius > 0.0001:
            scale = source_radius / result_radius
            result.x *= scale
            result.y = center_y + (result.y - center_y) * scale
        return result

    if group and group.startswith(("upperarm_", "lowerarm_")):
        side = group.rsplit("_", 1)[-1]
        points = arm_points[side]
        minimum, maximum = local_section_bounds(points, 0, position.x, section_caches[f"arm_{side}"])
        center_y = (minimum.y + maximum.y) * 0.5
        center_z = (minimum.z + maximum.z) * 0.5
        source_radius_y = max(0.018, (maximum.y - minimum.y) * 0.5)
        source_radius_z = max(0.018, (maximum.z - minimum.z) * 0.5)
        angle = atan2(
            (position.z - center_z) / source_radius_z,
            (position.y - center_y) / source_radius_y,
        )
        target = Vector((
            position.x,
            center_y + cos(angle) * (source_radius_y + limb_clearance),
            center_z + sin(angle) * (source_radius_z + limb_clearance),
        ))
        result = position.lerp(target, strength)
        source_radius = Vector((position.y - center_y, position.z - center_z)).length
        result_radius = Vector((result.y - center_y, result.z - center_z)).length
        if result_radius < source_radius and result_radius > 0.0001:
            scale = source_radius / result_radius
            result.y = center_y + (result.y - center_y) * scale
            result.z = center_z + (result.z - center_z) * scale
        return result

    if group and group.startswith(("thigh_", "calf_")):
        side = group.rsplit("_", 1)[-1]
        points = leg_points[side]
        minimum, maximum = local_section_bounds(points, 2, position.z, section_caches[f"leg_{side}"])
        center_x = (minimum.x + maximum.x) * 0.5
        center_y = (minimum.y + maximum.y) * 0.5
        source_radius_x = max(0.025, (maximum.x - minimum.x) * 0.5)
        source_radius_y = max(0.025, (maximum.y - minimum.y) * 0.5)
        angle = atan2(
            (position.y - center_y) / source_radius_y,
            (position.x - center_x) / source_radius_x,
        )
        target = Vector((
            center_x + cos(angle) * (source_radius_x + limb_clearance),
            center_y + sin(angle) * (source_radius_y + limb_clearance),
            position.z,
        ))
        result = position.lerp(target, strength)
        source_radius = Vector((position.x - center_x, position.y - center_y)).length
        result_radius = Vector((result.x - center_x, result.y - center_y)).length
        if result_radius < source_radius and result_radius > 0.0001:
            scale = source_radius / result_radius
            result.x = center_x + (result.x - center_x) * scale
            result.y = center_y + (result.y - center_y) * scale
        return result

    return position


def build_inner_liner(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    cutoff_z: float,
) -> bpy.types.Object:
    """Create a closed, unsmoothed seal below the hood.

    Imported character meshes deliberately split coincident vertices along UV
    and material seams.  The outer garment is welded and softened for volume;
    this exact-topology inner layer prevents those old seams from revealing
    skin when the suit bends sharply at the waist, wrists or ankles.
    """
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    source_to_new: dict[int, int] = {}
    source_indices: list[int] = []
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    for polygon in body.data.polygons:
        center = world_to_armature @ body.matrix_world @ polygon.center
        polygon_points = [
            world_to_armature @ body.matrix_world @ body.data.vertices[index].co
            for index in polygon.vertices
        ]
        # The donor body closes its lower pelvis with a broad front-to-back fan.
        # On a loose suit that fan becomes a visible horizontal spike.  Remove
        # only that hidden donor cap; a purpose-built rounded cloth gusset below
        # closes the coverall with animation-friendly weights.
        if (
            0.76 <= center.z <= 0.97
            and abs(center.x) <= 0.18
            and max(point.y for point in polygon_points) - min(point.y for point in polygon_points) > 0.18
        ):
            continue
        if center.z > cutoff_z:
            continue
        dominant = [dominant_group(body, vertex_index) for vertex_index in polygon.vertices]
        face: list[int] = []
        for source_index in polygon.vertices:
            if source_index not in source_to_new:
                source_to_new[source_index] = len(vertices)
                source_indices.append(source_index)
                source_vertex = body.data.vertices[source_index]
                position = world_to_armature @ body.matrix_world @ source_vertex.co
                position += (normal_transform @ source_vertex.normal).normalized() * 0.012
                vertices.append(tuple(position))
            face.append(source_to_new[source_index])
        faces.append(tuple(face))
        rubber_votes = sum(is_hand_group(group) or group in FOOT_GROUPS for group in dominant)
        materials.append(1 if rubber_votes >= max(1, len(dominant) // 2) else 0)

    mesh = bpy.data.meshes.new(f"{asset_id}_inner_liner_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, materials):
        polygon.material_index = material_index
    liner = bpy.data.objects.new(f"{asset_id}_inner_seal", mesh)
    bpy.context.collection.objects.link(liner)
    liner.parent = armature
    liner.matrix_parent_inverse = Matrix.Identity(4)
    liner.matrix_world = armature.matrix_world.copy()
    copy_shell_weights(body, liner, source_indices)
    bpy.context.view_layer.objects.active = liner
    liner.select_set(True)
    wrap = liner.modifiers.new("hazmat_inner_clearance", "SHRINKWRAP")
    wrap.target = body
    wrap.wrap_method = "NEAREST_SURFACEPOINT"
    wrap.wrap_mode = "OUTSIDE_SURFACE"
    wrap.offset = 0.018
    bpy.ops.object.modifier_apply(modifier=wrap.name)
    modifier = liner.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.92, island_margin=0.010)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in liner.data.polygons:
        polygon.use_smooth = True
    liner.select_set(False)
    liner["realm_asset_id"] = asset_id
    liner["realm_item_id"] = "hazmatSuit"
    liner["realm_hazmat_inner_seal"] = True
    liner["realm_review_only"] = True
    liner["realm_runtime_integration_allowed"] = False
    return liner


def build_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    profile: str = "coverall",
) -> tuple[bpy.types.Object, dict[str, object]]:
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    material_indices: list[int] = []
    source_indices: list[int] = []
    source_to_new: dict[int, int] = {}
    position_to_new: dict[tuple[int, int, int], int] = {}

    region_points = BASE.group_points(body, armature, SUIT_GROUPS)
    region_minimum, region_maximum = BASE.bounds(region_points)
    head_points = BASE.group_points(body, armature, {"head", "neck_01"})
    head_minimum, head_maximum = BASE.bounds(head_points)
    torso_points = BASE.group_points(body, armature, TORSO_GROUPS)
    torso_minimum, torso_maximum = BASE.bounds(torso_points)
    arm_points = {
        side: BASE.group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
        for side in ("l", "r")
    }
    leg_points = {
        side: BASE.group_points(body, armature, {f"thigh_{side}", f"calf_{side}"})
        for side in ("l", "r")
    }
    section_caches = {
        name: {}
        for name in ("arm_l", "arm_r", "leg_l", "leg_r")
    }

    for polygon in body.data.polygons:
        dominant = [dominant_group(body, vertex_index) for vertex_index in polygon.vertices]
        suit_votes = sum(group in SUIT_GROUPS for group in dominant)
        hand_votes = sum(is_hand_group(group) for group in dominant)
        center = world_to_armature @ body.matrix_world @ polygon.center
        # Transitional quads often have only one vertex dominated by the next
        # bone.  Keeping every face that touches a covered region prevents
        # triangular tears at the pelvis, wrists and ankles after posing.
        # Some underwear seam vertices arrive without a dominant deform group;
        # the spatial fallback closes those otherwise visible waist holes.
        if max(suit_votes, hand_votes) < 1 and center.z > torso_maximum.z + 0.035:
            continue
        face: list[int] = []
        for source_index in polygon.vertices:
            if source_index not in source_to_new:
                source_vertex = body.data.vertices[source_index]
                base_position = world_to_armature @ body.matrix_world @ source_vertex.co
                normal = (normal_transform @ source_vertex.normal).normalized()
                group = dominant_group(body, source_index)
                if is_hand_group(group) or group in FOOT_GROUPS:
                    allowance = 0.014
                elif group in TORSO_GROUPS:
                    allowance = 0.018
                else:
                    allowance = 0.016
                position = base_position + normal * allowance
                position = regularize_coverall_position(
                    position,
                    group,
                    torso_minimum,
                    torso_maximum,
                    arm_points,
                    leg_points,
                    section_caches,
                    profile,
                )
                key = tuple(round(value * 100000.0) for value in base_position)
                new_index = position_to_new.get(key)
                if new_index is None:
                    new_index = len(vertices)
                    position_to_new[key] = new_index
                    vertices.append(tuple(position))
                    source_indices.append(source_index)
                source_to_new[source_index] = new_index
            face.append(source_to_new[source_index])
        faces.append(tuple(face))
        rubber_votes = hand_votes + sum(group in FOOT_GROUPS for group in dominant)
        material_indices.append(1 if rubber_votes >= max(1, len(dominant) // 2) else 0)

    mesh = bpy.data.meshes.new(f"{asset_id}_shell_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, material_indices):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()

    shell = bpy.data.objects.new(f"{asset_id}_sealed_shell", mesh)
    bpy.context.collection.objects.link(shell)
    shell.parent = armature
    shell.matrix_parent_inverse = Matrix.Identity(4)
    shell.matrix_world = armature.matrix_world.copy()
    copy_shell_weights(body, shell, source_indices)
    smooth_mask = shell.vertex_groups.new(name="hazmat_smoothing_mask")
    smooth_vertices = [
        index
        for index, source_index in enumerate(source_indices)
        if not is_hand_group(dominant_group(body, source_index))
        and dominant_group(body, source_index) not in FOOT_GROUPS
    ]
    if smooth_vertices:
        smooth_mask.add(smooth_vertices, 1.0, "REPLACE")
    pelvis_mask = shell.vertex_groups.new(name="coverall_pelvis_ironing_mask")
    pelvis_vertices = [
        vertex.index
        for vertex in shell.data.vertices
        if 0.74 < vertex.co.z < 1.17 and abs(vertex.co.x) < 0.34
    ]
    if pelvis_vertices:
        pelvis_mask.add(pelvis_vertices, 1.0, "REPLACE")

    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    smooth = shell.modifiers.new("hazmat_soft_folds", "LAPLACIANSMOOTH")
    smooth.iterations = 5
    smooth.lambda_factor = 0.055
    smooth.use_volume_preserve = True
    smooth.vertex_group = smooth_mask.name
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    # A second, pelvis-only pass runs before decimation, thickness and the
    # armature modifier.  That ordering irons out donor crotch/seat creases
    # without baking the rig or shrinking gloves and boots in posed reviews.
    pelvis_smooth = shell.modifiers.new("coverall_pelvis_ironing", "LAPLACIANSMOOTH")
    pelvis_smooth.iterations = 11 if profile == "energy" else 15
    pelvis_smooth.lambda_factor = 0.045 if profile == "energy" else 0.055
    pelvis_smooth.use_volume_preserve = True
    pelvis_smooth.vertex_group = pelvis_mask.name
    bpy.ops.object.modifier_apply(modifier=pelvis_smooth.name)
    decimate = shell.modifiers.new("coverall_gameplay_topology", "DECIMATE")
    decimate.decimate_type = "COLLAPSE"
    decimate.ratio = 0.56
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    solidify = shell.modifiers.new("sealed_canvas_thickness", "SOLIDIFY")
    solidify.thickness = 0.0038
    solidify.offset = -0.10
    solidify.use_rim = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    modifier = shell.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.92, island_margin=0.014)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in shell.data.polygons:
        polygon.use_smooth = True
    shell.select_set(False)
    shell["realm_asset_id"] = asset_id
    shell["realm_item_id"] = "hazmatSuit"
    shell["realm_item_name_ru"] = "Костюм химзащиты"
    shell["realm_art_direction"] = "character_geometry_b_materials_c"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False

    return shell, {
        "bodyBounds": {
            "minimum": [round(value, 5) for value in region_minimum],
            "maximum": [round(value, 5) for value in region_maximum],
        },
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "headBounds": {
            "minimum": [round(value, 5) for value in head_minimum],
            "maximum": [round(value, 5) for value in head_maximum],
        },
        "shellVertices": len(mesh.vertices),
        "shellPolygons": len(mesh.polygons),
        "rubberMaterialPolygons": sum(index == 1 for index in material_indices),
        "silhouetteProfile": profile,
        "anatomyProjectionStrength": 0.84 if profile == "energy" else 0.78,
        "innerSealRequired": False,
    }


class HazmatBuilder(BASE.DetailBuilder):
    def ellipse_frustum_z(
        self,
        center: tuple[float, float],
        bottom_radii: tuple[float, float],
        top_radii: tuple[float, float],
        z0: float,
        z1: float,
        material: int,
        bottom_weights: dict[str, float],
        top_weights: dict[str, float],
        segments: int = 24,
    ) -> None:
        rings: list[list[int]] = []
        for z, radii, weights in (
            (z0, bottom_radii, bottom_weights),
            (z1, top_radii, top_weights),
        ):
            rings.append([
                self.vertex(
                    (
                        center[0] + cos(angle) * radii[0],
                        center[1] + sin(angle) * radii[1],
                        z,
                    ),
                    weights,
                )
                for angle in (2.0 * pi * index / segments for index in range(segments))
            ])
        for index in range(segments):
            following = (index + 1) % segments
            self.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)

    def cylinder_y(
        self,
        center: tuple[float, float, float],
        radius: float,
        depth: float,
        material: int,
        weights: dict[str, float],
        segments: int = 14,
    ) -> None:
        cx, cy, cz = center
        rings: list[list[int]] = []
        for y in (cy - depth * 0.5, cy + depth * 0.5):
            rings.append([
                self.vertex((cx + cos(angle) * radius, y, cz + sin(angle) * radius), weights)
                for angle in (2.0 * pi * index / segments for index in range(segments))
            ])
        for index in range(segments):
            following = (index + 1) % segments
            self.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)
        self.face(tuple(reversed(rings[0])), material)
        self.face(tuple(rings[1]), material)

    def cylinder_z(
        self,
        center: tuple[float, float, float],
        radius: float,
        height: float,
        material: int,
        weights: dict[str, float],
        segments: int = 14,
    ) -> None:
        cx, cy, cz = center
        rings: list[list[int]] = []
        for z in (cz - height * 0.5, cz + height * 0.5):
            rings.append([
                self.vertex((cx + cos(angle) * radius, cy + sin(angle) * radius, z), weights)
                for angle in (2.0 * pi * index / segments for index in range(segments))
            ])
        for index in range(segments):
            following = (index + 1) % segments
            self.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)
        self.face(tuple(reversed(rings[0])), material)
        self.face(tuple(rings[1]), material)

    def ellipse_disc_y(
        self,
        center: tuple[float, float, float],
        radii: tuple[float, float],
        material: int,
        weights: dict[str, float],
        segments: int = 24,
    ) -> None:
        cx, cy, cz = center
        middle = self.vertex(center, weights)
        ring = [
            self.vertex((cx + cos(angle) * radii[0], cy, cz + sin(angle) * radii[1]), weights)
            for angle in (2.0 * pi * index / segments for index in range(segments))
        ]
        for index in range(segments):
            following = (index + 1) % segments
            self.face((middle, ring[following], ring[index]), material)

    def ellipse_ring_y(
        self,
        center: tuple[float, float, float],
        outer: tuple[float, float],
        thickness: float,
        material: int,
        weights: dict[str, float],
        segments: int = 24,
    ) -> None:
        cx, cy, cz = center
        inner = (max(0.002, outer[0] - thickness), max(0.002, outer[1] - thickness))
        outer_ring = []
        inner_ring = []
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            outer_ring.append(self.vertex((cx + cos(angle) * outer[0], cy, cz + sin(angle) * outer[1]), weights))
            inner_ring.append(self.vertex((cx + cos(angle) * inner[0], cy - 0.002, cz + sin(angle) * inner[1]), weights))
        for index in range(segments):
            following = (index + 1) % segments
            self.face((outer_ring[index], outer_ring[following], inner_ring[following], inner_ring[index]), material)

    def ellipse_ring_z(
        self,
        center: tuple[float, float],
        outer: tuple[float, float],
        inner: tuple[float, float],
        z: float,
        material: int,
        weights: dict[str, float],
        segments: int = 24,
    ) -> None:
        """Create a horizontal gasket annulus that closes a visible collar gap."""
        outer_ring = []
        inner_ring = []
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            outer_ring.append(self.vertex((center[0] + cos(angle) * outer[0], center[1] + sin(angle) * outer[1], z), weights))
            inner_ring.append(self.vertex((center[0] + cos(angle) * inner[0], center[1] + sin(angle) * inner[1], z + 0.002), weights))
        for index in range(segments):
            following = (index + 1) % segments
            self.face((outer_ring[index], outer_ring[following], inner_ring[following], inner_ring[index]), material)

    def ellipsoid(
        self,
        center: tuple[float, float, float],
        radii: tuple[float, float, float],
        material: int,
        weights: dict[str, float],
        longitude_segments: int = 24,
        latitude_segments: int = 12,
    ) -> None:
        cx, cy, cz = center
        rings: list[list[int]] = []
        top = self.vertex((cx, cy, cz + radii[2]), weights)
        bottom = self.vertex((cx, cy, cz - radii[2]), weights)
        for lat in range(1, latitude_segments):
            theta = pi * lat / latitude_segments
            rings.append([
                self.vertex(
                    (
                        cx + sin(theta) * cos(phi) * radii[0],
                        cy + sin(theta) * sin(phi) * radii[1],
                        cz + cos(theta) * radii[2],
                    ),
                    weights,
                )
                for phi in (2.0 * pi * index / longitude_segments for index in range(longitude_segments))
            ])
        for index in range(longitude_segments):
            following = (index + 1) % longitude_segments
            self.face((top, rings[0][index], rings[0][following]), material)
            self.face((bottom, rings[-1][following], rings[-1][index]), material)
        for ring_index in range(len(rings) - 1):
            for index in range(longitude_segments):
                following = (index + 1) % longitude_segments
                face = (rings[ring_index][index], rings[ring_index + 1][index], rings[ring_index + 1][following], rings[ring_index][following])
                center_point = sum((Vector(self.vertices[vertex_index]) for vertex_index in face), Vector()) / 4.0
                # Leave a real opening behind the translucent visor.  This
                # keeps the face readable instead of tinting an opaque yellow
                # hood surface and calling it glass.
                front_opening = (
                    center_point.y < cy - radii[1] * 0.70
                    and (
                        ((center_point.x - cx) / (radii[0] * 0.76)) ** 2
                        + ((center_point.z - cz) / (radii[2] * 0.42)) ** 2
                    ) < 1.0
                )
                if not front_opening:
                    self.face(face, material)

    def tube_between(
        self,
        start: tuple[float, float, float],
        end: tuple[float, float, float],
        radius: float,
        material: int,
        weights: dict[str, float],
        segments: int = 10,
    ) -> None:
        a = Vector(start)
        b = Vector(end)
        direction = (b - a).normalized()
        reference = Vector((0.0, 0.0, 1.0)) if abs(direction.z) < 0.88 else Vector((1.0, 0.0, 0.0))
        tangent = direction.cross(reference).normalized()
        bitangent = direction.cross(tangent).normalized()
        rings: list[list[int]] = []
        for point in (a, b):
            ring = []
            for index in range(segments):
                angle = 2.0 * pi * index / segments
                offset = tangent * (cos(angle) * radius) + bitangent * (sin(angle) * radius)
                ring.append(self.vertex(point + offset, weights))
            rings.append(ring)
        for index in range(segments):
            following = (index + 1) % segments
            self.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)


def finalize_detail_builder(
    builder: HazmatBuilder,
    armature: bpy.types.Object,
    asset_id: str,
    suffix: str,
    hide_when_helmet_equipped: bool = False,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{asset_id}_{suffix}_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_{suffix}", mesh)
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
    modifier = details.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = details
    details.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.85, island_margin=0.014)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in details.data.polygons:
        polygon.use_smooth = polygon.material_index in (0, 1, 2, 3)
    details.select_set(False)
    details["realm_asset_id"] = asset_id
    details["realm_item_id"] = "hazmatSuit"
    details["realm_item_name_ru"] = "Костюм химзащиты"
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    if hide_when_helmet_equipped:
        details["realm_hide_when_helmet_equipped"] = True
        details["realm_hazmat_hood_assembly"] = True
    return details


def build_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> tuple[bpy.types.Object, bpy.types.Object]:
    builder = HazmatBuilder()
    hood_builder = HazmatBuilder()
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    head_minimum = Vector(fit["headBounds"]["minimum"])
    head_maximum = Vector(fit["headBounds"]["maximum"])
    torso_center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    torso_half_x = max(abs(torso_minimum.x), abs(torso_maximum.x))
    torso_radius_y = (torso_maximum.y - torso_minimum.y) * 0.5
    front_y = torso_minimum.y - 0.030
    back_y = torso_maximum.y + 0.035

    # A compact soft hood stays inside the minimum clearance shared by all
    # three shipped helmet families.  The respirator remains readable below
    # their brow line without forcing a second oversized head silhouette.
    head_center = (head_minimum + head_maximum) * 0.5
    head_radii = (
        (head_maximum.x - head_minimum.x) * 0.5 + 0.010,
        (head_maximum.y - head_minimum.y) * 0.5 + 0.012,
        (head_maximum.z - head_minimum.z) * 0.5 + 0.012,
    )
    hood_builder.ellipsoid(tuple(head_center), head_radii, 0, {"head": 0.92, "neck_01": 0.08})
    # The ellipsoid naturally pinches to a point below the skull.  A short,
    # overlapping skirt closes that pinch so neck skin never shows between the
    # hood and the shoulder cowl in rear or animated views.
    hood_builder.ellipse_band_z(
        (head_center.x, head_center.y),
        (head_radii[0] * 1.12, head_radii[1] * 1.12),
        head_minimum.z - 0.055,
        head_minimum.z + 0.095,
        0,
        {"head": 0.58, "neck_01": 0.42},
        24,
    )
    visor_center = (head_center.x, head_minimum.y - 0.020, head_center.z + 0.012)
    visor_radii = (head_radii[0] * 0.88, head_radii[2] * 0.47)
    hood_builder.ellipse_disc_y(visor_center, visor_radii, 3, {"head": 1.0})
    hood_builder.ellipse_ring_y((visor_center[0], visor_center[1] - 0.006, visor_center[2]), (visor_radii[0] + 0.018, visor_radii[1] + 0.018), 0.018, 1, {"head": 1.0})

    respirator_z = head_center.z - head_radii[2] * 0.51
    respirator_y = visor_center[1] - 0.022
    hood_builder.box((0.0, respirator_y, respirator_z), (0.086, 0.044, 0.058), 1, {"head": 0.88, "neck_01": 0.12})
    for direction in (-1.0, 1.0):
        filter_x = direction * (visor_radii[0] * 0.68)
        hood_builder.cylinder_y((filter_x, respirator_y - 0.008, respirator_z - 0.003), 0.032, 0.048, 1, {"head": 0.86, "neck_01": 0.14}, 16)
        hood_builder.cylinder_y((filter_x, respirator_y - 0.035, respirator_z - 0.003), 0.025, 0.010, 2, {"head": 0.86, "neck_01": 0.14}, 16)

    # Neck cowl and sealed waist seam follow each body's measured ellipse.
    cowl_z0 = max(torso_maximum.z - 0.065, head_minimum.z - 0.115)
    cowl_radii = (torso_half_x * 0.72, torso_radius_y * 1.00)
    cowl_weights = {"spine_03": 0.58, "neck_01": 0.42}
    hood_builder.ellipse_band_z((0.0, torso_center_y), cowl_radii, cowl_z0, cowl_z0 + 0.100, 0, cowl_weights, 22)
    hood_builder.ellipse_ring_z(
        (0.0, torso_center_y),
        cowl_radii,
        (
            0.012,
            0.015,
        ),
        cowl_z0 + 0.098,
        0,
        cowl_weights,
        22,
    )
    waist_z = max(torso_minimum.z + 0.19, 1.015)
    waist_points = [
        point
        for point in BASE.group_points(body, armature, TORSO_GROUPS)
        if waist_z - 0.035 <= point.z <= waist_z + 0.045
    ]
    waist_minimum, waist_maximum = BASE.bounds(waist_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.012,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.013,
    )
    # A continuous loose pelvis yoke bridges the body-derived crotch and seat.
    # It reads as the lower half of a one-piece coverall, tucks beneath the
    # waist seam, and stays open at the thighs so it deforms cleanly in motion.
    pelvis_points = BASE.group_points(body, armature, {"pelvis", "thigh_l", "thigh_r"})
    pelvis_band_points = [point for point in pelvis_points if 0.80 <= point.z <= 1.08]
    pelvis_minimum, pelvis_maximum = BASE.bounds(pelvis_band_points or pelvis_points)
    pelvis_center_y = (pelvis_minimum.y + pelvis_maximum.y) * 0.5
    pelvis_radius_x = max(abs(pelvis_minimum.x), abs(pelvis_maximum.x)) + 0.064
    pelvis_radius_y = (pelvis_maximum.y - pelvis_minimum.y) * 0.5 + 0.076
    builder.ellipse_frustum_z(
        (0.0, pelvis_center_y),
        (pelvis_radius_x * 1.02, pelvis_radius_y * 1.02),
        (max(pelvis_radius_x * 0.94, waist_radii[0] + 0.010), max(pelvis_radius_y * 0.94, waist_radii[1] + 0.012)),
        0.785,
        waist_z + 0.016,
        0,
        {"pelvis": 0.58, "thigh_l": 0.21, "thigh_r": 0.21},
        {"pelvis": 0.74, "spine_01": 0.26},
        28,
    )
    builder.ellipse_band_z((0.0, waist_center_y), waist_radii, waist_z, waist_z + 0.022, 4, BASE.torso_weights(waist_z), 24)

    # A covered front closure and its metal slider make the suit readable in
    # the isometric view while keeping the silhouette practical.
    zipper_top = min(torso_maximum.z - 0.075, 1.485)
    zipper_bottom = max(torso_minimum.z + 0.075, 0.900)
    builder.box((0.0, front_y - 0.013, (zipper_top + zipper_bottom) * 0.5), (0.022, 0.010, zipper_top - zipper_bottom), 1, {"spine_01": 0.34, "spine_02": 0.42, "spine_03": 0.24})
    builder.box((0.022, front_y - 0.024, zipper_top - 0.035), (0.028, 0.012, 0.043), 2, {"spine_03": 0.72, "spine_02": 0.28})

    # Compact chest warning patch: a recessed panel and a simplified, readable
    # three-lobed contamination mark instead of a floating decal.
    patch_center = (-torso_half_x * 0.43, front_y - 0.017, min(1.365, torso_maximum.z - 0.14))
    builder.box(patch_center, (0.105, 0.010, 0.082), 5, {"spine_03": 0.80, "spine_02": 0.20})
    for angle in (-pi / 2, pi / 6, 5 * pi / 6):
        lobe_x = patch_center[0] + cos(angle) * 0.022
        lobe_z = patch_center[2] + sin(angle) * 0.022
        builder.cylinder_y((lobe_x, patch_center[1] - 0.008, lobe_z), 0.013, 0.007, 1, {"spine_03": 0.80, "spine_02": 0.20}, 12)
    builder.cylinder_y((patch_center[0], patch_center[1] - 0.010, patch_center[2]), 0.010, 0.008, 5, {"spine_03": 0.80, "spine_02": 0.20}, 12)

    # Wrist and ankle seal rings are body-measured and follow the owning bone.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        lowerarm = BASE.group_points(body, armature, {f"lowerarm_{side}"})
        arm_minimum, arm_maximum = BASE.bounds(lowerarm)
        distance = max(abs(arm_minimum.x), abs(arm_maximum.x))
        wrist_points = [point for point in lowerarm if abs(abs(point.x) - distance) < 0.072]
        wrist_minimum, wrist_maximum = BASE.bounds(wrist_points)
        wrist_center = ((wrist_minimum.y + wrist_maximum.y) * 0.5, (wrist_minimum.z + wrist_maximum.z) * 0.5)
        wrist_radii = ((wrist_maximum.y - wrist_minimum.y) * 0.5 + 0.014, (wrist_maximum.z - wrist_minimum.z) * 0.5 + 0.014)
        x0, x1 = sorted((direction * (distance - 0.105), direction * (distance - 0.018)))
        builder.ellipse_band_x(x0, x1, wrist_center, wrist_radii, 1, {f"lowerarm_{side}": 0.82, f"hand_{side}": 0.18}, 16)

        # Three shallow accordion folds give the sleeve room to bend without
        # turning it into a body-tight rubber tube.
        arm_points = BASE.group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
        arm_minimum_all, arm_maximum_all = BASE.bounds(arm_points)
        inner_distance = min(abs(arm_minimum_all.x), abs(arm_maximum_all.x))
        outer_distance = max(abs(arm_minimum_all.x), abs(arm_maximum_all.x))
        elbow_x = direction * (inner_distance + (outer_distance - inner_distance) * 0.56)
        elbow_points = [point for point in arm_points if abs(point.x - elbow_x) <= 0.050]
        elbow_minimum, elbow_maximum = BASE.bounds(elbow_points)
        elbow_center = (
            (elbow_minimum.y + elbow_maximum.y) * 0.5,
            (elbow_minimum.z + elbow_maximum.z) * 0.5,
        )
        elbow_radii = (
            (elbow_maximum.y - elbow_minimum.y) * 0.5 + 0.022,
            (elbow_maximum.z - elbow_minimum.z) * 0.5 + 0.022,
        )
        for offset in (-0.024, 0.0, 0.024):
            fold_center_x = elbow_x + direction * offset
            fold_x0, fold_x1 = sorted((fold_center_x - 0.005, fold_center_x + 0.005))
            builder.ellipse_band_x(
                fold_x0,
                fold_x1,
                elbow_center,
                elbow_radii,
                0,
                {f"upperarm_{side}": 0.42, f"lowerarm_{side}": 0.58},
                16,
            )

        calf = BASE.group_points(body, armature, {f"calf_{side}"})
        calf_low = [point for point in calf if 0.18 <= point.z <= 0.34]
        if calf_low:
            calf_minimum, calf_maximum = BASE.bounds(calf_low)
            calf_center_y = (calf_minimum.y + calf_maximum.y) * 0.5
            calf_radii = (
                (calf_maximum.x - calf_minimum.x) * 0.5 + 0.018,
                (calf_maximum.y - calf_minimum.y) * 0.5 + 0.018,
            )
            builder.ellipse_band_z((direction * abs((calf_minimum.x + calf_maximum.x) * 0.5), calf_center_y), calf_radii, 0.205, 0.265, 1, {f"calf_{side}": 1.0}, 18)

        knee_points = [
            point
            for point in BASE.group_points(body, armature, {f"thigh_{side}", f"calf_{side}"})
            if 0.49 <= point.z <= 0.66
        ]
        knee_minimum, knee_maximum = BASE.bounds(knee_points)
        knee_center = (
            direction * abs((knee_minimum.x + knee_maximum.x) * 0.5),
            (knee_minimum.y + knee_maximum.y) * 0.5,
        )
        knee_radii = (
            (knee_maximum.x - knee_minimum.x) * 0.5 + 0.022,
            (knee_maximum.y - knee_minimum.y) * 0.5 + 0.022,
        )
        for fold_z in (0.535, 0.565, 0.595):
            builder.ellipse_band_z(
                knee_center,
                knee_radii,
                fold_z - 0.005,
                fold_z + 0.005,
                0,
                {f"thigh_{side}": 0.38, f"calf_{side}": 0.62},
                18,
            )

    # One restrained field repair on the rear shoulder and one knee patch add
    # C-level wear without turning the suit into a patchwork costume.
    builder.box((torso_half_x * 0.48, back_y + 0.006, min(1.405, torso_maximum.z - 0.10)), (0.105, 0.011, 0.068), 4, {"spine_03": 0.70, "clavicle_r": 0.30})
    left_thigh = BASE.group_points(body, armature, {"thigh_l"})
    thigh_minimum, thigh_maximum = BASE.bounds(left_thigh)
    builder.box(((thigh_minimum.x + thigh_maximum.x) * 0.5, thigh_minimum.y - 0.020, (thigh_minimum.z + thigh_maximum.z) * 0.5 - 0.045), ((thigh_maximum.x - thigh_minimum.x) * 0.48, 0.011, 0.100), 4, {"thigh_l": 1.0})

    details = finalize_detail_builder(builder, armature, asset_id, "sealed_details")
    hood = finalize_detail_builder(
        hood_builder,
        armature,
        asset_id,
        "helmet_optional_hood",
        hide_when_helmet_equipped=True,
    )
    fit["detailVertices"] = len(details.data.vertices)
    fit["detailPolygons"] = len(details.data.polygons)
    fit["hoodVertices"] = len(hood.data.vertices)
    fit["hoodPolygons"] = len(hood.data.polygons)
    fit["visorCenter"] = [round(value, 5) for value in visor_center]
    fit["headRadii"] = [round(value, 5) for value in head_radii]
    fit["helmetCompatibilityMode"] = "hide_hood_assembly_when_helmet_equipped"
    return details, hood


def pose_review(armature: bpy.types.Object) -> list[bpy.types.Object]:
    armature.data.pose_position = "POSE"
    helpers: list[bpy.types.Object] = []
    for side, direction in (("l", 1.0), ("r", -1.0)):
        hand = armature.pose.bones.get(f"hand_{side}")
        if hand is None:
            continue
        target = bpy.data.objects.new(f"hazmat_review_hand_{side}", None)
        target.location = (direction * 0.53, -0.018, 1.12)
        bpy.context.scene.collection.objects.link(target)
        pole = bpy.data.objects.new(f"hazmat_review_elbow_{side}", None)
        pole.location = (direction * 0.68, -0.25, 1.19)
        bpy.context.scene.collection.objects.link(pole)
        constraint = hand.constraints.new("IK")
        constraint.name = "hazmat_review_natural_arm"
        constraint.target = target
        constraint.pole_target = pole
        constraint.chain_count = 3
        constraint.iterations = 64
        helpers.extend((target, pole))
    bpy.context.view_layer.update()
    return helpers


def reset_pose(armature: bpy.types.Object, helpers: list[bpy.types.Object]) -> None:
    for pose_bone in armature.pose.bones:
        for constraint in list(pose_bone.constraints):
            if constraint.name == "hazmat_review_natural_arm":
                pose_bone.constraints.remove(constraint)
        pose_bone.matrix_basis.identity()
    for helper in helpers:
        bpy.data.objects.remove(helper, do_unlink=True)
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()


def render_review(
    output: Path,
    camera_location: tuple[float, float, float],
    target: tuple[float, float, float],
    ortho_scale: float,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("hazmat_review_world")
    scene.world.color = (0.018, 0.024, 0.022)

    for obj in [obj for obj in list(scene.objects) if obj.name.startswith("hazmat_review_light") or obj.name in {"hazmat_review_camera", "hazmat_review_floor"}]:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, -0.02))
    floor = bpy.context.object
    floor.name = "hazmat_review_floor"
    floor_material = bpy.data.materials.get("hazmat_review_floor_material") or bpy.data.materials.new("hazmat_review_floor_material")
    floor_material.use_nodes = True
    floor_bsdf = floor_material.node_tree.nodes.get("Principled BSDF")
    floor_bsdf.inputs["Base Color"].default_value = (0.055, 0.066, 0.058, 1.0)
    floor_bsdf.inputs["Roughness"].default_value = 0.94
    floor.data.materials.append(floor_material)

    for name, location, energy, color, size in (
        ("hazmat_review_light_key", (-2.7, -3.5, 4.4), 1120, (1.0, 0.80, 0.54), 3.0),
        ("hazmat_review_light_fill", (3.0, -1.1, 3.0), 720, (0.52, 0.72, 0.86), 3.3),
        ("hazmat_review_light_rim", (0.0, 3.2, 3.4), 960, (0.86, 0.72, 0.46), 2.3),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        BASE.look_at(light, Vector(target))
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "hazmat_review_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.data.lens = 58
    BASE.look_at(camera, Vector(target))
    scene.camera = camera
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output.resolve())
    bpy.ops.render.render(write_still=True)


def parse_exported_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    accessors = gltf.get("accessors", [])
    vertices = 0
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position_index = primitive.get("attributes", {}).get("POSITION")
            if position_index is not None:
                vertices += accessors[position_index]["count"]
            indices = primitive.get("indices")
            if indices is not None:
                triangles += accessors[indices]["count"] // 3
    return {
        "meshDefinitions": len(gltf.get("meshes", [])),
        "positionVertices": vertices,
        "triangles": triangles,
        "materials": len(gltf.get("materials", [])),
        "textures": len(gltf.get("textures", [])),
        "skins": len(gltf.get("skins", [])),
        "nodes": [node.get("name", "") for node in gltf.get("nodes", [])],
    }


def export_candidate(
    output: Path,
    armature: bpy.types.Object,
    equipment_objects: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in equipment_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = equipment_objects[0]
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
    for obj in reference_objects:
        lowered_name = obj.name.lower()
        if obj.type == "MESH" and ("hair" in lowered_name or "eyebrow" in lowered_name):
            obj.hide_render = True
            obj.hide_set(True)
    armature.data.pose_position = "REST"
    if armature.animation_data:
        armature.animation_data_clear()
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()

    materials = {
        "suit": textured_material("hazmat_faded_mustard_canvas", (0.30, 0.235, 0.035), 0.82, 0.0, args.body_id, "coated_canvas", 0.14),
        "rubber": textured_material("hazmat_aged_black_rubber", (0.025, 0.032, 0.028), 0.68, 0.0, args.body_id, "rubber", 0.09),
        "metal": plain_material("hazmat_oxidized_filter_metal", (0.105, 0.120, 0.108), 0.61, 0.64),
        "visor": plain_material("hazmat_scratched_smoke_visor", (0.095, 0.190, 0.180), 0.28, 0.18, 0.68),
        "repair": plain_material("hazmat_dusty_olive_repairs", (0.045, 0.055, 0.025), 0.92),
        "warning": plain_material("hazmat_faded_warning_panel", (0.22, 0.13, 0.012), 0.80),
    }
    material_order = tuple(materials[name] for name in ("suit", "rubber", "metal", "visor", "repair", "warning"))
    shell, fit = build_shell(body, armature, args.asset_id)
    details, hood = build_details(body, armature, args.asset_id, fit)
    for obj in (shell, details, hood):
        for material in material_order:
            obj.data.materials.append(material)

    helpers = pose_review(armature)
    if args.front_render:
        render_review(args.front_render, (2.35, -4.05, 2.08), (0.0, 0.0, 0.98), 2.16)
    if args.back_render:
        render_review(args.back_render, (-2.35, 4.05, 2.05), (0.0, 0.0, 1.00), 2.16)
    if args.detail_render:
        render_review(args.detail_render, (1.20, -3.15, 1.92), (0.0, -0.04, 1.48), 1.05)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    reset_pose(armature, helpers)
    for obj in list(reference_objects):
        if obj != armature and obj not in (shell, details, hood) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, shell, details, hood)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    export_candidate(args.output, armature, [shell, details, hood])
    actual = parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "itemId": "hazmatSuit",
        "itemNameRu": "Костюм химзащиты",
        "file": args.output.name,
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "materials": [material.name for material in material_order],
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "Blender-authored loose coverall silhouette with a sealed helmet-optional hood assembly and B+C hazmat details on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_HAZMAT_SUIT_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
