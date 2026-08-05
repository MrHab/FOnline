"""Build the review-only B+C mutant-ant replacement.

The runtime mutant ant is currently assembled from rigid procedural
primitives.  This generator creates an original project-owned low-poly
arthropod instead: one skinned mesh, anatomically continuous appendages,
controlled Quaternius-like facets, a complete deforming rig and all six
gameplay actions.  Runtime export stays gated behind an approved review hash.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import parse_glb
from build_unified_radscorpion_review import (
    MATERIAL_ORDER,
    MeshBuilder,
    blend,
    clear_scene,
    create_box_uv,
    lock_action_ground_contact,
    make_action,
    maximum_influences,
    merged_pose,
    mesh_statistics,
    reset_pose,
    validate_sha256,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
RUNTIME_SCALE_MULTIPLIER = 1.0


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--asset-id",
        default="creature_mutant_ant_unified_v1",
    )
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


def material_library() -> dict[str, bpy.types.Material]:
    materials = {
        "carapace": pbr_material(
            "mutant_ant_oxidized_umber_carapace",
            (0.135, 0.060, 0.032),
            0.90,
            normal_strength=0.35,
        ),
        "plate": pbr_material(
            "mutant_ant_dusty_rust_dorsal_plates",
            (0.240, 0.082, 0.032),
            0.87,
            normal_strength=0.31,
        ),
        "ventral": pbr_material(
            "mutant_ant_dry_ochre_ventral_chitin",
            (0.205, 0.125, 0.055),
            0.95,
            normal_strength=0.25,
        ),
        "joint": pbr_material(
            "mutant_ant_charcoal_joint_membranes",
            (0.068, 0.040, 0.029),
            0.93,
            normal_strength=0.24,
        ),
        "claw": pbr_material(
            "mutant_ant_worn_black_mandibles_and_feet",
            (0.037, 0.031, 0.027),
            0.82,
            normal_strength=0.29,
        ),
        "eye": pbr_material(
            "mutant_ant_dull_amber_compound_eyes",
            (0.300, 0.105, 0.012),
            0.43,
            normal_strength=0.13,
        ),
        "venom": pbr_material(
            "mutant_ant_muted_acid_gland",
            (0.095, 0.135, 0.025),
            0.68,
            normal_strength=0.19,
        ),
    }
    venom_bsdf = materials["venom"].node_tree.nodes.get("Principled BSDF")
    if venom_bsdf:
        emission = venom_bsdf.inputs.get("Emission Color") or venom_bsdf.inputs.get(
            "Emission"
        )
        strength = venom_bsdf.inputs.get("Emission Strength")
        if emission:
            emission.default_value = (0.040, 0.090, 0.008, 1.0)
        if strength:
            strength.default_value = 0.10
    return materials


def leg_points(
    row_index: int,
    side: float,
) -> tuple[tuple[float, float, float], ...]:
    rows = (
        (0.125, 0.175, 0.94),
        (-0.020, 0.010, 1.00),
        (-0.175, -0.175, 0.94),
    )
    y, splay, reach = rows[row_index]
    return (
        (side * 0.175, y, 0.345),
        (side * 0.320, y + splay * 0.14, 0.355),
        (side * 0.555, y + splay * 0.48, 0.455),
        (side * 0.735, y + splay * 0.70, 0.275),
        (side * (reach - 0.075), y + splay * 0.90, 0.090),
        (side * reach, y + splay, 0.023),
    )


def bone_rows() -> tuple[
    tuple[
        str,
        tuple[float, float, float],
        tuple[float, float, float],
        str | None,
    ],
    ...,
]:
    rows = [
        ("root", (0.0, 0.0, 0.045), (0.0, 0.0, 0.165), None),
        ("thorax", (0.0, -0.225, 0.350), (0.0, 0.155, 0.365), "root"),
        ("neck", (0.0, 0.125, 0.365), (0.0, 0.250, 0.400), "thorax"),
        ("Head", (0.0, 0.250, 0.400), (0.0, 0.575, 0.390), "neck"),
        ("petiole_1", (0.0, -0.205, 0.355), (0.0, -0.365, 0.380), "thorax"),
        ("petiole_2", (0.0, -0.365, 0.380), (0.0, -0.490, 0.405), "petiole_1"),
        ("gaster_1", (0.0, -0.490, 0.405), (0.0, -0.670, 0.420), "petiole_2"),
        ("gaster_2", (0.0, -0.670, 0.420), (0.0, -0.865, 0.400), "gaster_1"),
        ("gaster_3", (0.0, -0.865, 0.400), (0.0, -1.070, 0.355), "gaster_2"),
    ]
    for row_index in range(3):
        for side, suffix in ((-1.0, "l"), (1.0, "r")):
            points = leg_points(row_index, side)
            names = (
                f"leg_{row_index}_{suffix}_coxa",
                f"leg_{row_index}_{suffix}_femur",
                f"leg_{row_index}_{suffix}_tibia",
                f"leg_{row_index}_{suffix}_basitarsus",
                f"leg_{row_index}_{suffix}_tarsus",
            )
            parents = ("thorax", names[0], names[1], names[2], names[3])
            for index, name in enumerate(names):
                rows.append((name, points[index], points[index + 1], parents[index]))
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        antenna_points = (
            (side * 0.110, 0.515, 0.485),
            (side * 0.205, 0.690, 0.555),
            (side * 0.295, 0.860, 0.525),
            (side * 0.380, 1.055, 0.420),
        )
        scape = f"antenna_{suffix}_scape"
        pedicel = f"antenna_{suffix}_pedicel"
        flagellum = f"antenna_{suffix}_flagellum"
        rows.extend(
            (
                (scape, antenna_points[0], antenna_points[1], "Head"),
                (pedicel, antenna_points[1], antenna_points[2], scape),
                (flagellum, antenna_points[2], antenna_points[3], pedicel),
            )
        )
        mandible_points = (
            (side * 0.105, 0.550, 0.330),
            (side * 0.255, 0.695, 0.300),
            (side * 0.045, 0.865, 0.270),
        )
        base = f"mandible_{suffix}_base"
        tip = f"mandible_{suffix}_tip"
        rows.extend(
            (
                (base, mandible_points[0], mandible_points[1], "Head"),
                (tip, mandible_points[1], mandible_points[2], base),
            )
        )
    return tuple(rows)


def create_armature(asset_id: str) -> bpy.types.Object:
    data = bpy.data.armatures.new(f"{asset_id}_rig_data")
    armature = bpy.data.objects.new(f"{asset_id}_rig", data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for name, head, tail, parent in bone_rows():
        bone = data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.roll = 0.0
        bone.use_deform = True
        if parent:
            bone.parent = created[parent]
            bone.use_connect = False
        created[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    return armature


def append_core(builder: MeshBuilder) -> None:
    # Compact thorax with three readable lobes instead of stacked spheres.
    builder.append_tube(
        (
            (0.0, -0.245, 0.355),
            (0.0, -0.205, 0.360),
            (0.0, -0.115, 0.370),
            (0.0, -0.025, 0.375),
            (0.0, 0.065, 0.372),
            (0.0, 0.155, 0.365),
            (0.0, 0.225, 0.382),
        ),
        (
            (0.235, 0.145),
            (0.285, 0.175),
            (0.315, 0.190),
            (0.330, 0.200),
            (0.315, 0.192),
            (0.280, 0.170),
            (0.205, 0.130),
        ),
        (
            {"thorax": 1.0},
            {"thorax": 1.0},
            {"thorax": 1.0},
            {"thorax": 1.0},
            {"thorax": 1.0},
            blend("thorax", "neck", 0.25),
            {"neck": 1.0},
        ),
        "carapace",
        sides=14,
        segment_materials=(
            "joint",
            "carapace",
            "carapace",
            "carapace",
            "carapace",
            "joint",
        ),
        phase=pi / 14,
        organic_variation=0.032,
    )

    # Wedge-shaped head capsule and clypeus; the face stays low and insectoid.
    builder.append_tube(
        (
            (0.0, 0.205, 0.382),
            (0.0, 0.285, 0.405),
            (0.0, 0.390, 0.420),
            (0.0, 0.505, 0.405),
            (0.0, 0.600, 0.365),
            (0.0, 0.645, 0.330),
        ),
        (
            (0.185, 0.120),
            (0.265, 0.180),
            (0.310, 0.220),
            (0.325, 0.215),
            (0.275, 0.165),
            (0.205, 0.105),
        ),
        (
            {"neck": 1.0},
            blend("neck", "Head", 0.55),
            {"Head": 1.0},
            {"Head": 1.0},
            {"Head": 1.0},
            {"Head": 1.0},
        ),
        "carapace",
        sides=15,
        segment_materials=("joint", "carapace", "carapace", "carapace", "claw"),
        phase=pi / 15,
        organic_variation=0.026,
    )

    # Two-node waist: narrow but continuous, preserving the ant silhouette.
    builder.append_tube(
        (
            (0.0, -0.225, 0.355),
            (0.0, -0.300, 0.365),
            (0.0, -0.365, 0.390),
            (0.0, -0.425, 0.415),
            (0.0, -0.495, 0.415),
        ),
        (
            (0.195, 0.120),
            (0.105, 0.085),
            (0.155, 0.135),
            (0.105, 0.090),
            (0.170, 0.130),
        ),
        (
            blend("thorax", "petiole_1", 0.25),
            {"petiole_1": 1.0},
            {"petiole_1": 1.0},
            {"petiole_2": 1.0},
            blend("petiole_2", "gaster_1", 0.35),
        ),
        "joint",
        sides=12,
        segment_materials=("joint", "plate", "joint", "plate"),
        phase=pi / 12,
        organic_variation=0.025,
    )

    # Elongated three-part gaster with a tapered acid-gland tip.
    builder.append_tube(
        (
            (0.0, -0.475, 0.410),
            (0.0, -0.545, 0.420),
            (0.0, -0.645, 0.430),
            (0.0, -0.735, 0.425),
            (0.0, -0.825, 0.405),
            (0.0, -0.915, 0.380),
            (0.0, -1.005, 0.350),
            (0.0, -1.075, 0.330),
        ),
        (
            (0.180, 0.135),
            (0.300, 0.220),
            (0.350, 0.255),
            (0.380, 0.272),
            (0.365, 0.260),
            (0.320, 0.225),
            (0.235, 0.165),
            (0.115, 0.090),
        ),
        (
            blend("petiole_2", "gaster_1", 0.60),
            {"gaster_1": 1.0},
            {"gaster_1": 1.0},
            blend("gaster_1", "gaster_2", 0.55),
            {"gaster_2": 1.0},
            blend("gaster_2", "gaster_3", 0.45),
            {"gaster_3": 1.0},
            {"gaster_3": 1.0},
        ),
        "carapace",
        sides=16,
        segment_materials=(
            "joint",
            "carapace",
            "carapace",
            "carapace",
            "carapace",
            "carapace",
            "carapace",
        ),
        phase=pi / 16,
        organic_variation=0.030,
    )


def append_legs(builder: MeshBuilder) -> None:
    for row_index in range(3):
        for side, suffix in ((-1.0, "l"), (1.0, "r")):
            points = leg_points(row_index, side)
            names = {
                part: f"leg_{row_index}_{suffix}_{part}"
                for part in ("coxa", "femur", "tibia", "basitarsus", "tarsus")
            }
            centers = (
                points[0],
                tuple(Vector(points[0]).lerp(Vector(points[1]), 0.45)),
                points[1],
                tuple(Vector(points[1]).lerp(Vector(points[2]), 0.52)),
                points[2],
                tuple(Vector(points[2]).lerp(Vector(points[3]), 0.55)),
                points[3],
                tuple(Vector(points[3]).lerp(Vector(points[4]), 0.58)),
                points[4],
                points[5],
            )
            weights = (
                blend("thorax", names["coxa"], 0.62),
                {names["coxa"]: 1.0},
                blend(names["coxa"], names["femur"], 0.42),
                {names["femur"]: 1.0},
                blend(names["femur"], names["tibia"], 0.44),
                {names["tibia"]: 1.0},
                blend(names["tibia"], names["basitarsus"], 0.48),
                {names["basitarsus"]: 1.0},
                blend(names["basitarsus"], names["tarsus"], 0.48),
                {names["tarsus"]: 1.0},
            )
            builder.append_tube(
                centers,
                (
                    0.067,
                    0.082,
                    0.074,
                    0.065,
                    0.060,
                    0.053,
                    0.044,
                    0.032,
                    0.020,
                    0.008,
                ),
                weights,
                "carapace",
                sides=8,
                segment_materials=(
                    "joint",
                    "plate",
                    "joint",
                    "carapace",
                    "joint",
                    "plate",
                    "joint",
                    "claw",
                    "claw",
                ),
                phase=pi / 8,
                organic_variation=0.020,
            )


def append_head_appendages(builder: MeshBuilder) -> None:
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        antenna_names = (
            f"antenna_{suffix}_scape",
            f"antenna_{suffix}_pedicel",
            f"antenna_{suffix}_flagellum",
        )
        antenna_points = (
            (side * 0.110, 0.515, 0.485),
            (side * 0.205, 0.690, 0.555),
            (side * 0.295, 0.860, 0.525),
            (side * 0.380, 1.055, 0.420),
        )
        builder.append_tube(
            (
                antenna_points[0],
                tuple(Vector(antenna_points[0]).lerp(Vector(antenna_points[1]), 0.72)),
                antenna_points[1],
                antenna_points[2],
                tuple(Vector(antenna_points[2]).lerp(Vector(antenna_points[3]), 0.55)),
                antenna_points[3],
            ),
            (0.032, 0.037, 0.029, 0.023, 0.016, 0.006),
            (
                blend("Head", antenna_names[0], 0.78),
                {antenna_names[0]: 1.0},
                blend(antenna_names[0], antenna_names[1], 0.45),
                blend(antenna_names[1], antenna_names[2], 0.45),
                {antenna_names[2]: 1.0},
                {antenna_names[2]: 1.0},
            ),
            "joint",
            sides=7,
            segment_materials=("joint", "carapace", "joint", "carapace", "claw"),
            phase=pi / 7,
            organic_variation=0.018,
        )

        base = f"mandible_{suffix}_base"
        tip = f"mandible_{suffix}_tip"
        builder.append_tube(
            (
                (side * 0.100, 0.550, 0.330),
                (side * 0.190, 0.630, 0.315),
                (side * 0.255, 0.695, 0.300),
                (side * 0.225, 0.770, 0.285),
                (side * 0.045, 0.865, 0.270),
            ),
            (0.068, 0.080, 0.071, 0.046, 0.008),
            (
                blend("Head", base, 0.78),
                {base: 1.0},
                blend(base, tip, 0.45),
                {tip: 1.0},
                {tip: 1.0},
            ),
            "claw",
            sides=9,
            segment_materials=("joint", "plate", "claw", "claw"),
            phase=pi / 9,
            organic_variation=0.020,
        )

    # Two compound eyes and three ocelli give the face a readable ant identity.
    for x, y, z, radius, material in (
        (-0.245, 0.470, 0.485, 0.082, "eye"),
        (0.245, 0.470, 0.485, 0.082, "eye"),
        (-0.065, 0.525, 0.575, 0.024, "eye"),
        (0.065, 0.525, 0.575, 0.024, "eye"),
        (0.000, 0.585, 0.560, 0.020, "eye"),
    ):
        builder.append_ellipsoid(
            (x, y, z),
            (radius, radius * 0.62, radius * 0.78),
            {"Head": 1.0},
            material,
            sides=9,
            rings=3,
        )

    # Paired acid spiracles keep mutation colour subordinate to anatomy.
    for y, z, factor in (
        (-0.655, 0.415, 0.25),
        (-0.770, 0.395, 0.55),
        (-0.885, 0.365, 0.80),
    ):
        for side in (-1.0, 1.0):
            builder.append_ellipsoid(
                (side * (0.355 - factor * 0.060), y, z),
                (0.022, 0.031, 0.017),
                blend("gaster_2", "gaster_3", factor),
                "venom",
                sides=7,
                rings=2,
            )


def create_mesh(
    asset_id: str,
    armature: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    builder = MeshBuilder()
    append_core(builder)
    append_legs(builder)
    append_head_appendages(builder)
    mesh = bpy.data.meshes.new(f"{asset_id}_mesh_data")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    mesh_object = bpy.data.objects.new(
        f"{asset_id}_continuous_exoskeleton",
        mesh,
    )
    bpy.context.collection.objects.link(mesh_object)
    for material_name in MATERIAL_ORDER:
        mesh.materials.append(materials[material_name])
    for polygon, material_index in zip(mesh.polygons, builder.face_materials):
        polygon.material_index = material_index
        center = polygon.center
        protected_materials = (
            MATERIAL_ORDER.index("joint"),
            MATERIAL_ORDER.index("claw"),
            MATERIAL_ORDER.index("eye"),
            MATERIAL_ORDER.index("venom"),
        )
        if (
            abs(center.x) < 0.43
            and -1.09 < center.y < 0.66
            and center.z > 0.455
            and polygon.material_index not in protected_materials
        ):
            polygon.material_index = MATERIAL_ORDER.index("plate")
        if (
            abs(center.x) < 0.43
            and -1.09 < center.y < 0.66
            and center.z < 0.350
            and polygon.material_index not in protected_materials
        ):
            polygon.material_index = MATERIAL_ORDER.index("ventral")
        polygon.use_smooth = False

    groups = {
        bone.name: mesh_object.vertex_groups.new(name=bone.name)
        for bone in armature.data.bones
    }
    for vertex_index, weights in builder.weights.items():
        for bone_name, weight in weights.items():
            groups[bone_name].add([vertex_index], weight, "REPLACE")
    modifier = mesh_object.modifiers.new("mutant_ant_skin", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    mesh_object.parent = armature
    mesh_object["realm_actor_detail"] = False
    mesh_object["realm_surface_construction"] = (
        "one skinned mesh with continuous leg, antenna and mandible surfaces "
        "plus anatomically separated cuticle volumes"
    )
    create_box_uv(mesh_object)
    mesh_object.data.uv_layers.active.name = "RealmMutantAntUV"
    mesh_object.data.update()
    return mesh_object


def tripod_leg_pose(
    phase: float,
    *,
    stride: float,
    lift: float,
) -> dict[str, dict[str, tuple[float, float, float]]]:
    pose = {}
    for row_index in range(3):
        for side_index, suffix in enumerate(("l", "r")):
            # Ants use alternating tripods: front+rear on one side and the
            # middle leg on the other side transfer together.
            tripod = (row_index + side_index) % 2
            leg_phase = phase + tripod * pi
            swing = max(0.0, sin(leg_phase))
            drive = cos(leg_phase)
            outward = -1.0 if suffix == "l" else 1.0
            prefix = f"leg_{row_index}_{suffix}"
            pose[f"{prefix}_coxa"] = {
                "rotation": (
                    swing * lift * 0.12,
                    -outward * swing * lift * 0.08,
                    drive * stride * 0.32,
                )
            }
            pose[f"{prefix}_femur"] = {
                "rotation": (
                    -swing * lift * 0.36,
                    0.0,
                    -drive * stride * 0.20,
                )
            }
            pose[f"{prefix}_tibia"] = {
                "rotation": (
                    swing * lift * 0.78,
                    0.0,
                    drive * stride * 0.12,
                )
            }
            pose[f"{prefix}_basitarsus"] = {
                "rotation": (-swing * lift * 0.58, 0.0, 0.0)
            }
            pose[f"{prefix}_tarsus"] = {
                "rotation": (-swing * lift * 0.22, 0.0, 0.0)
            }
    return pose


def antenna_pose(
    phase: float,
    amount: float,
) -> dict[str, dict[str, tuple[float, float, float]]]:
    pose = {}
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        wave = sin(phase + (0.55 if suffix == "r" else 0.0))
        pose[f"antenna_{suffix}_scape"] = {
            "rotation": (amount * 0.20 * wave, 0.0, side * amount * 0.24 * wave)
        }
        pose[f"antenna_{suffix}_pedicel"] = {
            "rotation": (-amount * 0.16 * wave, 0.0, -side * amount * 0.18 * wave)
        }
        pose[f"antenna_{suffix}_flagellum"] = {
            "rotation": (amount * 0.12 * wave, 0.0, side * amount * 0.14 * wave)
        }
    return pose


def add_actions(armature: bpy.types.Object) -> None:
    idle_a = merged_pose(
        {
            "thorax": {"rotation": (0.012, 0.0, -0.010)},
            "neck": {"rotation": (-0.018, 0.0, 0.012)},
            "Head": {"rotation": (0.014, 0.0, -0.012)},
            "petiole_2": {"rotation": (0.0, 0.0, 0.025)},
            "gaster_2": {"rotation": (0.0, 0.0, -0.032)},
            "mandible_l_base": {"rotation": (0.0, 0.0, -0.025)},
            "mandible_r_base": {"rotation": (0.0, 0.0, 0.025)},
        },
        antenna_pose(0.0, 0.32),
    )
    idle_b = merged_pose(
        {
            "root": {"location": (0.0, 0.0, 0.006)},
            "thorax": {"rotation": (-0.010, 0.0, 0.010)},
            "neck": {"rotation": (0.020, 0.0, -0.014)},
            "Head": {"rotation": (-0.016, 0.0, 0.014)},
            "petiole_2": {"rotation": (0.0, 0.0, -0.025)},
            "gaster_2": {"rotation": (0.0, 0.0, 0.032)},
            "mandible_l_base": {"rotation": (0.0, 0.0, 0.020)},
            "mandible_r_base": {"rotation": (0.0, 0.0, -0.020)},
        },
        antenna_pose(pi, 0.32),
    )
    make_action(armature, "idle", ((1, idle_a), (25, idle_b), (49, idle_a)))

    walk_frames = []
    for frame, phase in (
        (1, 0.0),
        (7, pi / 2),
        (13, pi),
        (19, 3 * pi / 2),
        (25, 2 * pi),
    ):
        core = merged_pose(
            {
                "root": {
                    "location": (0.0, 0.045 + abs(sin(phase)) * 0.010, 0.0)
                },
                "thorax": {"rotation": (0.0, 0.0, sin(phase) * 0.025)},
                "neck": {"rotation": (0.0, 0.0, -sin(phase) * 0.030)},
                "Head": {"rotation": (0.0, 0.0, -sin(phase) * 0.035)},
                "petiole_1": {"rotation": (0.0, 0.0, sin(phase) * 0.028)},
                "gaster_1": {"rotation": (0.0, 0.0, sin(phase) * 0.040)},
                "gaster_2": {"rotation": (0.0, 0.0, -sin(phase) * 0.052)},
            },
            antenna_pose(phase * 1.15, 0.40),
        )
        walk_frames.append(
            (frame, merged_pose(core, tripod_leg_pose(phase, stride=0.48, lift=0.42)))
        )
    make_action(armature, "walk", tuple(walk_frames), interpolation="LINEAR")

    run_frames = []
    for frame, phase in (
        (1, 0.0),
        (5, pi / 2),
        (9, pi),
        (13, 3 * pi / 2),
        (17, 2 * pi),
    ):
        core = merged_pose(
            {
                "root": {"location": (0.0, 0.115, 0.0)},
                "thorax": {"rotation": (-0.075, 0.0, sin(phase) * 0.055)},
                "neck": {"rotation": (0.055, 0.0, -sin(phase) * 0.060)},
                "Head": {"rotation": (0.035, 0.0, -sin(phase) * 0.070)},
                "petiole_1": {"rotation": (0.060, 0.0, sin(phase) * 0.055)},
                "gaster_1": {"rotation": (-0.035, 0.0, sin(phase) * 0.075)},
                "gaster_2": {"rotation": (0.025, 0.0, -sin(phase) * 0.095)},
                "gaster_3": {"rotation": (-0.020, 0.0, sin(phase) * 0.075)},
            },
            antenna_pose(phase * 1.25, 0.55),
        )
        run_frames.append(
            (frame, merged_pose(core, tripod_leg_pose(phase, stride=0.88, lift=0.74)))
        )
    make_action(armature, "run", tuple(run_frames), interpolation="LINEAR")

    attack_anticipation = {
        "root": {"location": (0.0, -0.035, 0.006)},
        "thorax": {"rotation": (0.045, 0.0, 0.0)},
        "neck": {"rotation": (0.090, 0.0, 0.0)},
        "Head": {"rotation": (0.080, 0.0, 0.0)},
        "mandible_l_base": {"rotation": (0.0, 0.0, 0.22)},
        "mandible_r_base": {"rotation": (0.0, 0.0, -0.22)},
        "mandible_l_tip": {"rotation": (0.0, 0.0, -0.10)},
        "mandible_r_tip": {"rotation": (0.0, 0.0, 0.10)},
        "antenna_l_scape": {"rotation": (0.18, 0.0, -0.12)},
        "antenna_r_scape": {"rotation": (0.18, 0.0, 0.12)},
    }
    attack_peak = {
        "root": {"location": (0.0, 0.205, 0.008)},
        "thorax": {"rotation": (-0.100, 0.0, 0.0)},
        "neck": {"rotation": (-0.145, 0.0, 0.0)},
        "Head": {"rotation": (-0.285, 0.0, 0.0)},
        "mandible_l_base": {"rotation": (0.0, 0.0, 0.82)},
        "mandible_r_base": {"rotation": (0.0, 0.0, -0.82)},
        "mandible_l_tip": {"rotation": (0.0, 0.0, -0.22)},
        "mandible_r_tip": {"rotation": (0.0, 0.0, 0.22)},
        "antenna_l_scape": {"rotation": (-0.40, 0.0, -0.28)},
        "antenna_r_scape": {"rotation": (-0.40, 0.0, 0.28)},
        "antenna_l_pedicel": {"rotation": (0.22, 0.0, 0.16)},
        "antenna_r_pedicel": {"rotation": (0.22, 0.0, -0.16)},
        "leg_0_l_coxa": {"rotation": (-0.12, 0.0, 0.24)},
        "leg_0_r_coxa": {"rotation": (-0.12, 0.0, -0.24)},
        "leg_0_l_femur": {"rotation": (-0.18, 0.0, -0.12)},
        "leg_0_r_femur": {"rotation": (-0.18, 0.0, 0.12)},
        "petiole_1": {"rotation": (0.08, 0.0, 0.0)},
        "gaster_1": {"rotation": (-0.10, 0.0, 0.0)},
        "gaster_2": {"rotation": (-0.08, 0.0, 0.0)},
    }
    make_action(
        armature,
        "attack",
        ((1, idle_a), (7, attack_anticipation), (14, attack_peak), (22, idle_a)),
        interpolation="LINEAR",
    )

    make_action(
        armature,
        "hurt",
        (
            (1, idle_a),
            (
                5,
                merged_pose(
                    {
                        "root": {
                            "location": (0.075, 0.060, 0.030),
                            "rotation": (0.02, 0.12, 0.18),
                        },
                        "thorax": {"rotation": (0.13, 0.08, -0.15)},
                        "neck": {"rotation": (-0.16, -0.06, 0.14)},
                        "Head": {"rotation": (-0.14, 0.05, 0.18)},
                        "petiole_2": {"rotation": (0.0, 0.0, 0.18)},
                        "gaster_2": {"rotation": (0.0, 0.0, -0.24)},
                        "mandible_l_base": {"rotation": (0.0, 0.0, -0.18)},
                        "mandible_r_base": {"rotation": (0.0, 0.0, 0.08)},
                    },
                    tripod_leg_pose(pi * 0.7, stride=0.34, lift=0.48),
                    antenna_pose(pi * 0.7, 0.72),
                ),
            ),
            (15, idle_a),
        ),
        interpolation="LINEAR",
    )

    death_final = {
        "root": {
            "location": (0.10, 0.020, 0.040),
            "rotation": (0.0, 1.22, 0.16),
        },
        "thorax": {"rotation": (0.12, 0.0, 0.12)},
        "neck": {"rotation": (-0.20, 0.0, -0.14)},
        "Head": {"rotation": (-0.18, 0.0, -0.16)},
        "petiole_1": {"rotation": (-0.20, 0.0, 0.16)},
        "petiole_2": {"rotation": (-0.24, 0.0, -0.18)},
        "gaster_1": {"rotation": (-0.22, 0.0, 0.16)},
        "gaster_2": {"rotation": (-0.26, 0.0, -0.14)},
        "gaster_3": {"rotation": (-0.20, 0.0, 0.10)},
        "mandible_l_base": {"rotation": (0.0, 0.0, -0.32)},
        "mandible_r_base": {"rotation": (0.0, 0.0, 0.32)},
    }
    for row_index in range(3):
        for suffix, side in (("l", -1.0), ("r", 1.0)):
            prefix = f"leg_{row_index}_{suffix}"
            death_final[f"{prefix}_coxa"] = {
                "rotation": (0.22, 0.0, side * (0.58 + row_index * 0.07))
            }
            death_final[f"{prefix}_femur"] = {
                "rotation": (0.42, 0.0, -side * 0.46)
            }
            death_final[f"{prefix}_tibia"] = {
                "rotation": (0.62, 0.0, side * 0.34)
            }
            death_final[f"{prefix}_basitarsus"] = {
                "rotation": (0.72, 0.0, side * 0.22)
            }
            death_final[f"{prefix}_tarsus"] = {
                "rotation": (-0.52, 0.0, 0.0)
            }
    death_final.update(antenna_pose(pi, 0.85))
    make_action(
        armature,
        "death",
        (
            (1, idle_a),
            (
                10,
                merged_pose(
                    {
                        "root": {
                            "location": (0.040, 0.035, 0.025),
                            "rotation": (0.0, 0.45, 0.08),
                        },
                        "thorax": {"rotation": (0.08, 0.0, 0.08)},
                        "petiole_2": {"rotation": (-0.15, 0.0, 0.10)},
                        "gaster_2": {"rotation": (-0.20, 0.0, -0.12)},
                    },
                    tripod_leg_pose(pi * 0.85, stride=0.52, lift=0.74),
                ),
            ),
            (30, death_final),
        ),
        interpolation="BEZIER",
    )


def export_candidate(
    output: Path,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    mesh_object: bpy.types.Object,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    armature.select_set(True)
    mesh_object.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Original Realm of Ashes mutant-ant geometry, rig, textures and "
            "animations. Quaternius-inspired topology principles; project asset."
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


def build(args: argparse.Namespace) -> dict[str, object]:
    clear_scene()
    approved_sha = validate_sha256(args.runtime_approved_sha)
    runtime_mode = bool(approved_sha)
    materials = material_library()
    armature = create_armature(args.asset_id)
    mesh_object = create_mesh(args.asset_id, armature, materials)
    add_actions(armature)

    root = bpy.data.objects.new(args.asset_id, None)
    bpy.context.collection.objects.link(root)
    armature.parent = root
    root["realm_asset_id"] = args.asset_id
    root["realm_actor_category"] = "creature"
    root["realm_actor_species"] = "mutant_ant"
    root["realm_art_direction"] = "geometry_b_materials_c"
    root["realm_topology_style"] = (
        "organic Quaternius-principled lofts with controlled flat facets"
    )
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_approved_review_sha256"] = approved_sha
    root["realm_rig_type"] = "full_deforming_skin"
    root["realm_action_set"] = ",".join(REQUIRED_ACTIONS)
    root["realm_ground_contact"] = (
        "alternating_tripod_stance_with_per_frame_1mm_lock"
    )
    if runtime_mode:
        root["realm_style"] = "geometry_b_materials_c"
        root["realm_runtime_scale_multiplier"] = RUNTIME_SCALE_MULTIPLIER
        armature["realm_full_deforming_rig"] = True
        armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    ground_contact = lock_action_ground_contact(armature, mesh_object)

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 49
    bpy.context.scene.render.fps = 24
    bpy.context.scene.frame_set(1)
    reset_pose(armature)
    bpy.context.view_layer.update()

    statistics = mesh_statistics(mesh_object)
    if statistics["vertices"] < 1_000 or statistics["triangles"] < 1_900:
        raise RuntimeError(f"Mutant-ant topology is too sparse: {statistics}")
    if statistics["connectedComponents"] > 32:
        raise RuntimeError(
            "Mutant ant still reads as a primitive pile: "
            f"{statistics['connectedComponents']} components"
        )
    joint_count = len(armature.data.bones)
    if joint_count < 45:
        raise RuntimeError(f"Mutant-ant rig is incomplete: {joint_count} joints")
    if maximum_influences(mesh_object) > 4:
        raise RuntimeError("Mutant-ant skin exceeds four influences")
    action_names = sorted(action.name for action in bpy.data.actions)
    if action_names != sorted(REQUIRED_ACTIONS):
        raise RuntimeError(f"Mutant-ant action set is incomplete: {action_names}")

    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    export_candidate(args.output, root, armature, mesh_object)
    sha256 = hashlib.sha256(args.output.read_bytes()).hexdigest().upper()
    glb = parse_glb(args.output)
    report = {
        "schema": "realm.art-review.mutant-ant.v2",
        "assetId": args.asset_id,
        "sha256": sha256,
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "approvedReviewSha256": approved_sha,
        "artDirection": "geometry_b_materials_c",
        "geometryDirection": (
            "original organic Quaternius-principled topology; wedge-shaped "
            "head capsule, three-lobed thorax, two-node petiole, segmented "
            "gaster, six continuous legs, antennae and curved mandibles"
        ),
        "materialDirection": (
            "oxidized umber, dusty rust, dry ochre and charcoal with muted "
            "acid-gland accents and restrained contact wear"
        ),
        "topology": statistics,
        "rig": {
            "type": "full deforming skin",
            "joints": joint_count,
            "maximumVertexInfluences": maximum_influences(mesh_object),
            "legChains": 6,
            "legJointsPerChain": 5,
            "antennaChains": 2,
            "antennaJointsPerChain": 3,
            "mandibleChains": 2,
            "mandibleJointsPerChain": 2,
            "gasterChainJoints": 5,
        },
        "animations": REQUIRED_ACTIONS,
        "groundContact": ground_contact,
        "glb": glb,
        "textureSize": 512,
        "materials": [materials[name].name for name in MATERIAL_ORDER],
        "source": {
            "geometry": "Original Realm of Ashes authored topology",
            "method": (
                "Reproducible Blender-authored exoskeleton following the "
                "silhouette, edge-flow and controlled-facet principles used "
                "by Quaternius"
            ),
            "license": "Project-owned original work",
        },
    }
    if runtime_mode:
        report["runtimeScaleMultiplier"] = RUNTIME_SCALE_MULTIPLIER
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("REALM_MUTANT_ANT_REVIEW=" + json.dumps(report, ensure_ascii=False))
    return report


def main() -> None:
    build(parse_args())


if __name__ == "__main__":
    main()
