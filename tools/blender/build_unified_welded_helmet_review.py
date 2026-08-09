"""Build the B+C steel helmet review asset on the current player rig.

The helmet is original project geometry: a restrained stamped-steel dome with
a rolled brim, rear neck guard, ridge, rivets and leather chin strap.  Every
body variant is fitted from the shipped head bounds and weighted entirely to
the current ``head`` bone so all runtime face profiles preserve the fit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import cos, pi, sin, sqrt
from pathlib import Path
import random
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


FACE_PROFILES = {
    "01": {"headScale": [1.0, 1.0, 1.0], "label": "угловатое"},
    "02": {"headScale": [0.88, 1.018, 1.05], "label": "узкое"},
    "03": {"headScale": [1.13, 0.985, 0.96], "label": "широкое"},
    "04": {"headScale": [0.98, 0.982, 1.09], "label": "округлое"},
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference-character", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-id", default="equipment_welded_helmet_unified_v1")
    parser.add_argument("--body-id", default="male_medium")
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--front-render", type=Path)
    parser.add_argument("--side-render", type=Path)
    parser.add_argument("--back-render", type=Path)
    parser.add_argument("--detail-render", type=Path)
    return parser.parse_args(argv)


def clear_scene() -> None:
    # Never reset factory settings here: doing so disables the live Blender MCP
    # add-on.  Deleting scene objects keeps the remote session connected.
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for item in list(blocks):
            if item.users == 0:
                blocks.remove(item)


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()), import_shading="NORMALS")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def dominant_group(mesh_object: bpy.types.Object, vertex_index: int) -> str | None:
    assignments = mesh_object.data.vertices[vertex_index].groups
    if not assignments:
        return None
    strongest = max(assignments, key=lambda assignment: assignment.weight)
    return mesh_object.vertex_groups[strongest.group].name


def armature_point(
    mesh_object: bpy.types.Object,
    armature: bpy.types.Object,
    vertex_index: int,
) -> Vector:
    return armature.matrix_world.inverted() @ mesh_object.matrix_world @ mesh_object.data.vertices[vertex_index].co


def head_bounds(body: bpy.types.Object, armature: bpy.types.Object) -> tuple[Vector, Vector, int]:
    points = [
        armature_point(body, armature, vertex.index)
        for vertex in body.data.vertices
        if dominant_group(body, vertex.index) == "head"
    ]
    if not points:
        raise RuntimeError("Reference character has no vertices weighted to the head bone")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum, len(points)


def texture_image(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    kind: str,
    seed: str,
    size: int = 192,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-steel-helmet-v1:{seed}:{name}:{kind}")
    scratches = [
        (rng.randrange(size), rng.randrange(size), rng.randrange(8, 32), rng.choice((-1, 1)))
        for _ in range(32)
    ]
    rust_spots = [
        (rng.randrange(size), rng.randrange(size), rng.randrange(4, 15))
        for _ in range(18)
    ]
    pixels: list[float] = []
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.061 + y * 0.023) * 0.45 + sin(y * 0.093 - x * 0.017) * 0.25
            noise = (rng.random() - 0.5) * 0.16
            scratch = 0.0
            for sx, sy, length, direction in scratches:
                dx = x - sx
                dy = y - sy
                if abs(dy - direction * dx * 0.18) < 0.65 and abs(dx) < length:
                    scratch = max(scratch, 1.0 - abs(dx) / length)
            rust = 0.0
            for rx, ry, radius in rust_spots:
                distance = sqrt((x - rx) ** 2 + (y - ry) ** 2)
                if distance < radius:
                    rust = max(rust, 1.0 - distance / radius)
            if kind == "albedo":
                variation = broad * 0.045 + noise * 0.018
                values = [max(0.015, min(0.92, value * (1.0 + variation))) for value in base]
                values = [min(0.95, value + scratch * 0.055) for value in values]
                if "steel" in name:
                    rust_mix = rust * 0.22
                    rust_color = (0.255, 0.075, 0.025)
                    values = [values[index] * (1.0 - rust_mix) + rust_color[index] * rust_mix for index in range(3)]
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(0.25, min(0.98, roughness + broad * 0.035 + noise * 0.012 + rust * 0.09 - scratch * 0.08))
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend((0.5 + noise * 0.018, 0.5 + broad * 0.015, 1.0, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float,
    seed: str,
    normal_strength: float = 0.14,
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
    albedo.image = texture_image(f"{name}_albedo", base, roughness, "albedo", seed)
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = texture_image(f"{name}_roughness", (roughness,) * 3, roughness, "roughness", seed)
    rough.image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), roughness, "normal", seed, 128)
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


class MeshBuilder:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def vertex(self, point: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(point))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material: int) -> None:
        self.faces.append(indices)
        self.materials.append(material)

    def box_between(
        self,
        start: Vector,
        end: Vector,
        width_axis: Vector,
        width: float,
        depth: float,
        material: int,
    ) -> None:
        tangent = (end - start).normalized()
        side = width_axis.normalized()
        if abs(tangent.dot(side)) > 0.94:
            side = Vector((0.0, 1.0, 0.0))
        thickness_axis = tangent.cross(side).normalized()
        side = thickness_axis.cross(tangent).normalized()
        points: list[Vector] = []
        for center in (start, end):
            points.extend(
                center + side * side_sign * width * 0.5 + thickness_axis * depth_sign * depth * 0.5
                for side_sign, depth_sign in ((-1, -1), (1, -1), (1, 1), (-1, 1))
            )
        indices = [self.vertex(point) for point in points]
        for face in (
            (0, 3, 2, 1), (4, 5, 6, 7),
            (0, 1, 5, 4), (1, 2, 6, 5),
            (2, 3, 7, 6), (3, 0, 4, 7),
        ):
            self.face(tuple(indices[index] for index in face), material)

    def octahedron(self, center: Vector, radius: float, material: int) -> None:
        points = [
            center + Vector((radius, 0, 0)), center + Vector((-radius, 0, 0)),
            center + Vector((0, radius, 0)), center + Vector((0, -radius, 0)),
            center + Vector((0, 0, radius)), center + Vector((0, 0, -radius)),
        ]
        indices = [self.vertex(point) for point in points]
        for face in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            self.face(tuple(indices[index] for index in face), material)

    def surface_disc(
        self,
        center: Vector,
        normal: Vector,
        radius: float,
        material: int,
        segments: int = 8,
    ) -> None:
        normal = normal.normalized()
        tangent = normal.cross(Vector((0.0, 0.0, 1.0)))
        if tangent.length < 0.1:
            tangent = normal.cross(Vector((0.0, 1.0, 0.0)))
        tangent.normalize()
        bitangent = normal.cross(tangent).normalized()
        center_index = self.vertex(center + normal * 0.001)
        ring = [
            self.vertex(
                center
                + normal * 0.001
                + tangent * cos(2.0 * pi * index / segments) * radius
                + bitangent * sin(2.0 * pi * index / segments) * radius
            )
            for index in range(segments)
        ]
        for index in range(segments):
            self.face((center_index, ring[index], ring[(index + 1) % segments]), material)

    def surface_patch(
        self,
        center: Vector,
        normal: Vector,
        radius: float,
        material: int,
    ) -> None:
        normal = normal.normalized()
        tangent = normal.cross(Vector((0.0, 0.0, 1.0)))
        if tangent.length < 0.1:
            tangent = normal.cross(Vector((0.0, 1.0, 0.0)))
        tangent.normalize()
        bitangent = normal.cross(tangent).normalized()
        shape = ((1.0, 0.0), (0.36, 0.82), (-0.62, 0.66), (-0.90, -0.20), (-0.18, -0.78), (0.68, -0.58))
        indices = [
            self.vertex(center + normal * 0.0015 + tangent * x * radius + bitangent * y * radius)
            for x, y in shape
        ]
        self.face(tuple(indices), material)


def helmet_dimensions(minimum: Vector, maximum: Vector) -> dict[str, float]:
    center_y = (minimum.y + maximum.y) * 0.5
    top = maximum.z
    return {
        "centerX": (minimum.x + maximum.x) * 0.5,
        "centerY": center_y,
        "topZ": top + 0.021,
        "rimZ": top - 0.128,
        "radiusX": max(abs(minimum.x), abs(maximum.x)) + 0.025,
        "frontRadius": center_y - minimum.y + 0.022,
        "backRadius": maximum.y - center_y + 0.025,
        "shellThickness": 0.0045,
    }


def dome_point(dimensions: dict[str, float], angle: float, progression: float, inset: float = 0.0) -> Vector:
    # progression: 0 at crown, 1 at brim.
    # A broad crown is essential: the character head remains full near its top.
    # Starting at a small plateau also removes the artificial conical peak.
    profile = 0.22 + 0.78 * sin(progression * pi * 0.5) ** 0.42
    x_radius = dimensions["radiusX"] - inset
    y_base = dimensions["backRadius"] if sin(angle) >= 0.0 else dimensions["frontRadius"]
    y_radius = y_base - inset
    dent = 1.0
    # A restrained stamped dent at front-right; broad enough to read in the
    # silhouette without turning the helmet into scrap-metal caricature.
    angle_delta = abs(((angle + 0.62 + pi) % (2.0 * pi)) - pi)
    if angle_delta < 0.32 and 0.38 < progression < 0.82:
        dent -= 0.045 * (1.0 - angle_delta / 0.32) * sin((progression - 0.38) / 0.44 * pi)
    z = dimensions["topZ"] - (dimensions["topZ"] - dimensions["rimZ"]) * progression
    z -= 0.010 * progression * progression
    return Vector((
        dimensions["centerX"] + cos(angle) * x_radius * profile * dent,
        dimensions["centerY"] + sin(angle) * y_radius * profile * dent,
        z,
    ))


def build_helmet_mesh(
    armature: bpy.types.Object,
    asset_id: str,
    dimensions: dict[str, float],
    materials: list[bpy.types.Material],
) -> bpy.types.Object:
    builder = MeshBuilder()
    segments = 20
    ring_count = 6
    rings: list[list[int]] = []
    for ring_index in range(ring_count + 1):
        progression = ring_index / ring_count
        ring = [
            builder.vertex(dome_point(dimensions, 2.0 * pi * index / segments, progression))
            for index in range(segments)
        ]
        rings.append(ring)
    builder.face(tuple(reversed(rings[0])), 0)
    for ring_index in range(ring_count):
        for index in range(segments):
            following = (index + 1) % segments
            builder.face((
                rings[ring_index][index], rings[ring_index][following],
                rings[ring_index + 1][following], rings[ring_index + 1][index],
            ), 0)

    # Inner shell at the exposed lower edge, plus the short closing band.
    inner_ring = [
        builder.vertex(dome_point(dimensions, 2.0 * pi * index / segments, 1.0, dimensions["shellThickness"]))
        for index in range(segments)
    ]
    for index in range(segments):
        following = (index + 1) % segments
        builder.face((rings[-1][index], inner_ring[index], inner_ring[following], rings[-1][following]), 1)

    # Flared brim, slightly broader at the rear and subtly lower there.
    brim_outer: list[int] = []
    brim_inner: list[int] = []
    for index in range(segments):
        angle = 2.0 * pi * index / segments
        back = max(0.0, sin(angle))
        front = max(0.0, -sin(angle))
        outer_x = dimensions["radiusX"] + 0.030
        y_radius = (dimensions["backRadius"] if sin(angle) >= 0 else dimensions["frontRadius"]) + 0.031 + back * 0.012 - front * 0.004
        z = dimensions["rimZ"] - 0.008 - back * 0.012
        brim_outer.append(builder.vertex((
            dimensions["centerX"] + cos(angle) * outer_x,
            dimensions["centerY"] + sin(angle) * y_radius,
            z,
        )))
        brim_inner.append(builder.vertex(dome_point(dimensions, angle, 1.0, 0.001)))
    for index in range(segments):
        following = (index + 1) % segments
        builder.face((brim_inner[index], brim_outer[index], brim_outer[following], brim_inner[following]), 0)

    # Rolled outer edge, expressed as a faceted tube matching the character.
    tube_sides = 5
    edge_rings: list[list[int]] = []
    for index in range(segments):
        angle = 2.0 * pi * index / segments
        center = Vector(builder.vertices[brim_outer[index]])
        radial = Vector((cos(angle), sin(angle), 0.0)).normalized()
        ring = []
        for tube_index in range(tube_sides):
            tube_angle = 2.0 * pi * tube_index / tube_sides
            ring.append(builder.vertex(center + radial * cos(tube_angle) * 0.0042 + Vector((0, 0, 1)) * sin(tube_angle) * 0.0042))
        edge_rings.append(ring)
    for index in range(segments):
        following = (index + 1) % segments
        for tube_index in range(tube_sides):
            next_tube = (tube_index + 1) % tube_sides
            builder.face((edge_rings[index][tube_index], edge_rings[following][tube_index], edge_rings[following][next_tube], edge_rings[index][next_tube]), 1)

    # Rear neck guard: a curved plate that extends the silhouette without
    # covering the ears or colliding with the jacket collar.
    guard_segments = 10
    guard_top: list[int] = []
    guard_bottom: list[int] = []
    for index in range(guard_segments + 1):
        angle = 0.25 + (pi - 0.50) * index / guard_segments
        x = dimensions["centerX"] + cos(angle) * (dimensions["radiusX"] + 0.020)
        y = dimensions["centerY"] + sin(angle) * (dimensions["backRadius"] + 0.034)
        guard_top.append(builder.vertex((x, y, dimensions["rimZ"] - 0.012)))
        lower_scale = 0.93
        guard_bottom.append(builder.vertex((
            dimensions["centerX"] + (x - dimensions["centerX"]) * lower_scale,
            y + 0.004,
            dimensions["rimZ"] - 0.073 + 0.012 * abs(cos(angle)),
        )))
    for index in range(guard_segments):
        builder.face((guard_top[index], guard_top[index + 1], guard_bottom[index + 1], guard_bottom[index]), 0)

    # Личность сварного шлема: купол сварен из четырёх листов, и швы-валики
    # идут крестом через макушку плюс кольцевой шов на середине высоты. Валики
    # нарочно неровные: каждый сегмент чуть гуляет по высоте.
    for seam_angle in (0.0, pi * 0.5):
        seam_points: list[Vector] = []
        for index in range(11):
            y_factor = -0.90 + 1.80 * index / 10
            progression = abs(y_factor) * 0.82
            angle = seam_angle + (pi if y_factor < 0 else 0.0)
            point = dome_point(dimensions, angle, progression)
            point.z += 0.007 + 0.002 * ((index * 7) % 3)
            seam_points.append(point)
        for start, end in zip(seam_points, seam_points[1:]):
            builder.box_between(start, end, Vector((sin(seam_angle), cos(seam_angle), 0)), 0.010, 0.005, 1)
    ring_seam: list[Vector] = []
    for index in range(21):
        angle = 2.0 * pi * index / 20
        point = dome_point(dimensions, angle, 0.55)
        point += Vector((cos(angle), sin(angle), 0.0)) * 0.004
        point.z += 0.001 * ((index * 5) % 3)
        ring_seam.append(point)
    for start, end in zip(ring_seam, ring_seam[1:]):
        builder.box_between(start, end, Vector((0, 0, 1)), 0.009, 0.0045, 1)

    # Шесть грубых болтов по нижнему поясу, каждый чуть сбит с шага.
    for index in range(6):
        angle = 2.0 * pi * index / 6 + 0.22 + 0.05 * ((index * 3) % 2)
        point = dome_point(dimensions, angle, 0.90)
        outward = Vector((cos(angle), sin(angle), 0.14)).normalized()
        builder.surface_disc(point + outward * 0.002, outward, 0.0085, 1, 6)

    # Подбородочный ремень — скрученная проволока, никакой пряжки.
    strap_front_y = dimensions["centerY"] - dimensions["frontRadius"] * 0.66
    for side in (-1.0, 1.0):
        start = Vector((dimensions["centerX"] + side * (dimensions["radiusX"] - 0.004), dimensions["centerY"] - 0.006, dimensions["rimZ"] - 0.014))
        middle = Vector((dimensions["centerX"] + side * 0.066, strap_front_y, dimensions["rimZ"] - 0.066))
        end = Vector((dimensions["centerX"] + side * 0.026, strap_front_y - 0.010, dimensions["rimZ"] - 0.114))
        builder.box_between(start, middle, Vector((0, 1, 0)), 0.007, 0.006, 3)
        builder.box_between(middle, end, Vector((0, 1, 0)), 0.007, 0.006, 3)
    twist_center = Vector((dimensions["centerX"], strap_front_y - 0.006, dimensions["rimZ"] - 0.114))
    for offset in (-0.012, 0.0, 0.012):
        builder.box_between(
            twist_center + Vector((offset - 0.006, 0, -0.004)),
            twist_center + Vector((offset + 0.006, 0, 0.004)),
            Vector((0, 1, 0)), 0.006, 0.005, 3)

    # Sparse rust scars and a welded repair tab.  These are intentional focal
    # points; the texture supplies the finer all-over wear.
    for angle, progression, radius in ((-2.10, 0.72, 0.0105), (0.82, 0.64, 0.008), (-0.48, 0.46, 0.007), (2.62, 0.38, 0.009), (1.55, 0.80, 0.0075)):
        point = dome_point(dimensions, angle, progression)
        normal = Vector((point.x - dimensions["centerX"], point.y - dimensions["centerY"], 0.45 * (point.z - dimensions["rimZ"]))).normalized()
        builder.surface_patch(point, normal, radius, 2)
    repair_center = dome_point(dimensions, 2.36, 0.66) + Vector((0, 0, 0.004))
    builder.box_between(repair_center + Vector((-0.018, 0, -0.010)), repair_center + Vector((0.018, 0, 0.010)), Vector((0, 1, 0)), 0.022, 0.0035, 1)

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
    bpy.ops.uv.smart_project(angle_limit=0.82, island_margin=0.016)
    bpy.ops.object.mode_set(mode="OBJECT")
    for polygon in helmet.data.polygons:
        polygon.use_smooth = polygon.material_index in {0, 1}
    helmet.select_set(False)
    helmet["realm_asset_id"] = asset_id
    helmet["realm_item_id"] = "weldedHelmet"
    helmet["realm_item_name_ru"] = "Стальной шлем"
    helmet["realm_art_direction"] = "character_geometry_b_materials_c"
    helmet["realm_review_only"] = True
    helmet["realm_runtime_integration_allowed"] = False
    return helmet


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def hide_hair(reference_objects: list[bpy.types.Object]) -> None:
    for obj in reference_objects:
        name = obj.name.lower()
        layer = str(obj.get("realm_character_layer", "")).lower()
        if "hair" in name or layer == "hair":
            obj.hide_render = True
            obj.hide_set(True)


def render_review(
    output: Path,
    camera_location: tuple[float, float, float],
    target: tuple[float, float, float],
    ortho_scale: float,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1050
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("steel_helmet_review_world")
    scene.world.color = (0.022, 0.025, 0.024)
    for obj in [obj for obj in list(scene.objects) if obj.name.startswith("steel_helmet_review_")]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name, location, energy, color, size in (
        ("steel_helmet_review_key", (-2.2, -3.0, 3.2), 780, (1.0, 0.79, 0.58), 2.3),
        ("steel_helmet_review_fill", (2.4, -1.1, 2.6), 620, (0.55, 0.72, 0.88), 2.7),
        ("steel_helmet_review_rim", (0.0, 2.4, 2.8), 820, (0.94, 0.68, 0.43), 2.0),
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
    camera.name = "steel_helmet_review_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.data.lens = 62
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
            position = primitive.get("attributes", {}).get("POSITION")
            if position is not None:
                vertices += accessors[position]["count"]
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
        "bones": sum(1 for node in gltf.get("nodes", []) if node.get("name") in {bone.name for armature in bpy.data.armatures for bone in armature.bones}),
    }


def export_candidate(output: Path, armature: bpy.types.Object, helmet: bpy.types.Object) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    helmet.select_set(True)
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


def fit_report(
    body_id: str,
    minimum: Vector,
    maximum: Vector,
    dimensions: dict[str, float],
    head_vertex_count: int,
) -> dict[str, object]:
    base_clearance = {
        "side": round(dimensions["radiusX"] - max(abs(minimum.x), abs(maximum.x)), 5),
        "front": round(dimensions["frontRadius"] - (dimensions["centerY"] - minimum.y), 5),
        "back": round(dimensions["backRadius"] - (maximum.y - dimensions["centerY"]), 5),
        "crown": round(dimensions["topZ"] - maximum.z, 5),
    }
    faces = {}
    for sex in ("female", "male"):
        for profile_id, profile in FACE_PROFILES.items():
            scale = profile["headScale"]
            faces[f"{sex}_{profile_id}"] = {
                "label": profile["label"],
                "headScale": scale,
                "relativeFitPreservedByHeadBone": True,
                "scaledClearance": {
                    "side": round(base_clearance["side"] * scale[0], 5),
                    "front": round(base_clearance["front"] * scale[1], 5),
                    "back": round(base_clearance["back"] * scale[1], 5),
                    "crown": round(base_clearance["crown"] * scale[2], 5),
                },
            }
    return {
        "bodyId": body_id,
        "headVertexCount": head_vertex_count,
        "headBounds": {
            "minimum": [round(value, 6) for value in minimum],
            "maximum": [round(value, 6) for value in maximum],
        },
        "helmetDimensions": {key: round(value, 6) for key, value in dimensions.items()},
        "baseClearance": base_clearance,
        "faceProfiles": faces,
        "hairPolicy": "runtime_hides_hair_when_any_helmet_is_equipped",
        "result": "pass",
    }


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
    hide_hair(reference_objects)
    bpy.context.view_layer.update()

    minimum, maximum, head_vertex_count = head_bounds(body, armature)
    dimensions = helmet_dimensions(minimum, maximum)
    materials = [
        pbr_material("welded_scrap_plates", (0.098, 0.104, 0.096), 0.74, 0.62, args.body_id, 0.24),
        pbr_material("welded_seam_beads", (0.062, 0.058, 0.052), 0.55, 0.70, args.body_id, 0.12),
        pbr_material("welded_heavy_rust", (0.185, 0.066, 0.022), 0.93, 0.08, args.body_id, 0.26),
        pbr_material("welded_wire_strap", (0.140, 0.148, 0.140), 0.52, 0.80, args.body_id, 0.10),
    ]
    helmet = build_helmet_mesh(armature, args.asset_id, dimensions, materials)

    target = (dimensions["centerX"], dimensions["centerY"] - 0.005, maximum.z - 0.075)
    if args.front_render:
        render_review(args.front_render, (0.88, -2.65, maximum.z + 0.22), target, 0.67)
    if args.side_render:
        render_review(args.side_render, (2.65, -0.12, maximum.z + 0.13), target, 0.67)
    if args.back_render:
        render_review(args.back_render, (-0.40, 2.65, maximum.z + 0.18), target, 0.67)
    if args.detail_render:
        render_review(args.detail_render, (0.58, -2.15, maximum.z + 0.28), (target[0], target[1], maximum.z - 0.015), 0.46)

    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))

    # Keep only the rig and helmet in the review GLB.
    for obj in list(reference_objects):
        if obj != armature and obj != helmet and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [obj for obj in list(bpy.context.scene.objects) if obj not in (armature, helmet)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    export_candidate(args.output, armature, helmet)
    report = {
        "assetId": args.asset_id,
        "itemId": "weldedHelmet",
        "itemNameRu": "Стальной шлем",
        "bodyId": args.body_id,
        "file": args.output.name,
        "actualGlb": parse_exported_glb(args.output),
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "fit": fit_report(args.body_id, minimum, maximum, dimensions, head_vertex_count),
        "design": {
            "geometry": "B",
            "materialsAndWear": "C",
            "features": ["штампованный купол", "усиленный обод", "затылочная пластина", "ремень", "заклёпки", "вмятина", "локальная ржавчина"],
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
    print("REALM_UNIFIED_WELDED_HELMET_V1=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
