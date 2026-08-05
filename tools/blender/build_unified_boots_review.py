"""Build original B+C equipment golden-master boots for critic review.

The shipped character mesh is the sole proportion reference.  Every body variant
gets its own fitted boot mesh on the exact current 65-bone rig.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import sin
from pathlib import Path
import random
import struct
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor", type=Path)
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_boots_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
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
    size: int = 256,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-boots-v1:{name}:{kind}")
    pixels: list[float] = []
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.051 + y * 0.019) * 0.55 + sin(y * 0.087 - x * 0.017) * 0.25
            noise = (rng.random() - 0.5) * 0.20
            contact_wear = 0.07 if y in {22, 48, 214} and 18 < x < 236 else 0.0
            if kind == "albedo":
                variation = broad * 0.08 + noise * 0.035
                values = tuple(
                    max(0.025, min(0.94, component * (1.0 + variation) + contact_wear))
                    for component in base
                )
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(0.28, min(0.98, base[0] + broad * 0.06 + noise * 0.025))
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend((0.5 + broad * 0.014, 0.5 + noise * 0.012, 1.0, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float,
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
    rough.image = texture_image(f"{name}_roughness", (roughness,) * 3, "roughness")
    rough.image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), "normal")
    normal_texture.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.16
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def polygon_islands(mesh: bpy.types.Mesh) -> list[list[int]]:
    edge_to_polygons: dict[tuple[int, int], list[int]] = {}
    for polygon in mesh.polygons:
        for edge_key in polygon.edge_keys:
            edge_to_polygons.setdefault(tuple(sorted(edge_key)), []).append(polygon.index)
    adjacency: list[set[int]] = [set() for _ in mesh.polygons]
    for polygon_indices in edge_to_polygons.values():
        for polygon_index in polygon_indices:
            adjacency[polygon_index].update(
                neighbor
                for neighbor in polygon_indices
                if neighbor != polygon_index
            )
    unseen = set(range(len(mesh.polygons)))
    islands: list[list[int]] = []
    while unseen:
        start = unseen.pop()
        island = [start]
        stack = [start]
        while stack:
            polygon_index = stack.pop()
            for neighbor in adjacency[polygon_index]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    island.append(neighbor)
                    stack.append(neighbor)
        islands.append(island)
    return islands


def dominant_group_bounds(
    mesh_object: bpy.types.Object,
    armature: bpy.types.Object,
) -> dict[str, tuple[Vector, Vector]]:
    groups = {
        "calf_l",
        "foot_l",
        "ball_l",
        "calf_r",
        "foot_r",
        "ball_r",
    }
    points: dict[str, list[Vector]] = {name: [] for name in groups}
    world_to_armature = armature.matrix_world.inverted()
    for vertex in mesh_object.data.vertices:
        assignments = [
            (mesh_object.vertex_groups[item.group].name, item.weight)
            for item in vertex.groups
            if mesh_object.vertex_groups[item.group].name in groups
        ]
        if not assignments:
            continue
        dominant = max(assignments, key=lambda item: item[1])[0]
        points[dominant].append(
            world_to_armature @ mesh_object.matrix_world @ vertex.co
        )
    result = {}
    for name, values in points.items():
        if not values:
            continue
        result[name] = (
            Vector(tuple(min(point[axis] for point in values) for axis in range(3))),
            Vector(tuple(max(point[axis] for point in values) for axis in range(3))),
        )
    return result


def fit_boots_to_body(
    boots: bpy.types.Object,
    body_mesh: bpy.types.Object,
    armature: bpy.types.Object,
) -> dict[str, object]:
    body_bounds = dominant_group_bounds(body_mesh, armature)
    boot_bounds = dominant_group_bounds(boots, armature)
    margins = {
        "calf": Vector((0.014, 0.014, 0.0)),
        "foot": Vector((0.012, 0.016, 0.008)),
        "ball": Vector((0.012, 0.014, 0.006)),
    }
    transforms: dict[str, tuple[Vector, Vector]] = {}
    report: dict[str, object] = {}
    for group_name, (body_minimum, body_maximum) in body_bounds.items():
        if group_name not in boot_bounds:
            continue
        boot_minimum, boot_maximum = boot_bounds[group_name]
        category = group_name.split("_", 1)[0]
        margin = margins[category]
        desired_minimum = body_minimum - margin
        desired_maximum = body_maximum + margin
        body_center = (desired_minimum + desired_maximum) * 0.5
        boot_center = (boot_minimum + boot_maximum) * 0.5
        body_size = desired_maximum - desired_minimum
        boot_size = boot_maximum - boot_minimum
        scale = Vector((1.0, 1.0, 1.0))
        for axis in range(3):
            if boot_size[axis] > 1.0e-6:
                scale[axis] = max(0.86, min(1.38, body_size[axis] / boot_size[axis]))
        if category == "calf":
            scale.z = 1.0
        transforms[group_name] = (body_center - boot_center, scale)
        report[group_name] = {
            "translation": [round(value, 5) for value in transforms[group_name][0]],
            "scale": [round(value, 5) for value in scale],
        }

    for vertex in boots.data.vertices:
        assignments = [
            (boots.vertex_groups[item.group].name, item.weight)
            for item in vertex.groups
            if boots.vertex_groups[item.group].name in transforms
        ]
        if not assignments:
            continue
        group_name = max(assignments, key=lambda item: item[1])[0]
        translation, scale = transforms[group_name]
        boot_minimum, boot_maximum = boot_bounds[group_name]
        center = (boot_minimum + boot_maximum) * 0.5
        vertex.co = center + (vertex.co - center) * scale + translation

    # Bring the fantasy knee-high donor down to a practical wasteland
    # mid-calf silhouette while retaining the authored topology and skinning.
    for vertex in boots.data.vertices:
        if vertex.co.z > 0.085:
            vertex.co.z = 0.085 + (vertex.co.z - 0.085) * 0.54
        if vertex.co.z < 0.13 and vertex.co.y < -0.055:
            vertex.co.y = -0.055 + (vertex.co.y + 0.055) * 0.94
    boots.data.update()
    return report


def trim_donor_below_ankle(boots: bpy.types.Object) -> None:
    bm = bmesh.new()
    bm.from_mesh(boots.data)
    faces = [
        face
        for face in bm.faces
        if face.calc_center_median().z < 0.150
    ]
    bmesh.ops.delete(bm, geom=faces, context="FACES")
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bm.to_mesh(boots.data)
    bm.free()
    boots.data.update()


def remove_micro_fantasy_hardware(boots: bpy.types.Object) -> None:
    removable_faces: set[int] = set()
    for island in polygon_islands(boots.data):
        vertices = {
            vertex_index
            for polygon_index in island
            for vertex_index in boots.data.polygons[polygon_index].vertices
        }
        points = [boots.data.vertices[index].co for index in vertices]
        minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        size = maximum - minimum
        if (
            len(island) <= 80
            and max(size.x, size.y, size.z) < 0.042
            and minimum.z > 0.10
        ):
            removable_faces.update(island)
    if not removable_faces:
        return
    bm = bmesh.new()
    bm.from_mesh(boots.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(
        bm,
        geom=[bm.faces[index] for index in sorted(removable_faces)],
        context="FACES",
    )
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bm.to_mesh(boots.data)
    bm.free()
    boots.data.update()


def add_body_fitted_foot_shells(
    boots: bpy.types.Object,
    body_mesh: bpy.types.Object,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    """Build clean B-style shoe topology around measured player feet."""
    trim_donor_below_ankle(boots)
    remove_micro_fantasy_hardware(boots)
    body_bounds = dominant_group_bounds(body_mesh, armature)
    shells: list[bpy.types.Object] = []
    for side in ("l", "r"):
        ranges = [
            body_bounds[name]
            for name in (f"foot_{side}", f"ball_{side}")
            if name in body_bounds
        ]
        if not ranges:
            continue
        minimum = Vector(
            tuple(min(item[0][axis] for item in ranges) for axis in range(3))
        )
        maximum = Vector(
            tuple(max(item[1][axis] for item in ranges) for axis in range(3))
        )
        center_x = (minimum.x + maximum.x) * 0.5
        half_width = max(0.055, (maximum.x - minimum.x) * 0.5 + 0.006)
        heel_y = maximum.y + 0.010
        toe_y = minimum.y - 0.030
        bottom = minimum.z - 0.006
        profiles = (
            (0.00, 0.62, 0.112),
            (0.12, 0.80, 0.160),
            (0.30, 0.91, 0.178),
            (0.53, 0.96, 0.145),
            (0.75, 1.00, 0.096),
            (0.91, 0.82, 0.065),
            (1.00, 0.74, 0.052),
        )
        vertices: list[tuple[float, float, float]] = []
        weights: list[tuple[float, float, float]] = []
        for progression, width_factor, top in profiles:
            y = heel_y + (toe_y - heel_y) * progression
            width = half_width * width_factor
            height = top - bottom
            ring = (
                (-0.72, 0.00),
                (0.72, 0.00),
                (1.00, 0.18),
                (1.00, 0.62),
                (0.50, 1.00),
                (-0.50, 1.00),
                (-1.00, 0.62),
                (-1.00, 0.18),
            )
            ball_weight = max(0.0, min(1.0, (progression - 0.48) / 0.28))
            leaf_weight = max(0.0, min(1.0, (progression - 0.84) / 0.16))
            ball_weight *= 1.0 - leaf_weight
            foot_weight = max(0.0, 1.0 - ball_weight - leaf_weight)
            for x_factor, z_factor in ring:
                vertices.append(
                    (
                        center_x + width * x_factor,
                        y,
                        bottom + height * z_factor,
                    )
                )
                weights.append((foot_weight, ball_weight, leaf_weight))
        ring_size = 8
        faces: list[tuple[int, ...]] = []
        for section in range(len(profiles) - 1):
            start = section * ring_size
            following = (section + 1) * ring_size
            for edge in range(ring_size):
                next_edge = (edge + 1) % ring_size
                faces.append(
                    (
                        start + edge,
                        following + edge,
                        following + next_edge,
                        start + next_edge,
                    )
                )
        faces.append(tuple(reversed(range(ring_size))))
        final_start = (len(profiles) - 1) * ring_size
        faces.append(tuple(final_start + index for index in range(ring_size)))
        mesh = bpy.data.meshes.new(f"body_fitted_foot_shell_{side}_mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        shell = bpy.data.objects.new(f"body_fitted_foot_shell_{side}", mesh)
        bpy.context.collection.objects.link(shell)
        shell.name = f"closed_vamp_{side}"
        shell.matrix_world = armature.matrix_world.copy()
        foot_group = shell.vertex_groups.new(name=f"foot_{side}")
        ball_group = shell.vertex_groups.new(name=f"ball_{side}")
        leaf_group = shell.vertex_groups.new(name=f"ball_leaf_{side}")
        for vertex_index, (foot_weight, ball_weight, leaf_weight) in enumerate(weights):
            if foot_weight > 0:
                foot_group.add([vertex_index], foot_weight, "REPLACE")
            if ball_weight > 0:
                ball_group.add([vertex_index], ball_weight, "REPLACE")
            if leaf_weight > 0:
                leaf_group.add([vertex_index], leaf_weight, "REPLACE")
        bpy.ops.object.shade_flat()
        shell.select_set(False)
        shells.append(shell)

    if not shells:
        return boots
    bpy.ops.object.select_all(action="DESELECT")
    boots.select_set(True)
    for shell in shells:
        shell.select_set(True)
    bpy.context.view_layer.objects.active = boots
    bpy.ops.object.join()
    boots.data.name = f"{boots.name}_mesh"
    bpy.context.view_layer.objects.active = boots
    boots.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.0, island_margin=0.016)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    boots.select_set(False)
    return boots


class BootMeshBuilder:
    """Small deterministic mesh builder with per-vertex skin weights."""

    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.face_materials: list[int] = []
        self.weights: list[dict[str, float]] = []

    def add_vertex(
        self,
        position: tuple[float, float, float],
        weights: dict[str, float],
    ) -> int:
        index = len(self.vertices)
        self.vertices.append(position)
        self.weights.append(weights)
        return index

    def add_face(self, indices: tuple[int, ...], material: int) -> None:
        self.faces.append(indices)
        self.face_materials.append(material)


def skin_for_progression(side: str, progression: float) -> dict[str, float]:
    leaf = max(0.0, min(1.0, (progression - 0.88) / 0.12))
    ball = max(0.0, min(1.0, (progression - 0.50) / 0.32))
    ball *= 1.0 - leaf
    foot = max(0.0, 1.0 - ball - leaf)
    return {
        f"foot_{side}": foot,
        f"ball_{side}": ball,
        f"ball_leaf_{side}": leaf,
    }


def add_sole(
    builder: BootMeshBuilder,
    side: str,
    center_x: float,
    half_width: float,
    heel_y: float,
    toe_y: float,
    bottom: float,
    top: float,
) -> None:
    stations = (
        (0.00, 0.72),
        (0.12, 0.83),
        (0.28, 0.93),
        (0.48, 1.00),
        (0.66, 1.00),
        (0.82, 0.93),
        (0.94, 0.72),
        (1.00, 0.30),
    )
    outline: list[tuple[float, float, float]] = []
    for progression, width_factor in stations:
        y = heel_y + (toe_y - heel_y) * progression
        outline.append((center_x - half_width * width_factor, y, progression))
    for progression, width_factor in reversed(stations):
        y = heel_y + (toe_y - heel_y) * progression
        outline.append((center_x + half_width * width_factor, y, progression))

    # Three subtly different rings create a rounded, layered outsole without
    # the oversized wedge silhouette of the rejected prototype.
    layers = (
        (bottom, 0.91),
        (bottom + (top - bottom) * 0.42, 1.00),
        (top, 0.97),
    )
    rings: list[list[int]] = []
    for z, width_scale in layers:
        ring = []
        for x, y, progression in outline:
            x_scaled = center_x + (x - center_x) * width_scale
            ring.append(
                builder.add_vertex(
                    (x_scaled, y, z),
                    skin_for_progression(side, progression),
                )
            )
        rings.append(ring)
    count = len(outline)
    builder.add_face(tuple(reversed(rings[0])), 1)
    builder.add_face(tuple(rings[-1]), 1)
    for layer_index in range(len(rings) - 1):
        lower = rings[layer_index]
        upper = rings[layer_index + 1]
        for index in range(count):
            following = (index + 1) % count
            builder.add_face(
                (
                    lower[index],
                    lower[following],
                    upper[following],
                    upper[index],
                ),
                1,
            )


def add_upper(
    builder: BootMeshBuilder,
    side: str,
    center_x: float,
    half_width: float,
    heel_y: float,
    toe_y: float,
    base: float,
    foot_top: float,
) -> None:
    # Longitudinal stations and a nine-point dorsal arc follow the current
    # player's foot instead of approximating it with a box.
    stations = (
        (-0.030, 0.10, max(0.094, foot_top - 0.006)),
        (-0.016, 0.48, foot_top + 0.010),
        (0.00, 0.86, foot_top + 0.018),
        (0.12, 0.90, foot_top + 0.022),
        (0.27, 0.95, foot_top + 0.016),
        (0.43, 0.98, foot_top + 0.006),
        (0.60, 0.99, max(0.082, foot_top - 0.008)),
        (0.75, 0.96, max(0.066, foot_top - 0.026)),
        (0.88, 0.84, max(0.052, foot_top - 0.042)),
        (0.96, 0.54, max(0.044, foot_top - 0.050)),
        (1.00, 0.18, max(0.040, foot_top - 0.055)),
        (1.015, 0.035, max(0.039, foot_top - 0.056)),
    )
    arcs: list[list[int]] = []
    arc_segments = 10
    for progression, width_factor, top in stations:
        y = heel_y + (toe_y - heel_y) * progression
        width = half_width * width_factor
        height = max(0.022, top - base)
        ring = []
        for arc_index in range(arc_segments + 1):
            angle = 3.141592653589793 - 3.141592653589793 * arc_index / arc_segments
            x = center_x + width * __import__("math").cos(angle)
            # A slightly squared lower quarter reads as leather meeting a sole,
            # while the upper arc keeps the toe and instep anatomical.
            z_factor = max(0.0, __import__("math").sin(angle))
            z = base + height * (z_factor ** 0.82)
            ring.append(
                builder.add_vertex(
                    (x, y, z),
                    skin_for_progression(side, progression),
                )
            )
        arcs.append(ring)
    for station_index in range(len(arcs) - 1):
        current = arcs[station_index]
        following = arcs[station_index + 1]
        for arc_index in range(arc_segments):
            builder.add_face(
                (
                    current[arc_index],
                    following[arc_index],
                    following[arc_index + 1],
                    current[arc_index + 1],
                ),
                0,
            )
    builder.add_face(tuple(reversed(arcs[0])), 0)
    # Small rubber toe bumper makes the terminal facet intentional and avoids
    # a bright, visually detached leather cap under the warm key light.
    builder.add_face(tuple(arcs[-1]), 1)

def add_elliptic_tube(
    builder: BootMeshBuilder,
    side: str,
    center_x: float,
    center_y: float,
    rings: tuple[tuple[float, float, float], ...],
    material: int,
    segments: int = 14,
) -> list[list[int]]:
    tube: list[list[int]] = []
    for ring_index, (z, radius_x, radius_y) in enumerate(rings):
        calf_weight = max(0.22, min(0.92, ring_index / max(1, len(rings) - 1)))
        ring = []
        for index in range(segments):
            angle = 2.0 * 3.141592653589793 * index / segments
            ring.append(
                builder.add_vertex(
                    (
                        center_x + radius_x * __import__("math").cos(angle),
                        center_y + radius_y * __import__("math").sin(angle),
                        z,
                    ),
                    {
                        f"foot_{side}": 1.0 - calf_weight,
                        f"calf_{side}": calf_weight,
                    },
                )
            )
        tube.append(ring)
    for ring_index in range(len(tube) - 1):
        lower = tube[ring_index]
        upper = tube[ring_index + 1]
        for index in range(segments):
            following = (index + 1) % segments
            builder.add_face(
                (
                    lower[index],
                    lower[following],
                    upper[following],
                    upper[index],
                ),
                material,
            )
    return tube


def add_box_strip(
    builder: BootMeshBuilder,
    side: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    material: int,
    calf_weight: float,
) -> None:
    cx, cy, cz = center
    sx, sy, sz = (value * 0.5 for value in size)
    weights = {
        f"foot_{side}": 1.0 - calf_weight,
        f"calf_{side}": calf_weight,
    }
    indices = [
        builder.add_vertex((cx + dx * sx, cy + dy * sy, cz + dz * sz), weights)
        for dz in (-1.0, 1.0)
        for dy in (-1.0, 1.0)
        for dx in (-1.0, 1.0)
    ]
    for face in (
        (0, 1, 3, 2),
        (4, 6, 7, 5),
        (0, 4, 5, 1),
        (2, 3, 7, 6),
        (0, 2, 6, 4),
        (1, 5, 7, 3),
    ):
        builder.add_face(tuple(indices[index] for index in face), material)


def build_original_body_fitted_boots(
    body_mesh: bpy.types.Object,
    armature: bpy.types.Object,
    asset_id: str,
) -> tuple[bpy.types.Object, dict[str, object]]:
    bounds = dominant_group_bounds(body_mesh, armature)
    builder = BootMeshBuilder()
    fit_report: dict[str, object] = {}
    for side in ("l", "r"):
        ranges = [
            bounds[name]
            for name in (f"foot_{side}", f"ball_{side}")
            if name in bounds
        ]
        if len(ranges) != 2:
            raise RuntimeError(f"Current player body lacks foot bounds for {side}")
        minimum = Vector(tuple(min(item[0][axis] for item in ranges) for axis in range(3)))
        maximum = Vector(tuple(max(item[1][axis] for item in ranges) for axis in range(3)))
        center_x = (minimum.x + maximum.x) * 0.5
        half_width = (maximum.x - minimum.x) * 0.5 + 0.010
        heel_y = maximum.y + 0.018
        # The idle clip flexes ball/ball_leaf farther forward than the bind-pose
        # bounds.  A 35 mm allowance covers the animated toes while the rounded
        # terminal stations prevent the old wedge-shaped silhouette.
        toe_y = minimum.y - 0.040
        sole_bottom = minimum.z - 0.010
        sole_top = minimum.z + 0.020
        foot_top = maximum.z + 0.008
        add_sole(
            builder,
            side,
            center_x,
            half_width,
            heel_y,
            toe_y,
            sole_bottom,
            sole_top,
        )
        add_upper(
            builder,
            side,
            center_x,
            half_width * 0.95,
            heel_y - 0.003,
            toe_y + 0.004,
            sole_top - 0.002,
            foot_top,
        )

        ankle_center_y = min(maximum.y - 0.045, 0.082)
        ankle_width = max(0.058, half_width * 0.88)
        shaft_rings = (
            (0.070, ankle_width * 0.92, 0.058),
            (0.105, ankle_width, 0.063),
            (0.150, ankle_width * 1.02, 0.066),
            (0.205, ankle_width * 1.08, 0.069),
            (0.235, ankle_width * 1.10, 0.071),
        )
        add_elliptic_tube(
            builder,
            side,
            center_x,
            ankle_center_y,
            shaft_rings,
            0,
        )
        add_elliptic_tube(
            builder,
            side,
            center_x,
            ankle_center_y,
            (
                (0.222, ankle_width * 1.15, 0.075),
                (0.242, ankle_width * 1.16, 0.076),
            ),
            2,
        )

        # Tongue and four readable laces sit on the toe-facing side (-Y).
        tongue_y = ankle_center_y - 0.072
        add_box_strip(
            builder,
            side,
            (center_x, tongue_y + 0.004, 0.157),
            (ankle_width * 1.12, 0.011, 0.154),
            2,
            0.58,
        )
        for lace_index, z in enumerate((0.108, 0.135, 0.162, 0.189)):
            lace_width = ankle_width * (1.28 - lace_index * 0.05)
            add_box_strip(
                builder,
                side,
                (center_x, tongue_y - 0.004, z),
                (lace_width, 0.010, 0.008),
                2,
                0.38 + lace_index * 0.12,
            )
            for eyelet_direction in (-1.0, 1.0):
                add_box_strip(
                    builder,
                    side,
                    (
                        center_x + eyelet_direction * lace_width * 0.47,
                        tongue_y - 0.010,
                        z,
                    ),
                    (0.010, 0.007, 0.010),
                    3,
                    1.0,
                )
        # One restrained wasteland repair strap, shaped around the shaft.
        add_elliptic_tube(
            builder,
            side,
            center_x,
            ankle_center_y,
            (
                (0.165, ankle_width * 1.07, 0.069),
                (0.181, ankle_width * 1.09, 0.071),
            ),
            2,
        )
        fit_report[side] = {
            "footBounds": {
                "minimum": [round(value, 5) for value in minimum],
                "maximum": [round(value, 5) for value in maximum],
            },
            "sole": {
                "heelY": round(heel_y, 5),
                "toeY": round(toe_y, 5),
                "bottomZ": round(sole_bottom, 5),
                "topZ": round(sole_top, 5),
                "halfWidth": round(half_width, 5),
            },
        }

    mesh = bpy.data.meshes.new(f"{asset_id}_mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, builder.face_materials):
        polygon.material_index = material_index
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    boots = bpy.data.objects.new(asset_id, mesh)
    bpy.context.collection.objects.link(boots)
    boots.parent = armature
    boots.matrix_parent_inverse = Matrix.Identity(4)
    boots.matrix_world = armature.matrix_world.copy()
    group_names = sorted(
        {
            group_name
            for weights in builder.weights
            for group_name, weight in weights.items()
            if weight > 0.0
        }
    )
    vertex_groups = {
        group_name: boots.vertex_groups.new(name=group_name)
        for group_name in group_names
    }
    for vertex_index, weights in enumerate(builder.weights):
        total = sum(weights.values())
        if total <= 0.0:
            continue
        for group_name, weight in weights.items():
            if weight > 0.0:
                vertex_groups[group_name].add(
                    [vertex_index],
                    weight / total,
                    "REPLACE",
                )
    modifier = boots.modifiers.new("current_player_rig", "ARMATURE")
    modifier.object = armature
    bpy.context.view_layer.objects.active = boots
    boots.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=0.92, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    boots.select_set(False)
    boots["realm_asset_id"] = asset_id
    boots["realm_art_direction"] = "character_geometry_b_materials_c"
    boots["realm_review_only"] = True
    boots["realm_runtime_integration_allowed"] = False
    boots["realm_geometry_provenance"] = "original parametric body-fitted project geometry"
    return boots, fit_report


def assign_materials(
    boots: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    order = ("leather", "sole", "canvas", "metal")
    boots.data.materials.clear()
    for name in order:
        boots.data.materials.append(materials[name])
    slots = {name: index for index, name in enumerate(order)}
    for island in polygon_islands(boots.data):
        vertices = {
            vertex_index
            for polygon_index in island
            for vertex_index in boots.data.polygons[polygon_index].vertices
        }
        points = [boots.data.vertices[index].co for index in vertices]
        minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        size = maximum - minimum
        center = (minimum + maximum) * 0.5
        if maximum.z < 0.095:
            material = "sole"
        elif (
            len(island) < 180
            and max(size.x, size.y, size.z) < 0.075
            and abs(center.x) > 0.07
            and minimum.z > 0.08
        ):
            material = "metal"
        elif size.z < 0.065 and minimum.z > 0.12:
            material = "canvas"
        else:
            material = "leather"
        for polygon_index in island:
            boots.data.polygons[polygon_index].material_index = slots[material]
    # A continuous low shoe shell is one island, so give its ground-facing
    # facets a rubberized sole after island-level classification.
    for polygon in boots.data.polygons:
        center = polygon.center
        if center.z < 0.026:
            polygon.material_index = slots["sole"]


def rebuild_boots(
    donor: Path,
    target_armature: bpy.types.Object,
    asset_id: str,
) -> bpy.types.Object:
    donor_objects = import_glb(donor)
    boots = next(
        (obj for obj in donor_objects if obj.type == "MESH" and "Boots" in obj.name),
        None,
    )
    if boots is None:
        raise RuntimeError("Donor contains no boots mesh")
    donor_armature = next((obj for obj in donor_objects if obj.type == "ARMATURE"), None)
    helpers = [
        obj
        for obj in donor_objects
        if obj != boots and obj != donor_armature
    ]
    for obj in helpers:
        bpy.data.objects.remove(obj, do_unlink=True)

    if donor_armature is None:
        raise RuntimeError("Donor boots have no source armature")

    # The two assets share bone names but not the same bind-space proportions.
    # Rebinding only the modifier keeps the donor's narrow stance and causes the
    # boots to float between the player's feet.  Transfer every weighted vertex
    # through the matching source/target rest-bone matrices first.
    source_world_inverse = donor_armature.matrix_world.inverted()
    target_world = target_armature.matrix_world.copy()
    source_bones = donor_armature.data.bones
    target_bones = target_armature.data.bones
    missing_groups: set[str] = set()
    for vertex in boots.data.vertices:
        source_position = (
            source_world_inverse @ boots.matrix_world @ vertex.co
        )
        target_position = Vector((0.0, 0.0, 0.0))
        transferred_weight = 0.0
        for assignment in vertex.groups:
            group_name = boots.vertex_groups[assignment.group].name
            source_bone = source_bones.get(group_name)
            target_bone = target_bones.get(group_name)
            if source_bone is None or target_bone is None:
                missing_groups.add(group_name)
                continue
            transfer = target_bone.matrix_local @ source_bone.matrix_local.inverted()
            target_position += (transfer @ source_position) * assignment.weight
            transferred_weight += assignment.weight
        if transferred_weight <= 1.0e-6:
            target_position = source_position
        elif transferred_weight < 0.999:
            target_position += source_position * (1.0 - transferred_weight)
        else:
            target_position /= transferred_weight
        vertex.co = target_position
    if missing_groups:
        raise RuntimeError(
            "Donor has vertex groups absent from the current rig: "
            + ", ".join(sorted(missing_groups))
        )
    boots.data.update()

    for modifier in list(boots.modifiers):
        if modifier.type == "ARMATURE":
            modifier.object = target_armature
    boots.parent = target_armature
    boots.matrix_parent_inverse = Matrix.Identity(4)
    boots.matrix_world = target_world
    boots.name = asset_id
    boots.data.name = f"{asset_id}_mesh"

    bpy.context.view_layer.objects.active = boots
    boots.select_set(True)
    triangulate = boots.modifiers.new("new_controlled_facet_topology", "TRIANGULATE")
    triangulate.quad_method = "FIXED"
    triangulate.ngon_method = "BEAUTY"
    boots.modifiers.move(len(boots.modifiers) - 1, 0)
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    decimate = boots.modifiers.new("merge_coplanar_boot_planes", "DECIMATE")
    decimate.decimate_type = "DISSOLVE"
    decimate.angle_limit = 0.025
    decimate.use_dissolve_boundaries = False
    boots.modifiers.move(len(boots.modifiers) - 1, 0)
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.0, island_margin=0.016)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    boots.select_set(False)

    if donor_armature:
        bpy.data.objects.remove(donor_armature, do_unlink=True)
    boots["realm_asset_id"] = asset_id
    boots["realm_art_direction"] = "character_geometry_b_materials_c"
    boots["realm_review_only"] = True
    boots["realm_runtime_integration_allowed"] = False
    boots["realm_geometry_provenance"] = "substantial CC0 same-author donor rebuild"
    return boots


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
    boots: bpy.types.Object,
    asset_id: str,
    body_id: str,
    fit_transforms: dict[str, object],
) -> dict[str, object]:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    boots.select_set(True)
    bpy.context.view_layer.objects.active = boots
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
    actual = parse_exported_glb(output)
    return {
        "assetId": asset_id,
        "bodyId": body_id,
        "file": output.name,
        "dimensionsMetres": {
            "width": round(boots.dimensions.x, 4),
            "depth": round(boots.dimensions.y, 4),
            "height": round(boots.dimensions.z, 4),
        },
        "actualGlb": actual,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest().upper(),
        "fitBodies": [
            body_id,
        ],
        "fitTransforms": fit_transforms,
        "provenance": {
            "license": "Realm of Ashes project asset",
            "donor": None,
            "rebuild": "original body-fitted B geometry; new B+C material system; exact current 65-bone player rig",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }


def main() -> None:
    args = parse_args()
    clear_scene()
    reference_objects = import_glb(args.reference_character)
    armature = next((obj for obj in reference_objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("Reference character has no armature")
    body_mesh = next(
        (
            obj
            for obj in reference_objects
            if obj.type == "MESH" and "body" in obj.name.lower()
        ),
        None,
    )
    if body_mesh is None:
        raise RuntimeError("Reference character has no body mesh")
    armature.data.pose_position = "REST"
    if armature.animation_data:
        armature.animation_data_clear()
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    for obj in list(reference_objects):
        if obj.type == "MESH" and obj != body_mesh:
            bpy.data.objects.remove(obj, do_unlink=True)
    armature["realm_review_equipment_rig"] = "current_player_65_bone"

    materials = {
        "leather": pbr_material("boots_weathered_leather", (0.235, 0.115, 0.060), 0.86, 0.0),
        "sole": pbr_material("boots_rubberized_sole", (0.085, 0.095, 0.09), 0.90, 0.0),
        "canvas": pbr_material("boots_dusty_canvas", (0.245, 0.235, 0.155), 0.94, 0.0),
        "metal": pbr_material("boots_aged_hardware", (0.22, 0.235, 0.225), 0.64, 0.58),
    }
    boots, fit_transforms = build_original_body_fitted_boots(
        body_mesh,
        armature,
        args.asset_id,
    )
    bpy.data.objects.remove(body_mesh, do_unlink=True)
    for name in ("leather", "sole", "canvas", "metal"):
        boots.data.materials.append(materials[name])
    report = export_candidate(
        args.output,
        armature,
        boots,
        args.asset_id,
        args.body_id,
        fit_transforms,
    )
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_BOOTS_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
