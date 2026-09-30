"""Build Крысюк (the city rat) from the CC0 Quaternius Rat.

The donor is the Quaternius Rat glTF from poly.pizza: one flat-shaded body
skinned to a 31-bone quadruped rig with baked idle, walk, run, attack, jump
and death motion. Realm of Ashes keeps topology, rig and motion, welds the
flat-shading split of the glTF into one surface, replaces the two flat
colours with packed B+C PBR textures (grimy fur, a dusty belly, dirty skin on
ears, nose and paws, a scaly tail and dull red eyes), authors the hit flinch
the donor lacks, drops the jump and gates runtime export behind an approved
review SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import (
    connected_component_count,
    evaluated_bounds,
    parse_glb,
)
from build_unified_quaternius_wolf_review import (
    create_box_projected_uv,
    limit_skin_influences,
)
from build_quaternius_lantern_stag_review import (
    add_emission,
    bake_donor_rig_transform,
    export_candidate,
    validate_sha256,
)
from build_quaternius_rykhlyak_review import author_action, capture_pose


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
SOURCE_ACTIONS = {
    "idle": "RatArmature|Rat_Idle",
    "walk": "RatArmature|Rat_Walk",
    "run": "RatArmature|Rat_Run",
    "attack": "RatArmature|Rat_Attack",
    "death": "RatArmature|Rat_Death",
}
DROPPED_ACTIONS = ("RatArmature|Rat_Jump",)
DONOR_SHA256 = "68F67077981102E957059FD00AAF3799E6867C269DE900BD52C9F12CEC1D5F56"
# The donor rat is 4.1 units from nose to rump and 7.0 units with the tail.
# One uniform factor gives a cat-sized feral rat: a 0.57 m body and a 0.96 m
# total length. It is baked into the rig and mesh (the asset root stays at
# scale 1) because three.js skinned bounds apply a scaled root twice.
UNIT_SCALE = 0.137
RUNTIME_SCALE_MULTIPLIER = 1.0
# After the rig bake the armature space is the world: the snout points to -Y,
# +Z is up and +X is the rat's left.
FORWARD = Vector((0.0, -1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))
LATERAL = Vector((1.0, 0.0, 0.0))
GROUND_CLEARANCE_METRES = 0.0015
TRUNK_BONES = {"Body", "Hips", "Torso", "Back", "Shoulders", "Neck", "Head"}
POSE_CHANNELS = (("location", 3, 0.0), ("rotation_quaternion", 4, None), ("scale", 3, 1.0))


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="creature_rat_v1")
    parser.add_argument("--runtime-approved-sha")
    return parser.parse_args(argv)


# --- geometry --------------------------------------------------------------

def weld_flat_shading_split(body: bpy.types.Object) -> dict[str, int]:
    """Join the glTF's per-face vertex copies back into one surface.

    FBX2glTF stores flat shading by giving every face its own vertices, so
    the donor arrives as 2002 loose quads. Welding coincident vertices keeps
    every face, weight and position, and lets the connected-component count
    prove that no part floats off the body; flat shading stays per face.
    """
    before_vertices = len(body.data.vertices)
    before_components = connected_component_count(body)
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    bmesh.ops.remove_doubles(mesh, verts=mesh.verts, dist=1e-6)
    mesh.to_mesh(body.data)
    mesh.free()
    body.data.update()
    return {
        "verticesBefore": before_vertices,
        "verticesAfter": len(body.data.vertices),
        "componentsBefore": before_components,
        "componentsAfter": connected_component_count(body),
        "polygons": len(body.data.polygons),
    }


# --- materials -------------------------------------------------------------

def dominant_bone(body: bpy.types.Object, vertex: bpy.types.MeshVertex, names: dict) -> str:
    if not vertex.groups:
        return ""
    return names[max(vertex.groups, key=lambda item: item.weight).group]


def rematerialize_body(body: bpy.types.Object, materials: dict) -> dict[str, int]:
    """Grey becomes fur, belly and eyes; Pink becomes skin and tail.

    Runs before the rig bake, so faces are classified in the donor's rest
    world space (Z up, snout to -Y, donor units).
    """
    names = {group.index: group.name for group in body.vertex_groups}
    mesh = body.data
    to_world = body.matrix_world.copy()
    normal_to_world = to_world.to_3x3().inverted().transposed()
    source = [mesh.materials[polygon.material_index].name for polygon in mesh.polygons]
    unknown = sorted(set(source) - {"Grey", "Pink"})
    if unknown:
        raise RuntimeError(f"Rat donor has unexpected materials: {unknown}")
    trunk = [(to_world @ vertex.co).z for vertex in mesh.vertices
             if dominant_bone(body, vertex, names) in TRUNK_BONES]
    top, bottom = max(trunk), min(trunk)
    create_box_projected_uv(body)
    mesh.materials.clear()
    order = ("fur", "belly", "skin", "tail", "eyes")
    for name in order:
        mesh.materials.append(materials[name])
    counts = {name: 0 for name in order}
    eye_sides = {-1: 0, 1: 0}
    for polygon, donor in zip(mesh.polygons, source):
        bones = {dominant_bone(body, mesh.vertices[index], names) for index in polygon.vertices}
        center = to_world @ polygon.center
        normal = (normal_to_world @ polygon.normal).normalized()
        height = (center.z - bottom) / (top - bottom)
        if donor == "Pink":
            target = "tail" if any(bone.startswith("Tail") for bone in bones) else "skin"
        elif is_eye(center, normal):
            target = "eyes"
            eye_sides[1 if center.x > 0 else -1] += 1
        elif normal.z < -0.3 and height < 0.45 and bones & TRUNK_BONES:
            target = "belly"
        else:
            target = "fur"
        polygon.material_index = order.index(target)
        polygon.use_smooth = False
        counts[target] += 1
    mesh.update()
    if counts["fur"] < 800 or counts["belly"] < 60 or counts["skin"] < 1500 or counts["tail"] < 200:
        raise RuntimeError(f"Rat material hierarchy is incomplete: {counts}")
    if eye_sides[-1] != eye_sides[1] or not 2 <= eye_sides[1] <= 8:
        raise RuntimeError(f"Rat eyes are not a symmetric pair of small patches: {eye_sides}")
    return counts


# The donor head has no eye geometry: each eye is the few fur faces around
# this point of the rest head (donor world units, left side; the right eye
# mirrors X), facing sideways.
EYE_CENTRE = Vector((0.29, -1.52, 1.44))
EYE_RADIUS = 0.085


def is_eye(center: Vector, normal: Vector) -> bool:
    mirrored = Vector((abs(center.x), center.y, center.z))
    return (mirrored - EYE_CENTRE).length < EYE_RADIUS and abs(normal.x) > 0.35


# --- animation -------------------------------------------------------------

def complete_action_channels(armature: bpy.types.Object) -> int:
    """Key every pose channel the donor clip leaves unkeyed at its rest value.

    A glTF clip that does not animate a bone leaves it at rest. Blender keeps
    whatever the previous clip left instead, so ground contact and the
    authored flinch would be computed on a stale pose. Explicit rest keys make
    every clip self-contained in every runtime.
    """
    added = 0
    for action in bpy.data.actions:
        start = action.frame_range[0]
        present = {(curve.data_path, curve.array_index) for curve in action.fcurves}
        for bone in armature.pose.bones:
            for channel, size, value in POSE_CHANNELS:
                path = f'pose.bones["{bone.name}"].{channel}'
                for index in range(size):
                    if (path, index) in present:
                        continue
                    rest = value if value is not None else (1.0 if index == 0 else 0.0)
                    curve = action.fcurves.new(path, index=index, action_group=bone.name)
                    curve.keyframe_points.insert(start, rest).interpolation = "LINEAR"
                    added += 1
    return added


def prepare_donor_actions(armature: bpy.types.Object) -> dict[str, object]:
    for source in (*SOURCE_ACTIONS.values(), *DROPPED_ACTIONS):
        if bpy.data.actions.get(source) is None:
            raise RuntimeError(f"Quaternius Rat donor has no action {source}")
    armature.animation_data_create()
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    for source in DROPPED_ACTIONS:
        bpy.data.actions.remove(bpy.data.actions[source])
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions[source]
        action.name = target
        action.use_fake_user = True
    extra = sorted(set(action.name for action in bpy.data.actions) - set(SOURCE_ACTIONS))
    if extra:
        raise RuntimeError(f"Rat donor has unexpected actions: {extra}")
    added = complete_action_channels(armature)
    armature.animation_data.action = bpy.data.actions["idle"]
    return {"droppedActions": list(DROPPED_ACTIONS), "restKeyedChannels": added}


def author_hurt(armature: bpy.types.Object) -> bpy.types.Action:
    """Hit flinch, 13 frames at 24 fps, authored in metres after the rig bake.

    The whole rat jolts back from the hit (root), the body rolls and hunches,
    the head is thrown up and aside, the tail whips, then everything settles
    back into the idle pose.
    """
    base = capture_pose(armature, bpy.data.actions["idle"], 0)

    def shove(back: float, up: float = 0.0):
        return (FORWARD * -back + UP * up, [])

    def trunk(back: float, up: float, pitch: float, roll: float, yaw: float = 0.0):
        return (FORWARD * -back + UP * up, [(LATERAL, pitch), (FORWARD, roll), (UP, yaw)])

    def turn(pitch: float, yaw: float = 0.0):
        return (Vector(), [(LATERAL, pitch), (UP, yaw)])

    def whip(yaw: float):
        return (Vector(), [(UP, yaw)])

    return author_action(armature, "hurt", base, [
        (0, {}),
        # Hit: shoved back, the trunk bends into a C away from the blow, the
        # head is thrown up and aside and the tail whips the other way.
        (2, {"root": shove(0.040), "Body": trunk(0.006, -0.004, -3.0, 8.0, 10.0),
             "Hips": turn(0.0, -8.0), "Back": turn(0.0, -8.0),
             "Shoulders": turn(-4.0, 8.0), "Neck": turn(-12.0, 16.0), "Head": turn(-16.0, 20.0),
             "Tail1": whip(-12.0), "Tail2": whip(-20.0), "Tail3": whip(-24.0),
             "Tail4": whip(-20.0), "Tail5": whip(-14.0)}),
        # Counter-swing.
        (5, {"root": shove(0.030), "Body": trunk(0.004, -0.002, -1.0, -3.0, -4.0),
             "Hips": turn(0.0, 4.0), "Back": turn(0.0, 4.0),
             "Neck": turn(-4.0, -8.0), "Head": turn(-5.0, -10.0),
             "Tail2": whip(14.0), "Tail3": whip(20.0), "Tail4": whip(22.0), "Tail5": whip(16.0)}),
        (9, {"root": shove(0.012), "Body": trunk(0.001, 0.0, 0.0, 1.0, 1.5),
             "Neck": turn(-1.0, 2.0), "Head": turn(-1.0, 3.0),
             "Tail3": whip(-6.0), "Tail4": whip(-8.0), "Tail5": whip(-6.0)}),
        (13, {}),
    ])


def pin_to_ground(
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    root: bpy.types.Object,
) -> dict[str, dict[str, float | int]]:
    """Keep the lowest point of every sampled frame on the ground.

    At this scale the donor run and attack sink paws up to 2.6 and 1.1 cm
    into the ground, the death clip buries the flank by 4.3 cm and the run
    hovers up to 2 mm in its flight phase. A vertical root key per frame
    (object location, never bone motion) puts the rat back on the ground
    plane in every clip, so it neither floats nor clips.
    """
    scene = bpy.context.scene
    base = armature.location.copy()
    results: dict[str, dict[str, float | int]] = {}
    for name in REQUIRED_ACTIONS:
        action = bpy.data.actions[name]
        armature.animation_data.action = action
        armature.location = base
        start, end = (int(round(value)) for value in action.frame_range)
        frames = list(range(start, end + 1))
        before = []
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            before.append(evaluated_bounds(meshes)[0].z)
        for curve in [c for c in action.fcurves if c.data_path == "location"]:
            action.fcurves.remove(curve)
        curve = action.fcurves.new(data_path="location", index=2, action_group="GroundContact")
        curve.keyframe_points.add(len(frames))
        for point, frame, minimum in zip(curve.keyframe_points, frames, before):
            point.co = (frame, base.z + (GROUND_CLEARANCE_METRES - minimum) / root.scale.z)
            point.interpolation = "LINEAR"
        curve.update()
        after = []
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            after.append(evaluated_bounds(meshes)[0].z)
        if max(abs(value - GROUND_CLEARANCE_METRES) for value in after) > 0.0005:
            raise RuntimeError(f"{name} ground contact did not converge: {min(after)}..{max(after)}")
        results[name] = {
            "sampledFrames": len(frames),
            "minimumBeforeMetres": round(min(before), 6),
            "maximumBeforeMetres": round(max(before), 6),
            "minimumAfterMetres": round(min(after), 6),
            "maximumAfterMetres": round(max(after), 6),
        }
    armature.location = base
    armature.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(0)
    bpy.context.view_layer.update()
    return results


# --- main ------------------------------------------------------------------

def main() -> None:
    args = parse_args()
    approved = validate_sha256(args.runtime_approved_sha)
    runtime_mode = bool(approved)
    donor_hash = hashlib.sha256(args.source.read_bytes()).hexdigest().upper()
    if donor_hash != DONOR_SHA256:
        raise RuntimeError(f"Unexpected Quaternius donor hash {donor_hash}; expected {DONOR_SHA256}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    scene.render.fps = 24
    body = bpy.data.objects.get("Rat")
    armature = bpy.data.objects.get("RatArmature")
    donor_root = bpy.data.objects.get("RootNode")
    if not all((body, armature, donor_root)):
        raise RuntimeError("Quaternius donor must contain Rat, RatArmature and RootNode")
    if body.parent != armature or len(armature.data.bones) != 31:
        raise RuntimeError("Rat donor must be one mesh skinned to the 31-bone RatArmature")
    # Blender-only leftovers of the donor export: bone tip empties and a
    # stray icosphere. None of them is part of the creature.
    for obj in list(scene.objects):
        if obj not in (body, armature, donor_root):
            bpy.data.objects.remove(obj, do_unlink=True)

    materials = {
        # Base colours are sRGB albedo values, as in the other creature builders.
        "fur": pbr_material("rat_grimy_grey_brown_fur", (0.330, 0.296, 0.258), 0.95, normal_strength=0.24),
        "belly": pbr_material("rat_dusty_belly_fur", (0.500, 0.462, 0.405), 0.96, normal_strength=0.16),
        "skin": pbr_material("rat_dirty_pink_grey_skin", (0.555, 0.438, 0.412), 0.80, normal_strength=0.12),
        "tail": pbr_material("rat_scaly_grey_pink_tail", (0.472, 0.388, 0.362), 0.76, normal_strength=0.30),
        "eyes": pbr_material("rat_dull_red_eyes", (0.060, 0.014, 0.012), 0.92, normal_strength=0.04),
    }
    add_emission(materials["eyes"], (0.085, 0.010, 0.007))
    weld_report = weld_flat_shading_split(body)
    counts = rematerialize_body(body, materials)
    skin_report = limit_skin_influences(body)
    action_report = prepare_donor_actions(armature)
    rig_report = bake_donor_rig_transform(armature, [body], UNIT_SCALE)
    author_hurt(armature)
    action_report["restKeyedChannels"] += complete_action_channels(armature)

    body.name = "rat_quaternius_body"
    body.data.name = "rat_quaternius_body_mesh"
    armature.name = "rat_quaternius_rig"
    root = bpy.data.objects.new(args.asset_id, None)
    scene.collection.objects.link(root)
    world = armature.matrix_world.copy()
    armature.parent = root
    armature.matrix_world = world
    bpy.data.objects.remove(donor_root, do_unlink=True)
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_style"] = "geometry_b_materials_c"
    root["realm_species"] = "rat"
    root["realm_geometry_provenance"] = "Quaternius Rat flat-shaded organic topology"
    root["realm_donor_sha256"] = donor_hash
    if runtime_mode:
        root["realm_approved_review_sha256"] = approved
        root["realm_runtime_scale_multiplier"] = RUNTIME_SCALE_MULTIPLIER
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_action_source_mapping"] = json.dumps(SOURCE_ACTIONS, sort_keys=True)

    meshes = [body]
    armature.animation_data.action = bpy.data.actions["idle"]
    scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, _ = evaluated_bounds(meshes)
    root.location.z -= minimum.z
    bpy.context.view_layer.update()
    ground_report = pin_to_ground(armature, meshes, root)
    minimum, maximum = evaluated_bounds(meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    root["realm_collider"] = {"type": "box", "size": [round(v, 6) for v in size],
                              "center": [round(v, 6) for v in center]}

    export_candidate(args.output, root, armature, meshes, (
        "Quaternius Rat (poly.pizza) topology, rig and base animations: CC0 1.0. "
        "Realm of Ashes B+C materials and hurt clip: project work."
    ))
    actual = parse_glb(args.output)
    if sorted(actual["animations"]) != sorted(REQUIRED_ACTIONS):
        raise RuntimeError(f"Rat export has wrong actions: {actual['animations']}")
    if actual["skins"] != 1:
        raise RuntimeError(f"Rat must export one skin; got {actual['skins']}")

    fps = scene.render.fps
    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "boundsIdleMetres": {"minimum": [round(v, 6) for v in minimum],
                             "maximum": [round(v, 6) for v in maximum],
                             "size": [round(v, 6) for v in size]},
        "collider": {"type": "box", "size": [round(v, 6) for v in size],
                     "center": [round(v, 6) for v in center]},
        "rig": {"boneCount": len(armature.data.bones),
                "deformingBones": sum(1 for bone in armature.data.bones if bone.use_deform)},
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "geometryAnalysis": {
            "weld": weld_report,
            "sourceTriangles": sum(len(p.vertices) - 2 for p in body.data.polygons),
            "flatShaded": True,
            "materialPolygonCounts": counts,
            "skinInfluenceNormalization": skin_report,
            "donorRigTransform": rig_report,
        },
        "actions": {
            "sourceToRuntime": SOURCE_ACTIONS,
            **action_report,
            "authored": {
                "hurt": "flinch: jolt back with body roll, head thrown up and aside and a "
                        "tail whip at f2, counter-swing f5, settle f9, idle pose at f13",
            },
            "runtimeRanges": {name: [round(v, 3) for v in bpy.data.actions[name].frame_range]
                              for name in REQUIRED_ACTIONS},
            "durationsSeconds": {name: round((bpy.data.actions[name].frame_range[1]
                                              - bpy.data.actions[name].frame_range[0]) / fps, 4)
                                 for name in REQUIRED_ACTIONS},
        },
        "groundContactCorrections": {"clearanceMetres": GROUND_CLEARANCE_METRES,
                                     "actions": ground_report},
        "provenance": {
            "donor": "Quaternius Rat (poly.pizza iltq5bVNaV, official glTF)",
            "donorSha256": donor_hash,
            "license": "CC0 1.0 Universal",
            "geometry": "unaltered donor faces; flat-shading vertex split welded",
            "animations": "Quaternius Rat_Idle, Rat_Walk, Rat_Run, Rat_Attack, Rat_Death; "
                          "Realm-authored hurt; Rat_Jump dropped",
            "materials": "original Realm of Ashes B+C packed 512 px PBR textures",
        },
        "reviewOnly": not runtime_mode,
        "runtimeIntegrationAllowed": runtime_mode,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
    }
    if runtime_mode:
        report["approvedReviewSha256"] = approved
        report["runtimeScaleMultiplier"] = RUNTIME_SCALE_MULTIPLIER
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    print("REALM_RAT=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
