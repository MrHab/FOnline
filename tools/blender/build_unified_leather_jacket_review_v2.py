"""Build the Realm of Ashes B+C leather-jacket v2 review asset.

V2 is a new reference-led garment rather than a reskin of the shipped body.
Every variant is measured from its exact player body, but the torso, sleeves,
panels, lapels, collar, belt, hardware and reinforcements are authored as a
separate fitted jacket.  The review blend keeps a dense high-poly source while
the GLB contains only the clean game-ready meshes on the current 65-bone rig.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import atan2, cos, pi, sin, sqrt
from pathlib import Path
import random
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


TORSO_GROUPS = {"pelvis", "spine_01", "spine_02", "spine_03"}
ARM_GROUPS = {
    "clavicle_l",
    "upperarm_l",
    "lowerarm_l",
    "clavicle_r",
    "upperarm_r",
    "lowerarm_r",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_leather_jacket_unified_v2")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--side-render", type=Path)
    parser.add_argument("--three-quarter-render", type=Path)
    parser.add_argument("--isometric-render", type=Path)
    parser.add_argument("--night-render", type=Path)
    parser.add_argument("--wireframe-render", type=Path)
    parser.add_argument("--native-render", type=Path)
    parser.add_argument("--deformation-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    parser.add_argument("--idle-render", type=Path)
    parser.add_argument("--walk-render", type=Path)
    parser.add_argument("--run-render", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()), import_shading="NORMALS")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def texture_image(
    name: str,
    base: tuple[float, float, float],
    kind: str,
    seed: str,
    size: int = 512,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-leather-jacket-v2:{seed}:{name}:{kind}")
    pixels: list[float] = []
    scratches = [
        (
            rng.randrange(18, size - 18),
            rng.randrange(18, size - 18),
            rng.randrange(7, 34),
            rng.choice((-1, 1)),
        )
        for _ in range(10)
    ]
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.031 + y * 0.013) * 0.52 + sin(y * 0.053 - x * 0.011) * 0.27
            grain = sin(x * 0.73 + sin(y * 0.11) * 2.0) * 0.20
            pores = sin(x * 1.77 + y * 0.83) * sin(y * 1.31 - x * 0.47) * 0.10
            # High-frequency white noise reads as digital speckle and defeats
            # PNG compression.  Broad weave, directional grain and pores carry
            # the leather breakup; scratches remain seeded and localized.
            noise = 0.0
            scuff = 0.0
            for sx, sy, length, direction in scratches:
                dx = x - sx
                dy = y - sy
                if abs(dy - direction * dx * 0.16) < 0.75 and abs(dx) < length:
                    scuff = max(scuff, 1.0 - abs(dx) / max(1, length))
            if kind == "albedo":
                # Keep the packed texture nearly seamless.  Smart projection
                # separates garment panels, so broad colour swings would draw
                # every UV island as a false quilted triangle.
                variation = broad * 0.044 + grain * 0.016 + pores * 0.011 + noise * 0.008
                values = tuple(
                    max(0.012, min(0.92, component * (1.0 + variation) + scuff * 0.036))
                    for component in base
                )
                pixels.extend((*values, 1.0))
            elif kind == "orm":
                roughness = max(0.30, min(0.98, base[0] + broad * 0.026 + pores * 0.012 + noise * 0.008 - scuff * 0.060))
                occlusion = max(0.58, min(1.0, 0.94 + broad * 0.024 + grain * 0.018 - scuff * 0.012))
                metallic = max(0.0, min(1.0, base[1] + noise * (0.010 if base[1] > 0.0 else 0.0)))
                pixels.extend((occlusion, roughness, metallic, 1.0))
            else:
                pixels.extend((0.5 + grain * 0.009 + pores * 0.004, 0.5 + broad * 0.006, 1.0, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float,
    seed: str,
    normal_strength: float = 0.20,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "IOR Level" in bsdf.inputs:
        bsdf.inputs["IOR Level"].default_value = 0.28
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = texture_image(f"{name}_albedo", base, "albedo", seed)
    orm = nodes.new("ShaderNodeTexImage")
    orm.image = texture_image(f"{name}_orm", (roughness, metallic, 0.0), "orm", seed)
    orm.image.colorspace_settings.name = "Non-Color"
    separate_orm = nodes.new("ShaderNodeSeparateColor")
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), "normal", seed)
    normal_texture.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    gltf_tree = bpy.data.node_groups.get("glTF Material Output")
    if gltf_tree is None:
        gltf_tree = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        gltf_tree.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gltf_settings = nodes.new("ShaderNodeGroup")
    gltf_settings.node_tree = gltf_tree
    gltf_settings.label = "glTF Material Output"
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(orm.outputs["Color"], separate_orm.inputs["Color"])
    links.new(separate_orm.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(separate_orm.outputs["Blue"], bsdf.inputs["Metallic"])
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(orm.outputs["Color"], gltf_settings.inputs["Occlusion"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    material.diffuse_color = (*base, 1.0)
    return material


def dominant_group(body: bpy.types.Object, vertex_index: int) -> str | None:
    assignments = body.data.vertices[vertex_index].groups
    if not assignments:
        return None
    strongest = max(assignments, key=lambda assignment: assignment.weight)
    return body.vertex_groups[strongest.group].name


def armature_position(body: bpy.types.Object, armature: bpy.types.Object, vertex_index: int) -> Vector:
    return armature.matrix_world.inverted() @ body.matrix_world @ body.data.vertices[vertex_index].co


def group_points(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    groups: set[str],
) -> list[Vector]:
    return [
        armature_position(body, armature, vertex.index)
        for vertex in body.data.vertices
        if dominant_group(body, vertex.index) in groups
    ]


def bounds(points: list[Vector]) -> tuple[Vector, Vector]:
    if not points:
        raise RuntimeError("Cannot measure empty body region")
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def torso_weights(z: float) -> dict[str, float]:
    if z < 1.08:
        blend = max(0.0, min(1.0, (z - 0.96) / 0.12))
        return {"pelvis": 1.0 - blend, "spine_01": blend}
    if z < 1.22:
        blend = (z - 1.08) / 0.14
        return {"spine_01": 1.0 - blend, "spine_02": blend}
    if z < 1.38:
        blend = (z - 1.22) / 0.16
        return {"spine_02": 1.0 - blend, "spine_03": blend}
    return {"spine_03": 1.0}


def tailored_torso_position(
    position: Vector,
    torso_minimum: Vector,
    torso_maximum: Vector,
) -> Vector:
    """Move the torso surface toward a smooth garment ellipse.

    The source mesh provides reliable topology and skin weights, but using its
    coordinates verbatim makes leather look painted onto pectorals and breasts.
    A partial ellipse projection preserves body size while introducing a clear
    air gap, a quieter front plane and a straighter waist.
    """
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    source_radius_x = max(abs(torso_minimum.x), abs(torso_maximum.x))
    source_radius_y = max(
        abs(torso_minimum.y - center_y),
        abs(torso_maximum.y - center_y),
    )
    height = max(0.001, torso_maximum.z - torso_minimum.z)
    progression = max(0.0, min(1.0, (position.z - torso_minimum.z) / height))
    # A restrained waist taper reads as tailoring; the chest and hem stay
    # almost straight so the garment never becomes a second skin.
    waist_taper = 0.925 + 0.075 * min(1.0, abs(progression - 0.36) / 0.34)
    target_radius_x = (source_radius_x + 0.022) * waist_taper
    target_radius_y = (source_radius_y + 0.024) * (0.95 + 0.05 * progression)
    angle = atan2(
        (position.y - center_y) / max(0.001, source_radius_y),
        position.x / max(0.001, source_radius_x),
    )
    target_x = cos(angle) * target_radius_x
    target_y = center_y + sin(angle) * target_radius_y
    if position.z > 1.17 and position.y < center_y:
        centrality = max(0.0, 1.0 - abs(position.x) / max(0.001, target_radius_x * 0.88))
        front_plane_y = center_y - target_radius_y
        plane_strength = centrality * 0.90
        target_y = target_y * (1.0 - plane_strength) + front_plane_y * plane_strength
    strength = 0.82
    result = Vector((
        position.x * (1.0 - strength) + target_x * strength,
        position.y * (1.0 - strength) + target_y * strength,
        position.z,
    ))
    # Never pull the garment through a locally broader shoulder or back plane.
    source_radius = Vector((position.x, position.y - center_y)).length
    result_radius = Vector((result.x, result.y - center_y)).length
    if result_radius < source_radius and result_radius > 0.0001:
        scale = source_radius / result_radius
        result.x *= scale
        result.y = center_y + (result.y - center_y) * scale
    return result


class GarmentSurfaceBuilder:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.weights: list[dict[str, float]] = []
        self.uvs: list[tuple[float, float]] = []

    def vertex(
        self,
        point: Vector | tuple[float, float, float],
        weights: dict[str, float],
        uv: tuple[float, float],
    ) -> int:
        index = len(self.vertices)
        self.vertices.append(tuple(point))
        total = sum(max(0.0, weight) for weight in weights.values())
        self.weights.append({name: weight / total for name, weight in weights.items() if weight > 0.0})
        self.uvs.append(uv)
        return index

    def quad(self, a: int, b: int, c: int, d: int) -> None:
        self.faces.append((a, b, c, d))


def measured_arm_profile(points: list[Vector], x: float) -> tuple[float, float, float, float]:
    sample_count = min(len(points), max(40, len(points) // 10))
    nearest = sorted(points, key=lambda point: abs(abs(point.x) - abs(x)))[:sample_count]
    minimum, maximum = bounds(nearest)
    center_y = (minimum.y + maximum.y) * 0.5
    center_z = (minimum.z + maximum.z) * 0.5
    radius_y = max(0.035, (maximum.y - minimum.y) * 0.5)
    radius_z = max(0.035, (maximum.z - minimum.z) * 0.5)
    return center_y, center_z, radius_y, radius_z


def create_skinned_mesh(
    name: str,
    builder: GarmentSurfaceBuilder,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    uv_layer = mesh.uv_layers.new(name="garment_uv")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = builder.uvs[vertex_index]
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = armature
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = armature.matrix_world.copy()
    group_names = sorted({name for weights in builder.weights for name in weights})
    groups = {name: obj.vertex_groups.new(name=name) for name in group_names}
    for vertex_index, weights in enumerate(builder.weights):
        for group_name, weight in weights.items():
            groups[group_name].add([vertex_index], weight, "REPLACE")
    modifier = obj.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    return obj


def body_surface_position(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    position: Vector,
    allowance: float,
) -> Vector | None:
    world_position = armature.matrix_world @ position
    body_position = body.matrix_world.inverted() @ world_position
    success, location, normal, _ = body.closest_point_on_mesh(body_position, distance=0.45)
    if not success:
        return None
    world_location = body.matrix_world @ location
    world_normal = (body.matrix_world.to_3x3() @ normal).normalized()
    return armature.matrix_world.inverted() @ (world_location + world_normal * allowance)


def build_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_points = group_points(body, armature, TORSO_GROUPS)
    torso_minimum, torso_maximum = bounds(torso_points)
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    torso_half_width = max(abs(torso_minimum.x), abs(torso_maximum.x))
    torso_radius_y = (torso_maximum.y - torso_minimum.y) * 0.5
    lower_hem = max(0.94, torso_minimum.z + 0.20)
    upper_limit = min(1.565, torso_maximum.z + 0.002)
    base_radius_x = torso_half_width + 0.030
    base_radius_y = torso_radius_y + 0.042
    builder = GarmentSurfaceBuilder()

    # A deliberately authored open-front torso replaces the body-derived shell
    # used by v1.  Its controlled rings keep the hem straight, tuck the waist,
    # broaden the shoulder and open into a real V beneath the lapels.
    torso_segments = 56
    torso_rings = 20
    torso_grid: list[list[int]] = []
    for ring_index in range(torso_rings):
        t = ring_index / (torso_rings - 1)
        z = lower_hem + (upper_limit - lower_hem) * t
        waist = sin(pi * min(1.0, t / 0.64)) ** 2 if t <= 0.64 else 0.0
        shoulder = max(0.0, (t - 0.70) / 0.30)
        radius_x = base_radius_x * (1.0 - waist * 0.090 + shoulder * 0.025)
        radius_y = base_radius_y * (1.0 - waist * 0.040 + shoulder * 0.018)
        if t <= 0.50:
            opening = 0.014
        else:
            opening = 0.014 + ((t - 0.50) / 0.50) ** 1.25 * 0.165
        start_angle = -pi * 0.5 + opening
        end_angle = pi * 1.5 - opening
        ring: list[int] = []
        for segment in range(torso_segments + 1):
            u = segment / torso_segments
            angle = start_angle + (end_angle - start_angle) * u
            frontness = max(0.0, -sin(angle))
            side = abs(cos(angle))
            x = cos(angle) * radius_x
            y = center_y + sin(angle) * radius_y
            top_blend = max(0.0, (t - 0.72) / 0.28)
            backness = max(0.0, sin(angle))
            neckline_factor = max(0.0, 1.0 - side) ** 1.45
            neckline_drop = (upper_limit - lower_hem) * neckline_factor * (
                0.10 * backness + 0.205 * frontness
            )
            # Tailor the outer shoulder down into the sleeve cap.  Without this
            # drop the highest point of the ring sits at the armhole and reads
            # as a rigid triangular spike in front/back orthographic views.
            shoulder_drop = (upper_limit - lower_hem) * side**3.2 * 0.145
            z_shaped = z - top_blend * (neckline_drop + shoulder_drop)
            # Quiet construction folds: shallow shaping beneath the arms and
            # a slightly firmer front plane.  These are large-form changes,
            # never high-frequency procedural wrinkles.
            y -= frontness * (0.0035 + 0.0025 * sin(pi * t))
            y += side * max(0.0, 0.55 - abs(t - 0.54)) * 0.003
            if t > 0.54:
                authored = Vector((x, y, z_shaped))
                fitted = body_surface_position(body, armature, authored, 0.016)
                if fitted is not None:
                    # Fit the upper back/chest decisively enough to stay outside
                    # the scapula and pectoral planes, but preserve the authored
                    # tailoring whenever the nearest-point query would shrink it.
                    fitted.z = authored.z
                    authored_radius = Vector((authored.x, authored.y - center_y)).length
                    fitted_radius = Vector((fitted.x, fitted.y - center_y)).length
                    if fitted_radius < authored_radius and fitted_radius > 0.0001:
                        fitted_scale = authored_radius / fitted_radius
                        fitted.x *= fitted_scale
                        fitted.y = center_y + (fitted.y - center_y) * fitted_scale
                    fit_strength = min(0.52, (t - 0.54) / 0.46 * 0.52)
                    authored = authored.lerp(fitted, fit_strength)
                    x, y, z_shaped = authored
            weights = torso_weights(z)
            if t > 0.72 and side > 0.48:
                clavicle = "clavicle_l" if x > 0.0 else "clavicle_r"
                influence = min(0.58, (t - 0.72) / 0.28 * (side - 0.40))
                weights = {name: weight * (1.0 - influence) for name, weight in weights.items()}
                weights[clavicle] = influence
            ring.append(builder.vertex((x, y, z_shaped), weights, (u, t * 0.55)))
        torso_grid.append(ring)
    for ring_index in range(torso_rings - 1):
        current = torso_grid[ring_index]
        following = torso_grid[ring_index + 1]
        for segment in range(torso_segments):
            builder.quad(current[segment], current[segment + 1], following[segment + 1], following[segment])

    lowerarm_points = group_points(body, armature, {"lowerarm_l", "lowerarm_r"})
    sleeve_limit_x = max(abs(point.x) for point in lowerarm_points) - 0.055
    radial_segments = 28
    sleeve_rings = 20
    for side, direction in (("l", 1.0), ("r", -1.0)):
        points = group_points(body, armature, {f"clavicle_{side}", f"upperarm_{side}", f"lowerarm_{side}"})
        minimum, maximum = bounds(points)
        shoulder_x = min(sleeve_limit_x - 0.25, max(0.135, base_radius_x * 0.60))
        end_x = sleeve_limit_x
        sleeve_grid: list[list[int]] = []
        for ring_index in range(sleeve_rings):
            t = ring_index / (sleeve_rings - 1)
            absolute_x = shoulder_x + (end_x - shoulder_x) * t
            center_arm_y, center_arm_z, radius_y, radius_z = measured_arm_profile(points, absolute_x)
            shoulder_ease = max(0.0, 1.0 - t / 0.34)
            cuff_taper = max(0.0, (t - 0.72) / 0.28)
            # The nearest-vertex sample at the arm root can include chest/back
            # vertices.  Clamp that measurement to a plausible leather sleeve
            # cap instead of reproducing the torso volume around each shoulder.
            arm_envelope = max(0.076, min(0.104, base_radius_x * 0.36))
            radius_y = min(radius_y, arm_envelope)
            radius_z = min(radius_z, arm_envelope * 1.04)
            radius_y += 0.010 + shoulder_ease * 0.008 - cuff_taper * 0.004
            radius_z += 0.010 + shoulder_ease * 0.010 - cuff_taper * 0.004
            ring = []
            for segment in range(radial_segments):
                v = segment / radial_segments
                angle = 2.0 * pi * v
                elbow_envelope = max(0.0, 1.0 - abs(t - 0.58) / 0.18)
                fold = 1.0 + elbow_envelope * 0.025 * sin(angle * 3.0)
                vertical = sin(angle)
                if vertical > 0.0:
                    vertical *= 1.0 - shoulder_ease * 0.15
                point = (
                    direction * absolute_x,
                    center_arm_y + cos(angle) * radius_y * fold,
                    center_arm_z + vertical * radius_z * fold,
                )
                if t < 0.28:
                    clavicle_weight = 0.58 * (1.0 - t / 0.28)
                    weights = {f"clavicle_{side}": clavicle_weight, f"upperarm_{side}": 1.0 - clavicle_weight}
                elif t < 0.54:
                    weights = {f"upperarm_{side}": 1.0}
                elif t < 0.72:
                    lower_weight = (t - 0.54) / 0.18
                    weights = {f"upperarm_{side}": 1.0 - lower_weight, f"lowerarm_{side}": lower_weight}
                else:
                    weights = {f"lowerarm_{side}": 1.0}
                ring.append(builder.vertex(point, weights, (t, 0.56 + v * 0.44)))
            sleeve_grid.append(ring)
        for ring_index in range(sleeve_rings - 1):
            current = sleeve_grid[ring_index]
            following = sleeve_grid[ring_index + 1]
            for segment in range(radial_segments):
                next_segment = (segment + 1) % radial_segments
                if direction > 0.0:
                    builder.quad(current[segment], current[next_segment], following[next_segment], following[segment])
                else:
                    builder.quad(current[next_segment], current[segment], following[segment], following[next_segment])

    # Shoulder/armhole anatomy is the one place where a generic tube transition
    # is visibly wrong.  Reuse only this narrow surface patch from the current
    # approved player body, offset it by the leather allowance, and preserve its
    # exact rig weights.  The authored torso and sleeve overlap the patch, so its
    # boundary becomes a quiet raglan seam instead of an open gap or pauldron.
    shoulder_patch_start = len(builder.faces)
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    source_to_patch: dict[int, int] = {}
    position_to_patch: dict[tuple[int, int, int], int] = {}
    for polygon in body.data.polygons:
        center = world_to_armature @ body.matrix_world @ polygon.center
        absolute_x = abs(center.x)
        if not (
            base_radius_x * 0.50 <= absolute_x <= base_radius_x * 1.12
            and 1.285 <= center.z <= upper_limit + 0.025
        ):
            continue
        side = "l" if center.x > 0.0 else "r"
        dominant = [dominant_group(body, vertex_index) for vertex_index in polygon.vertices]
        shoulder_votes = sum(group in {f"clavicle_{side}", f"upperarm_{side}"} for group in dominant)
        upper_side_torso_votes = sum(group in TORSO_GROUPS for group in dominant)
        if shoulder_votes == 0 and not (upper_side_torso_votes > 0 and center.z > 1.335 and absolute_x > base_radius_x * 0.68):
            continue
        face: list[int] = []
        for source_index in polygon.vertices:
            patch_index = source_to_patch.get(source_index)
            if patch_index is None:
                source_vertex = body.data.vertices[source_index]
                base_position = world_to_armature @ body.matrix_world @ source_vertex.co
                position_key = tuple(round(value * 100000.0) for value in base_position)
                patch_index = position_to_patch.get(position_key)
                if patch_index is None:
                    normal = (normal_transform @ source_vertex.normal).normalized()
                    position = base_position + normal * 0.016
                    allowed_groups = {
                        "spine_02",
                        "spine_03",
                        f"clavicle_{side}",
                        f"upperarm_{side}",
                        f"lowerarm_{side}",
                    }
                    weight_items = sorted(
                        (
                            (body.vertex_groups[assignment.group].name, assignment.weight)
                            for assignment in source_vertex.groups
                            if assignment.weight > 0.001
                            and body.vertex_groups[assignment.group].name in allowed_groups
                        ),
                        key=lambda item: item[1],
                        reverse=True,
                    )[:4]
                    weights = dict(weight_items) or {f"clavicle_{side}": 1.0}
                    uv = (
                        0.5 + position.x / max(0.001, base_radius_x * 4.0),
                        0.58 + (position.z - 1.255) / max(0.001, upper_limit - 1.185) * 0.22,
                    )
                    patch_index = builder.vertex(position, weights, uv)
                    position_to_patch[position_key] = patch_index
                source_to_patch[source_index] = patch_index
            face.append(patch_index)
        if len(set(face)) >= 3:
            builder.faces.append(tuple(face))
    shoulder_patch_polygons = len(builder.faces) - shoulder_patch_start

    shell = create_skinned_mesh(f"{asset_id}_game_shell", builder, armature)
    shell["realm_asset_id"] = asset_id
    shell["realm_art_direction"] = "character_geometry_b_materials_c"
    shell["realm_geometry_role"] = "game_ready"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False
    return shell, {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "shellVertices": len(shell.data.vertices),
        "shellPolygons": len(shell.data.polygons),
        "frontOpeningThresholdY": round(center_y - base_radius_y, 5),
        "frontSurfaceY": round(center_y - base_radius_y - 0.006, 5),
        "backSurfaceY": round(center_y + base_radius_y, 5),
        "torsoRadiusX": round(base_radius_x, 5),
        "torsoRadiusY": round(base_radius_y, 5),
        "lowerHemZ": round(lower_hem, 5),
        "upperLimitZ": round(upper_limit, 5),
        "sleeveLimitX": round(sleeve_limit_x, 5),
        "topology": {
            "torsoSegments": torso_segments,
            "torsoRings": torso_rings,
            "sleeveRadialSegments": radial_segments,
            "sleeveRings": sleeve_rings,
            "shoulderPatchSource": "approved_player_surface",
            "shoulderPatchPolygons": shoulder_patch_polygons,
        },
    }


def build_fitted_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    """Create a welded garment shell from the exact player surface.

    The body supplies reliable shoulder, armhole and sleeve anatomy.  A small
    outward allowance, restrained tailoring blend and welded smoothing remove
    the painted-on look without turning the jacket into a rigid cylinder.
    """
    torso_points = group_points(body, armature, TORSO_GROUPS)
    torso_minimum, torso_maximum = bounds(torso_points)
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    torso_half_width = max(abs(torso_minimum.x), abs(torso_maximum.x))
    torso_radius_y = (torso_maximum.y - torso_minimum.y) * 0.5
    lower_hem = max(0.94, torso_minimum.z + 0.20)
    upper_limit = min(1.555, torso_maximum.z - 0.005)
    garment_height = upper_limit - lower_hem
    lapel_point = lower_hem + garment_height * 0.57
    front_threshold = torso_minimum.y + (torso_maximum.y - torso_minimum.y) * 0.12
    lowerarm_points = group_points(body, armature, {"lowerarm_l", "lowerarm_r"})
    sleeve_limit_x = max(abs(point.x) for point in lowerarm_points) - 0.055
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    old_to_new: dict[int, int] = {}
    position_to_new: dict[tuple[int, int, int], int] = {}
    source_indices: list[int] = []
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for polygon in body.data.polygons:
        center = world_to_armature @ body.matrix_world @ polygon.center
        dominant = [dominant_group(body, vertex_index) for vertex_index in polygon.vertices]
        torso_votes = sum(group in TORSO_GROUPS for group in dominant)
        arm_votes = sum(group in ARM_GROUPS for group in dominant)
        clavicle_votes = sum(group in {"clavicle_l", "clavicle_r"} for group in dominant)
        hand_votes = sum(
            group is not None and group.startswith(("hand_", "index_", "middle_", "pinky_", "ring_", "thumb_"))
            for group in dominant
        )
        is_torso = (
            lower_hem <= center.z <= upper_limit
            and abs(center.x) <= torso_half_width + 0.070
            and torso_votes + clavicle_votes >= 1
        )
        is_arm = (
            0.135 <= abs(center.x) <= sleeve_limit_x
            and 1.255 <= center.z <= 1.625
            and arm_votes + clavicle_votes >= 1
            and hand_votes == 0
        )
        is_clavicle = clavicle_votes > 0 and 1.325 <= center.z <= 1.550
        if not (is_torso or is_arm or is_clavicle):
            continue
        if is_torso and center.z > lapel_point and center.y <= front_threshold:
            opening_progress = (center.z - lapel_point) / max(0.001, upper_limit - lapel_point)
            opening_half_width = 0.010 + opening_progress * torso_half_width * 0.22
            if abs(center.x) < opening_half_width:
                continue
        face: list[int] = []
        for source_index in polygon.vertices:
            if source_index not in old_to_new:
                source_vertex = body.data.vertices[source_index]
                base_position = world_to_armature @ body.matrix_world @ source_vertex.co
                normal = (normal_transform @ source_vertex.normal).normalized()
                group = dominant_group(body, source_index)
                allowance = 0.018 if group in TORSO_GROUPS else 0.011
                position = base_position + normal * allowance
                if group in TORSO_GROUPS:
                    tailored = tailored_torso_position(position, torso_minimum, torso_maximum)
                    position = position.lerp(tailored, 0.28)
                    position.z = max(lower_hem, position.z)
                elif group and group.startswith("clavicle_"):
                    tailored = tailored_torso_position(position, torso_minimum, torso_maximum)
                    position = position.lerp(tailored, 0.14)
                key = tuple(round(value * 100000.0) for value in base_position)
                existing = position_to_new.get(key)
                if existing is None:
                    existing = len(vertices)
                    position_to_new[key] = existing
                    source_indices.append(source_index)
                    vertices.append(tuple(position))
                old_to_new[source_index] = existing
            face.append(old_to_new[source_index])
        if len(set(face)) >= 3:
            faces.append(tuple(face))

    mesh = bpy.data.meshes.new(f"{asset_id}_fitted_shell_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    shell = bpy.data.objects.new(f"{asset_id}_game_shell", mesh)
    bpy.context.collection.objects.link(shell)
    shell.parent = armature
    shell.matrix_parent_inverse = Matrix.Identity(4)
    shell.matrix_world = armature.matrix_world.copy()
    source_to_new = {source_index: new_index for new_index, source_index in enumerate(source_indices)}
    group_names = sorted({
        body.vertex_groups[assignment.group].name
        for source_index in source_indices
        for assignment in body.data.vertices[source_index].groups
        if assignment.weight > 0.0
    })
    groups = {name: shell.vertex_groups.new(name=name) for name in group_names}
    for source_index, new_index in source_to_new.items():
        for assignment in body.data.vertices[source_index].groups:
            if assignment.weight <= 0.0:
                continue
            name = body.vertex_groups[assignment.group].name
            groups[name].add([new_index], assignment.weight, "REPLACE")
    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    smooth = shell.modifiers.new("garment_surface_relax", "LAPLACIANSMOOTH")
    smooth.iterations = 2
    smooth.lambda_factor = 0.035
    smooth.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    armature_modifier = shell.modifiers.new("current_player_rig", "ARMATURE")
    armature_modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.90, island_margin=0.015)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in shell.data.polygons:
        polygon.use_smooth = True
    shell.select_set(False)
    shell["realm_asset_id"] = asset_id
    shell["realm_art_direction"] = "character_geometry_b_materials_c"
    shell["realm_geometry_role"] = "game_ready"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False
    return shell, {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "shellVertices": len(shell.data.vertices),
        "shellPolygons": len(shell.data.polygons),
        "frontOpeningThresholdY": round(front_threshold, 5),
        "frontSurfaceY": round(torso_minimum.y - 0.020, 5),
        "backSurfaceY": round(torso_maximum.y + 0.020, 5),
        "torsoRadiusX": round(torso_half_width + 0.020, 5),
        "torsoRadiusY": round(torso_radius_y + 0.020, 5),
        "lowerHemZ": round(lower_hem, 5),
        "upperLimitZ": round(upper_limit, 5),
        "sleeveLimitX": round(sleeve_limit_x, 5),
        "topology": {
            "source": "welded_player_surface",
            "tailoringBlend": 0.28,
            "smoothingIterations": 2,
        },
    }


class DetailBuilder:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []
        self.weights: list[dict[str, float]] = []

    def vertex(self, point: Vector | tuple[float, float, float], weights: dict[str, float]) -> int:
        index = len(self.vertices)
        self.vertices.append(tuple(point))
        self.weights.append(weights)
        return index

    def face(self, indices: tuple[int, ...], material: int) -> None:
        self.faces.append(indices)
        self.materials.append(material)

    def box(
        self,
        center: tuple[float, float, float],
        size: tuple[float, float, float],
        material: int,
        weights: dict[str, float],
    ) -> None:
        cx, cy, cz = center
        sx, sy, sz = (value * 0.5 for value in size)
        points = [
            (cx + x * sx, cy + y * sy, cz + z * sz)
            for x, y, z in (
                (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1),
            )
        ]
        indices = [self.vertex(point, weights) for point in points]
        for face in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.face(tuple(indices[index] for index in face), material)

    def prism_xz(
        self,
        points: list[tuple[float, float]],
        y: float,
        thickness: float,
        material: int,
        weights: dict[str, float],
    ) -> None:
        front = [self.vertex((x, y - thickness * 0.5, z), weights) for x, z in points]
        back = [self.vertex((x, y + thickness * 0.5, z), weights) for x, z in points]
        self.face(tuple(reversed(front)), material)
        self.face(tuple(back), material)
        for index in range(len(points)):
            following = (index + 1) % len(points)
            self.face((front[index], front[following], back[following], back[index]), material)

    def prism_xyz(
        self,
        points: list[tuple[float, float, float]],
        thickness: float,
        material: int,
        weights: dict[str, float],
    ) -> None:
        front = [self.vertex((x, y - thickness * 0.5, z), weights) for x, y, z in points]
        back = [self.vertex((x, y + thickness * 0.5, z), weights) for x, y, z in points]
        self.face(tuple(reversed(front)), material)
        self.face(tuple(back), material)
        for index in range(len(points)):
            following = (index + 1) % len(points)
            self.face((front[index], front[following], back[following], back[index]), material)

    def ribbon_xz(
        self,
        points: list[tuple[float, float]],
        y: float,
        width: float,
        thickness: float,
        material: int,
        weights: dict[str, float],
    ) -> None:
        if len(points) < 2:
            return
        half_width = width * 0.5
        left: list[tuple[float, float]] = []
        right: list[tuple[float, float]] = []
        for index, point in enumerate(points):
            previous = Vector(points[max(0, index - 1)])
            following = Vector(points[min(len(points) - 1, index + 1)])
            tangent = following - previous
            if tangent.length < 0.00001:
                tangent = Vector((0.0, 1.0))
            tangent.normalize()
            normal = Vector((-tangent.y, tangent.x)) * half_width
            left.append((point[0] + normal.x, point[1] + normal.y))
            right.append((point[0] - normal.x, point[1] - normal.y))
        front_left = [self.vertex((x, y - thickness * 0.5, z), weights) for x, z in left]
        front_right = [self.vertex((x, y - thickness * 0.5, z), weights) for x, z in right]
        back_left = [self.vertex((x, y + thickness * 0.5, z), weights) for x, z in left]
        back_right = [self.vertex((x, y + thickness * 0.5, z), weights) for x, z in right]
        for index in range(len(points) - 1):
            following = index + 1
            self.face((front_left[index], front_right[index], front_right[following], front_left[following]), material)
            self.face((back_right[index], back_left[index], back_left[following], back_right[following]), material)
            self.face((front_left[index], front_left[following], back_left[following], back_left[index]), material)
            self.face((front_right[following], front_right[index], back_right[index], back_right[following]), material)
        self.face((front_left[0], back_left[0], back_right[0], front_right[0]), material)
        self.face((front_right[-1], back_right[-1], back_left[-1], front_left[-1]), material)

    def ellipse_patch_xz(
        self,
        center: tuple[float, float],
        radii: tuple[float, float],
        y: float,
        thickness: float,
        material: int,
        weights: dict[str, float],
        segments: int = 28,
    ) -> list[tuple[float, float]]:
        points = [
            (
                center[0] + cos(2.0 * pi * index / segments) * radii[0],
                center[1] + sin(2.0 * pi * index / segments) * radii[1],
            )
            for index in range(segments)
        ]
        self.prism_xz(points, y, thickness, material, weights)
        return points

    def ellipse_band_z(
        self,
        center: tuple[float, float],
        radii: tuple[float, float],
        z0: float,
        z1: float,
        material: int,
        weights: dict[str, float],
        segments: int = 18,
    ) -> None:
        rings: list[list[int]] = []
        for z in (z0, z1):
            ring = []
            for index in range(segments):
                angle = 2.0 * pi * index / segments
                ring.append(self.vertex((center[0] + cos(angle) * radii[0], center[1] + sin(angle) * radii[1], z), weights))
            rings.append(ring)
        for index in range(segments):
            following = (index + 1) % segments
            self.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)

    def ellipse_arc_band_z(
        self,
        center: tuple[float, float],
        radii: tuple[float, float],
        z0: float,
        z1: float,
        start_angle: float,
        end_angle: float,
        material: int,
        weights: dict[str, float],
        segments: int = 12,
    ) -> None:
        rings: list[list[int]] = []
        for z in (z0, z1):
            ring = []
            for index in range(segments + 1):
                progression = index / segments
                angle = start_angle + (end_angle - start_angle) * progression
                ring.append(self.vertex((center[0] + cos(angle) * radii[0], center[1] + sin(angle) * radii[1], z), weights))
            rings.append(ring)
        for index in range(segments):
            self.face((rings[0][index], rings[0][index + 1], rings[1][index + 1], rings[1][index]), material)

    def shaped_rear_collar(
        self,
        center: tuple[float, float],
        radii: tuple[float, float],
        base_z: float,
        material: int,
        trim_material: int,
        weights: dict[str, float],
        segments: int = 24,
    ) -> None:
        """Build a tapered leather stand collar with a rounded rear crown.

        A constant-height half cylinder ends in two conspicuous vertical spikes.
        This four-sided strip instead dies into the lapel line at both ends and
        rises only behind the neck, matching the construction of the reference.
        """
        sections: list[tuple[int, int, int, int]] = []
        start_angle = 0.20
        end_angle = pi - 0.20
        thickness = 0.006
        for index in range(segments + 1):
            progression = index / segments
            angle = start_angle + (end_angle - start_angle) * progression
            crown = max(0.0, sin(angle)) ** 0.72
            lower_z = base_z + crown * 0.008
            upper_z = base_z + 0.020 + crown * 0.058
            inner = (
                center[0] + cos(angle) * radii[0],
                center[1] + sin(angle) * radii[1],
            )
            outer = (
                center[0] + cos(angle) * (radii[0] + thickness),
                center[1] + sin(angle) * (radii[1] + thickness),
            )
            sections.append((
                self.vertex((inner[0], inner[1], lower_z), weights),
                self.vertex((outer[0], outer[1], lower_z), weights),
                self.vertex((outer[0], outer[1], upper_z), weights),
                self.vertex((inner[0], inner[1], upper_z), weights),
            ))
        for index in range(segments):
            current = sections[index]
            following = sections[index + 1]
            self.face((current[0], following[0], following[3], current[3]), material)
            self.face((current[2], following[2], following[1], current[1]), material)
            self.face((current[1], following[1], following[0], current[0]), material)
            self.face((current[3], following[3], following[2], current[2]), trim_material)
        self.face(tuple(reversed(sections[0])), material)
        self.face(sections[-1], material)

    def ellipse_band_x(
        self,
        x0: float,
        x1: float,
        center_yz: tuple[float, float],
        radii_yz: tuple[float, float],
        material: int,
        weights: dict[str, float],
        segments: int = 14,
    ) -> None:
        rings: list[list[int]] = []
        for x in (x0, x1):
            ring = []
            for index in range(segments):
                angle = 2.0 * pi * index / segments
                ring.append(self.vertex((x, center_yz[0] + cos(angle) * radii_yz[0], center_yz[1] + sin(angle) * radii_yz[1]), weights))
            rings.append(ring)
        for index in range(segments):
            following = (index + 1) % segments
            self.face((rings[0][index], rings[0][following], rings[1][following], rings[1][index]), material)

    def octahedron(
        self,
        center: tuple[float, float, float],
        radius: float,
        material: int,
        weights: dict[str, float],
    ) -> None:
        cx, cy, cz = center
        points = [
            (cx + radius, cy, cz), (cx - radius, cy, cz),
            (cx, cy + radius, cz), (cx, cy - radius, cz),
            (cx, cy, cz + radius), (cx, cy, cz - radius),
        ]
        indices = [self.vertex(point, weights) for point in points]
        for face in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            self.face(tuple(indices[index] for index in face), material)


def build_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
    fit: dict[str, object],
) -> bpy.types.Object:
    torso_minimum = Vector(fit["torsoBounds"]["minimum"])
    torso_maximum = Vector(fit["torsoBounds"]["maximum"])
    chest_half_width = float(fit["torsoRadiusX"])
    chest_radius_y = float(fit["torsoRadiusY"])
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    front_y = float(fit["frontSurfaceY"]) - 0.006
    back_y = float(fit["backSurfaceY"]) + 0.005
    lower_hem = float(fit["lowerHemZ"])
    upper_limit = float(fit["upperLimitZ"])
    garment_height = upper_limit - lower_hem
    builder = DetailBuilder()

    def front_surface_y(x: float, outward: float = 0.0) -> float:
        normalized_x = min(0.995, abs(x) / max(0.001, chest_half_width))
        return center_y - chest_radius_y * sqrt(max(0.0, 1.0 - normalized_x * normalized_x)) - 0.004 - outward

    # Reference-led lapels conform to the curved chest instead of behaving as
    # two flat armour plates.  A slightly larger worn backing creates the edge
    # treatment while the inset panel remains the main tobacco leather.
    lapel_outer = chest_half_width * 0.63
    lapel_inner = max(0.035, chest_half_width * 0.18)
    lapel_point = lower_hem + garment_height * 0.57

    def lapel_surface_y(x: float, z: float, offset: float = 0.0) -> float:
        vertical = max(0.0, min(1.0, (z - lapel_point) / max(0.001, upper_limit - lapel_point)))
        innerness = max(0.0, 1.0 - abs(x) / max(0.001, lapel_outer))
        fold_lift = 0.005 + 0.011 * vertical * (0.42 + innerness * 0.58)
        return front_surface_y(x, fold_lift) + offset

    for direction in (-1.0, 1.0):
        lapel_weights = {"spine_02": 0.34, "spine_03": 0.66}
        outline_xz = [
            (direction * (lapel_inner * 1.06), upper_limit - garment_height * 0.055),
            (direction * (lapel_outer * 0.72), upper_limit - garment_height * 0.075),
            (direction * lapel_outer, upper_limit - garment_height * 0.185),
            (direction * (lapel_outer * 0.60), lapel_point + garment_height * 0.055),
            (direction * max(0.024, lapel_inner * 0.70), lapel_point),
        ]
        outline = [(x, lapel_surface_y(x, z), z) for x, z in outline_xz]
        builder.prism_xyz(outline, 0.0050, 0, lapel_weights)
        lining_xz = [
            (direction * lapel_inner * 0.50, upper_limit - garment_height * 0.070),
            (direction * lapel_inner * 0.88, upper_limit - garment_height * 0.068),
            (direction * lapel_inner * 0.60, lapel_point + 0.022),
            (direction * lapel_inner * 0.34, lapel_point + 0.015),
        ]
        lining = [(x, lapel_surface_y(x, z, 0.002), z) for x, z in lining_xz]
        builder.prism_xyz(lining, 0.004, 2, lapel_weights)

    # Raised rear stand collar, shaped around the actual upper torso.  Its ends
    # taper into the lapels instead of forming the vertical spikes produced by a
    # constant-height half-cylinder.
    collar_radius_x = min(0.118, chest_half_width * 0.53)
    collar_radius_y = min(0.082, chest_radius_y * 0.58)
    builder.shaped_rear_collar(
        (0.0, center_y),
        (collar_radius_x, collar_radius_y),
        upper_limit - 0.062,
        0,
        1,
        {"spine_03": 0.80, "neck_01": 0.20},
        24,
    )

    # Shoulder yokes and panel seams explain how the garment is assembled.
    yoke_z = upper_limit - garment_height * 0.19
    builder.ellipse_arc_band_z(
        (0.0, center_y),
        (chest_half_width + 0.004, chest_radius_y + 0.008),
        yoke_z - 0.004,
        yoke_z + 0.004,
        0.10,
        pi - 0.10,
        1,
        {"spine_03": 0.86, "spine_02": 0.14},
        28,
    )
    builder.ribbon_xz(
        [(0.0, lower_hem + 0.028), (0.0, yoke_z - 0.006)],
        back_y,
        0.007,
        0.004,
        1,
        {"spine_01": 0.24, "spine_02": 0.46, "spine_03": 0.30},
    )
    for direction in (-1.0, 1.0):
        seam_x = direction * chest_half_width * 0.54
        builder.ribbon_xz(
            [
                (seam_x * 0.88, lower_hem + 0.030),
                (seam_x, lower_hem + garment_height * 0.34),
                (seam_x * 0.86, lapel_point + garment_height * 0.055),
            ],
            front_surface_y(seam_x, 0.004),
            0.006,
            0.004,
            1,
            {"spine_01": 0.28, "spine_02": 0.50, "spine_03": 0.22},
        )

    # Closed lower front with individually readable zipper teeth and pull.
    zipper_top = lapel_point + 0.012
    zipper_bottom = lower_hem + 0.034
    zipper_middle = (zipper_bottom + zipper_top) * 0.5
    builder.box((-0.008, front_y - 0.009, zipper_middle), (0.010, 0.008, zipper_top - zipper_bottom), 1, {"spine_02": 0.48, "spine_01": 0.52})
    builder.box((0.008, front_y - 0.009, zipper_middle), (0.010, 0.008, zipper_top - zipper_bottom), 1, {"spine_02": 0.48, "spine_01": 0.52})
    # Twenty teeth remain legible at 112 px; denser geometry aliases into a
    # solid bar while spending vertices that are better kept in the silhouette.
    tooth_count = 20
    for index in range(tooth_count):
        progression = index / max(1, tooth_count - 1)
        z = zipper_bottom + (zipper_top - zipper_bottom) * progression
        weights = torso_weights(z)
        for direction in (-1.0, 1.0):
            builder.box((direction * 0.0065, front_y - 0.017, z), (0.005, 0.005, 0.005), 3, weights)
    builder.box((0.012, front_y - 0.022, zipper_top - 0.021), (0.021, 0.007, 0.030), 3, {"spine_02": 0.28, "spine_03": 0.72})
    builder.box((0.012, front_y - 0.024, zipper_top - 0.040), (0.012, 0.006, 0.020), 3, {"spine_02": 0.35, "spine_03": 0.65})

    # Integrated belt follows the jacket waist and uses a centered steel buckle.
    belt_z0 = lower_hem + 0.060
    belt_z1 = belt_z0 + 0.045
    waist_points = [
        point
        for point in group_points(body, armature, TORSO_GROUPS)
        if belt_z0 - 0.030 <= point.z <= belt_z1 + 0.030
    ]
    waist_minimum, waist_maximum = bounds(waist_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    measured_waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.020,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.022,
    )
    # The authored torso intentionally carries a leather allowance beyond the
    # naked body.  Keep belt and hem outside that shell rather than letting the
    # body-derived waist measurement bury them inside it.
    waist_radii = (
        max(measured_waist_radii[0], chest_half_width * 0.955 + 0.006),
        max(measured_waist_radii[1], chest_radius_y * 0.955 + 0.006),
    )
    builder.ellipse_band_z(
        (0.0, waist_center_y),
        (waist_radii[0] + 0.002, waist_radii[1] + 0.002),
        lower_hem,
        lower_hem + 0.026,
        1,
        torso_weights(lower_hem + 0.013),
        28,
    )
    builder.ellipse_band_z((0.0, waist_center_y), waist_radii, belt_z0, belt_z1, 0, torso_weights((belt_z0 + belt_z1) * 0.5), 32)
    builder.ellipse_band_z((0.0, waist_center_y), (waist_radii[0] + 0.002, waist_radii[1] + 0.002), belt_z0, belt_z0 + 0.006, 1, torso_weights(belt_z0 + 0.003), 32)
    buckle_x = 0.0
    buckle_y = front_y - 0.031
    buckle_z = (belt_z0 + belt_z1) * 0.5
    for offset_x, offset_z, size in (
        (-0.026, 0.0, (0.008, 0.010, 0.061)),
        (0.026, 0.0, (0.008, 0.010, 0.061)),
        (0.0, -0.027, (0.060, 0.010, 0.008)),
        (0.0, 0.027, (0.060, 0.010, 0.008)),
    ):
        builder.box((buckle_x + offset_x, buckle_y, buckle_z + offset_z), size, 3, torso_weights(buckle_z))
    builder.box((0.004, buckle_y - 0.005, buckle_z), (0.045, 0.006, 0.006), 3, torso_weights(buckle_z))
    for x in (-chest_half_width * 0.56, chest_half_width * 0.56):
        builder.box((x, front_surface_y(x, 0.014), buckle_z), (0.016, 0.009, 0.061), 0, torso_weights(buckle_z))
    builder.box((0.0, back_y + 0.014, buckle_z), (0.018, 0.009, 0.061), 0, torso_weights(buckle_z))

    # Body-measured cuffs, armhole welts and rear-facing elbow patches.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        points = group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
        minimum, maximum = bounds(points)
        maximum_distance = max(abs(minimum.x), abs(maximum.x))
        cuff_x = maximum_distance - 0.034
        center_arm_y, center_arm_z, radius_y, radius_z = measured_arm_profile(points, cuff_x)
        x0, x1 = sorted((direction * (cuff_x - 0.030), direction * cuff_x))
        builder.ellipse_band_x(x0, x1, (center_arm_y, center_arm_z), (radius_y + 0.017, radius_z + 0.017), 1, {f"lowerarm_{side}": 1.0}, 18)

        shoulder_x = chest_half_width * 0.64
        shoulder_y, shoulder_z, shoulder_radius_y, shoulder_radius_z = measured_arm_profile(points, shoulder_x)
        elbow_x = shoulder_x + (maximum_distance - shoulder_x) * 0.56
        elbow_y, elbow_z, elbow_radius_y, _ = measured_arm_profile(points, elbow_x)
        patch_y = elbow_y + elbow_radius_y + 0.010
        patch_weights = {f"upperarm_{side}": 0.32, f"lowerarm_{side}": 0.68}
        patch_points = builder.ellipse_patch_xz(
            (direction * elbow_x, elbow_z),
            (0.076, 0.041),
            patch_y,
            0.003,
            1,
            patch_weights,
            24,
        )
        inset = [
            (
                direction * elbow_x + (point[0] - direction * elbow_x) * 0.84,
                elbow_z + (point[1] - elbow_z) * 0.82,
            )
            for point in patch_points
        ]
        inset.append(inset[0])
        builder.ribbon_xz(inset, patch_y - 0.003, 0.0035, 0.002, 1, patch_weights)

        tab_x = direction * chest_half_width * 0.82
        builder.octahedron((tab_x, front_surface_y(tab_x, 0.007), upper_limit - garment_height * 0.16), 0.006, 3, {f"clavicle_{side}": 0.72, f"upperarm_{side}": 0.28})
    for direction in (-1.0, 1.0):
        rivet_x = direction * lapel_outer * 0.78
        builder.octahedron((rivet_x, front_surface_y(rivet_x, 0.010), lapel_point + garment_height * 0.12), 0.006, 3, {"spine_02": 0.34, "spine_03": 0.66})

    mesh = bpy.data.meshes.new(f"{asset_id}_details_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    details = bpy.data.objects.new(f"{asset_id}_details", mesh)
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
    bpy.ops.uv.smart_project(angle_limit=0.85, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bevel = details.modifiers.new("game_ready_detail_bevel", "BEVEL")
    bevel.width = 0.0012
    bevel.segments = 1
    bevel.limit_method = "ANGLE"
    while details.modifiers.find(bevel.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=bevel.name)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for polygon in details.data.polygons:
        polygon.use_smooth = polygon.material_index != 3
    details.select_set(False)
    details["realm_asset_id"] = asset_id
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_geometry_role"] = "game_ready"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details


def build_highpoly_sources(
    jacket_objects: list[bpy.types.Object],
) -> tuple[list[bpy.types.Object], dict[str, object]]:
    collection = bpy.data.collections.new("JACKET_V2_HIGH_POLY_SOURCE")
    bpy.context.scene.collection.children.link(collection)
    high_objects: list[bpy.types.Object] = []
    for source in jacket_objects:
        high = source.copy()
        high.data = source.data.copy()
        high.name = source.name.replace("game_", "highpoly_")
        collection.objects.link(high)
        for modifier in list(high.modifiers):
            high.modifiers.remove(modifier)
        bpy.context.view_layer.objects.active = high
        high.select_set(True)
        if "shell" in source.name:
            subdivision = high.modifiers.new("highpoly_surface_refinement", "SUBSURF")
            subdivision.subdivision_type = "CATMULL_CLARK"
            subdivision.levels = 2
            subdivision.render_levels = 2
            bpy.ops.object.modifier_apply(modifier=subdivision.name)
            grain = bpy.data.textures.new(f"{high.name}_leather_microrelief", type="CLOUDS")
            grain.noise_scale = 0.032
            grain.noise_depth = 2
            displacement = high.modifiers.new("authored_leather_microrelief", "DISPLACE")
            displacement.texture = grain
            displacement.texture_coords = "GLOBAL"
            displacement.strength = 0.0016
            displacement.mid_level = 0.52
            bpy.ops.object.modifier_apply(modifier=displacement.name)
            thickness = high.modifiers.new("highpoly_leather_thickness", "SOLIDIFY")
            thickness.thickness = 0.0045
            thickness.offset = -0.18
            thickness.use_rim = True
            bpy.ops.object.modifier_apply(modifier=thickness.name)
            bevel = high.modifiers.new("highpoly_soft_edge", "BEVEL")
            bevel.width = 0.0014
            bevel.segments = 2
            bpy.ops.object.modifier_apply(modifier=bevel.name)
        else:
            bevel = high.modifiers.new("highpoly_detail_bevel", "BEVEL")
            bevel.width = 0.0012
            bevel.segments = 3
            bpy.ops.object.modifier_apply(modifier=bevel.name)
        for polygon in high.data.polygons:
            polygon.use_smooth = True
        high["realm_geometry_role"] = "high_poly_source"
        high["realm_export_to_runtime"] = False
        high.hide_render = True
        high.hide_viewport = True
        high.select_set(False)
        high_objects.append(high)
    return high_objects, {
        "objects": len(high_objects),
        "vertices": sum(len(obj.data.vertices) for obj in high_objects),
        "polygons": sum(len(obj.data.polygons) for obj in high_objects),
        "construction": "subdivision plus leather thickness, softened edges and applied microrelief displacement",
    }


def neutralize_reference_character(
    reference_objects: list[bpy.types.Object],
    body: bpy.types.Object,
) -> None:
    mannequin = bpy.data.materials.new("jacket_v2_review_mannequin")
    mannequin.use_nodes = True
    bsdf = mannequin.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.030, 0.034, 0.036, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.88
    for obj in reference_objects:
        if obj.type != "MESH":
            continue
        if obj == body:
            obj.data.materials.clear()
            obj.data.materials.append(mannequin)
        else:
            obj.hide_render = True


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def pose_review(armature: bpy.types.Object) -> list[bpy.types.Object]:
    # Use a restrained A-pose made only from the existing upper-arm joints.  It
    # keeps the full sleeves inside the review frame and avoids the severe
    # shoulder inflation produced by an unconstrained three-bone IK solve.
    armature.data.pose_position = "POSE"
    helpers: list[bpy.types.Object] = []
    for side, direction in (("l", 1.0), ("r", -1.0)):
        upperarm = armature.pose.bones.get(f"upperarm_{side}")
        if upperarm is None:
            continue
        upperarm.rotation_mode = "XYZ"
        upperarm.rotation_euler.z = -direction * 0.43
    bpy.context.view_layer.update()
    return helpers


def pose_deformation_review(armature: bpy.types.Object) -> list[bpy.types.Object]:
    armature.data.pose_position = "POSE"
    helpers: list[bpy.types.Object] = []
    # Deterministic shoulder lowering plus opposing elbow bends.  Direct joint
    # rotations exercise the same skinning channels as gameplay without letting
    # a generic IK chain pull clavicles through the torso.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        upperarm = armature.pose.bones.get(f"upperarm_{side}")
        lowerarm = armature.pose.bones.get(f"lowerarm_{side}")
        if upperarm is not None:
            upperarm.rotation_mode = "XYZ"
            upperarm.rotation_euler.z = -direction * 0.48
        if lowerarm is not None:
            lowerarm.rotation_mode = "XYZ"
            lowerarm.rotation_euler.z = direction * 1.02
    bpy.context.view_layer.update()
    return helpers


def reset_pose(armature: bpy.types.Object, helpers: list[bpy.types.Object]) -> None:
    for pose_bone in armature.pose.bones:
        for constraint in list(pose_bone.constraints):
            if constraint.name == "jacket_review_natural_arm":
                pose_bone.constraints.remove(constraint)
        pose_bone.matrix_basis.identity()
    for helper in helpers:
        bpy.data.objects.remove(helper, do_unlink=True)
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()


def set_review_action(armature: bpy.types.Object, action_name: str | None, frame: int = 0) -> None:
    armature.animation_data_create()
    for track in armature.animation_data.nla_tracks:
        track.mute = True
    action = bpy.data.actions.get(action_name) if action_name else None
    if action_name and action is None:
        raise RuntimeError(f"Current player reference is missing required action: {action_name}")
    armature.animation_data.action = action
    armature.data.pose_position = "POSE" if action else "REST"
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def render_review(
    armature: bpy.types.Object,
    jacket_objects: list[bpy.types.Object],
    output: Path,
    camera_location: tuple[float, float, float],
    target: tuple[float, float, float],
    ortho_scale: float,
    resolution: tuple[int, int] = (1024, 1024),
    night: bool = False,
    wireframe: bool = False,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("jacket_review_world")
    scene.world.color = (0.009, 0.014, 0.026) if night else (0.035, 0.038, 0.036)

    for obj in [obj for obj in list(scene.objects) if obj.name.startswith("jacket_review_light") or obj.name == "jacket_review_camera" or obj.name == "jacket_review_floor"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, -0.02))
    floor = bpy.context.object
    floor.name = "jacket_review_floor"
    floor_material = bpy.data.materials.get("jacket_review_floor_material") or bpy.data.materials.new("jacket_review_floor_material")
    floor_material.use_nodes = True
    floor_bsdf = floor_material.node_tree.nodes.get("Principled BSDF")
    floor_bsdf.inputs["Base Color"].default_value = (0.075, 0.085, 0.078, 1.0)
    floor_bsdf.inputs["Roughness"].default_value = 0.93
    floor.data.materials.append(floor_material)

    lights = (
        (
            ("jacket_review_light_key", (-2.6, -3.4, 4.5), 760, (0.58, 0.72, 1.0), 3.0),
            ("jacket_review_light_fill", (3.1, -1.0, 3.2), 360, (0.30, 0.42, 0.68), 3.4),
            ("jacket_review_light_rim", (0.0, 3.2, 3.5), 650, (0.86, 0.60, 0.33), 2.4),
        )
        if night
        else (
            ("jacket_review_light_key", (-2.6, -3.4, 4.5), 1120, (1.0, 0.80, 0.62), 3.0),
            ("jacket_review_light_fill", (3.1, -1.0, 3.2), 810, (0.60, 0.74, 0.88), 3.4),
            ("jacket_review_light_rim", (0.0, 3.2, 3.5), 940, (0.92, 0.75, 0.54), 2.4),
        )
    )
    for name, location, energy, color, size in lights:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, Vector(target))
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "jacket_review_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.data.lens = 58
    look_at(camera, Vector(target))
    scene.camera = camera
    wire_objects: list[bpy.types.Object] = []
    if wireframe:
        wire_material = bpy.data.materials.get("jacket_v2_wire_material") or bpy.data.materials.new("jacket_v2_wire_material")
        wire_material.use_nodes = True
        wire_bsdf = wire_material.node_tree.nodes.get("Principled BSDF")
        wire_bsdf.inputs["Base Color"].default_value = (0.005, 0.008, 0.007, 1.0)
        wire_bsdf.inputs["Roughness"].default_value = 1.0
        for source in jacket_objects:
            duplicate = source.copy()
            duplicate.data = source.data.copy()
            duplicate.name = f"{source.name}_review_wire"
            bpy.context.collection.objects.link(duplicate)
            duplicate.data.materials.clear()
            duplicate.data.materials.append(wire_material)
            modifier = duplicate.modifiers.new("review_wireframe", "WIREFRAME")
            modifier.thickness = 0.0009
            modifier.use_replace = True
            modifier.use_even_offset = True
            wire_objects.append(duplicate)
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output.resolve())
    bpy.ops.render.render(write_still=True)
    for obj in wire_objects:
        bpy.data.objects.remove(obj, do_unlink=True)


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
    jacket_objects: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in jacket_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = jacket_objects[0]
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
    clear_scene()
    reference_objects = import_glb(args.reference_character)
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

    materials = {
        "leather": pbr_material("jacket_v2_dark_tobacco_leather", (0.096, 0.037, 0.016), 0.82, 0.0, args.body_id, 0.34),
        "trim": pbr_material("jacket_v2_worn_edge_leather", (0.145, 0.057, 0.023), 0.86, 0.0, args.body_id, 0.28),
        "lining": pbr_material("jacket_v2_charcoal_lining", (0.036, 0.028, 0.024), 0.92, 0.0, args.body_id, 0.12),
        "metal": pbr_material("jacket_v2_dull_gunmetal", (0.185, 0.195, 0.180), 0.58, 0.74, args.body_id, 0.16),
    }
    shell, fit = build_shell(body, armature, args.asset_id)
    details = build_details(body, armature, args.asset_id, fit)
    jacket_objects = [shell, details]
    material_order = (materials["leather"], materials["trim"], materials["lining"], materials["metal"])
    for obj in jacket_objects:
        for material in material_order:
            obj.data.materials.append(material)
    highpoly_objects, highpoly_stats = build_highpoly_sources(jacket_objects)
    neutralize_reference_character(reference_objects, body)

    helpers = pose_review(armature)
    if args.front_render:
        render_review(armature, jacket_objects, args.front_render, (0.0, -4.0, 1.36), (0.0, 0.0, 1.30), 1.28)
    if args.back_render:
        render_review(armature, jacket_objects, args.back_render, (0.0, 4.0, 1.36), (0.0, 0.0, 1.30), 1.28)
    if args.side_render:
        render_review(armature, jacket_objects, args.side_render, (4.0, 0.0, 1.36), (0.0, 0.0, 1.30), 1.28)
    if args.three_quarter_render:
        render_review(armature, jacket_objects, args.three_quarter_render, (2.85, -3.35, 1.72), (0.0, 0.0, 1.29), 1.34)
    if args.isometric_render:
        render_review(armature, jacket_objects, args.isometric_render, (2.75, -3.30, 2.55), (0.0, 0.0, 1.24), 1.40)
    if args.night_render:
        render_review(armature, jacket_objects, args.night_render, (2.75, -3.30, 2.55), (0.0, 0.0, 1.24), 1.40, night=True)
    if args.wireframe_render:
        render_review(armature, jacket_objects, args.wireframe_render, (2.85, -3.35, 1.72), (0.0, 0.0, 1.29), 1.34, wireframe=True)
    if args.native_render:
        render_review(armature, jacket_objects, args.native_render, (2.75, -3.30, 2.55), (0.0, 0.0, 1.24), 1.40, resolution=(112, 112))
    if args.detail_render:
        render_review(armature, jacket_objects, args.detail_render, (1.15, -3.6, 1.53), (0.0, -0.02, 1.39), 0.78)

    reset_pose(armature, helpers)
    if args.deformation_render:
        deformation_helpers = pose_deformation_review(armature)
        render_review(armature, jacket_objects, args.deformation_render, (2.85, -3.35, 1.72), (0.0, 0.0, 1.30), 1.38)
        reset_pose(armature, deformation_helpers)

    action_reviews = (
        ("idle", 19, args.idle_render),
        ("walk", 10, args.walk_render),
        ("run", 6, args.run_render),
    )
    for action_name, frame, output in action_reviews:
        if not output:
            continue
        set_review_action(armature, action_name, frame)
        render_review(armature, jacket_objects, output, (2.85, -3.35, 1.72), (0.0, 0.0, 1.26), 1.48)
    set_review_action(armature, None, 0)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    for obj in list(reference_objects):
        if obj != armature and obj not in (shell, details) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, shell, details)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    export_candidate(args.output, armature, [shell, details])
    actual = parse_exported_glb(args.output)
    report = {
        "assetId": args.asset_id,
        "bodyId": args.body_id,
        "file": args.output.name,
        "bytes": args.output.stat().st_size,
        "actualGlb": actual,
        "highPolySource": highpoly_stats,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "animationReview": {
            "idle": {"action": "idle", "frame": 19, "rendered": bool(args.idle_render)},
            "walk": {"action": "walk", "frame": 10, "rendered": bool(args.walk_render)},
            "run": {"action": "run", "frame": 6, "rendered": bool(args.run_render)},
            "raisedArmsAndElbowBend": {"rendered": bool(args.deformation_render)},
        },
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "reference": "docs/art/references/leather-jacket-bc-reference-v1.png",
            "rebuild": "Reference-led original v2 jacket with an authored open-front torso, measured sleeves, panel seams, lapels, stand collar, centered belt, zipper, cuffs and elbow reinforcements on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_LEATHER_JACKET_V2=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
