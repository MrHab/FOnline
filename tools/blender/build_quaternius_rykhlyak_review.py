"""Build Рыхляк (Rykhlyak) from the CC0 Quaternius Farm Animal Pig.

The donor contributes the low-poly body, a 24-bone rig with IK legs and its
idle, walk, run and death motion. Realm of Ashes turns the farm pig into the
bestiary's massive boar: dark bristle materials, bone growths along the spine,
a bony forehead boss and tusks (all rigid-skinned to the donor bones), plus
two authored clips the donor lacks: a charge-and-gore attack and a hit
flinch. The feet stay on their IK targets, so the charge moves the body
without sliding the hooves.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import radians
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_creature_review import pbr_material
from build_unified_gecko_review import (
    apply_ground_contact_corrections,
    evaluated_bounds,
    parse_glb,
)
from build_unified_quaternius_wolf_review import (
    create_box_projected_uv,
    limit_skin_influences,
)
from build_quaternius_lantern_stag_review import (
    bake_donor_rig_transform,
    export_candidate,
    validate_sha256,
)


REQUIRED_ACTIONS = ("idle", "walk", "run", "attack", "hurt", "death")
SOURCE_ACTIONS = {"idle": "Idle", "walk": "Walk", "run": "Run", "death": "Death"}
DONOR_SHA256 = "8AEC801123F31CA475000C738287DCD075DDA6BE4C5650C03B5657D801A847EF"
# The farm pig is 9.8 units long. One uniform factor gives a 1.9 m boar body
# (the server scales Рыхляк by a further 1.18); nothing is stretched.
UNIT_SCALE = 0.195
RUNTIME_SCALE_MULTIPLIER = 1.0
# Donor space: the snout points to -Y, +Z is up, +X is the pig's left.
FORWARD = Vector((0.0, -1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))
LATERAL = Vector((1.0, 0.0, 0.0))


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="creature_rykhlyak_v1")
    parser.add_argument("--runtime-approved-sha")
    return parser.parse_args(argv)


# --- shape -----------------------------------------------------------------

def reshape_boar(body: bpy.types.Object) -> dict[str, int]:
    """Straighten the farm pig's curly tail and raise the withers.

    Only vertex positions move: topology, UVs and skin weights stay the
    donor's. The curl (all on the Back bone) becomes a short tail hanging
    down behind the rump; the ridge over the shoulders rises so the boar is
    heavier in front than behind.
    """
    tail = [v for v in body.data.vertices if v.co.y > 3.9 and abs(v.co.x) < 0.25]
    if not 25 <= len(tail) <= 40:
        raise RuntimeError(f"Unexpected donor tail size: {len(tail)} vertices")
    base = Vector((0.0, 3.93, 3.4))
    tip = Vector((0.0, 4.2, 2.45))
    span = max((v.co - base).length for v in tail)
    for vertex in tail:
        t = min(1.0, (vertex.co - base).length / span)
        side = max(-1.0, min(1.0, vertex.co.x / 0.22))
        vertex.co = base.lerp(tip, t) + LATERAL * side * 0.1 * (1.0 - 0.6 * t)
    raised = 0
    for vertex in body.data.vertices:
        if vertex.co.z <= 3.2:
            continue
        along = 1.0 - min(1.0, abs(vertex.co.y + 1.0) / 1.25)
        if along <= 0.0:
            continue
        vertex.co.z += 0.5 * along * min(1.0, (vertex.co.z - 3.2) / 1.2)
        raised += 1
    body.data.update()
    return {"straightenedTailVertices": len(tail), "raisedWitherVertices": raised}


# --- materials -------------------------------------------------------------

def rematerialize_body(body: bpy.types.Object, materials: dict) -> dict[str, int]:
    source = [body.data.materials[p.material_index].name for p in body.data.polygons]
    zs = [v.co.z for v in body.data.vertices]
    top, bottom = max(zs), min(zs)
    height = top - bottom
    create_box_projected_uv(body)
    body.data.materials.clear()
    order = ("bristle", "mane", "belly", "hoof")
    for name in order:
        body.data.materials.append(materials[name])
    counts = {name: 0 for name in order}
    for polygon, donor in zip(body.data.polygons, source):
        z = polygon.center.z
        if donor == "Material":
            target = "hoof"
        elif (abs(polygon.center.x) < 0.5 and polygon.normal.z > 0.55
              and z > bottom + height * 0.7):
            # Only a narrow strip along the spine: the dark ridge bristle.
            target = "mane"
        elif z < bottom + height * 0.36:
            target = "belly"
        else:
            target = "bristle"
        polygon.material_index = order.index(target)
        polygon.use_smooth = False
        counts[target] += 1
    body.data.update()
    if min(counts.values()) < 10:
        raise RuntimeError(f"Boar material hierarchy is incomplete: {counts}")
    return counts


# --- bone growths ----------------------------------------------------------

def mesh_top(body: bpy.types.Object, y: float, half_width: float, reach: float) -> float:
    zs = [v.co.z for v in body.data.vertices
          if abs(v.co.x) < half_width and abs(v.co.y - y) < reach]
    if not zs:
        raise RuntimeError(f"No body surface above y={y}")
    return max(zs)


def nearest_spine_bone(armature: bpy.types.Object, point: Vector, names: tuple[str, ...]) -> str:
    def distance(name: str) -> float:
        bone = armature.data.bones[name]
        a, b = bone.head_local, bone.tail_local
        ab = b - a
        t = max(0.0, min(1.0, (point - a).dot(ab) / max(ab.length_squared, 1e-9)))
        return (a + ab * t - point).length
    return min(names, key=distance)


def add_cone(bm: bmesh.types.BMesh, base: Vector, tip: Vector, radius: float, sides: int,
             side_axis: Vector) -> list:
    axis = (tip - base).normalized()
    u = side_axis.cross(axis)
    if u.length < 1e-6:
        u = Vector((0.0, 1.0, 0.0)).cross(axis)
    u.normalize()
    v = axis.cross(u).normalized()
    from math import cos, sin, pi
    ring = [bm.verts.new(base + (u * cos(2 * pi * i / sides) + v * sin(2 * pi * i / sides)) * radius)
            for i in range(sides)]
    apex = bm.verts.new(tip)
    faces = [bm.faces.new((ring[i], ring[(i + 1) % sides], apex)) for i in range(sides)]
    faces.append(bm.faces.new(list(reversed(ring))))
    return ring + [apex]


def build_growths(body: bpy.types.Object, armature: bpy.types.Object,
                  bone_material: bpy.types.Material,
                  boss_material: bpy.types.Material) -> tuple[bpy.types.Object, dict]:
    bm = bmesh.new()
    groups: dict[str, list] = {}

    def assign(bone: str, verts: list) -> None:
        groups.setdefault(bone, []).extend(verts)

    spine = ("Back", "Hips", "Torso", "Shoulders", "Neck")
    spikes = []
    # Rump to shoulders: the ridge grows toward the withers like a boar's mane.
    for y, length in ((2.55, 0.55), (1.75, 0.8), (0.95, 1.0), (0.15, 1.15), (-0.65, 1.3), (-1.45, 1.1)):
        top = mesh_top(body, y, 0.55, 0.45)
        base = Vector((0.0, y, top - 0.12))
        tip = base + (UP * 1.0 + FORWARD * -0.45).normalized() * length
        bone = nearest_spine_bone(armature, base, spine)
        assign(bone, add_cone(bm, base, tip, 0.28, 5, LATERAL))
        spikes.append({"y": y, "length": length, "bone": bone})

    # Bony forehead boss: a flattened, faceted plate over the brow.
    head_y = -3.55
    top = mesh_top(body, head_y, 0.7, 0.45)
    boss = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)["verts"]
    shape = Matrix.Translation((0.0, head_y, top - 0.05)) @ Matrix.Diagonal((0.75, 0.62, 0.3, 1.0))
    bmesh.ops.transform(bm, matrix=shape, verts=boss)
    assign("Head", boss)
    boss_faces = {face for vert in boss for face in vert.link_faces}
    # Two low ridges across the boss make it read as bone, not a patch of hair.
    for offset in (-0.22, 0.22):
        ridge = add_cone(bm, Vector((0.0, head_y + offset, top + 0.12)),
                         Vector((0.0, head_y + offset - 0.12, top + 0.42)), 0.16, 4, LATERAL)
        assign("Head", ridge)
        boss_faces.update(face for vert in ridge for face in vert.link_faces)

    # Tusks from the sides of the snout, curving forward and up.
    snout = [v.co for v in body.data.vertices if v.co.y < -4.3]
    if not snout:
        raise RuntimeError("Donor snout not found")
    s_min_z = min(p.z for p in snout)
    s_max_z = max(p.z for p in snout)
    s_width = max(abs(p.x) for p in snout)
    tusks = []
    for side in (-1.0, 1.0):
        base = Vector((side * s_width * 0.85, -4.55, s_min_z + (s_max_z - s_min_z) * 0.25))
        bend = base + Vector((side * 0.28, -0.45, 0.35))
        tip = bend + Vector((side * 0.1, -0.2, 0.55))
        root_ring = add_cone(bm, base, bend, 0.16, 5, LATERAL)
        tip_ring = add_cone(bm, bend, tip, 0.11, 5, LATERAL)
        assign("Head", root_ring + tip_ring)
        tusks.append([round(value, 3) for value in tip])

    for face in bm.faces:
        face.material_index = 1 if face in boss_faces else 0
    mesh = bpy.data.meshes.new("rykhlyak_bone_growths_mesh")
    bm.to_mesh(mesh)
    index_of = {vert: i for i, vert in enumerate(bm.verts)}
    bm.free()
    growths = bpy.data.objects.new("rykhlyak_bone_growths", mesh)
    bpy.context.scene.collection.objects.link(growths)
    mesh.materials.append(bone_material)
    mesh.materials.append(boss_material)
    for polygon in mesh.polygons:
        polygon.use_smooth = False
    create_box_projected_uv(growths)
    for bone, verts in groups.items():
        group = growths.vertex_groups.new(name=bone)
        group.add([index_of[v] for v in verts], 1.0, "REPLACE")
    growths.parent = armature
    modifier = growths.modifiers.new("rykhlyak_growth_skin", "ARMATURE")
    modifier.object = armature
    return growths, {
        "spinalSpikes": spikes,
        "foreheadBoss": {"y": head_y, "bone": "Head"},
        "tuskTips": tusks,
        "triangles": sum(len(p.vertices) - 2 for p in mesh.polygons),
    }


# --- animation -------------------------------------------------------------

def rest_rotation(armature: bpy.types.Object, bone: str) -> Quaternion:
    return armature.data.bones[bone].matrix_local.to_quaternion()


def local_rotation(armature: bpy.types.Object, bone: str, axis: Vector, degrees: float) -> Quaternion:
    """An armature-space rotation about the bone's rest joint, in pose-bone space."""
    rest = rest_rotation(armature, bone)
    return rest.inverted() @ Quaternion(axis, radians(degrees)) @ rest


def local_offset(armature: bpy.types.Object, bone: str, offset: Vector) -> Vector:
    return rest_rotation(armature, bone).inverted() @ offset


def capture_pose(armature: bpy.types.Object, action: bpy.types.Action, frame: int) -> dict:
    armature.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    pose = {}
    for bone in armature.pose.bones:
        if bone.rotation_mode != "QUATERNION":
            raise RuntimeError(f"Donor bone {bone.name} is not quaternion-keyed")
        pose[bone.name] = (bone.location.copy(), bone.rotation_quaternion.copy())
    return pose


def author_action(armature: bpy.types.Object, name: str, base: dict, keys: list) -> bpy.types.Action:
    """keys: [(frame, {bone: (offset_arm, [(axis, degrees), ...])})]."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data.action = action
    for frame, changes in keys:
        for bone in armature.pose.bones:
            location, rotation = base[bone.name]
            offset, turns = changes.get(bone.name, (Vector(), []))
            extra = Quaternion()
            for axis, degrees in turns:
                extra = local_rotation(armature, bone.name, axis, degrees) @ extra
            bone.location = location + local_offset(armature, bone.name, offset)
            bone.rotation_quaternion = extra @ rotation
            bone.keyframe_insert("location", frame=frame, group=bone.name)
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
    return action


def build_actions(armature: bpy.types.Object) -> dict:
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions.get(source)
        if action is None:
            raise RuntimeError(f"Quaternius Pig donor has no action {source}")
    armature.animation_data_create()
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    base = capture_pose(armature, bpy.data.actions["Idle"], 0)

    def body(forward: float, up: float, pitch: float = 0.0, roll: float = 0.0):
        return (FORWARD * forward + UP * up, [(LATERAL, pitch), (FORWARD, roll)])

    def turn(pitch: float, yaw: float = 0.0):
        return (Vector(), [(LATERAL, pitch), (UP, yaw)])

    # Charge and gore, 22 frames at 24 fps: rear back, drive forward low with
    # the head down, toss the tusks up at contact, settle.
    attack = author_action(armature, "attack", base, [
        (0, {}),
        (6, {"Body": body(-0.35, -0.1, -4.0), "Neck": turn(-10.0), "Head": turn(-8.0)}),
        (11, {"Body": body(0.6, -0.3, 6.0), "Neck": turn(16.0), "Head": turn(18.0)}),
        (14, {"Body": body(0.7, -0.05, -3.0), "Neck": turn(-18.0), "Head": turn(-24.0)}),
        (22, {}),
    ])
    # Hit flinch, 14 frames: jolt back, head thrown aside, recover.
    hurt = author_action(armature, "hurt", base, [
        (0, {}),
        (3, {"Body": body(-0.55, -0.18, -5.0, 9.0), "Neck": turn(-8.0, 18.0), "Head": turn(-10.0, 16.0)}),
        (8, {"Body": body(-0.2, -0.06, -2.0, 3.0), "Neck": turn(-3.0, 6.0), "Head": turn(-4.0, 5.0)}),
        (14, {}),
    ])
    retained = {attack, hurt}
    for target, source in SOURCE_ACTIONS.items():
        action = bpy.data.actions[source]
        action.name = target
        action.use_fake_user = True
        retained.add(action)
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)

    # Bake the IK legs into plain bone channels, then drop the constraints.
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    for name in REQUIRED_ACTIONS:
        action = bpy.data.actions[name]
        armature.animation_data.action = action
        start, end = (int(value) for value in action.frame_range)
        bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=True,
                         visual_keying=True, clear_constraints=False, clear_parents=False,
                         use_current_action=True, bake_types={"POSE"},
                         channel_types={"LOCATION", "ROTATION", "SCALE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    removed = 0
    for bone in armature.pose.bones:
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)
            removed += 1
    armature.animation_data.action = bpy.data.actions["idle"]
    return {
        "sourceToRuntime": SOURCE_ACTIONS,
        "authored": {
            "attack": "charge: rear back f6, low drive with head down f11, tusk toss f14, settle f22",
            "hurt": "flinch: jolt back and head thrown aside f3, recover by f14",
        },
        "runtimeRanges": {name: [round(v, 3) for v in bpy.data.actions[name].frame_range]
                          for name in REQUIRED_ACTIONS},
        "removedIkConstraints": removed,
    }


def main() -> None:
    args = parse_args()
    approved = validate_sha256(args.runtime_approved_sha)
    runtime_mode = bool(approved)
    donor_hash = hashlib.sha256(args.source_blend.read_bytes()).hexdigest().upper()
    if donor_hash != DONOR_SHA256:
        raise RuntimeError(f"Unexpected Quaternius donor hash {donor_hash}; expected {DONOR_SHA256}")
    bpy.ops.wm.open_mainfile(filepath=str(args.source_blend.resolve()))
    body = bpy.data.objects.get("Pig")
    armature = bpy.data.objects.get("Armature")
    if body is None or armature is None:
        raise RuntimeError("Quaternius Pig donor must contain Pig and Armature")
    for obj in list(bpy.context.scene.objects):
        if obj not in (body, armature):
            bpy.data.objects.remove(obj, do_unlink=True)

    materials = {
        "bristle": pbr_material("rykhlyak_bristle_hide", (0.335, 0.250, 0.180), 0.95, normal_strength=0.26),
        "mane": pbr_material("rykhlyak_dark_ridge_bristle", (0.150, 0.115, 0.090), 0.96, normal_strength=0.3),
        "belly": pbr_material("rykhlyak_dusty_belly", (0.470, 0.400, 0.310), 0.97, normal_strength=0.16),
        "hoof": pbr_material("rykhlyak_charcoal_hooves_snout", (0.06, 0.052, 0.046), 0.84, normal_strength=0.1),
        "bone": pbr_material("rykhlyak_weathered_bone_growths", (0.70, 0.63, 0.48), 0.88, normal_strength=0.2),
        "boss": pbr_material("rykhlyak_scarred_forehead_boss", (0.46, 0.39, 0.29), 0.9, normal_strength=0.35),
    }
    shape_report = reshape_boar(body)
    counts = rematerialize_body(body, materials)
    growths, growth_report = build_growths(body, armature, materials["bone"], materials["boss"])
    skin_report = limit_skin_influences(body)
    action_report = build_actions(armature)
    rig_report = bake_donor_rig_transform(armature, [body, growths], UNIT_SCALE)

    body.name = "rykhlyak_quaternius_pig_body"
    body.data.name = "rykhlyak_quaternius_pig_body_mesh"
    armature.name = "rykhlyak_quaternius_rig"
    root = bpy.data.objects.new(args.asset_id, None)
    bpy.context.scene.collection.objects.link(root)
    world = armature.matrix_world.copy()
    armature.parent = root
    armature.matrix_world = world
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = not runtime_mode
    root["realm_runtime_integration_allowed"] = runtime_mode
    root["realm_style"] = "geometry_b_materials_c"
    root["realm_species"] = "rykhlyak"
    root["realm_geometry_provenance"] = "Quaternius Farm Animal Pig topology plus Realm bone growths"
    root["realm_donor_sha256"] = donor_hash
    if runtime_mode:
        root["realm_approved_review_sha256"] = approved
        root["realm_runtime_scale_multiplier"] = RUNTIME_SCALE_MULTIPLIER
    armature["realm_full_deforming_rig"] = True
    armature["realm_required_actions"] = list(REQUIRED_ACTIONS)
    armature["realm_action_source_mapping"] = json.dumps(SOURCE_ACTIONS, sort_keys=True)

    meshes = [body, growths]
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, _ = evaluated_bounds(meshes)
    root.location.z -= minimum.z
    bpy.context.view_layer.update()
    ground_report = apply_ground_contact_corrections(armature, [body], root)
    armature.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, maximum = evaluated_bounds(meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    root["realm_collider"] = {"type": "box", "size": [round(v, 6) for v in size],
                              "center": [round(v, 6) for v in center]}

    export_candidate(args.output, root, armature, meshes, (
        "Quaternius Farm Animal Pack / Pig topology, rig and base animations: "
        "CC0 1.0. Realm of Ashes B+C materials, bone growths and attack/hurt "
        "clips: project work."
    ))
    actual = parse_glb(args.output)
    if sorted(actual["animations"]) != sorted(REQUIRED_ACTIONS):
        raise RuntimeError(f"Rykhlyak export has wrong actions: {actual['animations']}")
    if actual["skins"] != 1:
        raise RuntimeError(f"Rykhlyak must export one skin; got {actual['skins']}")

    report = {
        "assetId": args.asset_id,
        "file": args.output.name,
        "boundsIdleMetres": {"minimum": [round(v, 6) for v in minimum],
                             "maximum": [round(v, 6) for v in maximum],
                             "size": [round(v, 6) for v in size]},
        "collider": {"type": "box", "size": [round(v, 6) for v in size],
                     "center": [round(v, 6) for v in center]},
        "rig": {"boneCount": len(armature.data.bones)},
        "requiredAnimations": list(REQUIRED_ACTIONS),
        "actualGlb": actual,
        "geometryAnalysis": {
            "shape": shape_report,
            "materialPolygonCounts": counts,
            "boneGrowths": growth_report,
            "skinInfluenceNormalization": skin_report,
            "donorRigTransform": rig_report,
        },
        "actions": action_report,
        "groundContactCorrections": {"actions": ground_report},
        "provenance": {
            "donor": "Quaternius Farm Animal Pack / Pig.blend",
            "donorSha256": donor_hash,
            "license": "CC0 1.0 Universal",
            "geometry": "donor topology; spine spikes, forehead boss and tusks are Realm meshes",
            "animations": "Quaternius Idle, Walk, Run, Death; Realm-authored attack and hurt",
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
    print("REALM_RYKHLYAK=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
