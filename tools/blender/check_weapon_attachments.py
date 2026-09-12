"""Check that visible GLB parts form a connected rest-pose assembly (metres)."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def geometry(obj):
    mesh = obj.to_mesh()
    mesh.calc_loop_triangles()
    points = [obj.matrix_world @ v.co for v in mesh.vertices]
    triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
    obj.to_mesh_clear()
    return points, BVHTree.FromPolygons(points, triangles, all_triangles=True)


def gap(a, b):
    if a[1].overlap(b[1]):
        return 0.0
    best = float("inf")
    for points, target in ((a[0], b[1]), (b[0], a[1])):
        for point in points:
            hit, normal, index, distance = target.find_nearest(point)
            if hit is not None:
                best = min(best, distance)
    return best


def audit(path, tolerance):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    rest = {obj: obj.matrix_basis.copy() for obj in bpy.context.scene.objects}
    clips = set()
    for obj in bpy.context.scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                clips.add(track.name)
                track.mute = True
    bpy.context.view_layer.update()
    objects = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
        size = Vector([max(p[a] for p in points) - min(p[a] for p in points) for a in range(3)])
        if size.length > 0.002:  # hidden shell used only during reload
            objects.append(obj)
    data = [geometry(obj) for obj in objects]
    distances = {}
    for i in range(len(objects)):
        for j in range(i):
            distances[i, j] = gap(data[i], data[j])
    anchor = max(range(len(objects)), key=lambda i: len(data[i][0]))
    connected = {anchor}
    while True:
        more = {i for i in range(len(objects)) if i not in connected
                and any(distances[max(i, j), min(i, j)] <= tolerance for j in connected)}
        if not more:
            break
        connected.update(more)
    detached = []
    for i, obj in enumerate(objects):
        if i in connected:
            continue
        j = min(connected, key=lambda j: distances[max(i, j), min(i, j)])
        detached.append({"part": obj.name, "nearestAssemblyPart": objects[j].name,
                         "gapMetres": round(distances[max(i, j), min(i, j)], 6)})
    # A correct idle picture is not enough: attachment transforms must stay
    # rigid when a magazine/bolt/tank moves during the imported animation.
    attached = [obj for obj in objects if obj.get("realm_attachment_parent")]
    attachment_rest = {obj: obj.matrix_local.copy() for obj in attached}
    for obj in attached:
        if obj.parent is None or obj.parent.name != obj["realm_attachment_parent"]:
            raise RuntimeError(f"{path.stem}: wrong parent for {obj.name}")
    pose_checks = 0
    for clip in sorted(clips):
        for frame in (1, 3, 9, 18, 27, 34, 42, 60):
            for obj, matrix in rest.items():
                obj.matrix_basis = matrix
                if obj.animation_data:
                    for track in obj.animation_data.nla_tracks:
                        track.mute = track.name != clip
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            for obj in attached:
                current = obj.matrix_local.copy()
                expected = attachment_rest[obj].copy()
                if obj.get("realm_attachment_allow_scale"):
                    current = current.normalized()
                    expected = expected.normalized()
                difference = max(abs(current[i][j] - expected[i][j])
                                 for i in range(4) for j in range(4))
                if difference > 0.00001:
                    raise RuntimeError(f"{path.stem}/{clip}/{frame}: {obj.name} leaves its assembly")
            pose_checks += 1
    return {"weapon": path.stem.removeprefix("weapon_"), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "meshCount": len(objects), "detached": detached,
            "attachedParts": {obj.name: obj.parent.name for obj in attached},
            "animationPoseChecks": pose_checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--tolerance", type=float, default=0.002)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    reports = [audit(path, args.tolerance) for path in sorted(args.model_directory.glob("weapon_*.glb"))]
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({"toleranceMetres": args.tolerance, "weapons": reports}, indent=2) + "\n")
    failures = [row for row in reports if row["detached"]]
    print("ATTACHMENT_AUDIT=" + json.dumps(failures))
    if failures:
        raise RuntimeError(f"{len(failures)} weapons contain disconnected visible parts")
    print(f"Weapon attachment audit passed: {len(reports)} models")


if __name__ == "__main__":
    main()
