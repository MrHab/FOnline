"""Build the Lantern (Фонарник) from the CC0 Quaternius Stag.

The donor is the official Quaternius glTF export of the Ultimate Animated
Animals Stag: one connected body skinned to a quadruped rig, antlers parented
to the head bone and baked animal motion. Realm of Ashes keeps topology, rig
and motion, replaces the materials with packed B+C PBR textures, turns the
antlers into the cold-glowing symbiont from the bestiary, normalizes the six
runtime action names and gates runtime export behind an approved review
SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import (
    apply_ground_contact_corrections,
    connected_component_count,
    evaluated_bounds,
    parse_glb,
)
from build_unified_quaternius_wolf_review import (
    create_box_projected_uv,
    limit_skin_influences,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
SOURCE_ACTIONS = {
    "idle": "AnimalArmature|Idle",
    "walk": "AnimalArmature|Walk",
    "run": "AnimalArmature|Gallop",
    "attack": "AnimalArmature|Attack_Headbutt",
    "hurt": "AnimalArmature|Idle_HitReact_Left",
    "death": "AnimalArmature|Death",
}
DONOR_SHA256 = "3C2DF7C13A3D37C8660684E46AA1E5A2BF7E91A9B279983921D48BD93D0B67ED"
# Quaternius authors in arbitrary units (the stag stands 5.7 units with
# antlers). One uniform factor gives a 1.9 m long red-deer body with antlers
# reaching about 2.2 m; the model is never stretched on any axis. The factor
# is baked into the rig and meshes (the asset root stays at scale 1): a
# scaled root is applied twice by three.js skinned bounds, which the collider
# builder uses, while Unity applies it once.
UNIT_SCALE = 0.38
RUNTIME_SCALE_MULTIPLIER = 1.0
# Symbiont glow: a cold blue-green light, as in the bestiary entry.
SYMBIONT_EMISSION = (0.22, 0.95, 0.78)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="creature_lantern_stag_v1")
    parser.add_argument(
        "--runtime-approved-sha",
        help=(
            "Enable runtime export and record the SHA-256 of the separately "
            "approved review candidate"
        ),
    )
    return parser.parse_args(argv)


def validate_sha256(value: str) -> str:
    normalized = str(value or "").upper()
    if normalized and (
        len(normalized) != 64
        or any(character not in "0123456789ABCDEF" for character in normalized)
    ):
        raise RuntimeError(
            "--runtime-approved-sha must be a 64-character hexadecimal SHA-256"
        )
    return normalized


def add_emission(material: bpy.types.Material, color: tuple[float, float, float]) -> None:
    bsdf = next(
        node for node in material.node_tree.nodes
        if node.type == "BSDF_PRINCIPLED"
    )
    bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
    # Strength 1 keeps the glow in the core emissiveFactor (no extension).
    bsdf.inputs["Emission Strength"].default_value = 1.0


def rematerialize_body(
    body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> dict[str, int]:
    """Map the donor's five flat colours onto the B+C hierarchy."""
    donor_to_target = {
        "Material": "fur",
        "Material.003": "underfur",
        "Material.010": "hooves",
        "Material.001": "hooves",
        "Material.011": "eyes",
    }
    source_names = [
        body.data.materials[polygon.material_index].name
        for polygon in body.data.polygons
    ]
    unknown = sorted(set(source_names) - set(donor_to_target))
    if unknown:
        raise RuntimeError(f"Stag donor has unexpected materials: {unknown}")
    create_box_projected_uv(body)
    body.data.materials.clear()
    order = ("fur", "underfur", "hooves", "eyes")
    for name in order:
        body.data.materials.append(materials[name])
    counts = {name: 0 for name in order}
    for polygon, source in zip(body.data.polygons, source_names):
        target = donor_to_target[source]
        polygon.material_index = order.index(target)
        polygon.use_smooth = False
        counts[target] += 1
    body.data.update()
    if counts["fur"] < 600 or counts["underfur"] < 500 or counts["eyes"] < 8:
        raise RuntimeError(f"Stag material hierarchy is incomplete: {counts}")
    return counts


def bake_donor_rig_transform(
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    unit_scale: float,
) -> dict[str, object]:
    """Bake the donor armature's 100x scale and Y-up rotation into the rig.

    The skinned meshes would otherwise export as identity children of a
    100x node: skinning still renders right, but every tool that bounds a
    mesh by its node transform (the collider builder, Unity renderer bounds)
    sees a 38 m stag. Pose-bone location keys live in bone space, so they are
    multiplied by the baked scale; rotations stay relative to the rest bones.
    """
    factor = armature.scale.x
    if max(abs(value - factor) for value in armature.scale) > 1e-3 * factor:
        raise RuntimeError(f"Donor armature scale is not uniform: {tuple(armature.scale)}")
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()
    unit = Matrix.Scale(unit_scale, 4)
    worlds = {obj: unit @ obj.matrix_world for obj in meshes}
    armature.location *= unit_scale
    armature.scale *= unit_scale
    factor *= unit_scale
    for obj in meshes:
        obj.parent = None
        obj.matrix_world = worlds[obj]
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    scaled_curves = 0
    for action in bpy.data.actions:
        for curve in action.fcurves:
            if curve.data_path.startswith("pose.bones[") and curve.data_path.endswith(".location"):
                for point in curve.keyframe_points:
                    point.co.y *= factor
                    point.handle_left.y *= factor
                    point.handle_right.y *= factor
                scaled_curves += 1
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = armature
        obj.matrix_world = world
    armature.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    return {
        "bakedArmatureScale": round(factor, 6),
        "unitScale": unit_scale,
        "scaledLocationCurves": scaled_curves,
    }


def skin_antlers_to_head(
    antlers: bpy.types.Object,
    armature: bpy.types.Object,
) -> None:
    """Replace the donor's bone parenting with a rigid Head skin.

    A bone-parented child under the scaled donor armature exports with the
    wrong offset (the antlers float above the head and fly off in the death
    clip). A skinned mesh with full Head weight follows the bone exactly in
    every runtime.
    """
    # Skin binds against the rest pose, so the antlers are placed on the
    # resting head, not on whatever frame the donor NLA left evaluated.
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()
    world = antlers.matrix_world.copy()
    antlers.parent = armature
    antlers.parent_type = "OBJECT"
    antlers.parent_bone = ""
    antlers.matrix_world = world
    armature.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    group = antlers.vertex_groups.new(name="Head")
    group.add(list(range(len(antlers.data.vertices))), 1.0, "REPLACE")
    modifier = antlers.modifiers.new("lantern_antler_skin", "ARMATURE")
    modifier.object = armature


def rematerialize_antlers(
    antlers: bpy.types.Object,
    material: bpy.types.Material,
) -> int:
    create_box_projected_uv(antlers)
    antlers.data.materials.clear()
    antlers.data.materials.append(material)
    for polygon in antlers.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = False
    antlers.data.update()
    return len(antlers.data.polygons)


def prepare_actions(armature: bpy.types.Object) -> dict[str, object]:
    retained: set[bpy.types.Action] = set()
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions.get(source)
        if action is None:
            raise RuntimeError(f"Quaternius Stag donor has no action {source}")
        retained.add(action)
    armature.animation_data_create()
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions[source]
        action.name = target
        action.use_fake_user = True
    armature.animation_data.action = bpy.data.actions["idle"]
    return {
        "sourceToRuntime": SOURCE_ACTIONS,
        "runtimeRanges": {
            name: [round(value, 3) for value in bpy.data.actions[name].frame_range]
            for name in REQUIRED_ACTIONS
        },
        "authoredMotion": (
            "Quaternius quadruped idle, walk, gallop, headbutt, hit reaction "
            "and death, baked by the donor glTF export"
        ),
    }


def export_candidate(
    output: Path,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    copyright_text: str = (
        "Quaternius Ultimate Animated Animals / Stag topology, rig and "
        "base animations: CC0 1.0. Realm of Ashes B+C materials and "
        "symbiont glow: project work."
    ),
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in (root, armature, *meshes):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_copyright=copyright_text,
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
    donor_hash = hashlib.sha256(args.source.read_bytes()).hexdigest().upper()
    if donor_hash != DONOR_SHA256:
        raise RuntimeError(
            f"Unexpected Quaternius donor hash {donor_hash}; expected {DONOR_SHA256}"
        )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    body = bpy.data.objects.get("Stag")
    antlers = bpy.data.objects.get("Stag_Horns")
    armature = bpy.data.objects.get("AnimalArmature")
    donor_root = bpy.data.objects.get("RootNode")
    if not all((body, antlers, armature, donor_root)):
        raise RuntimeError(
            "Quaternius donor must contain Stag, Stag_Horns, AnimalArmature and RootNode"
        )
    if antlers.parent != armature or antlers.parent_type != "BONE" or antlers.parent_bone != "Head":
        raise RuntimeError("Stag antlers must stay parented to the Head bone")
    # Blender-only leftovers of the donor export: bone tip empties and a
    # stray icosphere. None of them is part of the creature.
    for obj in list(bpy.context.scene.objects):
        if obj not in (body, antlers, armature, donor_root):
            bpy.data.objects.remove(obj, do_unlink=True)

    materials = {
        "fur": pbr_material(
            "lantern_ash_brown_fur", (0.235, 0.175, 0.125), 0.93, normal_strength=0.22
        ),
        "underfur": pbr_material(
            "lantern_dusty_pale_underfur", (0.440, 0.395, 0.330), 0.95, normal_strength=0.16
        ),
        "hooves": pbr_material(
            "lantern_charcoal_hooves_muzzle", (0.060, 0.055, 0.050), 0.82, normal_strength=0.10
        ),
        "eyes": pbr_material(
            "lantern_milky_eyes", (0.300, 0.420, 0.410), 0.55, normal_strength=0.05
        ),
        "symbiont": pbr_material(
            "lantern_glowing_symbiont_antlers", (0.160, 0.520, 0.460), 0.60, normal_strength=0.20
        ),
    }
    add_emission(materials["symbiont"], SYMBIONT_EMISSION)
    add_emission(materials["eyes"], tuple(value * 0.35 for value in SYMBIONT_EMISSION))
    body_counts = rematerialize_body(body, materials)
    antler_polygons = rematerialize_antlers(antlers, materials["symbiont"])
    skin_antlers_to_head(antlers, armature)
    rig_report = bake_donor_rig_transform(armature, [body, antlers], UNIT_SCALE)
    skin_report = limit_skin_influences(body)
    action_report = prepare_actions(armature)

    body.name = "lantern_quaternius_stag_body"
    body.data.name = "lantern_quaternius_stag_body_mesh"
    antlers.name = "lantern_symbiont_antlers"
    antlers.data.name = "lantern_symbiont_antlers_mesh"
    armature.name = "lantern_quaternius_rig"

    root = bpy.data.objects.new(args.asset_id, None)
    bpy.context.scene.collection.objects.link(root)
    armature_world = armature.matrix_world.copy()
    armature.parent = root
    armature.matrix_world = armature_world
    bpy.data.objects.remove(donor_root, do_unlink=True)
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_style"] = "geometry_b_materials_c"
    root["realm_species"] = "lantern"
    root["realm_geometry_provenance"] = "Quaternius Stag single-component organic topology"
    root["realm_donor_sha256"] = donor_hash
    if runtime_mode:
        root["realm_approved_review_sha256"] = approved_review_sha
        root["realm_runtime_scale_multiplier"] = RUNTIME_SCALE_MULTIPLIER
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_action_source_mapping"] = json.dumps(SOURCE_ACTIONS, sort_keys=True)

    meshes = [body, antlers]
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, _ = evaluated_bounds(meshes)
    root.location.z -= minimum.z
    bpy.context.view_layer.update()
    # Only the body decides ground contact: a lying stag rests on its flank
    # and the lower antler digs into the soil. Counting the antlers would lift
    # the whole carcass 0.8 m into the air at the end of the death clip.
    ground_report = apply_ground_contact_corrections(armature, [body], root)
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    root["realm_collider"] = {
        "type": "box",
        "size": [round(value, 6) for value in size],
        "center": [round(value, 6) for value in center],
    }

    export_candidate(args.output, root, armature, meshes)
    actual = parse_glb(args.output)
    missing = sorted(set(REQUIRED_ACTIONS) - set(actual["animations"]))
    if missing:
        raise RuntimeError(f"Stag export is missing actions: {missing}")
    if sorted(actual["animations"]) != sorted(REQUIRED_ACTIONS):
        raise RuntimeError(f"Stag export has extra actions: {actual['animations']}")
    if actual["skins"] != 1:
        raise RuntimeError(f"Stag must export one skin; got {actual['skins']}")
    components = connected_component_count(body)

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
            "deformingBones": sum(1 for bone in armature.data.bones if bone.use_deform),
        },
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "geometryAnalysis": {
            "primaryBodyConnectedComponents": components,
            "sourceVertices": len(body.data.vertices),
            "sourceTriangles": sum(len(p.vertices) - 2 for p in body.data.polygons),
            "antlerTriangles": sum(len(p.vertices) - 2 for p in antlers.data.polygons),
            "antlerPolygons": antler_polygons,
            "flatShaded": True,
            "materialPolygonCounts": body_counts,
            "skinInfluenceNormalization": skin_report,
            "donorRigTransform": rig_report,
        },
        "actions": action_report,
        "groundContactCorrections": {"actions": ground_report},
        "provenance": {
            "donor": "Quaternius Ultimate Animated Animals / Stag (official glTF, poly.pizza)",
            "donorSha256": donor_hash,
            "license": "CC0 1.0 Universal",
            "geometry": "unaltered donor topology; antlers stay a Head-bone child",
            "animations": "Quaternius Idle, Walk, Gallop, Attack_Headbutt, Idle_HitReact_Left, Death",
            "materials": "original Realm of Ashes B+C packed 512 px PBR textures; emissive symbiont antlers",
        },
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if runtime_mode:
        report["approvedReviewSha256"] = approved_review_sha
        report["runtimeScaleMultiplier"] = RUNTIME_SCALE_MULTIPLIER
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_LANTERN_STAG=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
