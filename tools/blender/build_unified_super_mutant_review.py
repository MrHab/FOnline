"""Build the Realm of Ashes B+C super mutant from the approved humanoid rig.

The legacy runtime asset was nine disconnected primitives without a skin or
animations.  This generator keeps the approved 65-joint humanoid contract,
authors a much heavier mutant anatomy, adds skinned facial landmarks, gives
the body worn packed PBR materials and exports all six combat actions.
Equipment deliberately remains outside the body asset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_ghoul_review import (
    SOURCE_SHA256,
    connected_component_count,
    weld_body,
    weight_map,
    closest_on_segment,
    bone_segment_in_mesh,
)
from build_unified_humanoid_npc_review import (
    add_combat_actions,
    capture_idle_baseline,
    clear_scene,
    create_action,
    evaluated_bounds,
    export_candidate as export_humanoid_candidate,
    import_player,
    parse_glb,
    reset_pose,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
BODY_SCALE = 1.20
LIMB_FACTORS = {
    "upperarm_l": 1.44,
    "upperarm_r": 1.49,
    "lowerarm_l": 1.38,
    "lowerarm_r": 1.43,
    "thigh_l": 1.19,
    "thigh_r": 1.22,
    "calf_l": 1.16,
    "calf_r": 1.18,
    "hand_l": 1.30,
    "hand_r": 1.33,
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="creature_super_mutant_unified_v1")
    parser.add_argument("--runtime-approved-sha")
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


def reshape_body(
    body: bpy.types.Object,
    armature: bpy.types.Object,
) -> dict[str, object]:
    """Create a heavy, broad, readable mutant silhouette with feathered weights."""
    index_to_name = {group.index: group.name for group in body.vertex_groups}
    segments = {
        name: bone_segment_in_mesh(body, armature, name)
        for name in LIMB_FACTORS
    }
    changed = 0
    torso_vertices = 0
    limb_vertices = 0
    head_vertices = 0
    hand_vertices = 0
    maximum_displacement = 0.0

    for vertex in body.data.vertices:
        original = vertex.co.copy()
        co = original.copy()
        weights = weight_map(vertex, index_to_name)

        for bone_name, factor in LIMB_FACTORS.items():
            influence = min(1.0, weights.get(bone_name, 0.0))
            if influence <= 0.025:
                continue
            start, end = segments[bone_name]
            anchor = closest_on_segment(co, start, end)
            target = anchor + (co - anchor) * factor
            co = co.lerp(target, influence * 0.92)
            limb_vertices += 1
            if bone_name.startswith("hand"):
                hand_vertices += 1

        pelvis = weights.get("pelvis", 0.0)
        lower_torso = weights.get("spine_01", 0.0)
        chest = weights.get("spine_02", 0.0) + weights.get("spine_03", 0.0)
        torso = min(1.0, pelvis + lower_torso + chest)
        if torso > 0.025:
            target = co.copy()
            chest_band = max(0.0, min(1.0, chest))
            waist_band = max(0.0, min(1.0, pelvis + lower_torso))
            target.x *= 1.0 + torso * (0.20 + chest_band * 0.25)
            target.y *= 1.0 + torso * (0.12 + chest_band * 0.12)
            # A compact waist keeps the silhouette powerful instead of obese.
            if 0.94 < target.z < 1.20:
                target.x *= 1.0 - 0.055 * waist_band
            # A forward barrel chest and high trapezius break the human outline.
            target.y -= chest_band * 0.030
            shoulder = min(
                1.0,
                weights.get("clavicle_l", 0.0)
                + weights.get("clavicle_r", 0.0)
                + weights.get("upperarm_l", 0.0) * 0.32
                + weights.get("upperarm_r", 0.0) * 0.32,
            )
            target.x *= 1.0 + shoulder * 0.20
            target.z += shoulder * 0.018
            co = co.lerp(target, torso)
            torso_vertices += 1

        neck = min(1.0, weights.get("neck_01", 0.0))
        if neck > 0.025:
            # Thick, shortened neck and forward head carriage.
            co.x *= 1.0 + neck * 0.23
            co.y -= neck * 0.035
            co.z -= neck * 0.018

        head = min(1.0, weights.get("head", 0.0))
        if head > 0.025:
            target = co.copy()
            target.x *= 1.0 + 0.18 * head
            # Low cranium, heavy cheekbones and prognathic lower face.
            if target.z > 1.72:
                target.z -= 0.030 * head
            cheek_band = max(0.0, 1.0 - abs(target.z - 1.665) / 0.085)
            jaw_band = max(0.0, 1.0 - abs(target.z - 1.600) / 0.060)
            front = max(0.0, min(1.0, (-target.y - 0.010) / 0.105))
            target.x *= 1.0 + cheek_band * 0.105 * head
            target.y -= jaw_band * front * 0.068 * head
            target.z -= jaw_band * front * 0.016 * head
            # Flatten the nose bridge and deepen the brow plane.
            if abs(target.x) < 0.034 and 1.655 < target.z < 1.735:
                target.y += 0.020 * front * head
            co = co.lerp(target, head)
            head_vertices += 1

        # Controlled asymmetry supports the worn B+C art direction.
        if 1.10 < co.z < 1.62:
            co.x += sin(co.z * 29.0 + co.y * 23.0) * 0.0026 * (
                0.4 + abs(co.x)
            )

        displacement = (co - original).length
        if displacement > 1e-7:
            vertex.co = co
            changed += 1
            maximum_displacement = max(maximum_displacement, displacement)

    body.data.update()
    return {
        "changedVertices": changed,
        "torsoVertices": torso_vertices,
        "limbInfluences": limb_vertices,
        "handInfluences": hand_vertices,
        "headVertices": head_vertices,
        "maximumDisplacementMetres": round(maximum_displacement, 6),
        "policy": (
            "weight-feathered barrel chest, wide shoulders, thick limbs and "
            "hands, shortened neck, low cranium, heavy cheeks and projecting jaw"
        ),
    }


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "skin": pbr_material(
            "mutant_weathered_olive_skin", (0.245, 0.325, 0.175), 0.90,
            normal_strength=0.24,
        ),
        "shadow": pbr_material(
            "mutant_deep_skin_folds", (0.135, 0.195, 0.100), 0.95,
            normal_strength=0.27,
        ),
        "scar": pbr_material(
            "mutant_old_pink_scars", (0.330, 0.205, 0.150), 0.91,
            normal_strength=0.18,
        ),
        "callus": pbr_material(
            "mutant_knuckle_callus", (0.300, 0.285, 0.165), 0.96,
            normal_strength=0.25,
        ),
        "cloth": pbr_material(
            "mutant_charcoal_underwear", (0.050, 0.048, 0.040), 0.98,
            normal_strength=0.14,
        ),
        "nail": pbr_material(
            "mutant_chipped_nails", (0.365, 0.335, 0.185), 0.84,
            normal_strength=0.09,
        ),
        "eye": pbr_material(
            "mutant_amber_eyes", (0.420, 0.270, 0.075), 0.76,
            normal_strength=0.03,
        ),
        "tooth": pbr_material(
            "mutant_worn_tusks", (0.335, 0.300, 0.155), 0.86,
            normal_strength=0.10,
        ),
    }


def assign_body_materials(
    body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> dict[str, int]:
    body.data.materials.clear()
    order = ("skin", "shadow", "scar", "callus", "cloth", "nail")
    for key in order:
        body.data.materials.append(materials[key])
    counts = {key: 0 for key in order}

    for polygon in body.data.polygons:
        center = sum(
            (body.data.vertices[index].co for index in polygon.vertices),
            Vector(),
        ) / len(polygon.vertices)
        key = "skin"
        if 0.86 < center.z < 1.12 and abs(center.x) < 0.31:
            key = "cloth"
        elif center.z < 0.045 or (abs(center.x) > 0.80 and center.y < -0.015):
            key = "nail"
        elif (
            (abs(center.x) > 0.64 and 1.28 < center.z < 1.53)
            or (center.z < 0.13 and center.y < -0.025)
        ):
            key = "callus"
        elif any(
            sum(((center[axis] - origin[axis]) / radius[axis]) ** 2 for axis in range(3)) < 1.0
            for origin, radius in (
                ((0.20, -0.08, 1.40), (0.09, 0.07, 0.16)),
                ((-0.12, -0.10, 1.66), (0.055, 0.045, 0.080)),
                ((-0.20, -0.02, 0.58), (0.075, 0.070, 0.130)),
            )
        ):
            key = "scar"
        elif center.y > 0.11 and 1.18 < center.z < 1.62:
            key = "shadow"
        polygon.material_index = order.index(key)
        polygon.use_smooth = False
        counts[key] += 1
    return counts


def bind_rigid_detail(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
) -> None:
    obj.parent = armature
    modifier = obj.modifiers.new("mutant_skin", "ARMATURE")
    modifier.object = armature
    group = obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    for polygon in obj.data.polygons:
        polygon.use_smooth = False


def add_uv_detail(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    armature: bpy.types.Object,
    segments: int = 12,
    rings: int = 6,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=1.0,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bind_rigid_detail(obj, armature, "head")
    return obj


def add_tusk(
    name: str,
    x: float,
    armature: bpy.types.Object,
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=7,
        radius1=0.011,
        radius2=0.004,
        depth=0.036,
        location=(x, -0.128, 1.615),
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = -0.16
    obj.rotation_euler[1] = 0.10 if x < 0 else -0.10
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bind_rigid_detail(obj, armature, "head")
    return obj


def create_face_details(
    armature: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    # The projecting jaw and brow are sculpted into the connected head.  Only
    # short worn tusks remain separate so the face still reads at game scale
    # without looking like a stack of floating primitives.
    details = [
        add_tusk("mutant_tusk_left", -0.060, armature, materials["tooth"]),
        add_tusk("mutant_tusk_right", 0.060, armature, materials["tooth"]),
    ]
    return details


def configure_eyes(
    eyes: bpy.types.Object,
    material: bpy.types.Material,
) -> None:
    eyes.data.materials.clear()
    eyes.data.materials.append(material)
    for polygon in eyes.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = False


def create_mutant_attack(armature: bpy.types.Object) -> dict[str, object]:
    baseline = capture_idle_baseline(armature)
    neutral = {
        "root": {"location": (0.0, 0.0, 0.0)},
        "spine_01": {"rotation": (0.0, 0.0, 0.0)},
        "spine_02": {"rotation": (0.0, 0.0, 0.0)},
        "spine_03": {"rotation": (0.0, 0.0, 0.0)},
        "head": {"rotation": (0.0, 0.0, 0.0)},
        "upperarm_l": {"rotation": (0.0, 0.0, 0.0)},
        "upperarm_r": {"rotation": (0.0, 0.0, 0.0)},
        "lowerarm_l": {"rotation": (0.0, 0.0, 0.0)},
        "lowerarm_r": {"rotation": (0.0, 0.0, 0.0)},
    }
    finger_curl = {}
    for side, mirror in (("l", 1.0), ("r", -1.0)):
        for finger in ("index", "middle", "ring", "pinky"):
            for joint, factor in ((1, 0.48), (2, 0.78), (3, 0.64)):
                finger_curl[f"{finger}_{joint:02d}_{side}"] = {
                    "rotation": (factor, 0.0, 0.03 * mirror)
                }
        finger_curl[f"thumb_01_{side}"] = {
            "rotation": (0.20, 0.18 * mirror, 0.0)
        }
    frames = (
        (1, neutral),
        (
            7,
            {
                **neutral,
                "root": {"location": (0.0, 0.025, -0.015)},
                "spine_01": {"rotation": (-0.08, 0.02, -0.16)},
                "spine_02": {"rotation": (-0.15, 0.04, -0.24)},
                "spine_03": {"rotation": (-0.20, 0.03, -0.28)},
                "head": {"rotation": (0.10, -0.02, 0.16)},
                "upperarm_r": {"rotation": (-0.75, -0.20, 0.55)},
                "lowerarm_r": {"rotation": (-0.95, 0.08, 0.12)},
                "upperarm_l": {"rotation": (-0.15, 0.10, -0.28)},
                "lowerarm_l": {"rotation": (-0.35, 0.0, 0.06)},
                **finger_curl,
            },
        ),
        (
            13,
            {
                **neutral,
                "root": {"location": (0.0, -0.085, 0.025)},
                "spine_01": {"rotation": (0.12, -0.02, 0.18)},
                "spine_02": {"rotation": (0.24, -0.04, 0.30)},
                "spine_03": {"rotation": (0.30, -0.02, 0.36)},
                "head": {"rotation": (-0.18, 0.03, -0.20)},
                "upperarm_r": {"rotation": (0.35, 0.16, -0.45)},
                "lowerarm_r": {"rotation": (-0.18, -0.08, -0.08)},
                "upperarm_l": {"rotation": (0.08, -0.10, 0.24)},
                "lowerarm_l": {"rotation": (-0.18, 0.0, -0.04)},
                **finger_curl,
            },
        ),
        (23, neutral),
    )
    create_action(armature, "attack", frames, baseline)
    return {
        "style": "heavy whole-body hook with guarded support arm",
        "frames": [1, 7, 13, 23],
        "fullyKeyedBones": len(baseline),
        "fingerPose": "both hands use articulated curled fingers",
    }


def configure_asset(
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    asset_id: str,
    approved_review_sha: str,
) -> None:
    runtime_mode = bool(approved_review_sha)
    armature.name = "super_mutant_full_humanoid_rig"
    armature.scale = (BODY_SCALE, BODY_SCALE, BODY_SCALE)
    armature["realm_schema"] = "realm.unified-creature-review.v1"
    armature["realm_asset_id"] = asset_id
    armature["realm_category"] = "humanoid_mutant"
    armature["realm_species"] = "super_mutant"
    armature["realm_style"] = "geometry_b_materials_c"
    armature["realm_shared_player_topology"] = True
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_underwear_included"] = True
    armature["realm_barefoot"] = True
    armature["realm_no_equipment"] = True
    armature["realm_inventory_driven_equipment"] = True
    armature["realm_review_only"] = not runtime_mode
    armature["realm_runtime_integration_allowed"] = runtime_mode
    if runtime_mode:
        armature["realm_approved_review_sha256"] = approved_review_sha
        armature["realm_runtime_scale_multiplier"] = 1.0
    for obj in meshes:
        obj.parent = armature
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = armature


def export_candidate(
    output: Path,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Realm of Ashes B+C super mutant. Humanoid topology, rig and base "
            "motion derive from the approved Quaternius-based player system; "
            "mutant anatomy, face details, materials and combat pose are project work."
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
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest().upper()
    if source_hash != SOURCE_SHA256:
        raise RuntimeError(
            f"Unexpected humanoid v5 hash {source_hash}; expected {SOURCE_SHA256}"
        )
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.frame_start = 0
    scene.frame_end = 250
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    armature, imported_meshes = import_player(args.source)
    body = next(
        (obj for obj in imported_meshes if obj.name.startswith("body_base")),
        None,
    )
    eyes = next(
        (obj for obj in imported_meshes if "face_eyes" in obj.name),
        None,
    )
    if body is None or eyes is None:
        raise RuntimeError("Approved humanoid source has no body or eyes")
    for obj in list(imported_meshes):
        if obj not in (body, eyes):
            bpy.data.objects.remove(obj, do_unlink=True)

    body.name = "super_mutant_connected_heavy_body"
    body.data.name = "super_mutant_connected_heavy_body_mesh"
    eyes.name = "super_mutant_amber_eyes"
    eyes.data.name = "super_mutant_amber_eyes_mesh"
    weld_report = weld_body(body)
    if connected_component_count(body.data) != 1:
        raise RuntimeError("Super mutant body must remain one connected surface")
    reshape_report = reshape_body(body, armature)
    materials = create_materials()
    material_counts = assign_body_materials(body, materials)
    configure_eyes(eyes, materials["eye"])
    face_details = create_face_details(armature, materials)
    add_combat_actions(armature)
    attack_report = create_mutant_attack(armature)
    meshes = [body, eyes, *face_details]
    configure_asset(armature, meshes, args.asset_id, approved_review_sha)

    missing = sorted(
        set(REQUIRED_ACTIONS)
        - {action.name.lower() for action in bpy.data.actions}
    )
    if missing:
        raise RuntimeError(f"Super mutant source is missing actions: {missing}")

    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(1)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    armature["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }

    export_candidate(args.output, armature, meshes)
    actual = parse_glb(args.output)
    if actual["skins"] != 1 or actual["skinJointCounts"] != [65]:
        raise RuntimeError(
            "Super mutant must export one 65-joint humanoid skin; "
            f"got {actual['skins']} skins and {actual['skinJointCounts']} joints"
        )
    if sorted(name.lower() for name in actual["animations"]) != sorted(REQUIRED_ACTIONS):
        raise RuntimeError(f"Super mutant action set changed: {actual['animations']}")

    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "source": args.source.name,
        "sourceSha256": source_hash,
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
            "bodyTopology": weld_report,
            "anatomicalReshape": reshape_report,
            "bodyPolygons": len(body.data.polygons),
            "faceDetailMeshes": [obj.name for obj in face_details],
            "flatShaded": all(
                not polygon.use_smooth
                for obj in meshes
                for polygon in obj.data.polygons
            ),
            "removedHumanLayers": ["face_eyebrows", "hair_short_crop"],
        },
        "combatAnimation": attack_report,
        "materials": {
            "bodyMaterialPolygonCounts": material_counts,
            "materialCount": len(materials),
            "textureResolution": [512, 512],
            "policy": (
                "weathered olive skin, deep folds, old scars, callused hands, "
                "charcoal underwear, chipped nails, amber eyes and worn tusks"
            ),
        },
        "design": {
            "bodyScale": BODY_SCALE,
            "underwearIncluded": True,
            "barefoot": True,
            "equipmentBakedIntoBody": False,
            "inventoryDrivenEquipment": True,
        },
        "provenance": {
            "base": "approved humanoid NPC v5 / current player anatomy",
            "baseLicense": "Quaternius CC0-1.0 plus Realm adaptations",
            "geometry": (
                "welded approved humanoid body with weight-feathered, "
                "project-authored super mutant anatomy and facial landmarks"
            ),
            "rigAndAnimations": (
                "approved 65-joint humanoid skin and six complete actions"
            ),
            "externalDonorBeyondApprovedHumanoid": None,
        },
        "reviewOnly": not bool(approved_review_sha),
        "runtimeIntegrationAllowed": bool(approved_review_sha),
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if approved_review_sha:
        report["approvedReviewSha256"] = approved_review_sha
        report["runtimeScaleMultiplier"] = 1.0
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_UNIFIED_SUPER_MUTANT=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
