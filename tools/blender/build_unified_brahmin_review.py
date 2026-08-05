"""Build a two-headed B+C brahmin from the CC0 Quaternius Bull donor.

The donor contributes one connected organic low-poly surface, a complete
quadruped rig and authored locomotion.  The Realm build keeps the torso,
limbs, tail and their skinning, creates a connected Y-shaped two-head
topology, augments the rig with the second neck/head branch, two jaws and
four deforming ears, and replaces the flat donor palette with packed B+C PBR
materials.  Runtime export remains SHA-gated behind a separate critic
approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import pi, sin, sqrt
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import (
    apply_ground_contact_corrections,
    connected_component_count,
    evaluated_bounds,
    parse_glb,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
SOURCE_ACTIONS = {
    "idle": "Idle",
    "walk": "Walk",
    "run": "Gallop",
    "attack": "Attack_Headbutt",
    "hurt": "Idle_HitReact_Left",
    "death": "Death",
}
DONOR_SHA256 = "6CD6CB9DB2FF50CC32AF34C4138613B92F1132D14476322CD23DD1F4347605FD"

# Blender donor axes: X is lateral, -Y is forward and Z is up.  The runtime
# target is the established brahmin envelope: roughly 1.8 m wide, 1.1 m high
# and 1.25 m long after glTF's Y-up conversion.
ROOT_SCALE = (0.620, 0.155, 0.237)
RUNTIME_ROOT_SCALE = tuple(sqrt(component) for component in ROOT_SCALE)
BRANCH_SEAM_Y = -2.70
BRANCH_FRONT_Y = -5.09
BRANCH_OFFSET_X = 0.84
HEAD_LATERAL_SCALE = 0.46
HEAD_LONGITUDINAL_SCALE = 0.90
HEAD_VERTICAL_SCALE = 0.92

RIGHT_BRANCH_GROUPS = {
    "Neck2": "Neck2.R",
    "Neck3": "Neck3.R",
    "Head": "Head.R",
}
RIG_BRANCH_OFFSETS = {
    "Neck2": 0.28,
    "Neck3": 0.62,
    "Head": 0.84,
}
SECONDARY_BONES = (
    "Jaw.L",
    "Jaw.R",
    "EarA.L",
    "EarB.L",
    "EarA.R",
    "EarB.R",
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--asset-id",
        default="creature_brahmin_unified_v1",
    )
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


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


def branch_factor(y: float) -> float:
    return max(
        0.0,
        min(1.0, (BRANCH_SEAM_Y - y) / (BRANCH_SEAM_Y - BRANCH_FRONT_Y)),
    )


def branch_transform(point: Vector, side: int) -> Vector:
    """Transform a donor neck/head point into one branch of the Y split."""
    t = branch_factor(point.y)
    spread = sin(t * pi * 0.5)
    lateral_scale = 1.0 - (1.0 - HEAD_LATERAL_SCALE) * spread
    longitudinal_scale = 1.0 - (1.0 - HEAD_LONGITUDINAL_SCALE) * spread
    vertical_scale = 1.0 - (1.0 - HEAD_VERTICAL_SCALE) * spread
    transformed = point.copy()
    transformed.x = point.x * lateral_scale + side * BRANCH_OFFSET_X * spread
    transformed.y = (
        BRANCH_SEAM_Y
        + (point.y - BRANCH_SEAM_Y) * longitudinal_scale
        + side * 0.16 * spread
    )
    transformed.z = 3.58 + (point.z - 3.58) * vertical_scale
    return transformed


def vertex_group_weight(
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


def create_box_projected_uv(body: bpy.types.Object) -> None:
    points = [vertex.co.copy() for vertex in body.data.vertices]
    minimum = Vector(
        tuple(min(point[axis] for point in points) for axis in range(3))
    )
    maximum = Vector(
        tuple(max(point[axis] for point in points) for axis in range(3))
    )
    span = maximum - minimum
    for axis in range(3):
        span[axis] = max(span[axis], 1e-6)
    uv_layer = body.data.uv_layers.get("RealmBrahminUV")
    if uv_layer is None:
        uv_layer = body.data.uv_layers.new(name="RealmBrahminUV")
    for polygon in body.data.polygons:
        absolute = tuple(abs(value) for value in polygon.normal)
        dominant = absolute.index(max(absolute))
        for loop_index in polygon.loop_indices:
            point = body.data.vertices[
                body.data.loops[loop_index].vertex_index
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
    body.data.uv_layers.active = uv_layer
    body.data.update()


def augment_brahmin_rig(
    armature: bpy.types.Object,
) -> dict[str, object]:
    """Split the donor neck in edit mode and add jaws plus deforming ears."""
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones
    for name in ("Neck2", "Neck3", "Head"):
        if edit_bones.get(name) is None:
            raise RuntimeError(f"Quaternius Bull donor has no {name}")

    original_geometry = {
        name: (
            edit_bones[name].head.copy(),
            edit_bones[name].tail.copy(),
            edit_bones[name].roll,
        )
        for name in ("Neck2", "Neck3", "Head")
    }
    for name, (head, tail, _roll) in original_geometry.items():
        bone = edit_bones[name]
        offset = Vector((-RIG_BRANCH_OFFSETS[name], 0.0, 0.0))
        # Keep the donor's local forward/up axes intact.  Tilting these rest
        # bones sideways would turn the authored vertical headbutt into a
        # lateral scissor motion and make the two heads intersect.
        bone.head = head + offset
        bone.tail = tail + offset
        bone.use_connect = False

    parent = edit_bones["Neck1"]
    right_bone_names: list[str] = []
    for source_name in ("Neck2", "Neck3", "Head"):
        target_name = RIGHT_BRANCH_GROUPS[source_name]
        source_head, source_tail, source_roll = original_geometry[source_name]
        offset = Vector((RIG_BRANCH_OFFSETS[source_name], 0.0, 0.0))
        bone = edit_bones.new(target_name)
        bone.head = source_head + offset
        bone.tail = source_tail + offset
        bone.roll = source_roll
        bone.parent = parent
        bone.use_connect = False
        bone.use_deform = True
        parent = bone
        right_bone_names.append(target_name)

    head_rest = original_geometry["Head"]
    jaw_source = (
        Vector((0.0, -4.34, 3.23)),
        Vector((0.0, -4.92, 2.96)),
    )
    ear_sources = {
        "EarA": (
            Vector((0.54, -3.92, 3.98)),
            Vector((1.03, -4.00, 4.15)),
        ),
        "EarB": (
            Vector((-0.54, -3.92, 3.98)),
            Vector((-1.03, -4.00, 4.15)),
        ),
    }
    added: list[str] = []
    for side, suffix, head_parent in (
        (-1, "L", edit_bones["Head"]),
        (1, "R", edit_bones["Head.R"]),
    ):
        jaw = edit_bones.new(f"Jaw.{suffix}")
        jaw.head = branch_transform(jaw_source[0], side)
        jaw.tail = branch_transform(jaw_source[1], side)
        jaw.parent = head_parent
        jaw.use_connect = False
        jaw.use_deform = True
        added.append(jaw.name)
        for ear_label, (source_head, source_tail) in ear_sources.items():
            ear = edit_bones.new(f"{ear_label}.{suffix}")
            ear.head = branch_transform(source_head, side)
            ear.tail = branch_transform(source_tail, side)
            ear.parent = head_parent
            ear.use_connect = False
            ear.use_deform = True
            added.append(ear.name)
    bpy.ops.object.mode_set(mode="OBJECT")
    return {
        "commonNeck": "Neck1",
        "leftBranch": ["Neck2", "Neck3", "Head"],
        "rightBranch": right_bone_names,
        "addedSecondaryBones": added,
        "totalBones": len(armature.data.bones),
        "branchMethod": (
            "central Neck1 forks into independently skinned left and right "
            "Neck2/Neck3/Head chains; donor forward/up rest axes are "
            "preserved so the authored headbutt stays sagittal"
        ),
        "sourceHeadRest": {
            "head": [round(value, 4) for value in head_rest[0]],
            "tail": [round(value, 4) for value in head_rest[1]],
        },
    }


def rebuild_connected_two_head_topology(
    body: bpy.types.Object,
) -> dict[str, object]:
    """Duplicate only the forward branch while sharing its seam vertices."""
    old_mesh = body.data
    group_names = {group.index: group.name for group in body.vertex_groups}
    old_groups = [group.name for group in body.vertex_groups]
    source_points = [vertex.co.copy() for vertex in old_mesh.vertices]
    source_assignments = [
        [
            (group_names[assignment.group], assignment.weight)
            for assignment in vertex.groups
        ]
        for vertex in old_mesh.vertices
    ]
    source_materials = [
        old_mesh.materials[polygon.material_index].name
        for polygon in old_mesh.polygons
    ]
    vertex_materials: list[set[str]] = [
        set() for _ in old_mesh.vertices
    ]
    for polygon, material_name in zip(old_mesh.polygons, source_materials):
        for index in polygon.vertices:
            vertex_materials[index].add(material_name)

    branch_groups = {"Neck1", "Neck2", "Neck3", "Head"}
    selected = {
        vertex.index
        for vertex in old_mesh.vertices
        if (
            vertex.co.y < BRANCH_SEAM_Y
            and vertex.co.z > 2.50
            and vertex_group_weight(vertex, group_names, branch_groups) > 0.03
        )
    }
    if not 500 <= len(selected) <= 550:
        raise RuntimeError(
            f"Unexpected Bull head/neck selection size: {len(selected)}"
        )

    vertices: list[tuple[float, float, float]] = []
    vertex_meta: list[dict[str, object]] = []
    assignments: list[list[tuple[str, float]]] = []
    for index, point in enumerate(source_points):
        branch = "L" if index in selected else None
        transformed = branch_transform(point, -1) if branch else point
        if (
            branch
            and "Horns" in vertex_materials[index]
            and point.x > 0.78
        ):
            wear = min(1.0, max(0.0, (point.x - 0.78) / 0.38))
            center_x = -BRANCH_OFFSET_X
            transformed.x = (
                center_x + (transformed.x - center_x) * (1.0 - 0.68 * wear)
            )
            transformed.z -= 0.12 * wear
        vertices.append(tuple(transformed))
        vertex_meta.append(
            {
                "sourceIndex": index,
                "sourcePoint": point.copy(),
                "sourceMaterials": set(vertex_materials[index]),
                "branch": branch,
            }
        )
        assignments.append(list(source_assignments[index]))

    duplicate_indices: dict[int, int] = {}
    for index in sorted(selected):
        duplicate_indices[index] = len(vertices)
        point = source_points[index]
        transformed = branch_transform(point, 1)
        # One shortened outer horn breaks perfect mirroring without changing
        # the recognizable Quaternius silhouette or adding detached pieces.
        if "Horns" in vertex_materials[index] and point.x < -0.78:
            wear = min(1.0, max(0.0, (-point.x - 0.78) / 0.38))
            center_x = BRANCH_OFFSET_X
            transformed.x = (
                center_x + (transformed.x - center_x) * (1.0 - 0.68 * wear)
            )
            transformed.z -= 0.12 * wear
        vertices.append(tuple(transformed))
        vertex_meta.append(
            {
                "sourceIndex": index,
                "sourcePoint": point.copy(),
                "sourceMaterials": set(vertex_materials[index]),
                "branch": "R",
            }
        )
        mapped = [
            (RIGHT_BRANCH_GROUPS.get(name, name), weight)
            for name, weight in source_assignments[index]
        ]
        assignments.append(mapped)

    faces: list[tuple[int, ...]] = [
        tuple(polygon.vertices) for polygon in old_mesh.polygons
    ]
    face_meta: list[dict[str, object]] = [
        {
            "sourceMaterial": material_name,
            "sourcePolygon": polygon.index,
            "branch": (
                "L" if any(index in selected for index in polygon.vertices)
                else None
            ),
        }
        for polygon, material_name in zip(old_mesh.polygons, source_materials)
    ]
    duplicated_faces = 0
    mixed_seam_faces = 0
    for polygon, material_name in zip(old_mesh.polygons, source_materials):
        if not any(index in selected for index in polygon.vertices):
            continue
        duplicate = tuple(
            duplicate_indices.get(index, index) for index in polygon.vertices
        )
        if duplicate == tuple(polygon.vertices):
            continue
        faces.append(duplicate)
        face_meta.append(
            {
                "sourceMaterial": material_name,
                "sourcePolygon": polygon.index,
                "branch": "R",
            }
        )
        duplicated_faces += 1
        if not all(index in selected for index in polygon.vertices):
            mixed_seam_faces += 1

    # Quaternius authors the four horns as closed islands inside the same
    # object.  Join every horn at its hidden base with a two-triangle bridge
    # so the exported brahmin is one genuinely connected surface rather than
    # merely one object containing detached shells.
    horn_bridge_faces = 0
    horn_bridge_distances: list[float] = []
    for branch in ("L", "R"):
        for source_side in (-1, 1):
            horn_vertices = {
                index
                for index, meta in enumerate(vertex_meta)
                if (
                    meta["branch"] == branch
                    and "Horns" in meta["sourceMaterials"]
                    and (
                        meta["sourcePoint"].x < 0.0
                        if source_side < 0
                        else meta["sourcePoint"].x > 0.0
                    )
                )
            }
            body_candidates = [
                index
                for index, meta in enumerate(vertex_meta)
                if (
                    meta["branch"] == branch
                    and "Horns" not in meta["sourceMaterials"]
                    and bool(
                        meta["sourceMaterials"].intersection(
                            {"Main", "Main_Light"}
                        )
                    )
                    and -4.34 < meta["sourcePoint"].y < -3.42
                    and meta["sourcePoint"].z > 3.56
                    and (
                        meta["sourcePoint"].x < 0.0
                        if source_side < 0
                        else meta["sourcePoint"].x > 0.0
                    )
                )
            ]
            horn_edges = {
                tuple(sorted((face[index], face[(index + 1) % len(face)])))
                for face in faces
                if all(vertex in horn_vertices for vertex in face)
                for index in range(len(face))
            }
            if not horn_edges or len(body_candidates) < 2:
                raise RuntimeError(
                    "Cannot find a hidden horn-to-skull bridge for "
                    f"branch={branch}, sourceSide={source_side}"
                )

            def nearest_body(vertex_index: int) -> tuple[float, int]:
                point = Vector(vertices[vertex_index])
                return min(
                    (
                        (point - Vector(vertices[candidate])).length,
                        candidate,
                    )
                    for candidate in body_candidates
                )

            edge = min(
                horn_edges,
                key=lambda candidate: (
                    nearest_body(candidate[0])[0]
                    + nearest_body(candidate[1])[0]
                ),
            )
            first_distance, first_body = nearest_body(edge[0])
            second_ranked = sorted(
                (
                    (
                        Vector(vertices[edge[1]])
                        - Vector(vertices[candidate])
                    ).length,
                    candidate,
                )
                for candidate in body_candidates
            )
            second_distance, second_body = next(
                item for item in second_ranked if item[1] != first_body
            )
            if max(first_distance, second_distance) > 0.34:
                raise RuntimeError(
                    "Horn bridge would be visibly long: "
                    f"{first_distance:.4f}, {second_distance:.4f}"
                )
            faces.extend(
                (
                    (edge[0], edge[1], first_body),
                    (edge[1], second_body, first_body),
                )
            )
            face_meta.extend(
                (
                    {
                        "sourceMaterial": "Horns",
                        "sourcePolygon": -1,
                        "branch": branch,
                    },
                    {
                        "sourceMaterial": "Horns",
                        "sourcePolygon": -1,
                        "branch": branch,
                    },
                )
            )
            horn_bridge_faces += 2
            horn_bridge_distances.extend(
                (first_distance, second_distance)
            )

    new_mesh = bpy.data.meshes.new("brahmin_quaternius_connected_body_mesh")
    new_mesh.from_pydata(vertices, (), faces)
    for polygon in new_mesh.polygons:
        polygon.use_smooth = False
    new_mesh.update()
    body.data = new_mesh
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)

    body.vertex_groups.clear()
    all_group_names = list(old_groups)
    for name in (*RIGHT_BRANCH_GROUPS.values(), *SECONDARY_BONES):
        if name not in all_group_names:
            all_group_names.append(name)
    groups = {
        name: body.vertex_groups.new(name=name)
        for name in all_group_names
    }
    for index, vertex_assignments in enumerate(assignments):
        for name, weight in vertex_assignments:
            if weight > 1e-6:
                groups[name].add([index], weight, "REPLACE")

    create_box_projected_uv(body)
    modifier = next(
        (item for item in body.modifiers if item.type == "ARMATURE"),
        None,
    )
    if modifier is None:
        modifier = body.modifiers.new("brahmin_full_skin", "ARMATURE")
        modifier.object = body.parent
    return {
        "selectedSourceVertices": len(selected),
        "sourceVertices": len(source_points),
        "resultVertices": len(vertices),
        "sourcePolygons": len(source_materials),
        "duplicatedBranchPolygons": duplicated_faces,
        "mixedSharedSeamPolygons": mixed_seam_faces,
        "hiddenHornBridgeTriangles": horn_bridge_faces,
        "maximumHornBridgeLength": round(
            max(horn_bridge_distances, default=0.0),
            6,
        ),
        "resultPolygons": len(faces),
        "seamY": BRANCH_SEAM_Y,
        "branchOffsetX": BRANCH_OFFSET_X,
        "headLateralScale": HEAD_LATERAL_SCALE,
        "headLongitudinalScale": HEAD_LONGITUDINAL_SCALE,
        "topologyMethod": (
            "forward Quaternius branch duplicated inside one mesh; mixed "
            "boundary faces share the original seam vertices so both necks "
            "remain connected to the torso"
        ),
        "vertexMeta": vertex_meta,
        "faceMeta": face_meta,
    }


def transfer_vertex_weight(
    body: bpy.types.Object,
    index: int,
    target_group: str,
    amount: float,
) -> None:
    vertex = body.data.vertices[index]
    amount = max(0.0, min(1.0, amount))
    existing = [
        (assignment.group, assignment.weight)
        for assignment in vertex.groups
    ]
    for group_index, old_weight in existing:
        body.vertex_groups[group_index].add(
            [index],
            old_weight * (1.0 - amount),
            "REPLACE",
        )
    body.vertex_groups[target_group].add(
        [index],
        amount,
        "REPLACE",
    )


def weight_jaws_and_ears(
    body: bpy.types.Object,
    vertex_meta: list[dict[str, object]],
) -> dict[str, object]:
    counts = {name: 0 for name in SECONDARY_BONES}
    maximum = {name: 0.0 for name in SECONDARY_BONES}
    for index, meta in enumerate(vertex_meta):
        branch = meta["branch"]
        if branch not in {"L", "R"}:
            continue
        point = meta["sourcePoint"]
        materials = meta["sourceMaterials"]
        suffix = str(branch)
        if (
            point.y < -4.34
            and point.z < 3.34
            and abs(point.x) < 0.66
            and not materials.intersection({"Horns", "Eye_Black", "Eye_White"})
        ):
            forward = max(0.0, min(1.0, (-4.25 - point.y) / 0.72))
            lower = max(0.0, min(1.0, (3.38 - point.z) / 0.52))
            weight = min(0.96, 0.18 + forward * lower * 0.86)
            transfer_vertex_weight(body, index, f"Jaw.{suffix}", weight)
            counts[f"Jaw.{suffix}"] += 1
            maximum[f"Jaw.{suffix}"] = max(
                maximum[f"Jaw.{suffix}"],
                weight,
            )
            continue
        if (
            -4.34 < point.y < -3.56
            and point.z > 3.58
            and abs(point.x) > 0.54
            and "Horns" not in materials
            and not materials.intersection({"Eye_Black", "Eye_White"})
        ):
            ear_label = "EarA" if point.x > 0.0 else "EarB"
            group_name = f"{ear_label}.{suffix}"
            outer = max(0.0, min(1.0, (abs(point.x) - 0.48) / 0.58))
            weight = min(0.88, 0.22 + outer * 0.72)
            transfer_vertex_weight(body, index, group_name, weight)
            counts[group_name] += 1
            maximum[group_name] = max(maximum[group_name], weight)
    if min(counts["Jaw.L"], counts["Jaw.R"]) < 25:
        raise RuntimeError(f"Brahmin jaw masks are too sparse: {counts}")
    if min(counts[name] for name in counts if name.startswith("Ear")) < 8:
        raise RuntimeError(f"Brahmin ear masks are too sparse: {counts}")
    return {
        "weightedVertices": counts,
        "maximumWeights": {
            name: round(value, 4) for name, value in maximum.items()
        },
        "jawMask": "forward lower muzzle with feathered anatomical hinge",
        "earMask": "hide polygons only; horns and eyes excluded",
    }


def rematerialize_body(
    body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
    vertex_meta: list[dict[str, object]],
    face_meta: list[dict[str, object]],
) -> dict[str, object]:
    material_order = (
        "hide",
        "ash_hide",
        "dust",
        "muzzle",
        "hoof",
        "eye_black",
        "eye_white",
        "horn",
        "scar",
    )
    body.data.materials.clear()
    for name in material_order:
        body.data.materials.append(materials[name])
    counts = {name: 0 for name in material_order}
    for polygon, meta in zip(body.data.polygons, face_meta):
        source_name = meta["sourceMaterial"]
        source_center = sum(
            (
                vertex_meta[index]["sourcePoint"]
                for index in polygon.vertices
            ),
            Vector(),
        ) / len(polygon.vertices)
        branch = meta["branch"]
        if source_name == "Hooves":
            target = "hoof"
        elif source_name == "Muzzle":
            target = "muzzle"
        elif source_name == "Eye_Black":
            target = "eye_black"
        elif source_name == "Eye_White":
            target = "eye_white"
        elif source_name == "Horns":
            target = "horn"
        elif (
            branch == "R"
            and source_name == "Main"
            and source_center.y < -4.02
            and -0.34 < source_center.x < 0.24
            and 3.28 < source_center.z < 3.86
        ):
            target = "scar"
        elif source_center.z < 0.78:
            target = "dust"
        elif source_name == "Main_Light":
            target = "ash_hide"
        else:
            target = "hide"
        polygon.material_index = material_order.index(target)
        polygon.use_smooth = False
        counts[target] += 1
    body.data.update()
    if counts["hide"] < 900 or counts["horn"] < 200:
        raise RuntimeError(f"Brahmin material hierarchy is incomplete: {counts}")
    if counts["eye_black"] < 50 or counts["scar"] < 3:
        raise RuntimeError(f"Brahmin face accents are incomplete: {counts}")
    return {
        "materialPolygonCounts": counts,
        "uvProjection": "deterministic dominant-axis box projection",
        "facetPolicy": "preserved Quaternius flat-shaded planes",
        "wearHierarchy": (
            "burnt hide, ash patches, contact dust, muted muzzle, worn horn "
            "and a localized healed mutation scar"
        ),
    }


def limit_skin_influences(body: bpy.types.Object) -> dict[str, int]:
    before = [
        sum(1 for assignment in vertex.groups if assignment.weight > 1e-6)
        for vertex in body.data.vertices
    ]
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_limit_total(
        group_select_mode="ALL",
        limit=4,
    )
    bpy.ops.object.vertex_group_normalize_all(
        group_select_mode="ALL",
        lock_active=False,
    )
    after = [
        sum(1 for assignment in vertex.groups if assignment.weight > 1e-6)
        for vertex in body.data.vertices
    ]
    if max(after, default=0) > 4:
        raise RuntimeError("Brahmin skin still exceeds four influences")
    return {
        "verticesLimitedToFourInfluences": sum(
            1 for count in before if count > 4
        ),
        "maximumInfluencesBefore": max(before, default=0),
        "maximumInfluencesAfter": max(after, default=0),
    }


def prepare_actions(armature: bpy.types.Object) -> dict[str, object]:
    retained: set[bpy.types.Action] = set()
    source_mapping: dict[str, str] = {}
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions.get(source)
        if action is None:
            raise RuntimeError(f"Quaternius Bull donor has no action {source}")
        source_mapping[target] = source
        action.name = target
        action.use_fake_user = True
        retained.add(action)
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)
    armature.animation_data_create()
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    baked_frames = 0
    for name in REQUIRED_ACTIONS:
        action = bpy.data.actions[name]
        armature.animation_data.action = action
        start = int(action.frame_range[0])
        end = int(action.frame_range[1])
        bpy.ops.nla.bake(
            frame_start=start,
            frame_end=end,
            only_selected=True,
            visual_keying=True,
            clear_constraints=False,
            clear_parents=False,
            use_current_action=True,
            bake_types={"POSE"},
            channel_types={
                "LOCATION",
                "ROTATION",
                "SCALE",
                "BBONE",
                "PROPS",
            },
        )
        baked_frames += (end - start + 1) * len(armature.pose.bones)
    bpy.ops.object.mode_set(mode="OBJECT")
    removed_constraints = 0
    for bone in armature.pose.bones:
        removed_constraints += len(bone.constraints)
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)
    armature.animation_data.action = bpy.data.actions["idle"]
    return {
        "sourceToRuntime": source_mapping,
        "runtimeRanges": {
            name: [
                round(value, 3)
                for value in bpy.data.actions[name].frame_range
            ]
            for name in REQUIRED_ACTIONS
        },
        "visualBake": {
            "sampledPoseBoneFrames": baked_frames,
            "removedBlenderOnlyConstraints": removed_constraints,
            "purpose": (
                "portable GLB channels preserve the evaluated Quaternius "
                "quadruped IK motion"
            ),
        },
    }


def duplicate_fcurve(
    action: bpy.types.Action,
    source_curve: bpy.types.FCurve,
    source_bone: str,
    target_bone: str,
) -> bpy.types.FCurve:
    data_path = source_curve.data_path.replace(
        f'pose.bones["{source_bone}"]',
        f'pose.bones["{target_bone}"]',
        1,
    )
    curve = action.fcurves.new(
        data_path=data_path,
        index=source_curve.array_index,
        action_group=target_bone,
    )
    curve.keyframe_points.add(len(source_curve.keyframe_points))
    for target, source in zip(
        curve.keyframe_points,
        source_curve.keyframe_points,
    ):
        target.co = source.co
        target.interpolation = source.interpolation
        target.easing = source.easing
        target.handle_left_type = source.handle_left_type
        target.handle_right_type = source.handle_right_type
    curve.update()
    return curve


def duplicate_right_head_actions() -> dict[str, object]:
    mapping = RIGHT_BRANCH_GROUPS
    copied = 0
    for action_name in REQUIRED_ACTIONS:
        action = bpy.data.actions[action_name]
        for source_bone, target_bone in mapping.items():
            target_prefix = f'pose.bones["{target_bone}"]'
            for curve in list(action.fcurves):
                if curve.data_path.startswith(target_prefix):
                    action.fcurves.remove(curve)
            source_prefix = f'pose.bones["{source_bone}"]'
            source_curves = [
                curve
                for curve in list(action.fcurves)
                if curve.data_path.startswith(source_prefix)
            ]
            for curve in source_curves:
                duplicate_fcurve(
                    action,
                    curve,
                    source_bone,
                    target_bone,
                )
                copied += 1
    return {
        "sourceToRightBranch": mapping,
        "copiedFcurves": copied,
        "policy": (
            "right branch inherits authored donor head motion before "
            "asymmetric secondary posing is added"
        ),
    }


def remove_rotation_curves(
    action: bpy.types.Action,
    bone_name: str,
) -> None:
    prefix = f'pose.bones["{bone_name}"].rotation_'
    for curve in list(action.fcurves):
        if curve.data_path.startswith(prefix):
            action.fcurves.remove(curve)


def set_absolute_quaternion_keys(
    armature: bpy.types.Object,
    action_name: str,
    bone_name: str,
    axis: tuple[float, float, float],
    keys: tuple[tuple[int, float], ...],
) -> None:
    action = bpy.data.actions[action_name]
    remove_rotation_curves(action, bone_name)
    armature.animation_data.action = action
    bone = armature.pose.bones[bone_name]
    bone.rotation_mode = "QUATERNION"
    for frame, angle in keys:
        bone.rotation_quaternion = Quaternion(Vector(axis), angle)
        bone.keyframe_insert(
            "rotation_quaternion",
            frame=frame,
            group=bone_name,
        )
    for curve in action.fcurves:
        if curve.data_path.startswith(f'pose.bones["{bone_name}"]'):
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"


def set_pose_transform_keys(
    armature: bpy.types.Object,
    action_name: str,
    bone_name: str,
    keys: tuple[tuple[int, float, float], ...],
) -> None:
    """Replace a bone's transform with safe pitch/yaw animation keys."""
    action = bpy.data.actions[action_name]
    prefix = f'pose.bones["{bone_name}"].'
    for curve in list(action.fcurves):
        if curve.data_path.startswith(prefix) and any(
            channel in curve.data_path
            for channel in (
                "location",
                "rotation_",
                "scale",
            )
        ):
            action.fcurves.remove(curve)
    armature.animation_data.action = action
    bone = armature.pose.bones[bone_name]
    bone.rotation_mode = "QUATERNION"
    for frame, pitch, yaw in keys:
        bone.location = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)
        bone.rotation_quaternion = (
            Quaternion(Vector((1.0, 0.0, 0.0)), pitch)
            @ Quaternion(Vector((0.0, 0.0, 1.0)), yaw)
        )
        bone.keyframe_insert("location", frame=frame, group=bone_name)
        bone.keyframe_insert(
            "rotation_quaternion",
            frame=frame,
            group=bone_name,
        )
        bone.keyframe_insert("scale", frame=frame, group=bone_name)
    for curve in action.fcurves:
        if curve.data_path.startswith(prefix):
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"


def author_safe_two_head_headbutt(
    armature: bpy.types.Object,
) -> dict[str, object]:
    """Replace the donor's diagonal horn sweep with a sagittal two-head hit."""
    common = (
        (0, 0.00, 0.00),
        (6, 0.08, 0.00),
        (12, 0.26, 0.00),
        (16, 0.42, 0.00),
        (20, 0.24, 0.00),
        (24, -0.08, 0.00),
        (31, 0.00, 0.00),
    )
    neck2 = (
        (0, 0.00, 0.05),
        (6, 0.05, 0.07),
        (12, 0.13, 0.11),
        (16, 0.18, 0.15),
        (20, 0.10, 0.10),
        (24, -0.04, 0.07),
        (31, 0.00, 0.05),
    )
    neck3 = (
        (0, 0.00, 0.04),
        (6, 0.06, 0.07),
        (12, 0.15, 0.12),
        (16, 0.24, 0.17),
        (20, 0.13, 0.11),
        (24, -0.05, 0.07),
        (31, 0.00, 0.04),
    )
    head = (
        (0, 0.00, 0.04),
        (6, 0.05, 0.07),
        (12, 0.12, 0.11),
        (16, 0.18, 0.14),
        (20, 0.10, 0.10),
        (24, -0.04, 0.06),
        (31, 0.00, 0.04),
    )
    set_pose_transform_keys(
        armature,
        "attack",
        "Neck1",
        common,
    )
    for left_name, right_name, source_keys in (
        ("Neck2", "Neck2.R", neck2),
        ("Neck3", "Neck3.R", neck3),
        ("Head", "Head.R", head),
    ):
        left_keys = tuple(
            (frame, pitch, -abs(yaw))
            for frame, pitch, yaw in source_keys
        )
        right_keys = tuple(
            (frame, pitch, abs(yaw))
            for frame, pitch, yaw in source_keys
        )
        set_pose_transform_keys(
            armature,
            "attack",
            left_name,
            left_keys,
        )
        set_pose_transform_keys(
            armature,
            "attack",
            right_name,
            right_keys,
        )
    return {
        "method": (
            "donor body weight-shift retained; diagonal single-head neck "
            "sweep replaced by symmetric sagittal pitch with outward yaw"
        ),
        "maximumCommonNeckPitchRadians": 0.42,
        "maximumBranchPitchRadians": 0.24,
        "maximumOutwardYawRadians": 0.17,
    }


def add_rotation_delta_keys(
    armature: bpy.types.Object,
    action_name: str,
    bone_name: str,
    axis: tuple[float, float, float],
    keys: tuple[tuple[int, float], ...],
) -> None:
    action = bpy.data.actions[action_name]
    armature.animation_data.action = action
    bone = armature.pose.bones[bone_name]
    cached: list[tuple[int, Quaternion]] = []
    for frame, angle in keys:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        bone.rotation_mode = "QUATERNION"
        base = bone.rotation_quaternion.copy()
        cached.append((frame, base @ Quaternion(Vector(axis), angle)))
    for frame, rotation in cached:
        bone.rotation_quaternion = rotation
        bone.keyframe_insert(
            "rotation_quaternion",
            frame=frame,
            group=bone_name,
        )


def add_secondary_animation(
    armature: bpy.types.Object,
) -> dict[str, object]:
    jaw_keys = {
        "idle": ((0, 0.02), (24, 0.10), (50, 0.01), (76, 0.07), (100, 0.02)),
        "walk": ((0, 0.02), (17, 0.06), (35, 0.02)),
        "run": ((0, 0.05), (9, 0.10), (18, 0.05)),
        "attack": ((0, 0.01), (10, 0.04), (16, 0.20), (24, 0.05), (31, 0.01)),
        "hurt": ((0, 0.01), (5, 0.13), (12, 0.03), (20, 0.01)),
        "death": ((0, 0.02), (15, 0.06), (30, 0.14)),
    }
    for action_name, keys in jaw_keys.items():
        set_absolute_quaternion_keys(
            armature,
            action_name,
            "Jaw.L",
            (1.0, 0.0, 0.0),
            keys,
        )
        shifted = tuple(
            (
                frame,
                max(0.0, angle * 0.82 + (0.015 if index % 2 else 0.0)),
            )
            for index, (frame, angle) in enumerate(keys)
        )
        set_absolute_quaternion_keys(
            armature,
            action_name,
            "Jaw.R",
            (1.0, 0.0, 0.0),
            shifted,
        )
    ear_ranges = {
        "idle": ((0, -0.04), (25, 0.09), (50, -0.02), (75, -0.08), (100, -0.04)),
        "walk": ((0, -0.03), (17, 0.05), (35, -0.03)),
        "run": ((0, -0.06), (9, 0.07), (18, -0.06)),
        "attack": ((0, 0.0), (12, -0.13), (20, 0.08), (31, 0.0)),
        "hurt": ((0, 0.0), (5, -0.18), (12, 0.06), (20, 0.0)),
        "death": ((0, 0.0), (15, -0.08), (30, -0.15)),
    }
    for action_name, keys in ear_ranges.items():
        for bone_name, sign in (
            ("EarA.L", 1.0),
            ("EarB.L", -0.8),
            ("EarA.R", -0.7),
            ("EarB.R", 0.9),
        ):
            set_absolute_quaternion_keys(
                armature,
                action_name,
                bone_name,
                (0.0, 0.0, 1.0),
                tuple((frame, angle * sign) for frame, angle in keys),
            )
    headbutt_report = author_safe_two_head_headbutt(armature)
    add_rotation_delta_keys(
        armature,
        "idle",
        "Head.R",
        (0.0, 0.0, 1.0),
        ((0, 0.04), (25, 0.09), (50, 0.03), (75, 0.07), (100, 0.04)),
    )
    add_rotation_delta_keys(
        armature,
        "idle",
        "Head",
        (0.0, 0.0, 1.0),
        ((0, -0.04), (25, -0.06), (50, -0.03), (75, -0.05), (100, -0.04)),
    )
    add_rotation_delta_keys(
        armature,
        "hurt",
        "Head.R",
        (0.0, 1.0, 0.0),
        ((0, 0.0), (5, 0.11), (12, -0.04), (20, 0.0)),
    )
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(50)
    return {
        "jaws": {
            "bones": ["Jaw.L", "Jaw.R"],
            "attackMaximumRadians": 0.20,
            "asynchronousChewing": True,
        },
        "ears": {
            "bones": ["EarA.L", "EarB.L", "EarA.R", "EarB.R"],
            "asymmetricFlicks": True,
        },
        "rightHeadAsymmetry": {
            "idleYawRadians": 0.09,
            "attackCounterYawRadians": 0.14,
            "hurtRollRadians": 0.11,
        },
        "twoHeadOutwardYaw": {
            "idleRadians": 0.04,
            "attackMaximumRadians": 0.17,
            "purpose": (
                "preserve a readable gap between cheeks and internal horns "
                "through the headbutt arc"
            ),
        },
        "headbuttRetarget": headbutt_report,
    }


def export_candidate(
    output: Path,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    body: bpy.types.Object,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    root.select_set(True)
    armature.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Quaternius Ultimate Animated Animals / Bull topology, rig and "
            "base animations: CC0 1.0. Realm of Ashes two-head anatomy and "
            "B+C materials: project work."
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
    approved_review_sha = validate_sha256(args.runtime_approved_sha)
    runtime_mode = bool(approved_review_sha)
    donor_hash = hashlib.sha256(args.source_blend.read_bytes()).hexdigest().upper()
    if donor_hash != DONOR_SHA256:
        raise RuntimeError(
            f"Unexpected Quaternius Bull hash {donor_hash}; "
            f"expected {DONOR_SHA256}"
        )
    if (
        not bpy.data.filepath
        or Path(bpy.data.filepath).resolve() != args.source_blend.resolve()
        or bpy.data.objects.get("Cow") is None
        or bpy.data.objects.get("AnimalArmature") is None
    ):
        bpy.ops.wm.open_mainfile(filepath=str(args.source_blend.resolve()))
    body = bpy.data.objects.get("Cow")
    armature = bpy.data.objects.get("AnimalArmature")
    if body is None or armature is None:
        raise RuntimeError(
            "Quaternius Bull donor must contain Cow mesh and AnimalArmature"
        )
    if body.type != "MESH" or armature.type != "ARMATURE":
        raise RuntimeError("Quaternius Bull donor objects have unexpected types")

    materials = {
        "hide": pbr_material(
            "brahmin_burnt_umber_weathered_hide",
            (0.355, 0.165, 0.085),
            0.95,
            normal_strength=0.23,
        ),
        "ash_hide": pbr_material(
            "brahmin_ash_patched_hide",
            (0.285, 0.245, 0.190),
            0.96,
            normal_strength=0.19,
        ),
        "dust": pbr_material(
            "brahmin_pale_contact_dust",
            (0.440, 0.335, 0.220),
            0.98,
            normal_strength=0.15,
        ),
        "muzzle": pbr_material(
            "brahmin_dry_muted_muzzle",
            (0.245, 0.115, 0.090),
            0.92,
            normal_strength=0.12,
        ),
        "hoof": pbr_material(
            "brahmin_chipped_charcoal_hooves",
            (0.070, 0.060, 0.050),
            0.88,
            normal_strength=0.16,
        ),
        "eye_black": pbr_material(
            "brahmin_deep_glossy_eyes",
            (0.018, 0.014, 0.010),
            0.38,
            normal_strength=0.04,
        ),
        "eye_white": pbr_material(
            "brahmin_dusty_eye_whites",
            (0.555, 0.455, 0.325),
            0.78,
            normal_strength=0.04,
        ),
        "horn": pbr_material(
            "brahmin_worn_ochre_horns",
            (0.520, 0.395, 0.220),
            0.89,
            normal_strength=0.13,
        ),
        "scar": pbr_material(
            "brahmin_healed_mutation_scar",
            (0.385, 0.125, 0.070),
            0.91,
            normal_strength=0.10,
        ),
    }

    rig_report = augment_brahmin_rig(armature)
    topology_report = rebuild_connected_two_head_topology(body)
    vertex_meta = topology_report.pop("vertexMeta")
    face_meta = topology_report.pop("faceMeta")
    secondary_weight_report = weight_jaws_and_ears(body, vertex_meta)
    material_report = rematerialize_body(
        body,
        materials,
        vertex_meta,
        face_meta,
    )
    skin_report = limit_skin_influences(body)
    action_report = prepare_actions(armature)
    branch_animation_report = duplicate_right_head_actions()
    secondary_animation_report = add_secondary_animation(armature)

    body.name = "brahmin_quaternius_connected_two_head_body"
    body.data.name = "brahmin_quaternius_connected_two_head_body_mesh"
    armature.name = "brahmin_quaternius_full_rig"
    root = bpy.data.objects.new(args.asset_id, None)
    bpy.context.scene.collection.objects.link(root)
    armature.parent = root
    root.scale = RUNTIME_ROOT_SCALE if runtime_mode else ROOT_SCALE
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_style"] = "geometry_b_materials_c"
    root["realm_species"] = "brahmin"
    root["realm_geometry_provenance"] = (
        "Quaternius Bull connected topology with shared two-neck fork"
    )
    root["realm_donor_sha256"] = donor_hash
    root["realm_two_head_anatomy"] = True
    root["realm_no_equipment"] = True
    if runtime_mode:
        root["realm_approved_review_sha256"] = approved_review_sha
        root["realm_runtime_scale_multiplier"] = 1.0
        root["realm_runtime_scale_compensation"] = (
            "component_square_root_for_threejs_skinned_bounds"
        )
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_action_source_mapping"] = json.dumps(
        SOURCE_ACTIONS,
        sort_keys=True,
    )

    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(50)
    bpy.context.view_layer.update()
    minimum, _maximum = evaluated_bounds([body])
    root.location.z -= minimum.z
    bpy.context.view_layer.update()
    ground_report = apply_ground_contact_corrections(
        armature,
        [body],
        root,
    )
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(50)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds([body])
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    root["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }

    export_candidate(args.output, root, armature, body)
    actual = parse_glb(args.output)
    missing_actions = sorted(set(REQUIRED_ACTIONS) - set(actual["animations"]))
    if missing_actions:
        raise RuntimeError(f"Brahmin export is missing actions: {missing_actions}")
    if actual["skins"] != 1 or actual["skinJointCounts"] != [51]:
        raise RuntimeError(
            "Brahmin must export one 51-joint augmented Quaternius skin; "
            f"got {actual['skins']} skins and {actual['skinJointCounts']} joints"
        )
    components = connected_component_count(body)
    if components != 1:
        raise RuntimeError(
            f"Brahmin primary body must stay connected; got {components}"
        )

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
            "twoHeadAugmentation": rig_report,
        },
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "geometryAnalysis": {
            "primaryBodyConnectedComponents": components,
            "primaryBodyTopology": (
                "connected Quaternius Bull surface with shared Y-shaped "
                "two-neck fork"
            ),
            "sourceVertices": topology_report["sourceVertices"],
            "resultVertices": len(body.data.vertices),
            "sourceTriangles": topology_report["sourcePolygons"] * 2,
            "resultTriangles": sum(
                len(polygon.vertices) - 2 for polygon in body.data.polygons
            ),
            "flatShaded": all(
                not polygon.use_smooth for polygon in body.data.polygons
            ),
            "twoHeadRebuild": topology_report,
            "materialRemap": material_report,
            "secondarySkinning": secondary_weight_report,
            "skinInfluenceNormalization": skin_report,
        },
        "actions": action_report,
        "rightHeadAnimation": branch_animation_report,
        "secondaryAnimation": secondary_animation_report,
        "groundContactCorrections": {
            "actions": ground_report,
        },
        "provenance": {
            "donor": "Quaternius Ultimate Animated Animals / Bull.blend",
            "donorSha256": donor_hash,
            "license": "CC0 1.0 Universal",
            "geometry": (
                "connected donor body and limbs; forward branch duplicated "
                "with shared seam into original two-head mutant anatomy"
            ),
            "rig": (
                "Quaternius 42-bone quadruped rig plus right neck/head branch, "
                "two jaws and four deforming ears"
            ),
            "animations": (
                "Quaternius Idle, Walk, Gallop, Attack_Headbutt, "
                "Idle_HitReact_Left and Death with Realm secondary motion"
            ),
            "materials": (
                "original Realm of Ashes B+C packed 512 px PBR textures"
            ),
        },
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if runtime_mode:
        report["approvedReviewSha256"] = approved_review_sha
        report["runtimeScaleMultiplier"] = 1.0
        report["runtimeRootScale"] = [
            round(component, 9) for component in RUNTIME_ROOT_SCALE
        ]
        report["runtimeScaleCompensation"] = (
            "component_square_root_for_threejs_skinned_bounds"
        )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print(
        "REALM_UNIFIED_QUATERNIUS_BRAHMIN="
        + json.dumps(report, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
