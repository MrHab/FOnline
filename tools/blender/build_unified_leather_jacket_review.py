"""Build the B+C leather-jacket review asset for the current player rig.

The jacket starts from each shipped body so it keeps the exact 65-bone skin,
then its torso is reshaped into a deliberately tailored outer layer.  The
authored lapels, belt, armhole seams, hardware, cuffs and repairs provide the
readable wasteland silhouette without tracing the character's anatomy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import atan2, cos, pi, sin
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
    parser.add_argument("--asset-id", default="equipment_leather_jacket_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
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
    size: int = 384,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-leather-jacket-v1:{seed}:{name}:{kind}")
    pixels: list[float] = []
    scratches = [
        (
            rng.randrange(18, size - 18),
            rng.randrange(18, size - 18),
            rng.randrange(7, 34),
            rng.choice((-1, 1)),
        )
        for _ in range(42)
    ]
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.043 + y * 0.017) * 0.55 + sin(y * 0.071 - x * 0.013) * 0.28
            grain = sin(x * 0.91 + sin(y * 0.13) * 2.0) * 0.22
            noise = (rng.random() - 0.5) * 0.16
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
                variation = broad * 0.012 + grain * 0.008 + noise * 0.006
                values = tuple(
                    max(0.018, min(0.92, component * (1.0 + variation) + scuff * 0.015))
                    for component in base
                )
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(0.30, min(0.98, base[0] + broad * 0.012 + noise * 0.006 - scuff * 0.025))
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend((0.5 + grain * 0.004, 0.5 + broad * 0.003, 1.0, 1.0))
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
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = texture_image(f"{name}_albedo", base, "albedo", seed)
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = texture_image(f"{name}_roughness", (roughness,) * 3, "roughness", seed)
    rough.image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), "normal", seed)
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


def build_trousers(
    builder,
    body: bpy.types.Object,
    armature: bpy.types.Object,
    cloth_material: int,
    knee_material: int,
    accent_material: int,
    style: str = "leather",
) -> dict[str, object]:
    """Штаны, снятые с мерок тела: пояс, юбка таза и трубы бёдер и голеней.

    Броня корпуса не должна оставлять ноги голыми, и у каждой брони штаны
    свои: кожанка получает тёмные наколенники и заклёпки по внешнему шву,
    металл — наваренный лист на колене, бронежилет — накладной карман на
    бедре. Каждая полоса взвешена на кости бедра и голени, поэтому штанина
    сгибается в колене вместе с телом на всех шести телосложениях.
    """
    pelvis_points = group_points(body, armature, {"pelvis", "thigh_l", "thigh_r"})
    upper = [point for point in pelvis_points if 0.88 <= point.z <= 1.06]
    pelvis_minimum, pelvis_maximum = bounds(upper or pelvis_points)
    pelvis_center = (
        (pelvis_minimum.x + pelvis_maximum.x) * 0.5,
        (pelvis_minimum.y + pelvis_maximum.y) * 0.5,
    )
    pelvis_radii = (
        (pelvis_maximum.x - pelvis_minimum.x) * 0.5 + 0.024,
        (pelvis_maximum.y - pelvis_minimum.y) * 0.5 + 0.024,
    )
    # Пояс с ремнём и юбка таза до развилки ног.
    builder.ellipse_band_z(pelvis_center, pelvis_radii, 0.985, 1.030, cloth_material, {"pelvis": 1.0}, 20)
    builder.ellipse_band_z(
        pelvis_center,
        (pelvis_radii[0] + 0.007, pelvis_radii[1] + 0.007),
        1.010, 1.032,
        accent_material,
        {"pelvis": 1.0},
        20,
    )
    builder.ellipse_band_z(
        pelvis_center, pelvis_radii, 0.900, 0.988, cloth_material,
        {"pelvis": 0.72, "thigh_l": 0.14, "thigh_r": 0.14}, 20,
    )

    bands = 3
    for side in ("l", "r"):
        leg_points = group_points(body, armature, {f"thigh_{side}", f"calf_{side}"})

        def slice_band(z0, z1, material, weights, clearance=0.020, segments=16):
            points = [point for point in leg_points if z0 - 0.02 <= point.z <= z1 + 0.02]
            if not points:
                return None
            slice_minimum, slice_maximum = bounds(points)
            center = (
                (slice_minimum.x + slice_maximum.x) * 0.5,
                (slice_minimum.y + slice_maximum.y) * 0.5,
            )
            radii = (
                (slice_maximum.x - slice_minimum.x) * 0.5 + clearance,
                (slice_maximum.y - slice_minimum.y) * 0.5 + clearance,
            )
            builder.ellipse_band_z(center, radii, z0, z1, material, weights, segments)
            return center, radii

        # Бедро тремя сегментами, чтобы труба следовала сужению ноги.
        for z0, z1 in ((0.800, 0.905), (0.680, 0.800), (0.565, 0.680)):
            slice_band(z0, z1, cloth_material, {f"thigh_{side}": 1.0})
        knee = slice_band(0.500, 0.565, cloth_material, {f"thigh_{side}": 0.55, f"calf_{side}": 0.45})
        slice_band(0.360, 0.500, cloth_material, {f"thigh_{side}": 0.18, f"calf_{side}": 0.82})
        slice_band(0.240, 0.360, cloth_material, {f"calf_{side}": 1.0}, clearance=0.018)

        if knee is None:
            continue
        knee_center, knee_radii = knee
        knee_weights = {f"thigh_{side}": 0.55, f"calf_{side}": 0.45}
        if style == "metal":
            # Наваренный лист на колене и заклёпка по центру.
            builder.ellipse_arc_band_z(
                (knee_center[0], knee_center[1] - 0.004),
                (knee_radii[0] + 0.012, knee_radii[1] + 0.012),
                0.505, 0.585, -2.35, -0.79,
                knee_material, knee_weights, 10,
            )
            builder.octahedron(
                (knee_center[0], knee_center[1] - knee_radii[1] - 0.016, 0.548),
                0.0095, accent_material, knee_weights,
            )
        elif style == "vest":
            # Накладной карман на бедре с клапаном из стропы.
            builder.box(
                (knee_center[0], knee_center[1] - knee_radii[1] - 0.014, 0.740),
                (0.088, 0.022, 0.108), knee_material, {f"thigh_{side}": 1.0},
            )
            builder.box(
                (knee_center[0], knee_center[1] - knee_radii[1] - 0.023, 0.778),
                (0.092, 0.011, 0.028), accent_material, {f"thigh_{side}": 1.0},
            )
        else:
            # Кожанка: тёмная накладка на колене и заклёпки по внешнему шву.
            builder.ellipse_arc_band_z(
                (knee_center[0], knee_center[1]),
                (knee_radii[0] + 0.009, knee_radii[1] + 0.009),
                0.510, 0.578, -2.30, -0.85,
                knee_material, knee_weights, 9,
            )
            seam_x = knee_center[0] + (knee_radii[0] if side == "l" else -knee_radii[0])
            for z in (0.620, 0.720, 0.820):
                builder.octahedron(
                    (seam_x, knee_center[1], z), 0.0078,
                    accent_material, {f"thigh_{side}": 1.0},
                )
    return {"trouserBandsPerLeg": bands + 3, "trouserStyle": style}


def build_shell(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    torso_points = group_points(body, armature, TORSO_GROUPS)
    torso_minimum, torso_maximum = bounds(torso_points)
    world_to_armature = armature.matrix_world.inverted()
    normal_transform = world_to_armature.to_3x3() @ body.matrix_world.to_3x3()
    old_to_new: dict[int, int] = {}
    position_to_new: dict[tuple[int, int, int], int] = {}
    source_indices: list[int] = []
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    front_threshold = torso_minimum.y + (torso_maximum.y - torso_minimum.y) * 0.43
    lower_hem = max(0.94, torso_minimum.z + 0.20)
    upper_limit = min(1.555, torso_maximum.z - 0.005)
    torso_half_width = max(abs(torso_minimum.x), abs(torso_maximum.x))
    lowerarm_points = group_points(body, armature, {"lowerarm_l", "lowerarm_r"})
    sleeve_limit_x = max(abs(point.x) for point in lowerarm_points) - 0.055

    for polygon in body.data.polygons:
        center = world_to_armature @ body.matrix_world @ polygon.center
        dominant = [dominant_group(body, vertex_index) for vertex_index in polygon.vertices]
        torso_votes = sum(group in TORSO_GROUPS for group in dominant)
        arm_votes = sum(group in ARM_GROUPS for group in dominant)
        clavicle_votes = sum(group in {"clavicle_l", "clavicle_r"} for group in dominant)
        hand_votes = sum(
            group is not None
            and group.startswith(("hand_", "index_", "middle_", "pinky_", "ring_", "thumb_"))
            for group in dominant
        )
        is_torso = (
            lower_hem <= center.z <= upper_limit
            and abs(center.x) <= torso_half_width + 0.075
            and torso_votes + clavicle_votes >= 1
        )
        # Use a continuous spatial sleeve cut.  Dominant bone labels change
        # abruptly around the deltoid and elbow, which otherwise punches holes
        # into a sleeve as soon as the arm leaves the rest T-pose.
        is_arm = (
            0.135 <= abs(center.x) <= sleeve_limit_x
            and 1.265 <= center.z <= 1.625
            and hand_votes == 0
        )
        is_clavicle = clavicle_votes > 0 and 1.335 <= center.z <= 1.545
        if not (is_torso or is_arm or is_clavicle):
            continue
        face: list[int] = []
        for source_index in polygon.vertices:
            if source_index not in old_to_new:
                source_vertex = body.data.vertices[source_index]
                base_position = world_to_armature @ body.matrix_world @ source_vertex.co
                normal = (normal_transform @ source_vertex.normal).normalized()
                group = dominant_group(body, source_index)
                allowance = 0.019 if group in TORSO_GROUPS else 0.009
                position = base_position + normal * allowance
                if group in TORSO_GROUPS or (group and group.startswith("clavicle_")):
                    position = tailored_torso_position(position, torso_minimum, torso_maximum)
                # Imported GLBs intentionally split vertices along UV and
                # normal seams.  Reuse coincident points here; otherwise the
                # smoothing and thickness modifiers treat every triangle as a
                # separate leather scale and expose the body between them.
                key = tuple(round(value * 100000.0) for value in base_position)
                existing = position_to_new.get(key)
                if existing is None:
                    existing = len(vertices)
                    position_to_new[key] = existing
                    source_indices.append(source_index)
                    vertices.append(tuple(position))
                old_to_new[source_index] = existing
            face.append(old_to_new[source_index])
        faces.append(tuple(face))

    mesh = bpy.data.meshes.new(f"{asset_id}_shell_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    shell = bpy.data.objects.new(f"{asset_id}_shell", mesh)
    bpy.context.collection.objects.link(shell)
    shell.parent = armature
    shell.matrix_parent_inverse = Matrix.Identity(4)
    shell.matrix_world = armature.matrix_world.copy()

    source_to_new = {source_index: new_index for new_index, source_index in enumerate(source_indices)}
    required_groups = sorted(
        {
            body.vertex_groups[assignment.group].name
            for source_index in source_indices
            for assignment in body.data.vertices[source_index].groups
            if assignment.weight > 0.0
        }
    )
    vertex_groups = {name: shell.vertex_groups.new(name=name) for name in required_groups}
    for source_index, new_index in source_to_new.items():
        for assignment in body.data.vertices[source_index].groups:
            name = body.vertex_groups[assignment.group].name
            if assignment.weight > 0.0:
                vertex_groups[name].add([new_index], assignment.weight, "REPLACE")

    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    smooth = shell.modifiers.new("softened_tailoring_volume", "LAPLACIANSMOOTH")
    smooth.iterations = 3
    smooth.lambda_factor = 0.055
    smooth.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    solidify = shell.modifiers.new("leather_thickness", "SOLIDIFY")
    solidify.thickness = 0.0045
    solidify.offset = -0.15
    solidify.use_rim = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    armature_modifier = shell.modifiers.new("current_player_rig", "ARMATURE")
    armature_modifier.object = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.92, island_margin=0.016)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in shell.data.polygons:
        polygon.use_smooth = True
    shell.select_set(False)
    shell["realm_asset_id"] = asset_id
    shell["realm_art_direction"] = "character_geometry_b_materials_c"
    shell["realm_review_only"] = True
    shell["realm_runtime_integration_allowed"] = False

    return shell, {
        "torsoBounds": {
            "minimum": [round(value, 5) for value in torso_minimum],
            "maximum": [round(value, 5) for value in torso_maximum],
        },
        "shellVertices": len(mesh.vertices),
        "shellPolygons": len(mesh.polygons),
        "frontOpeningThresholdY": round(front_threshold, 5),
        "lowerHemZ": round(lower_hem, 5),
        "upperLimitZ": round(upper_limit, 5),
        "sleeveLimitX": round(sleeve_limit_x, 5),
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
    chest_half_width = max(abs(torso_minimum.x), abs(torso_maximum.x)) + 0.010
    chest_radius_y = (torso_maximum.y - torso_minimum.y) * 0.5 + 0.017
    center_y = (torso_minimum.y + torso_maximum.y) * 0.5
    front_y = center_y - (chest_radius_y + 0.055)
    back_y = torso_maximum.y + 0.014
    lower_hem = float(fit["lowerHemZ"])
    upper_limit = float(fit["upperLimitZ"])
    builder = DetailBuilder()

    # Broad lapels make the jacket readable at the game's isometric camera.
    lapel_outer = min(chest_half_width * 0.70, 0.148)
    lapel_inner = max(0.044, chest_half_width * 0.20)
    lapel_point = max(lower_hem + 0.145, 1.235)
    for direction in (-1.0, 1.0):
        points = [
            (direction * (lapel_outer * 0.78), upper_limit - 0.025),
            (direction * (lapel_inner + 0.010), upper_limit - 0.065),
            (direction * max(0.028, lapel_inner * 0.72), lapel_point + 0.030),
            (direction * (lapel_outer * 0.52), lapel_point + 0.078),
        ]
        builder.prism_xz(points, front_y - 0.004, 0.010, 0, {"spine_03": 1.0})

    # One curved front pattern piece bridges the anatomical chest surface.  It
    # follows the jacket ellipse rather than becoming a flat armour plate.
    builder.ellipse_arc_band_z(
        (0.0, center_y),
        (chest_half_width + 0.018, chest_radius_y + 0.048),
        lower_hem + 0.022,
        upper_limit - 0.048,
        pi + 0.08,
        2.0 * pi - 0.08,
        0,
        {"spine_02": 0.46, "spine_03": 0.54},
        22,
    )

    # Raised rear collar protects the neck while keeping the V-front open.
    builder.ellipse_arc_band_z(
        (0.0, 0.025),
        (min(0.125, chest_half_width * 0.60), 0.102),
        upper_limit - 0.005,
        upper_limit + 0.060,
        0.10,
        pi - 0.10,
        0,
        {"spine_03": 0.80, "neck_01": 0.20},
    )

    # Closed lower front with aged zipper teeth and a chunky pull.
    zipper_top = lapel_point + 0.008
    zipper_bottom = lower_hem + 0.055
    builder.box((0.0, front_y - 0.011, (zipper_bottom + zipper_top) * 0.5), (0.018, 0.010, zipper_top - zipper_bottom), 1, {"spine_02": 0.55, "spine_01": 0.45})
    tooth_count = 22
    for index in range(tooth_count):
        progression = index / max(1, tooth_count - 1)
        z = zipper_bottom + (zipper_top - zipper_bottom) * progression
        weights = torso_weights(z)
        for direction in (-1.0, 1.0):
            builder.box((direction * 0.0095, front_y - 0.018, z), (0.006, 0.006, 0.006), 3, weights)
    builder.box((0.016, front_y - 0.024, zipper_top - 0.038), (0.024, 0.008, 0.036), 3, {"spine_02": 0.35, "spine_03": 0.65})

    # Belt follows the real torso ellipse rather than floating as a straight bar.
    belt_z0 = lower_hem + 0.028
    belt_z1 = belt_z0 + 0.045
    waist_points = [
        point
        for point in group_points(body, armature, TORSO_GROUPS)
        if belt_z0 - 0.025 <= point.z <= belt_z1 + 0.025
    ]
    waist_minimum, waist_maximum = bounds(waist_points)
    waist_center_y = (waist_minimum.y + waist_maximum.y) * 0.5
    waist_radii = (
        max(abs(waist_minimum.x), abs(waist_maximum.x)) + 0.018,
        (waist_maximum.y - waist_minimum.y) * 0.5 + 0.020,
    )
    builder.ellipse_band_z(
        (0.0, waist_center_y),
        (waist_radii[0] * 0.985, waist_radii[1] * 0.985),
        lower_hem - 0.004,
        lower_hem + 0.024,
        1,
        torso_weights(lower_hem + 0.010),
    )
    builder.ellipse_band_z((0.0, waist_center_y), waist_radii, belt_z0, belt_z1, 1, torso_weights((belt_z0 + belt_z1) * 0.5))
    buckle_x = waist_radii[0] * 0.31
    buckle_y = front_y - 0.031
    buckle_z = (belt_z0 + belt_z1) * 0.5
    for offset_x, offset_z, size in (
        (-0.024, 0.0, (0.008, 0.010, 0.058)),
        (0.024, 0.0, (0.008, 0.010, 0.058)),
        (0.0, -0.025, (0.056, 0.010, 0.008)),
        (0.0, 0.025, (0.056, 0.010, 0.008)),
    ):
        builder.box((buckle_x + offset_x, buckle_y, buckle_z + offset_z), size, 3, torso_weights(buckle_z))

    # Body-measured cuffs and one restrained repair strap on the left sleeve.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        points = group_points(body, armature, {f"lowerarm_{side}"})
        minimum, maximum = bounds(points)
        maximum_distance = max(abs(minimum.x), abs(maximum.x))
        wrist_points = [point for point in points if abs(point.x) >= maximum_distance - 0.075]
        wrist_minimum, wrist_maximum = bounds(wrist_points)
        center_yz = ((wrist_minimum.y + wrist_maximum.y) * 0.5, (wrist_minimum.z + wrist_maximum.z) * 0.5)
        radii = ((wrist_maximum.y - wrist_minimum.y) * 0.5 + 0.017, (wrist_maximum.z - wrist_minimum.z) * 0.5 + 0.017)
        inner_x = direction * (maximum_distance - 0.058)
        outer_x = direction * (maximum_distance - 0.033)
        inner_distance = min(abs(minimum.x), abs(maximum.x))
        reinforcement_center_x = direction * (
            inner_distance + (maximum_distance - inner_distance) * 0.26
        )
        reinforcement_points = [
            point
            for point in group_points(body, armature, {f"upperarm_{side}", f"lowerarm_{side}"})
            if abs(point.x - reinforcement_center_x) <= 0.040
        ]
        if reinforcement_points:
            reinforcement_minimum, reinforcement_maximum = bounds(reinforcement_points)
            reinforcement_center = (
                (reinforcement_minimum.y + reinforcement_maximum.y) * 0.5,
                (reinforcement_minimum.z + reinforcement_maximum.z) * 0.5,
            )
            reinforcement_radii = (
                (reinforcement_maximum.y - reinforcement_minimum.y) * 0.5 + 0.014,
                (reinforcement_maximum.z - reinforcement_minimum.z) * 0.5 + 0.014,
            )
            x0, x1 = sorted((reinforcement_center_x - 0.033, reinforcement_center_x + 0.033))
            builder.ellipse_band_x(
                x0,
                x1,
                reinforcement_center,
                reinforcement_radii,
                1,
                {f"upperarm_{side}": 0.72, f"lowerarm_{side}": 0.28},
            )

        # A narrow armhole welt separates the sleeve from the torso.  Besides
        # giving the jacket a real construction seam, it hides the topology
        # transition when the clavicle rotates in weapon poses.
        shoulder_center_x = direction * (inner_distance + 0.045)
        shoulder_points = [
            point
            for point in group_points(body, armature, {f"clavicle_{side}", f"upperarm_{side}"})
            if abs(point.x - shoulder_center_x) <= 0.035
        ]
        if shoulder_points:
            shoulder_minimum, shoulder_maximum = bounds(shoulder_points)
            shoulder_center = (
                (shoulder_minimum.y + shoulder_maximum.y) * 0.5,
                (shoulder_minimum.z + shoulder_maximum.z) * 0.5,
            )
            shoulder_radii = (
                (shoulder_maximum.y - shoulder_minimum.y) * 0.5 + 0.011,
                (shoulder_maximum.z - shoulder_minimum.z) * 0.5 + 0.011,
            )
            x0, x1 = sorted((shoulder_center_x - 0.010, shoulder_center_x + 0.010))
            builder.ellipse_band_x(
                x0,
                x1,
                shoulder_center,
                shoulder_radii,
                0,
                {f"upperarm_{side}": 1.0},
            )

    # Small rivets add scale cues without armour-like floating shoulder blocks.
    for side, direction in (("l", 1.0), ("r", -1.0)):
        tab_x = direction * chest_half_width * 0.93
        builder.octahedron((tab_x, front_y - 0.006, min(upper_limit - 0.030, 1.505)), 0.007, 3, {f"clavicle_{side}": 0.72, f"upperarm_{side}": 0.28})
    for direction in (-1.0, 1.0):
        builder.octahedron((direction * lapel_outer * 0.78, front_y - 0.026, lapel_point + 0.105), 0.009, 3, {"spine_03": 1.0})

    build_trousers(builder, body, armature, 0, 1, 3, style="leather")

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
    bpy.ops.object.shade_flat()
    details.select_set(False)
    details["realm_asset_id"] = asset_id
    details["realm_art_direction"] = "character_geometry_b_materials_c"
    details["realm_review_only"] = True
    details["realm_runtime_integration_allowed"] = False
    return details


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def pose_review(armature: bpy.types.Object) -> list[bpy.types.Object]:
    armature.data.pose_position = "POSE"
    helpers: list[bpy.types.Object] = []
    for side, direction in (("l", 1.0), ("r", -1.0)):
        hand = armature.pose.bones.get(f"hand_{side}")
        if hand is None:
            continue
        target = bpy.data.objects.new(f"jacket_review_hand_{side}", None)
        target.location = (direction * 0.52, -0.015, 1.13)
        bpy.context.scene.collection.objects.link(target)
        pole = bpy.data.objects.new(f"jacket_review_elbow_{side}", None)
        pole.location = (direction * 0.64, -0.22, 1.18)
        bpy.context.scene.collection.objects.link(pole)
        constraint = hand.constraints.new("IK")
        constraint.name = "jacket_review_natural_arm"
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
            if constraint.name == "jacket_review_natural_arm":
                pose_bone.constraints.remove(constraint)
        pose_bone.matrix_basis.identity()
    for helper in helpers:
        bpy.data.objects.remove(helper, do_unlink=True)
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()


def render_review(
    armature: bpy.types.Object,
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
        scene.world = bpy.data.worlds.new("jacket_review_world")
    scene.world.color = (0.025, 0.030, 0.028)

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

    for name, location, energy, color, size in (
        ("jacket_review_light_key", (-2.6, -3.4, 4.5), 1050, (1.0, 0.78, 0.58), 3.0),
        ("jacket_review_light_fill", (3.1, -1.0, 3.2), 760, (0.56, 0.72, 0.84), 3.4),
        ("jacket_review_light_rim", (0.0, 3.2, 3.5), 900, (0.88, 0.72, 0.50), 2.4),
    ):
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
        "leather": pbr_material("jacket_weathered_oxblood_leather", (0.170, 0.061, 0.029), 0.76, 0.0, args.body_id, 0.08),
        "trim": pbr_material("jacket_dark_edge_leather", (0.065, 0.033, 0.022), 0.84, 0.0, args.body_id, 0.06),
        "repair": pbr_material("jacket_dusty_repair_canvas", (0.205, 0.180, 0.115), 0.94, 0.0, args.body_id, 0.12),
        "metal": pbr_material("jacket_tarnished_hardware", (0.205, 0.220, 0.205), 0.56, 0.68, args.body_id, 0.10),
    }
    shell, fit = build_shell(body, armature, args.asset_id)
    details = build_details(body, armature, args.asset_id, fit)
    material_order = (materials["leather"], materials["trim"], materials["repair"], materials["metal"])
    for obj in (shell, details):
        for material in material_order:
            obj.data.materials.append(material)

    helpers = pose_review(armature)
    if args.front_render:
        render_review(armature, args.front_render, (2.35, -4.1, 2.05), (0.0, 0.0, 1.02), 2.02)
    if args.back_render:
        render_review(armature, args.back_render, (-2.45, 4.0, 2.12), (0.0, 0.0, 1.06), 2.02)
    if args.detail_render:
        render_review(armature, args.detail_render, (1.42, -3.5, 1.72), (0.0, -0.01, 1.27), 1.15)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    reset_pose(armature, helpers)
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
        "actualGlb": actual,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "Blender-authored tailored outer-layer silhouette with straight lapels, armhole welts and B+C leather details on the exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_LEATHER_JACKET_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
