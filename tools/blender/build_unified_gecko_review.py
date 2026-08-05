"""Build a review-only B+C wasteland gecko from Quaternius topology.

The CC0 Velociraptor donor supplies one continuous biped reptile mesh, a
deforming 29-bone skin and authored locomotion/combat clips. The Realm rebuild
keeps that animation-safe topology, adjusts the readable head/foot masses,
replaces every material and remains review-only until art approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import ceil, floor, pi, sin
from pathlib import Path
import random
import struct
import sys

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
SOURCE_ACTIONS = {
    "idle": "Velociraptor_Idle",
    "walk": "Velociraptor_Walk",
    "run": "Velociraptor_Run",
    "attack": "Velociraptor_Attack",
    "death": "Velociraptor_Death",
}
DONOR_SHA256 = "ADDFA06B9851B61F8E53B0CD1468E45C43CA0F4F2D2C6B756F1C8C0EFA5FFFC1"
ROOT_SCALE = (0.45, 0.25, 0.32)
RUNTIME_SCALE_MULTIPLIER = 2.2
RUNTIME_ROOT_SCALE_MULTIPLIER = RUNTIME_SCALE_MULTIPLIER ** 0.5
# The evaluated skinned vertices already inherit the asset-root scale and the
# glTF exporter also preserves that root transform. Applying sqrt(target)
# therefore produces the requested uniform target multiplier in the GLB.
RUNTIME_ROOT_SCALE = tuple(
    component * RUNTIME_ROOT_SCALE_MULTIPLIER for component in ROOT_SCALE
)
GROUND_CLEARANCE_METRES = 0.0015
GROUND_PENETRATION_TOLERANCE_METRES = 0.0005
FIRE_FISSURE_TARGETS_Y = (-0.665, -0.096, 0.567, 1.315, 2.020)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="creature_wasteland_gecko_unified_v1")
    parser.add_argument(
        "--variant",
        choices=("standard", "fire"),
        default="standard",
    )
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


def texture_image(
    name: str,
    base: tuple[float, float, float],
    kind: str,
    size: int = 512,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-gecko-unified-v1:{name}:{kind}")
    pixels: list[float] = []
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.041 + y * 0.019) * 0.46
            scales = sin(x * 0.175) * sin(y * 0.123) * 0.30
            contact = max(0.0, 1.0 - y / (size * 0.46))
            noise = (rng.random() - 0.5) * 0.16
            if kind == "albedo":
                variation = broad * 0.10 + scales * 0.08 + noise * 0.05
                dust = contact * 0.055
                values = tuple(
                    max(0.025, min(0.92, channel * (1.0 + variation) + dust))
                    for channel in base
                )
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(
                    0.44,
                    min(0.99, base[0] + broad * 0.045 + contact * 0.035),
                )
                pixels.extend((value, value, value, 1.0))
            elif kind == "emission_fissure":
                primary = abs(
                    sin(
                        x * 0.071
                        + sin(y * 0.043) * 2.25
                        + sin(y * 0.013) * 1.15
                    )
                )
                branch = abs(
                    sin(
                        y * 0.087
                        + x * 0.021
                        + sin(x * 0.037) * 1.45
                    )
                )
                cold_gap = (
                    sin(x * 0.017 + y * 0.011)
                    + sin(x * 0.006 - y * 0.019)
                )
                intensity = 0.0
                if primary < 0.110 and cold_gap > 0.10:
                    intensity = 0.68 + (0.110 - primary) * 1.2
                elif branch < 0.055 and cold_gap > 0.65:
                    intensity = 0.48 + (0.055 - branch) * 2.2
                intensity = min(0.84, intensity)
                pixels.extend(
                    (
                        base[0] * intensity,
                        base[1] * intensity,
                        base[2] * intensity,
                        1.0,
                    )
                )
            else:
                pixels.extend(
                    (
                        0.5 + scales * 0.028 + broad * 0.012,
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
    normal_strength: float,
    emission_color: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    emission_texture_kind: str | None = None,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
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
    if emission_color is not None and emission_strength > 0.0:
        if emission_texture_kind:
            emission_texture = nodes.new("ShaderNodeTexImage")
            emission_texture.image = texture_image(
                f"{name}_{emission_texture_kind}",
                emission_color,
                emission_texture_kind,
            )
            links.new(
                emission_texture.outputs["Color"],
                bsdf.inputs["Emission Color"],
            )
        else:
            bsdf.inputs["Emission Color"].default_value = (
                *emission_color,
                1.0,
            )
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def create_fire_body_uv(body: bpy.types.Object) -> None:
    """Create deterministic planar UVs for thin packed fissure textures."""
    minimum_x = min(vertex.co.x for vertex in body.data.vertices)
    maximum_x = max(vertex.co.x for vertex in body.data.vertices)
    minimum_y = min(vertex.co.y for vertex in body.data.vertices)
    maximum_y = max(vertex.co.y for vertex in body.data.vertices)
    span_x = max(1e-6, maximum_x - minimum_x)
    span_y = max(1e-6, maximum_y - minimum_y)
    uv_layer = body.data.uv_layers.get("RealmFireHeatUV")
    if uv_layer is None:
        uv_layer = body.data.uv_layers.new(name="RealmFireHeatUV")
    for loop in body.data.loops:
        point = body.data.vertices[loop.vertex_index].co
        uv_layer.data[loop.index].uv = (
            (point.x - minimum_x) / span_x,
            (point.y - minimum_y) / span_y,
        )
    body.data.uv_layers.active = uv_layer
    body.data.update()


def vertex_weight(
    vertex: bpy.types.MeshVertex,
    group_names: dict[int, str],
    wanted: set[str],
) -> float:
    return max(
        (
            assignment.weight
            for assignment in vertex.groups
            if group_names.get(assignment.group) in wanted
        ),
        default=0.0,
    )


def rebuild_body(
    body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
    variant: str = "standard",
) -> dict[str, object]:
    group_names = {group.index: group.name for group in body.vertex_groups}
    original = [vertex.co.copy() for vertex in body.data.vertices]
    original_materials = [
        body.data.materials[polygon.material_index].name.lower()
        for polygon in body.data.polygons
    ]
    head_groups = {"Head"}
    foot_groups = {
        "FrontFoot.R",
        "FrontFoot.L",
        "BackFoot.R",
        "BackFoot.L",
        "FrontLowLeg.R",
        "FrontLowLeg.L",
        "BackLowLeg.R",
        "BackLowLeg.L",
    }
    limb_groups = foot_groups | {
        "FrontLeg.R",
        "FrontLeg.L",
        "FrontUpLeg.R",
        "FrontUpLeg.L",
        "BackLeg.R",
        "BackLeg.L",
        "BackUpLeg.R",
        "BackUpLeg.L",
    }
    head_points = [
        source
        for vertex, source in zip(body.data.vertices, original)
        if vertex_weight(vertex, group_names, head_groups) > 0.35
    ]
    if not head_points:
        raise RuntimeError("Quaternius donor has no weighted head vertices")
    head_front_y = min(point.y for point in head_points)
    head_rear_y = max(point.y for point in head_points)
    head_bottom_z = min(point.z for point in head_points)
    head_top_z = max(point.z for point in head_points)
    head_span_y = max(1e-6, head_rear_y - head_front_y)
    head_span_z = max(1e-6, head_top_z - head_bottom_z)
    for vertex, source in zip(body.data.vertices, original):
        point = source.copy()
        head_weight = vertex_weight(vertex, group_names, head_groups)
        foot_weight = vertex_weight(vertex, group_names, foot_groups)
        limb_weight = vertex_weight(vertex, group_names, limb_groups)
        chest_weight = vertex_weight(
            vertex,
            group_names,
            {"Neck", "Shoulders", "Torso"},
        )
        snout = max(
            0.0,
            min(1.0, (head_rear_y - source.y) / head_span_y),
        )
        head_height = max(
            0.0,
            min(1.0, (source.z - head_bottom_z) / head_span_z),
        )
        orbital = max(0.0, 1.0 - abs(snout - 0.47) / 0.25) * max(
            0.0,
            1.0 - abs(head_height - 0.67) / 0.28,
        )
        cheek = max(0.0, 1.0 - abs(snout - 0.35) / 0.28) * max(
            0.0,
            1.0 - abs(head_height - 0.38) / 0.30,
        )
        jaw_taper = (
            0.80 + 0.20 * min(1.0, head_height / 0.38)
            if head_height < 0.38
            else 1.0
        )
        head_width_scale = (
            (1.04 - snout * 0.42)
            + orbital * 0.15
            + cheek * 0.08
        ) * jaw_taper
        point.x *= 1.0 + head_weight * (head_width_scale - 1.0)
        point.y -= head_weight * (snout ** 1.65) * 0.105
        point.z += head_weight * (
            0.020 * (1.0 - snout)
            - 0.035 * snout
            + orbital * 0.020
        )
        if head_height < 0.38:
            point.z += (
                head_weight
                * (0.38 - head_height)
                * (0.055 + snout * 0.055)
            )
        if head_height > 0.70:
            crown_center = max(
                0.0,
                1.0 - abs(source.x) / 0.16,
            )
            point.z += (
                head_weight
                * max(0.0, 1.0 - abs(snout - 0.35) / 0.38)
                * (crown_center * 0.048 - (1.0 - crown_center) * 0.022)
            )
            if variant == "fire":
                skull_scute = max(
                    0.0,
                    1.0 - abs(snout - 0.38) / 0.34,
                )
                point.z += (
                    head_weight
                    * crown_center
                    * skull_scute
                    * 0.180
                )
        chest_ventral = max(
            0.0,
            min(1.0, (1.28 - source.z) / 0.34),
        )
        chest_longitudinal = max(
            0.0,
            min(1.0, (source.y + 1.18) / 0.82),
        )
        chest_mass = chest_weight * chest_ventral * chest_longitudinal
        point.z -= chest_mass * 0.320
        point.y -= chest_mass * 0.240
        point.x *= 1.0 + chest_mass * 0.26
        if variant == "fire":
            nearby_top = [
                candidate.z
                for candidate in original
                if abs(candidate.y - source.y) < 0.075
            ]
            local_top = max(nearby_top) if nearby_top else source.z
            dorsal_surface = max(
                0.0,
                min(1.0, (source.z - (local_top - 0.105)) / 0.105),
            )
            centerline = max(
                0.0,
                min(1.0, 1.0 - abs(source.x) / 0.17),
            )
            front_fade = max(
                0.0,
                min(1.0, (source.y + 1.15) / 0.28),
            )
            rear_fade = max(
                0.0,
                min(1.0, (1.72 - source.y) / 0.35),
            )
            thermal_zone = front_fade * rear_fade * (1.0 - limb_weight)
            scute_wave = 0.12 + 0.88 * (
                max(0.0, sin((source.y + 1.10) * 8.4)) ** 1.55
            )
            major_scute_mass = (
                0.72
                + max(0.0, sin((source.y + 1.04) * 3.35)) * 0.42
                + max(0.0, sin((source.y - 0.18) * 1.72)) * 0.18
            )
            scute_lift = (
                dorsal_surface
                * centerline
                * thermal_zone
                * scute_wave
                * major_scute_mass
                * 0.260
            )
            point.z += scute_lift
            point.x *= 1.0 + scute_lift * 0.72
        if foot_weight and abs(point.x) > 1e-5:
            point.x += (0.08 if point.x > 0.0 else -0.08) * foot_weight
        vertex.co = point

    if variant == "fire":
        create_fire_body_uv(body)
    body.data.materials.clear()
    body.data.materials.append(materials["scales"])
    body.data.materials.append(materials["underbelly"])
    body.data.materials.append(materials["ridge"])
    body.data.materials.append(materials["dark"])
    if variant == "fire":
        body.data.materials.append(materials["ember"])
    ridge_polygons = 0
    ember_polygons = 0
    for polygon, source_material in zip(
        body.data.polygons,
        original_materials,
    ):
        center = sum(
            (original[index] for index in polygon.vertices),
            Vector(),
        ) / len(polygon.vertices)
        nearby_top = [
            point.z
            for point in original
            if abs(point.y - center.y) < 0.12
        ]
        local_top = (
            max(nearby_top)
            if nearby_top
            else max(original[index].z for index in polygon.vertices)
        )
        ventral_width = max(
            0.060,
            0.20 - max(0.0, center.y) * 0.050,
        )
        is_ventral = (
            center.z <= local_top - 0.16
            and abs(center.x) <= ventral_width
            and center.y < 2.25
            and max(
                vertex_weight(
                    body.data.vertices[index],
                    group_names,
                    limb_groups,
                )
                for index in polygon.vertices
            )
            < 0.25
        )
        if "black" in source_material:
            polygon.material_index = 3
        elif "light" in source_material or is_ventral:
            # The throat stays matte. Assigning emission to these large donor
            # polygons reads as a neon bib rather than subsurface fissures.
            polygon.material_index = 1
        else:
            dorsal_width = max(
                0.035,
                0.14
                - max(0.0, center.y) * 0.045
                + sin(center.y * 8.0 + polygon.index * 0.47) * 0.022,
            )
            if center.y < -0.75:
                dorsal_width = max(
                    0.028,
                    dorsal_width
                    * (
                        0.30
                        + max(0.0, min(1.0, (center.y + 1.45) / 0.70))
                        * 0.22
                    ),
                )
            is_dorsal = (
                center.z
                >= local_top
                - 0.035
                - max(
                    0.0,
                    sin(center.y * 6.5 + polygon.index * 0.31),
                )
                * 0.018
                and abs(center.x) <= dorsal_width
            )
            if is_dorsal:
                is_dorsal_heat = (
                    variant == "fire"
                    and abs(center.x) <= max(0.032, dorsal_width * 0.95)
                    and min(
                        abs(center.y - target_y)
                        for target_y in FIRE_FISSURE_TARGETS_Y
                    )
                    < 0.055
                )
                if is_dorsal_heat:
                    polygon.material_index = 4
                    ember_polygons += 1
                else:
                    polygon.material_index = 2
                    ridge_polygons += 1
            else:
                polygon.material_index = 0
        polygon.use_smooth = False
    body.data.update()
    if ridge_polygons < 8:
        raise RuntimeError(
            f"Dorsal accent is too sparse: only {ridge_polygons} polygons"
        )
    if variant == "fire" and ember_polygons < 6:
        raise RuntimeError(
            f"Fire-gecko heat fissures are too sparse: {ember_polygons} polygons"
        )
    material_polygon_counts = {
        material.name: sum(
            1
            for polygon in body.data.polygons
            if polygon.material_index == index
        )
        for index, material in enumerate(body.data.materials)
    }
    result = {
        "variant": variant,
        "ridgePolygons": ridge_polygons,
        "emberPolygons": ember_polygons,
        "materialPolygonCounts": material_polygon_counts,
    }
    if variant == "fire":
        result["thermalEffect"] = {
            "ventralEmissivePolygons": 0,
            "dorsalPattern": "five short windows separated by cold intervals",
            "emissionMask": "packed 512 px irregular fissure texture",
            "eyeEmissionStrength": 0.16,
            "fissureEmissionStrength": 0.28,
        }
    return result


def create_facial_details(
    body: bpy.types.Object,
    armature: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
    variant: str = "standard",
) -> bpy.types.Object:
    """Create low-poly, non-emissive facial landmarks on the head skin."""
    head_group = body.vertex_groups.get("Head")
    if head_group is None:
        raise RuntimeError("Quaternius donor has no Head vertex group")
    head_points: list[Vector] = []
    for vertex in body.data.vertices:
        if any(
            assignment.group == head_group.index and assignment.weight > 0.35
            for assignment in vertex.groups
        ):
            head_points.append(vertex.co.copy())
    if not head_points:
        raise RuntimeError("Cannot derive gecko eye anchors")

    minimum_y = min(point.y for point in head_points)
    maximum_y = max(point.y for point in head_points)
    minimum_z = min(point.z for point in head_points)
    maximum_z = max(point.z for point in head_points)
    half_width = max(abs(point.x) for point in head_points)
    eye_y = minimum_y + (maximum_y - minimum_y) * 0.49
    eye_z = minimum_z + (maximum_z - minimum_z) * 0.67
    pieces: list[bpy.types.Object] = []
    surface = BVHTree.FromPolygons(
        [vertex.co.copy() for vertex in body.data.vertices],
        [tuple(polygon.vertices) for polygon in body.data.polygons],
    )

    def add_mouth_segment(
        start_local: Vector,
        end_local: Vector,
    ) -> None:
        start_world = body.matrix_world @ start_local
        end_world = body.matrix_world @ end_local
        delta = end_world - start_world
        if delta.length <= 1e-6:
            return
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=6,
            radius=0.006,
            depth=delta.length,
            location=(start_world + end_world) * 0.5,
        )
        seam = bpy.context.object
        seam.rotation_mode = "QUATERNION"
        seam.rotation_quaternion = delta.to_track_quat("Z", "Y")
        seam.data.materials.append(materials["dark"])
        pieces.append(seam)

    for side in (-1.0, 1.0):
        direction = Vector((side, 0.0, 0.0))
        hit = surface.ray_cast(
            Vector((side * (half_width + 0.5), eye_y, eye_z)),
            -direction,
            half_width + 1.0,
        )
        if hit[0] is None:
            raise RuntimeError(f"Cannot place gecko eye on side {side:+.0f}")
        eye_surface = hit[0]

        socket_local = eye_surface - direction * 0.007
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8,
            radius=0.075,
            depth=0.032,
            location=body.matrix_world @ socket_local,
            rotation=(0.0, pi * 0.5, 0.0),
        )
        socket = bpy.context.object
        socket.scale = (1.0, 1.0, 0.84)
        bpy.ops.object.transform_apply(
            location=False,
            rotation=False,
            scale=True,
        )
        socket.data.materials.append(materials["dark"])
        pieces.append(socket)

        iris_local = eye_surface + direction * 0.012
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8,
            radius=0.052 if variant == "fire" else 0.047,
            depth=0.024,
            location=body.matrix_world @ iris_local,
            rotation=(0.0, pi * 0.5, 0.0),
        )
        iris = bpy.context.object
        iris.scale = (1.0, 1.0, 0.86)
        bpy.ops.object.transform_apply(
            location=False,
            rotation=False,
            scale=True,
        )
        iris.data.materials.append(materials["eyes"])
        pieces.append(iris)

        pupil_local = eye_surface + direction * 0.026
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8,
            radius=0.020,
            depth=0.016,
            location=body.matrix_world @ pupil_local,
            rotation=(0.0, pi * 0.5, 0.0),
        )
        pupil = bpy.context.object
        pupil.data.materials.append(materials["dark"])
        pieces.append(pupil)

        nostril_x = side * half_width * 0.25
        nostril_z = minimum_z + (maximum_z - minimum_z) * 0.43
        nostril_hit = surface.ray_cast(
            Vector((nostril_x, minimum_y - 0.5, nostril_z)),
            Vector((0.0, 1.0, 0.0)),
            1.0,
        )
        if nostril_hit[0] is None:
            raise RuntimeError(f"Cannot place gecko nostril on side {side:+.0f}")
        nostril_local = nostril_hit[0] + Vector((0.0, -0.006, 0.0))
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8,
            radius=0.019,
            depth=0.014,
            location=body.matrix_world @ nostril_local,
            rotation=(pi * 0.5, 0.0, 0.0),
        )
        nostril = bpy.context.object
        nostril.data.materials.append(materials["dark"])
        pieces.append(nostril)

        hinge_y = minimum_y + (maximum_y - minimum_y) * 0.68
        hinge_z = minimum_z + (maximum_z - minimum_z) * 0.37
        hinge_hit = surface.ray_cast(
            Vector((side * (half_width + 0.5), hinge_y, hinge_z)),
            -direction,
            half_width + 1.0,
        )
        if hinge_hit[0] is None:
            raise RuntimeError(
                f"Cannot place gecko jaw hinge on side {side:+.0f}"
            )
        hinge_local = hinge_hit[0] + direction * 0.010
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8,
            radius=0.031,
            depth=0.012,
            location=body.matrix_world @ hinge_local,
            rotation=(0.0, pi * 0.5, 0.0),
        )
        hinge = bpy.context.object
        hinge.scale = (1.0, 1.0, 0.76)
        bpy.ops.object.transform_apply(
            location=False,
            rotation=False,
            scale=True,
        )
        hinge.data.materials.append(materials["dark"])
        pieces.append(hinge)

        mouth_points: list[Vector] = []
        for longitudinal, vertical in (
            (0.10, 0.29),
            (0.28, 0.30),
            (0.48, 0.32),
            (0.66, 0.36),
        ):
            mouth_y = minimum_y + (maximum_y - minimum_y) * longitudinal
            mouth_z = minimum_z + (maximum_z - minimum_z) * vertical
            mouth_hit = surface.ray_cast(
                Vector((side * (half_width + 0.5), mouth_y, mouth_z)),
                -direction,
                half_width + 1.0,
            )
            if mouth_hit[0] is None:
                raise RuntimeError(
                    f"Cannot trace gecko mouth on side {side:+.0f}"
                )
            mouth_points.append(mouth_hit[0] + direction * 0.007)
        for start, end in zip(mouth_points, mouth_points[1:]):
            add_mouth_segment(start, end)

    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    eyes = bpy.context.object
    eyes.name = (
        "fire_gecko_facial_details"
        if variant == "fire"
        else "gecko_facial_details"
    )
    world_matrix = eyes.matrix_world.copy()
    eyes.parent = armature
    eyes.parent_type = "OBJECT"
    eyes.matrix_world = world_matrix
    head_weights = eyes.vertex_groups.new(name="Head")
    head_weights.add(
        list(range(len(eyes.data.vertices))),
        1.0,
        "REPLACE",
    )
    modifier = eyes.modifiers.new("Armature", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    if variant == "fire":
        eyes["realm_facial_detail"] = (
            "embedded ember eyes, charcoal pupils, heat vents, jaw hinges "
            "and faceted mouth seam"
        )
    else:
        eyes["realm_facial_detail"] = (
            "embedded amber eyes, charcoal pupils, nostrils, jaw hinges and "
            "faceted mouth seam"
        )
    return eyes


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        bone.scale = (1.0, 1.0, 1.0)


def create_hurt_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new("hurt")
    armature.animation_data_create()
    armature.animation_data.action = action
    scene = bpy.context.scene
    targets = ("Body", "Shoulders", "Neck", "Head")
    poses = {
        1: {
            "Body": Quaternion((1.0, 0.0, 0.0, 0.0)),
            "Shoulders": Quaternion((1.0, 0.0, 0.0, 0.0)),
            "Neck": Quaternion((1.0, 0.0, 0.0, 0.0)),
            "Head": Quaternion((1.0, 0.0, 0.0, 0.0)),
        },
        5: {
            "Body": Quaternion(Vector((0.0, 1.0, 0.0)), -0.10),
            "Shoulders": Quaternion(Vector((1.0, 0.0, 0.0)), 0.18),
            "Neck": Quaternion(Vector((1.0, 0.0, 0.0)), -0.28),
            "Head": Quaternion(Vector((0.0, 0.0, 1.0)), 0.24),
        },
        11: {
            "Body": Quaternion((1.0, 0.0, 0.0, 0.0)),
            "Shoulders": Quaternion((1.0, 0.0, 0.0, 0.0)),
            "Neck": Quaternion((1.0, 0.0, 0.0, 0.0)),
            "Head": Quaternion((1.0, 0.0, 0.0, 0.0)),
        },
    }
    for frame, rotations in poses.items():
        scene.frame_set(frame)
        for name in targets:
            bone = armature.pose.bones[name]
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = rotations[name]
            bone.keyframe_insert(
                "rotation_quaternion",
                frame=frame,
                group=name,
            )
    for curve in action.fcurves:
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "BEZIER"
    reset_pose(armature)
    return action


def prepare_actions(armature: bpy.types.Object) -> None:
    retained: set[bpy.types.Action] = set()
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions.get(source)
        if action is None:
            raise RuntimeError(f"Quaternius donor has no required action {source}")
        action.name = target
        action.use_fake_user = True
        retained.add(action)
    hurt = create_hurt_action(armature)
    hurt.use_fake_user = True
    retained.add(hurt)
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)
    armature.animation_data.action = bpy.data.actions["idle"]


def refine_combat_and_death_actions(
    armature: bpy.types.Object,
) -> dict[str, object]:
    """Make the strike read from the head and keep the fall anatomically compact."""
    scene = bpy.context.scene
    tail_bones = ("Tail1", "Tail2", "Tail3", "Tail4", "Tail5")
    forelimb_bones = (
        "FrontUpLeg.L",
        "FrontLowLeg.L",
        "FrontFoot.L",
        "FrontUpLeg.R",
        "FrontLowLeg.R",
        "FrontFoot.R",
    )

    armature.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(30)
    bpy.context.view_layer.update()
    neutral_forelimbs = {
        name: armature.pose.bones[name].matrix_basis.decompose()
        for name in forelimb_bones
    }

    armature.animation_data.action = bpy.data.actions["run"]
    scene.frame_set(6)
    bpy.context.view_layer.update()
    running_tail = {
        name: armature.pose.bones[name].rotation_quaternion.copy()
        for name in tail_bones
    }

    attack = bpy.data.actions["attack"]
    for curve in list(attack.fcurves):
        if any(
            curve.data_path.startswith(f'pose.bones["{name}"]')
            for name in tail_bones + forelimb_bones
        ):
            attack.fcurves.remove(curve)
    armature.animation_data.action = attack
    attack_tail_frames = (0, 5, 7, 9, 12, 16, 20)
    for frame in attack_tail_frames:
        scene.frame_set(frame)
        for name in tail_bones:
            bone = armature.pose.bones[name]
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = running_tail[name]
            bone.keyframe_insert(
                "rotation_quaternion",
                frame=frame,
                group=name,
            )

    for frame in attack_tail_frames:
        scene.frame_set(frame)
        for bone_name, (
            location,
            rotation,
            scale,
        ) in neutral_forelimbs.items():
            bone = armature.pose.bones[bone_name]
            bone.location = location
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = rotation
            bone.scale = scale
            bone.keyframe_insert(
                "location",
                frame=frame,
                group=bone_name,
            )
            bone.keyframe_insert(
                "rotation_quaternion",
                frame=frame,
                group=bone_name,
            )
            bone.keyframe_insert(
                "scale",
                frame=frame,
                group=bone_name,
            )

    source_death = bpy.data.actions["death"]
    death_pose_mapping = {
        0: 0,
        20: 12,
        31: 31,
    }
    sampled_death_poses: dict[
        int,
        dict[str, tuple[Vector, Quaternion, Vector]],
    ] = {}
    armature.animation_data.action = source_death
    for source_frame, target_frame in death_pose_mapping.items():
        scene.frame_set(source_frame)
        bpy.context.view_layer.update()
        sampled_death_poses[target_frame] = {
            bone.name: bone.matrix_basis.decompose()
            for bone in armature.pose.bones
        }
    death = bpy.data.actions.new("death_refined")
    death.use_fake_user = True
    armature.animation_data.action = death
    for target_frame, pose in sampled_death_poses.items():
        scene.frame_set(target_frame)
        for bone_name, (location, rotation, scale) in pose.items():
            bone = armature.pose.bones[bone_name]
            bone.location = location
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = rotation
            bone.scale = scale
            bone.keyframe_insert(
                "location",
                frame=target_frame,
                group=bone_name,
            )
            bone.keyframe_insert(
                "rotation_quaternion",
                frame=target_frame,
                group=bone_name,
            )
            bone.keyframe_insert(
                "scale",
                frame=target_frame,
                group=bone_name,
            )
    source_death.use_fake_user = False
    bpy.data.actions.remove(source_death)
    death.name = "death"

    for action in (attack, death):
        for curve in action.fcurves:
            for keyframe in curve.keyframe_points:
                keyframe.interpolation = "BEZIER"
                keyframe.handle_left_type = "AUTO_CLAMPED"
                keyframe.handle_right_type = "AUTO_CLAMPED"
    armature.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)
    bpy.context.view_layer.update()
    return {
        "attack": {
            "tailReference": "run frame 6",
            "tailKeyframes": list(attack_tail_frames),
            "forelimbReference": "idle frame 30",
            "forelimbBones": list(forelimb_bones),
            "purpose": (
                "low counterbalancing tail and neutral separated forelimbs "
                "expose the head-first lunge"
            ),
        },
        "death": {
            "sourceToTargetPoseFrames": death_pose_mapping,
            "purpose": (
                "direct full-rig blend from stance through grounded collapse "
                "to final rest, without the donor's vertical neck extension"
            ),
        },
    }


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


def apply_ground_contact_corrections(
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    root: bpy.types.Object,
) -> dict[str, dict[str, float | int]]:
    """Add a world-up root correction without altering authored bone motion."""
    if abs(root.rotation_euler.x) > 1e-6 or abs(root.rotation_euler.y) > 1e-6:
        raise RuntimeError("Ground correction requires an unrotated asset root")
    if root.scale.z <= 0.0:
        raise RuntimeError("Ground correction requires a positive root Z scale")

    scene = bpy.context.scene
    original_action = armature.animation_data.action
    original_frame = scene.frame_current
    original_location = armature.location.copy()
    results: dict[str, dict[str, float | int]] = {}

    for action_name in REQUIRED_ACTIONS:
        action = bpy.data.actions[action_name]
        armature.animation_data.action = action
        armature.location = original_location
        start = int(floor(action.frame_range[0]))
        end = int(ceil(action.frame_range[1]))
        frames = list(range(start, end + 1))
        minimum_before: list[float] = []
        corrections_world: list[float] = []

        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            minimum_z = evaluated_bounds(meshes)[0].z
            minimum_before.append(minimum_z)
            corrections_world.append(
                (
                    GROUND_CLEARANCE_METRES - minimum_z
                    if minimum_z < -GROUND_PENETRATION_TOLERANCE_METRES
                    else 0.0
                )
            )

        existing = next(
            (
                curve
                for curve in action.fcurves
                if curve.data_path == "location" and curve.array_index == 2
            ),
            None,
        )
        if existing is not None:
            action.fcurves.remove(existing)
        curve = action.fcurves.new(
            data_path="location",
            index=2,
            action_group="GroundContact",
        )
        curve.keyframe_points.add(len(frames))
        for point, frame, correction_world in zip(
            curve.keyframe_points,
            frames,
            corrections_world,
        ):
            point.co = (
                frame,
                original_location.z + correction_world / root.scale.z,
            )
            point.interpolation = "LINEAR"
        curve.update()

        minimum_after: list[float] = []
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            minimum_after.append(evaluated_bounds(meshes)[0].z)
        worst_after = min(minimum_after)
        if worst_after < -GROUND_PENETRATION_TOLERANCE_METRES:
            raise RuntimeError(
                f"{action_name} still penetrates ground by {-worst_after:.6f} m"
            )
        results[action_name] = {
            "sampledFrames": len(frames),
            "minimumBeforeMetres": round(min(minimum_before), 6),
            "minimumAfterMetres": round(worst_after, 6),
            "maximumVerticalCorrectionMetres": round(
                max(corrections_world),
                6,
            ),
        }

    armature.animation_data.action = original_action
    armature.location = original_location
    scene.frame_set(original_frame)
    bpy.context.view_layer.update()
    return results


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
        "animations": sorted(
            animation.get("name", "") for animation in gltf.get("animations", [])
        ),
        "nodes": [node.get("name", "") for node in gltf.get("nodes", [])],
    }


def export_candidate(
    output: Path,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    root.select_set(True)
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Quaternius Animated Dinosaur Pack / Velociraptor topology, rig "
            "and base animations: CC0 1.0. Realm of Ashes gecko materials "
            "and hurt animation: project work."
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
    runtime_approved_sha = str(args.runtime_approved_sha or "").upper()
    runtime_mode = bool(runtime_approved_sha)
    if runtime_mode and (
        len(runtime_approved_sha) != 64
        or any(character not in "0123456789ABCDEF" for character in runtime_approved_sha)
    ):
        raise RuntimeError(
            "--runtime-approved-sha must be a 64-character hexadecimal SHA-256"
        )
    donor_hash = hashlib.sha256(args.source_blend.read_bytes()).hexdigest().upper()
    if donor_hash != DONOR_SHA256:
        raise RuntimeError(
            f"Unexpected Quaternius donor hash {donor_hash}; expected {DONOR_SHA256}"
        )
    bpy.ops.wm.open_mainfile(filepath=str(args.source_blend.resolve()))
    body = bpy.data.objects.get("Velociraptor")
    armature = bpy.data.objects.get("Armature")
    if body is None or armature is None:
        raise RuntimeError("Quaternius donor has no Velociraptor mesh/Armature")
    if body.type != "MESH" or armature.type != "ARMATURE":
        raise RuntimeError("Quaternius donor objects have unexpected types")

    if args.variant == "fire":
        materials = {
            "scales": pbr_material(
                "fire_gecko_charred_umber_scales",
                (0.255, 0.125, 0.065),
                0.93,
                0.32,
            ),
            "underbelly": pbr_material(
                "fire_gecko_burnished_ochre_underbelly",
                (0.570, 0.255, 0.062),
                0.91,
                0.19,
            ),
            "ridge": pbr_material(
                "fire_gecko_ash_black_thermal_scutes",
                (0.105, 0.070, 0.043),
                0.95,
                0.28,
            ),
            "dark": pbr_material(
                "fire_gecko_charcoal_claws",
                (0.070, 0.055, 0.040),
                0.84,
                0.10,
            ),
            "eyes": pbr_material(
                "fire_gecko_ember_eyes",
                (0.720, 0.155, 0.018),
                0.68,
                0.08,
                emission_color=(0.860, 0.095, 0.006),
                emission_strength=0.16,
            ),
            "ember": pbr_material(
                "fire_gecko_subsurface_heat_fissures",
                (0.115, 0.063, 0.035),
                0.94,
                0.14,
                emission_color=(1.000, 0.220, 0.020),
                emission_strength=0.28,
                emission_texture_kind="emission_fissure",
            ),
        }
    else:
        materials = {
            "scales": pbr_material(
                "gecko_weathered_olive_scales",
                (0.275, 0.350, 0.190),
                0.94,
                0.31,
            ),
            "underbelly": pbr_material(
                "gecko_dusty_ochre_underbelly",
                (0.735, 0.515, 0.270),
                0.88,
                0.18,
            ),
            "ridge": pbr_material(
                "gecko_burnt_rust_dorsal_ridge",
                (0.235, 0.090, 0.035),
                0.92,
                0.26,
            ),
            "dark": pbr_material(
                "gecko_charcoal_eyes_claws",
                (0.095, 0.105, 0.075),
                0.80,
                0.10,
            ),
            "eyes": pbr_material(
                "gecko_dull_amber_eyes",
                (0.720, 0.390, 0.075),
                0.66,
                0.08,
            ),
        }
    geometry_adjustments = rebuild_body(body, materials, args.variant)
    prepare_actions(armature)
    action_refinements = refine_combat_and_death_actions(armature)

    armature.animation_data.action = None
    reset_pose(armature)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    facial_details = create_facial_details(
        body,
        armature,
        materials,
        args.variant,
    )

    body.name = (
        "fire_gecko_continuous_body"
        if args.variant == "fire"
        else "gecko_continuous_body"
    )
    armature.name = (
        "fire_gecko_rig"
        if args.variant == "fire"
        else "gecko_rig"
    )
    root = bpy.data.objects.new(args.asset_id, None)
    bpy.context.scene.collection.objects.link(root)
    armature.parent = root
    root.scale = RUNTIME_ROOT_SCALE if runtime_mode else ROOT_SCALE
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_style"] = "geometry_b_materials_c"
    if runtime_mode:
        root["realm_approved_review_sha256"] = runtime_approved_sha
        root["realm_runtime_scale_multiplier"] = RUNTIME_SCALE_MULTIPLIER
    root["realm_geometry_provenance"] = (
        "thermally adapted Quaternius Velociraptor continuous topology"
        if args.variant == "fire"
        else "proportionally adjusted Quaternius Velociraptor continuous topology"
    )
    if args.variant == "fire":
        root["realm_species_variant"] = "fire_gecko"
        root["realm_heat_effect"] = (
            "continuous dorsal thermal scutes and restrained emissive fissures"
        )
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_action_refinements"] = json.dumps(
        action_refinements,
        ensure_ascii=False,
        sort_keys=True,
    )

    reset_pose(armature)
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    review_meshes = [body, facial_details]
    minimum, _ = evaluated_bounds(review_meshes)
    root.location.z -= minimum.z
    bpy.context.view_layer.update()
    ground_contact_corrections = apply_ground_contact_corrections(
        armature,
        review_meshes,
        root,
    )
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(review_meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    root["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }

    export_candidate(args.output, root, armature, review_meshes)
    actual = parse_glb(args.output)
    missing_actions = sorted(set(REQUIRED_ACTIONS) - set(actual["animations"]))
    if missing_actions:
        raise RuntimeError(f"Export is missing required actions: {missing_actions}")
    if actual["skins"] != 1 or actual["skinJointCounts"] != [29]:
        raise RuntimeError(
            "Gecko must export exactly one 29-joint deforming skin; "
            f"got {actual['skins']} skins and {actual['skinJointCounts']} joints"
        )
    components = connected_component_count(body)
    if components != 1:
        raise RuntimeError(
            f"Primary gecko body must stay connected; got {components} components"
        )

    report = {
        "assetId": args.asset_id,
        "variant": args.variant,
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
            "primaryBodyConnectedComponents": components,
            "primaryBodyTopology": (
                "Quaternius continuous biped reptile topology with integrated "
                "thermal scutes"
                if args.variant == "fire"
                else "Quaternius continuous biped reptile topology, adjusted"
            ),
            "flatShaded": all(
                not polygon.use_smooth for polygon in body.data.polygons
            ),
            "facialDetailMesh": facial_details.name,
            "facialDetailObjects": 1,
            "adjustments": geometry_adjustments,
        },
        "actionRefinements": action_refinements,
        "groundContactCorrections": {
            "clearanceMetres": GROUND_CLEARANCE_METRES,
            "penetrationToleranceMetres": (
                GROUND_PENETRATION_TOLERANCE_METRES
            ),
            "actions": ground_contact_corrections,
        },
        "provenance": {
            "donor": "Quaternius Animated Dinosaur Pack / Velociraptor.blend",
            "donorSha256": donor_hash,
            "license": "CC0 1.0 Universal",
            "sourceUrl": "https://quaternius.com/packs/animateddinosaurs.html",
            "geometry": (
                "continuous donor topology with anatomical head, contact feet "
                "and raised centerline thermal scutes"
                if args.variant == "fire"
                else "continuous donor topology with widened head and contact feet"
            ),
            "rig": "Quaternius 29-bone biped reptile deform rig",
            "animations": (
                "Quaternius idle/walk/run/attack/death; original Realm hurt clip"
            ),
            "materials": (
                "original Realm of Ashes B+C charred PBR materials with "
                "restrained emissive heat fissures"
                if args.variant == "fire"
                else "original Realm of Ashes B+C packed PBR textures"
            ),
        },
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if runtime_mode:
        report["approvedReviewSha256"] = runtime_approved_sha
        report["runtimeScaleMultiplier"] = RUNTIME_SCALE_MULTIPLIER
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_UNIFIED_GECKO_BUILD=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
