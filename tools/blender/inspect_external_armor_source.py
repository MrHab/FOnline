"""Print a compact JSON inventory for an external glTF/GLB armor source.

Run with Blender in background mode and pass the model after ``--``.  The
report is intentionally read-only and is used to decide which meshes can be
isolated before fitting them to the Realm of Ashes player rig.
"""

from __future__ import annotations

import json
import pathlib
import sys

import bpy
from mathutils import Vector


def argument_path() -> pathlib.Path:
    if "--" not in sys.argv:
        raise SystemExit("expected a model path after --")
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 1:
        raise SystemExit("expected exactly one model path")
    path = pathlib.Path(arguments[0]).resolve()
    if not path.is_file():
        raise SystemExit(f"model does not exist: {path}")
    return path


def round_vector(values) -> list[float]:
    return [round(float(value), 5) for value in values]


def mesh_report(obj: bpy.types.Object) -> dict:
    world_corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = [min(corner[index] for corner in world_corners) for index in range(3)]
    maximum = [max(corner[index] for corner in world_corners) for index in range(3)]
    return {
        "name": obj.name,
        "parent": obj.parent.name if obj.parent else None,
        "vertices": len(obj.data.vertices),
        "triangles": sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons),
        "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "dimensions": round_vector(obj.dimensions),
        "boundsMin": round_vector(minimum),
        "boundsMax": round_vector(maximum),
        "vertexGroups": [group.name for group in obj.vertex_groups[:24]],
        "vertexGroupCount": len(obj.vertex_groups),
    }


def main() -> None:
    path = argument_path()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(path))

    meshes = [mesh_report(obj) for obj in bpy.context.scene.objects if obj.type == "MESH"]
    armatures = []
    for obj in bpy.context.scene.objects:
        if obj.type != "ARMATURE":
            continue
        armatures.append(
            {
                "name": obj.name,
                "boneCount": len(obj.data.bones),
                "bones": [bone.name for bone in obj.data.bones],
            }
        )

    print(
        "ROA_EXTERNAL_SOURCE_JSON="
        + json.dumps(
            {
                "file": str(path),
                "meshCount": len(meshes),
                "meshes": meshes,
                "armatures": armatures,
                "animationCount": len(bpy.data.actions),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
