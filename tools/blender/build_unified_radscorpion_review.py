"""Build the review-only B+C radscorpion replacement.

The current runtime radscorpion is a pile of rigid primitives.  This generator
creates an authored low-poly exoskeleton instead: one skinned mesh, continuous
organic lofts, controlled Quaternius-like facets, a complete articulated rig
and six gameplay actions.  Runtime export is gated behind a separately
approved review SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import cos, pi, sin
from pathlib import Path
import sys
from typing import Iterable

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import (
    connected_component_count,
    evaluated_bounds,
    parse_glb,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
RUNTIME_SCALE_MULTIPLIER = 1.0
MATERIAL_ORDER = (
    "carapace",
    "plate",
    "ventral",
    "joint",
    "claw",
    "eye",
    "venom",
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--asset-id",
        default="creature_radscorpion_unified_v2",
    )
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.actions,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(collection):
            if collection == bpy.data.actions:
                item.use_fake_user = False
            if item.users == 0:
                collection.remove(item)


def validate_sha256(value: str | None) -> str:
    normalized = str(value or "").upper()
    if normalized and (
        len(normalized) != 64
        or any(character not in "0123456789ABCDEF" for character in normalized)
    ):
        raise RuntimeError(
            "--runtime-approved-sha must be a 64-character hexadecimal SHA-256"
        )
    return normalized


def material_library() -> dict[str, bpy.types.Material]:
    materials = {
        "carapace": pbr_material(
            "radscorpion_oxidized_umber_carapace",
            (0.135, 0.073, 0.041),
            0.90,
            normal_strength=0.34,
        ),
        "plate": pbr_material(
            "radscorpion_burnt_rust_dorsal_plates",
            (0.215, 0.102, 0.043),
            0.86,
            normal_strength=0.30,
        ),
        "ventral": pbr_material(
            "radscorpion_dusty_ochre_ventral_chitin",
            (0.225, 0.150, 0.080),
            0.94,
            normal_strength=0.25,
        ),
        "joint": pbr_material(
            "radscorpion_charcoal_joint_membranes",
            (0.072, 0.043, 0.028),
            0.91,
            normal_strength=0.23,
        ),
        "claw": pbr_material(
            "radscorpion_worn_black_claw_tips",
            (0.055, 0.044, 0.035),
            0.81,
            normal_strength=0.28,
        ),
        "eye": pbr_material(
            "radscorpion_dull_amber_eyes",
            (0.475, 0.235, 0.025),
            0.44,
            normal_strength=0.12,
        ),
        "venom": pbr_material(
            "radscorpion_muted_venom_gland",
            (0.100, 0.145, 0.030),
            0.67,
            normal_strength=0.18,
        ),
    }
    venom_bsdf = materials["venom"].node_tree.nodes.get("Principled BSDF")
    if venom_bsdf:
        emission = venom_bsdf.inputs.get("Emission Color") or venom_bsdf.inputs.get(
            "Emission"
        )
        strength = venom_bsdf.inputs.get("Emission Strength")
        if emission:
            emission.default_value = (0.055, 0.115, 0.012, 1.0)
        if strength:
            strength.default_value = 0.12
    return materials


def normalized_weights(weights: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, value) for value in weights.values())
    if total <= 1e-9:
        raise ValueError("Vertex skin weights cannot be empty")
    return {
        name: max(0.0, value) / total
        for name, value in weights.items()
        if value > 1e-9
    }


class MeshBuilder:
    """Collect deterministic low-poly surfaces and their skin weights."""

    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.face_materials: list[int] = []
        self.weights: dict[int, dict[str, float]] = {}

    def add_vertex(
        self,
        point: Vector | tuple[float, float, float],
        weights: dict[str, float],
    ) -> int:
        index = len(self.vertices)
        self.vertices.append(tuple(point))
        self.weights[index] = normalized_weights(weights)
        return index

    def add_face(self, face: Iterable[int], material: str) -> None:
        self.faces.append(tuple(face))
        self.face_materials.append(MATERIAL_ORDER.index(material))

    @staticmethod
    def _frame(
        centers: tuple[Vector, ...],
        index: int,
    ) -> tuple[Vector, Vector]:
        center = centers[index]
        if index == 0:
            tangent = centers[1] - center
        elif index == len(centers) - 1:
            tangent = center - centers[index - 1]
        else:
            tangent = centers[index + 1] - centers[index - 1]
        tangent.normalize()
        side = Vector((1.0, 0.0, 0.0))
        if abs(tangent.dot(side)) > 0.92:
            side = Vector((0.0, 1.0, 0.0))
        normal = tangent.cross(side).normalized()
        side = normal.cross(tangent).normalized()
        return side, normal

    def append_tube(
        self,
        centers: Iterable[tuple[float, float, float]],
        radii: Iterable[tuple[float, float] | float],
        ring_weights: Iterable[dict[str, float]],
        material: str,
        *,
        sides: int = 8,
        segment_materials: Iterable[str] | None = None,
        cap_start: bool = True,
        cap_end: bool = True,
        phase: float = 0.0,
        organic_variation: float = 0.0,
    ) -> list[list[int]]:
        center_rows = tuple(Vector(center) for center in centers)
        radius_rows = tuple(
            (float(radius), float(radius))
            if isinstance(radius, (int, float))
            else (float(radius[0]), float(radius[1]))
            for radius in radii
        )
        weight_rows = tuple(ring_weights)
        if not (
            len(center_rows) == len(radius_rows) == len(weight_rows)
            and len(center_rows) >= 2
        ):
            raise ValueError("Tube rows must have matching lengths")
        materials = (
            tuple(segment_materials)
            if segment_materials is not None
            else (material,) * (len(center_rows) - 1)
        )
        if len(materials) != len(center_rows) - 1:
            raise ValueError("Tube segment material count does not match")

        rings: list[list[int]] = []
        for ring_index, (center, radius, weights) in enumerate(
            zip(center_rows, radius_rows, weight_rows)
        ):
            side_axis, normal_axis = self._frame(center_rows, ring_index)
            ring = []
            for side_index in range(sides):
                angle = (
                    phase
                    + side_index * (2.0 * pi / sides)
                    + organic_variation * sin(ring_index * 1.71) * 0.34
                )
                variation = 1.0 + organic_variation * (
                    sin(side_index * 2.17 + ring_index * 1.31) * 0.66
                    + cos(side_index * 1.23 - ring_index * 1.77) * 0.34
                )
                point = (
                    center
                    + side_axis * (cos(angle) * radius[0] * variation)
                    + normal_axis * (sin(angle) * radius[1] * variation)
                )
                ring.append(self.add_vertex(point, weights))
            rings.append(ring)

        for ring_index in range(len(rings) - 1):
            current = rings[ring_index]
            following = rings[ring_index + 1]
            face_material = materials[ring_index]
            for side_index in range(sides):
                next_side = (side_index + 1) % sides
                if (ring_index + side_index) % 2:
                    self.add_face(
                        (
                            current[side_index],
                            following[side_index],
                            current[next_side],
                        ),
                        face_material,
                    )
                    self.add_face(
                        (
                            current[next_side],
                            following[side_index],
                            following[next_side],
                        ),
                        face_material,
                    )
                else:
                    self.add_face(
                        (
                            current[side_index],
                            following[side_index],
                            following[next_side],
                        ),
                        face_material,
                    )
                    self.add_face(
                        (
                            current[side_index],
                            following[next_side],
                            current[next_side],
                        ),
                        face_material,
                    )
        if cap_start:
            center_index = self.add_vertex(center_rows[0], weight_rows[0])
            for side_index in range(sides):
                self.add_face(
                    (
                        center_index,
                        rings[0][(side_index + 1) % sides],
                        rings[0][side_index],
                    ),
                    material,
                )
        if cap_end:
            center_index = self.add_vertex(center_rows[-1], weight_rows[-1])
            for side_index in range(sides):
                self.add_face(
                    (
                        center_index,
                        rings[-1][side_index],
                        rings[-1][(side_index + 1) % sides],
                    ),
                    material,
                )
        return rings

    def append_ellipsoid(
        self,
        center: tuple[float, float, float],
        radius: tuple[float, float, float],
        weights: dict[str, float],
        material: str,
        *,
        sides: int = 8,
        rings: int = 3,
    ) -> None:
        center_vector = Vector(center)
        rows: list[list[int]] = []
        top = self.add_vertex(
            center_vector + Vector((0.0, 0.0, radius[2])),
            weights,
        )
        bottom = self.add_vertex(
            center_vector - Vector((0.0, 0.0, radius[2])),
            weights,
        )
        for ring_index in range(1, rings + 1):
            latitude = pi * ring_index / (rings + 1)
            row = []
            for side_index in range(sides):
                longitude = 2.0 * pi * side_index / sides
                point = center_vector + Vector(
                    (
                        radius[0] * sin(latitude) * cos(longitude),
                        radius[1] * sin(latitude) * sin(longitude),
                        radius[2] * cos(latitude),
                    )
                )
                row.append(self.add_vertex(point, weights))
            rows.append(row)
        for side_index in range(sides):
            next_side = (side_index + 1) % sides
            self.add_face((top, rows[0][side_index], rows[0][next_side]), material)
            self.add_face(
                (bottom, rows[-1][next_side], rows[-1][side_index]),
                material,
            )
        for ring_index in range(len(rows) - 1):
            current = rows[ring_index]
            following = rows[ring_index + 1]
            for side_index in range(sides):
                next_side = (side_index + 1) % sides
                self.add_face(
                    (
                        current[side_index],
                        following[side_index],
                        following[next_side],
                    ),
                    material,
                )
                self.add_face(
                    (
                        current[side_index],
                        following[next_side],
                        current[next_side],
                    ),
                    material,
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
        ("root", (0.0, 0.0, 0.05), (0.0, 0.0, 0.18), None),
        ("body", (0.0, -0.50, 0.31), (0.0, 0.16, 0.31), "root"),
        ("Head", (0.0, 0.16, 0.31), (0.0, 0.72, 0.29), "body"),
        ("tail_1", (0.0, -0.48, 0.32), (0.0, -0.68, 0.43), "body"),
        ("tail_2", (0.0, -0.68, 0.43), (0.0, -0.78, 0.61), "tail_1"),
        ("tail_3", (0.0, -0.78, 0.61), (0.0, -0.77, 0.81), "tail_2"),
        ("tail_4", (0.0, -0.77, 0.81), (0.0, -0.65, 1.00), "tail_3"),
        ("tail_5", (0.0, -0.65, 1.00), (0.0, -0.44, 1.14), "tail_4"),
        ("telson", (0.0, -0.44, 1.14), (0.0, -0.20, 1.17), "tail_5"),
        ("stinger", (0.0, -0.20, 1.17), (0.0, 0.08, 0.99), "telson"),
    ]
    for row_index, (y, splay, reach) in enumerate(
        (
            (0.26, 0.26, 1.02),
            (0.08, 0.11, 1.10),
            (-0.10, -0.11, 1.10),
            (-0.28, -0.26, 1.02),
        )
    ):
        for side, suffix in ((-1.0, "l"), (1.0, "r")):
            points = (
                (side * 0.25, y, 0.30),
                (side * 0.42, y + splay * 0.16, 0.29),
                (side * 0.67, y + splay * 0.43, 0.40),
                (side * 0.84, y + splay * 0.65, 0.31),
                (side * (reach - 0.11), y + splay * 0.87, 0.13),
                (side * reach, y + splay, 0.035),
            )
            coxa = f"leg_{row_index}_{suffix}_coxa"
            femur = f"leg_{row_index}_{suffix}_femur"
            patella = f"leg_{row_index}_{suffix}_patella"
            tibia = f"leg_{row_index}_{suffix}_tibia"
            tarsus = f"leg_{row_index}_{suffix}_tarsus"
            rows.extend(
                (
                    (coxa, points[0], points[1], "body"),
                    (femur, points[1], points[2], coxa),
                    (patella, points[2], points[3], femur),
                    (tibia, points[3], points[4], patella),
                    (tarsus, points[4], points[5], tibia),
                )
            )
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        points = (
            (side * 0.22, 0.35, 0.31),
            (side * 0.38, 0.49, 0.32),
            (side * 0.56, 0.65, 0.35),
            (side * 0.70, 0.81, 0.32),
            (side * 0.82, 1.00, 0.31),
        )
        coxa = f"claw_{suffix}_coxa"
        femur = f"claw_{suffix}_femur"
        patella = f"claw_{suffix}_patella"
        palm = f"claw_{suffix}_palm"
        rows.extend(
            (
                (coxa, points[0], points[1], "Head"),
                (femur, points[1], points[2], coxa),
                (patella, points[2], points[3], femur),
                (palm, points[3], points[4], patella),
                (
                    f"claw_{suffix}_fixed",
                    points[4],
                    (side * 0.67, 1.34, 0.29),
                    palm,
                ),
                (
                    f"claw_{suffix}_mobile",
                    points[4],
                    (side * 0.94, 1.34, 0.29),
                    palm,
                ),
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


def blend(
    first: str,
    second: str,
    factor: float,
) -> dict[str, float]:
    return {first: 1.0 - factor, second: factor}


def append_body_and_tail(builder: MeshBuilder) -> None:
    # Low, shield-like prosoma.  The eyes and mouth are embedded into this
    # volume; there is deliberately no raised neck or separate head tower.
    builder.append_tube(
        (
            (0.0, 0.74, 0.285),
            (0.0, 0.64, 0.295),
            (0.0, 0.48, 0.315),
            (0.0, 0.30, 0.320),
            (0.0, 0.18, 0.315),
        ),
        (
            (0.31, 0.105),
            (0.405, 0.135),
            (0.455, 0.165),
            (0.445, 0.175),
            (0.405, 0.155),
        ),
        (
            {"Head": 1.0},
            {"Head": 1.0},
            {"Head": 1.0},
            blend("Head", "body", 0.28),
            blend("Head", "body", 0.52),
        ),
        "carapace",
        sides=16,
        segment_materials=("carapace", "plate", "carapace", "joint"),
        phase=pi / 12,
        organic_variation=0.035,
    )

    # The mesosoma is a broad, flattened abdomen.  Paired rings create seven
    # visible tergite volumes without relying on black painted stripes.
    abdomen_centers = []
    abdomen_radii = []
    abdomen_weights = []
    abdomen_materials = []
    plate_rows = (
        (0.16, 0.405, 0.155),
        (0.05, 0.425, 0.165),
        (-0.07, 0.430, 0.170),
        (-0.19, 0.410, 0.168),
        (-0.30, 0.380, 0.158),
        (-0.40, 0.345, 0.145),
        (-0.49, 0.300, 0.130),
    )
    for plate_index, (y, width, height) in enumerate(plate_rows):
        abdomen_centers.extend(
            (
                (0.0, y + 0.044, 0.315),
                (0.0, y - 0.044, 0.315),
            )
        )
        abdomen_radii.extend(
            (
                (width * 0.94, height * 0.92),
                (width, height),
            )
        )
        factor = plate_index / max(1, len(plate_rows) - 1)
        abdomen_weights.extend(
            (
                blend("body", "tail_1", factor * 0.18),
                blend("body", "tail_1", factor * 0.32),
            )
        )
        if plate_index:
            abdomen_materials.append("joint")
        abdomen_materials.append("plate" if plate_index % 2 == 0 else "carapace")
    builder.append_tube(
        abdomen_centers,
        abdomen_radii,
        abdomen_weights,
        "carapace",
        sides=16,
        segment_materials=tuple(abdomen_materials),
        phase=pi / 16,
        organic_variation=0.028,
    )

    # Five separately armoured metasoma segments.  Each begins with a short
    # flexible membrane and then expands into a distinct tapered plate.
    tail_points = (
        Vector((0.0, -0.48, 0.32)),
        Vector((0.0, -0.68, 0.43)),
        Vector((0.0, -0.78, 0.61)),
        Vector((0.0, -0.77, 0.81)),
        Vector((0.0, -0.65, 1.00)),
        Vector((0.0, -0.44, 1.14)),
    )
    tail_radii = (
        (0.175, 0.145),
        (0.158, 0.135),
        (0.142, 0.122),
        (0.126, 0.108),
        (0.108, 0.092),
    )
    for index in range(5):
        start = tail_points[index]
        end = tail_points[index + 1]
        direction = end - start
        bone = f"tail_{index + 1}"
        builder.append_tube(
            (
                tuple(start + direction * 0.03),
                tuple(start + direction * 0.14),
                tuple(start + direction * 0.56),
                tuple(start + direction * 0.96),
            ),
            (
                (tail_radii[index][0] * 0.70, tail_radii[index][1] * 0.72),
                tail_radii[index],
                (tail_radii[index][0] * 1.08, tail_radii[index][1] * 1.05),
                (tail_radii[index][0] * 0.82, tail_radii[index][1] * 0.82),
            ),
            (
                {bone: 1.0},
                {bone: 1.0},
                {bone: 1.0},
                {bone: 1.0},
            ),
            "plate",
            sides=11,
            segment_materials=("joint", "plate", "carapace"),
            phase=pi / 11,
            organic_variation=0.022,
        )

    # Telson ampulla and a separate hooked aculeus.
    builder.append_ellipsoid(
        (0.0, -0.30, 1.165),
        (0.115, 0.155, 0.105),
        {"telson": 1.0},
        "venom",
        sides=11,
        rings=4,
    )
    builder.append_tube(
        (
            (0.0, -0.22, 1.17),
            (0.0, -0.10, 1.145),
            (0.0, -0.01, 1.085),
            (0.0, 0.05, 1.015),
            (0.0, 0.075, 0.965),
        ),
        (0.050, 0.045, 0.034, 0.020, 0.007),
        ({"stinger": 1.0},) * 5,
        "claw",
        sides=8,
        segment_materials=("carapace", "claw", "claw", "claw"),
        phase=pi / 8,
        organic_variation=0.018,
    )


def append_legs(builder: MeshBuilder) -> None:
    for row_index, (y, splay, reach) in enumerate(
        (
            (0.26, 0.26, 1.02),
            (0.08, 0.11, 1.10),
            (-0.10, -0.11, 1.10),
            (-0.28, -0.26, 1.02),
        )
    ):
        for side, suffix in ((-1.0, "l"), (1.0, "r")):
            names = {
                part: f"leg_{row_index}_{suffix}_{part}"
                for part in ("coxa", "femur", "patella", "tibia", "tarsus")
            }
            centers = (
                (side * 0.245, y, 0.30),
                (side * 0.39, y + splay * 0.12, 0.29),
                (side * 0.43, y + splay * 0.18, 0.30),
                (side * 0.66, y + splay * 0.42, 0.40),
                (side * 0.83, y + splay * 0.64, 0.31),
                (side * (reach - 0.11), y + splay * 0.86, 0.13),
                (side * (reach - 0.045), y + splay * 0.94, 0.060),
                (side * reach, y + splay, 0.032),
            )
            radii = (
                0.075,
                0.090,
                0.082,
                0.073,
                0.064,
                0.046,
                0.026,
                0.010,
            )
            weights = (
                {"body": 0.10, names["coxa"]: 0.90},
                {names["coxa"]: 1.0},
                blend(names["coxa"], names["femur"], 0.45),
                {names["femur"]: 1.0},
                {names["patella"]: 1.0},
                {names["tibia"]: 1.0},
                blend(names["tibia"], names["tarsus"], 0.65),
                {names["tarsus"]: 1.0},
            )
            builder.append_tube(
                centers,
                radii,
                weights,
                "carapace",
                sides=10,
                segment_materials=(
                    "joint",
                    "carapace",
                    "plate",
                    "joint",
                    "plate",
                    "joint",
                    "claw",
                ),
                phase=pi / 7,
                organic_variation=0.026,
            )


def append_claws(builder: MeshBuilder) -> None:
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        coxa = f"claw_{suffix}_coxa"
        femur = f"claw_{suffix}_femur"
        patella = f"claw_{suffix}_patella"
        palm = f"claw_{suffix}_palm"
        fixed = f"claw_{suffix}_fixed"
        mobile = f"claw_{suffix}_mobile"
        builder.append_tube(
            (
                (side * 0.21, 0.35, 0.31),
                (side * 0.34, 0.45, 0.32),
                (side * 0.39, 0.50, 0.32),
                (side * 0.55, 0.64, 0.35),
                (side * 0.69, 0.80, 0.32),
                (side * 0.74, 0.87, 0.31),
            ),
            (
                (0.085, 0.072),
                (0.110, 0.090),
                (0.098, 0.082),
                (0.090, 0.078),
                (0.105, 0.090),
                (0.090, 0.078),
            ),
            (
                {"Head": 0.12, coxa: 0.88},
                {coxa: 1.0},
                blend(coxa, femur, 0.35),
                {femur: 1.0},
                {patella: 1.0},
                blend(patella, palm, 0.32),
            ),
            "carapace",
            sides=10,
            segment_materials=(
                "joint",
                "carapace",
                "joint",
                "plate",
                "joint",
            ),
            phase=pi / 10,
            organic_variation=0.028,
        )
        # Broad manus: a visibly muscular crushing surface, not a swollen tube.
        builder.append_ellipsoid(
            (side * 0.82, 0.99, 0.31),
            (0.185, 0.245, 0.135),
            {palm: 1.0},
            "plate",
            sides=11,
            rings=4,
        )
        builder.append_tube(
            (
                (side * 0.75, 1.11, 0.31),
                (side * 0.70, 1.21, 0.31),
                (side * 0.66, 1.30, 0.30),
                (side * 0.67, 1.36, 0.29),
            ),
            (0.075, 0.060, 0.038, 0.010),
            ({fixed: 1.0},) * 4,
            "plate",
            sides=8,
            segment_materials=("plate", "plate", "claw"),
            phase=pi / 8,
            organic_variation=0.020,
        )
        builder.append_tube(
            (
                (side * 0.91, 1.10, 0.31),
                (side * 0.98, 1.20, 0.32),
                (side * 0.97, 1.30, 0.31),
                (side * 0.93, 1.36, 0.29),
            ),
            (0.078, 0.062, 0.039, 0.010),
            ({mobile: 1.0},) * 4,
            "plate",
            sides=8,
            segment_materials=("plate", "plate", "claw"),
            phase=pi / 8,
            organic_variation=0.020,
        )


def append_face_details(builder: MeshBuilder) -> None:
    for x, y, z, radius in (
        (-0.075, 0.525, 0.468, 0.030),
        (0.075, 0.525, 0.468, 0.030),
        (-0.185, 0.485, 0.432, 0.022),
        (0.185, 0.485, 0.432, 0.022),
        (-0.265, 0.405, 0.388, 0.016),
        (0.265, 0.405, 0.388, 0.016),
    ):
        builder.append_ellipsoid(
            (x, y, z),
            (radius, radius * 0.72, radius * 0.76),
            {"Head": 1.0},
            "eye",
            sides=10,
            rings=3,
        )
    for side in (-1.0, 1.0):
        builder.append_tube(
            (
                (side * 0.075, 0.655, 0.235),
                (side * 0.088, 0.745, 0.218),
                (side * 0.045, 0.810, 0.205),
            ),
            (0.050, 0.040, 0.010),
            ({"Head": 1.0},) * 3,
            "claw",
            sides=8,
            phase=pi / 6,
            organic_variation=0.018,
        )


def create_box_uv(mesh_object: bpy.types.Object) -> None:
    points = [vertex.co.copy() for vertex in mesh_object.data.vertices]
    minimum = Vector(
        tuple(min(point[axis] for point in points) for axis in range(3))
    )
    maximum = Vector(
        tuple(max(point[axis] for point in points) for axis in range(3))
    )
    span = maximum - minimum
    for axis in range(3):
        span[axis] = max(span[axis], 1e-6)
    uv_layer = mesh_object.data.uv_layers.new(name="RealmRadscorpionUV")
    for polygon in mesh_object.data.polygons:
        normal = polygon.normal
        dominant = max(range(3), key=lambda axis: abs(normal[axis]))
        for loop_index in polygon.loop_indices:
            point = mesh_object.data.vertices[
                mesh_object.data.loops[loop_index].vertex_index
            ].co
            if dominant == 0:
                uv = (
                    (point.y - minimum.y) / span.y,
                    (point.z - minimum.z) / span.z,
                )
            elif dominant == 1:
                uv = (
                    (point.x - minimum.x) / span.x,
                    (point.z - minimum.z) / span.z,
                )
            else:
                uv = (
                    (point.x - minimum.x) / span.x,
                    (point.y - minimum.y) / span.y,
                )
            uv_layer.data[loop_index].uv = uv
    mesh_object.data.uv_layers.active = uv_layer


def create_mesh(
    asset_id: str,
    armature: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    builder = MeshBuilder()
    append_body_and_tail(builder)
    append_legs(builder)
    append_claws(builder)
    append_face_details(builder)
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
        if (
            abs(center.x) < 0.46
            and -0.55 < center.y < 0.68
            and center.z < 0.285
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
    modifier = mesh_object.modifiers.new("radscorpion_skin", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    mesh_object.parent = armature
    mesh_object["realm_actor_detail"] = False
    mesh_object["realm_surface_construction"] = (
        "one skinned mesh with anatomically separated cuticle plates and "
        "continuous appendage surfaces"
    )
    create_box_uv(mesh_object)
    mesh_object.data.update()
    return mesh_object


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
            if "scale" in transform:
                bone.scale = transform["scale"]
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


def leg_pose(
    phase: float,
    *,
    stride: float,
    lift: float,
) -> dict[str, dict[str, tuple[float, float, float]]]:
    pose = {}
    for row_index in range(4):
        for side_index, suffix in enumerate(("l", "r")):
            # Two alternating tetrapods: while one diagonal group transfers,
            # the other four feet remain at the authored ground-contact pose.
            gait_phase = phase + ((row_index + side_index) % 2) * pi
            swing = max(0.0, sin(gait_phase))
            outward = (-1.0 if suffix == "l" else 1.0)
            pose[f"leg_{row_index}_{suffix}_coxa"] = {
                "rotation": (
                    swing * stride * 0.18,
                    -outward * swing * lift * 0.10,
                    swing * stride * 0.32,
                )
            }
            pose[f"leg_{row_index}_{suffix}_femur"] = {
                "rotation": (
                    -swing * stride * 0.20,
                    0.0,
                    -swing * stride * 0.22,
                )
            }
            pose[f"leg_{row_index}_{suffix}_patella"] = {
                "rotation": (
                    swing * lift * 0.42,
                    0.0,
                    swing * stride * 0.16,
                )
            }
            pose[f"leg_{row_index}_{suffix}_tibia"] = {
                "rotation": (
                    swing * lift,
                    0.0,
                    swing * stride * 0.12,
                )
            }
            pose[f"leg_{row_index}_{suffix}_tarsus"] = {
                "rotation": (-swing * lift * 0.72, 0.0, 0.0)
            }
    return pose


def merged_pose(*poses: dict) -> dict:
    merged = {}
    for pose in poses:
        merged.update(pose)
    return merged


def add_actions(armature: bpy.types.Object) -> None:
    idle_a = {
        "body": {"rotation": (0.010, 0.0, -0.012)},
        "Head": {"rotation": (-0.018, 0.0, 0.018)},
        "tail_2": {"rotation": (0.0, 0.0, 0.035)},
        "tail_4": {"rotation": (0.0, 0.0, -0.045)},
        "telson": {"rotation": (0.0, 0.0, 0.050)},
        "claw_l_palm": {"rotation": (0.0, 0.0, -0.018)},
        "claw_r_palm": {"rotation": (0.0, 0.0, 0.018)},
    }
    idle_b = {
        "root": {"location": (0.0, 0.0, 0.008)},
        "body": {"rotation": (-0.012, 0.0, 0.012)},
        "Head": {"rotation": (0.020, 0.0, -0.018)},
        "tail_2": {"rotation": (0.0, 0.0, -0.035)},
        "tail_4": {"rotation": (0.0, 0.0, 0.045)},
        "telson": {"rotation": (0.0, 0.0, -0.050)},
        "claw_l_palm": {"rotation": (0.0, 0.0, 0.020)},
        "claw_r_palm": {"rotation": (0.0, 0.0, -0.020)},
    }
    make_action(
        armature,
        "idle",
        ((1, idle_a), (25, idle_b), (49, idle_a)),
    )

    walk_frames = []
    for frame, phase in ((1, 0.0), (7, pi / 2), (13, pi), (19, 3 * pi / 2), (25, 2 * pi)):
        core = {
            "root": {"location": (0.0, 0.050 + abs(sin(phase)) * 0.015, 0.0)},
            "body": {"rotation": (0.0, 0.0, sin(phase) * 0.025)},
            "Head": {"rotation": (0.0, 0.0, -sin(phase) * 0.035)},
            "tail_2": {"rotation": (0.0, 0.0, sin(phase) * 0.055)},
            "tail_4": {"rotation": (0.0, 0.0, -sin(phase) * 0.065)},
            "claw_l_coxa": {"rotation": (0.0, 0.0, sin(phase) * 0.030)},
            "claw_r_coxa": {"rotation": (0.0, 0.0, -sin(phase) * 0.030)},
        }
        walk_frames.append(
            (frame, merged_pose(core, leg_pose(phase, stride=0.48, lift=0.36)))
        )
    make_action(armature, "walk", tuple(walk_frames), interpolation="LINEAR")

    run_frames = []
    for frame, phase in ((1, 0.0), (5, pi / 2), (9, pi), (13, 3 * pi / 2), (17, 2 * pi)):
        core = {
            "root": {"location": (0.0, 0.137, 0.0)},
            "body": {"rotation": (-0.110, 0.0, sin(phase) * 0.065)},
            "Head": {"rotation": (0.105, 0.0, -sin(phase) * 0.075)},
            "tail_1": {"rotation": (0.120, 0.0, sin(phase) * 0.075)},
            "tail_2": {"rotation": (0.060, 0.0, -sin(phase) * 0.060)},
            "tail_3": {"rotation": (-0.080, 0.0, -sin(phase) * 0.095)},
            "tail_5": {"rotation": (0.055, 0.0, sin(phase) * 0.110)},
            "claw_l_coxa": {"rotation": (-0.110, 0.0, 0.095 + sin(phase) * 0.055)},
            "claw_r_coxa": {"rotation": (-0.110, 0.0, -0.095 - sin(phase) * 0.055)},
            "claw_l_femur": {"rotation": (-0.080, 0.0, 0.070)},
            "claw_r_femur": {"rotation": (-0.080, 0.0, -0.070)},
        }
        run_frames.append(
            (frame, merged_pose(core, leg_pose(phase, stride=0.95, lift=0.78)))
        )
    make_action(armature, "run", tuple(run_frames), interpolation="LINEAR")

    make_action(
        armature,
        "attack",
        (
            (1, idle_a),
            (
                7,
                {
                    "root": {"location": (0.0, 0.044, 0.0)},
                    "body": {"rotation": (-0.055, 0.0, 0.0)},
                    "claw_l_coxa": {"rotation": (0.0, 0.0, 0.16)},
                    "claw_r_coxa": {"rotation": (0.0, 0.0, -0.16)},
                    "claw_l_mobile": {"rotation": (0.0, 0.0, -0.42)},
                    "claw_r_mobile": {"rotation": (0.0, 0.0, 0.42)},
                    "tail_2": {"rotation": (-0.15, 0.0, 0.0)},
                    "tail_3": {"rotation": (-0.18, 0.0, 0.0)},
                    "tail_4": {"rotation": (-0.22, 0.0, 0.0)},
                    "tail_5": {"rotation": (-0.18, 0.0, 0.0)},
                    "telson": {"rotation": (-0.16, 0.0, 0.0)},
                },
            ),
            (
                14,
                {
                    "root": {"location": (0.0, 0.0, 0.015)},
                    "body": {"rotation": (0.075, 0.0, 0.0)},
                    "Head": {"rotation": (-0.080, 0.0, 0.0)},
                    "claw_l_coxa": {"rotation": (0.0, 0.0, -0.18)},
                    "claw_r_coxa": {"rotation": (0.0, 0.0, 0.18)},
                    "claw_l_femur": {"rotation": (0.0, 0.0, -0.16)},
                    "claw_r_femur": {"rotation": (0.0, 0.0, 0.16)},
                    "claw_l_patella": {"rotation": (0.0, 0.0, -0.12)},
                    "claw_r_patella": {"rotation": (0.0, 0.0, 0.12)},
                    "claw_l_mobile": {"rotation": (0.0, 0.0, 0.28)},
                    "claw_r_mobile": {"rotation": (0.0, 0.0, -0.28)},
                    "tail_1": {"rotation": (-1.282, 0.0, 0.0)},
                    "tail_2": {"rotation": (-0.445, 0.0, 0.0)},
                    "tail_3": {"rotation": (0.365, 0.0, 0.0)},
                    "tail_4": {"rotation": (0.367, 0.0, 0.0)},
                    "tail_5": {"rotation": (0.219, 0.0, 0.0)},
                    "telson": {"rotation": (0.858, 0.0, 0.0)},
                    "stinger": {"rotation": (0.570, 0.0, 0.0)},
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
                merged_pose(
                    {
                        "root": {
                            "location": (0.08, 0.075, 0.025),
                            "rotation": (0.02, 0.10, 0.18),
                        },
                        "body": {"rotation": (0.12, 0.08, -0.14)},
                        "Head": {"rotation": (-0.18, -0.06, 0.16)},
                        "tail_2": {"rotation": (0.0, 0.0, 0.22)},
                        "tail_4": {"rotation": (0.0, 0.0, -0.26)},
                        "claw_l_coxa": {"rotation": (0.0, 0.0, 0.12)},
                        "claw_r_coxa": {"rotation": (0.0, 0.0, -0.06)},
                    },
                    leg_pose(pi * 0.7, stride=0.35, lift=0.42),
                ),
            ),
            (15, idle_a),
        ),
        interpolation="LINEAR",
    )

    death_final = {
        "root": {
            "location": (0.16, 0.030, 0.04),
            "rotation": (0.0, 1.22, 0.18),
        },
        "body": {"rotation": (0.10, 0.0, 0.12)},
        "Head": {"rotation": (-0.22, 0.0, -0.12)},
        "tail_1": {"rotation": (-0.26, 0.0, 0.18)},
        "tail_2": {"rotation": (-0.34, 0.0, -0.22)},
        "tail_3": {"rotation": (-0.28, 0.0, 0.20)},
        "tail_4": {"rotation": (-0.38, 0.0, -0.16)},
        "tail_5": {"rotation": (-0.28, 0.0, 0.12)},
        "telson": {"rotation": (-0.22, 0.0, -0.10)},
        "claw_l_coxa": {"rotation": (0.0, 0.0, 0.28)},
        "claw_r_coxa": {"rotation": (0.0, 0.0, -0.28)},
        "claw_l_femur": {"rotation": (0.0, 0.0, 0.22)},
        "claw_r_femur": {"rotation": (0.0, 0.0, -0.22)},
        "claw_l_patella": {"rotation": (0.0, 0.0, 0.18)},
        "claw_r_patella": {"rotation": (0.0, 0.0, -0.18)},
        "claw_l_mobile": {"rotation": (0.0, 0.0, 0.40)},
        "claw_r_mobile": {"rotation": (0.0, 0.0, -0.40)},
    }
    for row_index in range(4):
        for suffix, side in (("l", -1.0), ("r", 1.0)):
            death_final[f"leg_{row_index}_{suffix}_coxa"] = {
                "rotation": (0.20, 0.0, side * (0.55 + row_index * 0.05))
            }
            death_final[f"leg_{row_index}_{suffix}_femur"] = {
                "rotation": (0.35, 0.0, -side * 0.42)
            }
            death_final[f"leg_{row_index}_{suffix}_patella"] = {
                "rotation": (0.50, 0.0, side * 0.30)
            }
            death_final[f"leg_{row_index}_{suffix}_tibia"] = {
                "rotation": (0.65, 0.0, side * 0.22)
            }
            death_final[f"leg_{row_index}_{suffix}_tarsus"] = {
                "rotation": (-0.46, 0.0, 0.0)
            }
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
                            "location": (0.05, 0.045, 0.025),
                            "rotation": (0.0, 0.42, 0.08),
                        },
                        "body": {"rotation": (0.08, 0.0, 0.08)},
                        "tail_2": {"rotation": (-0.15, 0.0, 0.10)},
                        "tail_4": {"rotation": (-0.22, 0.0, -0.12)},
                    },
                    leg_pose(pi * 0.85, stride=0.52, lift=0.70),
                ),
            ),
            (30, death_final),
        ),
        interpolation="BEZIER",
    )


def lock_action_ground_contact(
    armature: bpy.types.Object,
    mesh_object: bpy.types.Object,
) -> dict[str, dict[str, float | int]]:
    """Keep at least one authored stance surface exactly 1 mm above ground.

    The leg cycles themselves preserve alternating four-leg stance groups.
    This object-space correction removes the residual vertical drift produced
    by interpolation, body pitch and the death roll without changing relative
    limb motion.
    """
    clearance = 0.001
    tolerance = 0.00035
    scene = bpy.context.scene
    original_action = armature.animation_data.action
    original_frame = scene.frame_current
    original_location = armature.location.copy()
    results: dict[str, dict[str, float | int]] = {}

    for action_name in REQUIRED_ACTIONS:
        action = bpy.data.actions[action_name]
        armature.animation_data.action = action
        for curve in tuple(action.fcurves):
            if curve.data_path == "location" and curve.array_index == 2:
                action.fcurves.remove(curve)
        armature.location = original_location
        start = int(round(action.frame_range[0]))
        end = int(round(action.frame_range[1]))
        frames = list(range(start, end + 1))
        minimum_before = []
        corrections = []
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            minimum_z = evaluated_bounds([mesh_object])[0].z
            minimum_before.append(minimum_z)
            corrections.append(clearance - minimum_z)

        curve = action.fcurves.new(
            data_path="location",
            index=2,
            action_group="GroundContact",
        )
        curve.keyframe_points.add(len(frames))
        for point, frame, correction in zip(
            curve.keyframe_points,
            frames,
            corrections,
        ):
            point.co = (frame, original_location.z + correction)
            point.interpolation = "LINEAR"
        curve.update()

        minimum_after = []
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            minimum_after.append(evaluated_bounds([mesh_object])[0].z)
        worst = min(minimum_after)
        highest = max(minimum_after)
        if abs(worst - clearance) > tolerance or abs(highest - clearance) > tolerance:
            raise RuntimeError(
                f"{action_name} ground lock failed: "
                f"{worst:.6f}..{highest:.6f} m"
            )
        results[action_name] = {
            "sampledFrames": len(frames),
            "minimumBeforeMetres": round(min(minimum_before), 6),
            "maximumBeforeMetres": round(max(minimum_before), 6),
            "minimumAfterMetres": round(worst, 6),
            "maximumAfterMetres": round(highest, 6),
            "maximumAbsoluteCorrectionMetres": round(
                max(abs(value) for value in corrections),
                6,
            ),
        }

    armature.animation_data.action = original_action
    armature.location = original_location
    scene.frame_set(original_frame)
    bpy.context.view_layer.update()
    return results


def mesh_statistics(mesh_object: bpy.types.Object) -> dict[str, int]:
    mesh_object.data.calc_loop_triangles()
    return {
        "vertices": len(mesh_object.data.vertices),
        "triangles": len(mesh_object.data.loop_triangles),
        "connectedComponents": connected_component_count(mesh_object),
        "materialSlots": len(mesh_object.data.materials),
    }


def maximum_influences(mesh_object: bpy.types.Object) -> int:
    return max(
        (
            sum(
                1
                for assignment in vertex.groups
                if assignment.weight > 1e-6
            )
            for vertex in mesh_object.data.vertices
        ),
        default=0,
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
            "Original Realm of Ashes radscorpion geometry, rig, textures and "
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
    root["realm_actor_species"] = "radscorpion"
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
        "alternating_tetrapod_stance_with_per_frame_1mm_lock"
    )
    if runtime_mode:
        root["realm_style"] = "geometry_b_materials_c"
        root["realm_approved_review_sha256"] = approved_sha
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
    if statistics["vertices"] < 1_500 or statistics["triangles"] < 2_500:
        raise RuntimeError(f"Radscorpion topology is too sparse: {statistics}")
    # Arthropod cuticle is discontinuous at flexible membranes by design.
    # Components are kept in one skinned mesh and correspond to anatomical
    # plates/appendages rather than separate rigid runtime objects.
    if statistics["connectedComponents"] > 40:
        raise RuntimeError(
            "Radscorpion still reads as a primitive pile: "
            f"{statistics['connectedComponents']} components"
        )
    joint_count = len(armature.data.bones)
    if joint_count < 50:
        raise RuntimeError(f"Radscorpion rig is incomplete: {joint_count} joints")
    if maximum_influences(mesh_object) > 4:
        raise RuntimeError("Radscorpion skin exceeds four influences")
    action_names = sorted(action.name for action in bpy.data.actions)
    if action_names != sorted(REQUIRED_ACTIONS):
        raise RuntimeError(f"Radscorpion action set is incomplete: {action_names}")

    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    export_candidate(args.output, root, armature, mesh_object)
    sha256 = hashlib.sha256(args.output.read_bytes()).hexdigest().upper()
    glb = parse_glb(args.output)
    report = {
        "schema": "realm.art-review.radscorpion.v2",
        "assetId": args.asset_id,
        "sha256": sha256,
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "approvedReviewSha256": approved_sha,
        "artDirection": "geometry_b_materials_c",
        "geometryDirection": (
            "original organic Quaternius-principled topology; flattened "
            "prosoma, seven-part mesosoma, five-part metasoma, telson and "
            "anatomical appendage surfaces"
        ),
        "materialDirection": (
            "oxidized umber, burnt rust, dusty ochre and charcoal with "
            "subtle contact wear"
        ),
        "topology": statistics,
        "rig": {
            "type": "full deforming skin",
            "joints": joint_count,
            "maximumVertexInfluences": maximum_influences(mesh_object),
            "legChains": 8,
            "legJointsPerChain": 5,
            "tailChainJoints": 7,
            "pedipalpChains": 2,
        },
        "animations": REQUIRED_ACTIONS,
        "groundContact": ground_contact,
        "glb": glb,
        "textureSize": 512,
        "materials": [materials[name].name for name in MATERIAL_ORDER],
        "source": {
            "geometry": "Original Realm of Ashes authored topology",
            "method": (
                "Reproducible Blender-authored cuticle surfaces following the "
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
    print("REALM_RADSCORPION_REVIEW=" + json.dumps(report, ensure_ascii=False))
    return report


def main() -> None:
    build(parse_args())


if __name__ == "__main__":
    main()
