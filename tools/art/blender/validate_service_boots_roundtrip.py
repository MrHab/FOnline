"""Re-import approved Service Scout GLBs into clean Blender scenes.

Run with:

    blender --background --factory-startup \
      --python tools/art/blender/validate_service_boots_roundtrip.py -- \
      --root <repo> --directory <production-dir> --output <report.json>

The script never overwrites GLB files. Each file is imported after a factory
reset and is inspected through Blender's own glTF importer.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


FILE_NAME = re.compile(
    r"^service_boots_(female|male)_(slim|medium|large)_(lod[012])\.glb$"
)
EXPECTED_LODS = {"lod0", "lod1", "lod2"}
EXPECTED_VARIANTS = {
    f"{sex}_{body_type}"
    for sex in ("female", "male")
    for body_type in ("slim", "medium", "large")
}


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(raw)


def repo_path(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def triangle_count(obj: bpy.types.Object) -> int:
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def world_bounds(meshes: list[bpy.types.Object]) -> dict[str, list[float]]:
    points: list[Vector] = []
    for obj in meshes:
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    lower = [min(point[index] for point in points) for index in range(3)]
    upper = [max(point[index] for point in points) for index in range(3)]
    return {
        "min": [round(value, 6) for value in lower],
        "max": [round(value, 6) for value in upper],
        "size": [round(upper[index] - lower[index], 6) for index in range(3)],
    }


def custom_property(objects: list[bpy.types.Object], name: str):
    for obj in objects:
        if name in obj:
            return obj[name]
    return None


def inspect_glb(root: Path, glb: Path) -> dict:
    match = FILE_NAME.match(glb.name)
    if not match:
        raise RuntimeError(f"Unexpected production filename: {glb.name}")
    sex, body_type, lod = match.groups()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(glb.resolve()))
    if "FINISHED" not in result:
        raise RuntimeError(f"Blender glTF import failed: {glb}")

    # Blender 4.5 creates a local Icosphere display helper for one imported
    # empty. It is not a glTF node (no parent, vertex groups, materials, or
    # custom properties) and must not participate in asset validation.
    for obj in list(bpy.context.scene.objects):
        if (
            obj.name == "Icosphere"
            and obj.type == "MESH"
            and obj.parent is None
            and not obj.vertex_groups
            and not obj.material_slots
            and not dict(obj.items())
        ):
            bpy.data.objects.remove(obj, do_unlink=True)

    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    cameras = [obj for obj in objects if obj.type == "CAMERA"]
    lights = [obj for obj in objects if obj.type == "LIGHT"]

    if not meshes:
        raise RuntimeError(f"No mesh objects after import: {glb}")
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, got {len(armatures)}: {glb}")
    if cameras or lights:
        raise RuntimeError(f"Camera/light leaked into production GLB: {glb}")

    armature = armatures[0]
    joint_count = len(armature.data.bones)
    if joint_count != 65:
        raise RuntimeError(f"Expected 65 joints, got {joint_count}: {glb}")

    material_names = sorted(
        {
            slot.material.name
            for obj in meshes
            for slot in obj.material_slots
            if slot.material is not None
        }
    )
    if len(material_names) != 2:
        raise RuntimeError(
            f"Expected exactly two materials, got {len(material_names)}: {glb}"
        )

    skinned_meshes = [
        obj
        for obj in meshes
        if any(modifier.type == "ARMATURE" for modifier in obj.modifiers)
    ]
    if len(skinned_meshes) != len(meshes):
        raise RuntimeError(f"Unskinned mesh objects after import: {glb}")

    approval_status = custom_property(objects, "realm_approval_status")
    review_only = custom_property(objects, "realm_review_only")
    runtime_allowed = custom_property(objects, "realm_runtime_integration_allowed")
    if approval_status != "approved":
        raise RuntimeError(f"Approval metadata missing after import: {glb}")
    if bool(review_only):
        raise RuntimeError(f"Production GLB is still review-only: {glb}")
    if not bool(runtime_allowed):
        raise RuntimeError(f"Runtime integration metadata is false: {glb}")

    return {
        "file": repo_path(root, glb),
        "variant": f"{sex}_{body_type}",
        "lod": lod,
        "objects": len(objects),
        "meshes": len(meshes),
        "skinnedMeshes": len(skinned_meshes),
        "armatures": len(armatures),
        "joints": joint_count,
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(triangle_count(obj) for obj in meshes),
        "materials": material_names,
        "boundsMeters": world_bounds(meshes),
        "approval": {
            "status": approval_status,
            "reviewOnly": bool(review_only),
            "runtimeIntegrationAllowed": bool(runtime_allowed),
        },
    }


def main() -> None:
    args = parse_args()
    root = Path(args.root).resolve()
    directory = Path(args.directory).resolve()
    output = Path(args.output).resolve()
    glbs = sorted(directory.glob("variants/*/*.glb"))
    if len(glbs) != 18:
        raise RuntimeError(f"Expected 18 production GLBs, got {len(glbs)}")

    rows = [inspect_glb(root, glb) for glb in glbs]
    variants = {row["variant"] for row in rows}
    lods_by_variant = {
        variant: sorted(row["lod"] for row in rows if row["variant"] == variant)
        for variant in sorted(variants)
    }
    if variants != EXPECTED_VARIANTS:
        raise RuntimeError(f"Variant matrix mismatch: {sorted(variants)}")
    for variant, lods in lods_by_variant.items():
        if set(lods) != EXPECTED_LODS:
            raise RuntimeError(f"LOD matrix mismatch for {variant}: {lods}")

    report = {
        "schema": "realm.service-scout-blender-roundtrip.v1",
        "assetId": "service_boots",
        "modelFamily": "service_scout",
        "blenderVersion": bpy.app.version_string,
        "importer": "bpy.ops.import_scene.gltf",
        "cleanScenePerFile": True,
        "glbCount": len(rows),
        "variantCount": len(variants),
        "lodsPerVariant": 3,
        "checks": {
            "cameraAndLightFree": True,
            "oneArmaturePerGlb": True,
            "jointCount": 65,
            "allMeshesSkinned": True,
            "materialsPerGlb": 2,
            "approvalMetadataRetained": True,
        },
        "files": rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Service Scout Blender round-trip passed: "
        f"{len(rows)} GLB, {len(variants)} variants, Blender {bpy.app.version_string}."
    )


if __name__ == "__main__":
    main()
