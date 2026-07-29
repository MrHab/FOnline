"""Build browser-ready Realm of Ashes character GLBs from approved review models.

Run through tools/build-character-runtime-models.js. The source review package
is intentionally kept outside public/; only optimized runtime derivatives are
written into the shipped asset tree.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


CHARACTER_MODELS = (
    ("female", "slim", "body-types/character_female_slim_bc_lod0.glb"),
    ("female", "medium", "character_female_medium_bc_lod0.glb"),
    ("female", "large", "body-types/character_female_large_bc_lod0.glb"),
    ("male", "slim", "body-types/character_male_slim_bc_lod0.glb"),
    ("male", "medium", "character_male_medium_bc_lod0.glb"),
    ("male", "large", "body-types/character_male_large_bc_lod0.glb"),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--texture-size", type=int, default=512)
    return parser.parse_args(argv)


def scene_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in meshes
        for corner in obj.bound_box
    ]
    if not points:
        raise RuntimeError("Imported character does not contain mesh bounds")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def optimize_images(max_size: int) -> list[dict[str, object]]:
    optimized = []
    for image in bpy.data.images:
        width, height = int(image.size[0]), int(image.size[1])
        if width <= 0 or height <= 0:
            continue
        largest = max(width, height)
        if largest > max_size:
            scale = max_size / largest
            width = max(1, round(width * scale))
            height = max(1, round(height * scale))
            image.scale(width, height)
        image.pack()
        optimized.append({"name": image.name, "width": width, "height": height})
    return optimized


def configure_scene(sex: str, body_type: str) -> tuple[list[bpy.types.Object], bpy.types.Object]:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    armature = armatures[0]
    armature.name = "character_root"
    armature["realm_schema"] = "realm.character-runtime.v1"
    armature["realm_sex"] = sex
    armature["realm_body_type"] = body_type
    armature["realm_underwear_included"] = True
    armature["realm_barefoot"] = True
    for obj in meshes:
        obj["realm_character_layer"] = (
            "hair"
            if "hair" in obj.name.lower()
            else "eyes"
            if "eye" in obj.name.lower()
            else "eyebrows"
            if "eyebrow" in obj.name.lower()
            else "body_base"
        )
    return meshes, armature


def export_character(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_copyright=(
            "Realm of Ashes B+C runtime derivative. Topology, rig and "
            "animations: Quaternius Universal Base Characters and Universal "
            "Animation Library, CC0-1.0. Realm material treatment."
        ),
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
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


def build_one(
    source: Path,
    output: Path,
    sex: str,
    body_type: str,
    texture_size: int,
) -> dict[str, object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
    if "FINISHED" not in result:
        raise RuntimeError(f"Cannot import {source}: {result}")
    meshes, armature = configure_scene(sex, body_type)
    images = optimize_images(texture_size)
    minimum, maximum = scene_bounds(meshes)
    animations = sorted(action.name for action in bpy.data.actions)
    export_character(output.resolve())
    return {
        "sex": sex,
        "bodyType": body_type,
        "source": str(source.resolve()),
        "output": str(output.resolve()),
        "meshes": len(meshes),
        "armature": armature.name,
        "animations": animations,
        "images": images,
        "boundsMeters": {
            "min": [round(value, 6) for value in minimum],
            "max": [round(value, 6) for value in maximum],
        },
    }


def main() -> None:
    args = parse_args()
    source_directory = args.source_directory.resolve()
    output_directory = args.output_directory.resolve()
    texture_size = max(128, min(1024, int(args.texture_size)))
    reports = []
    for sex, body_type, relative_source in CHARACTER_MODELS:
        source = source_directory / relative_source
        if not source.is_file():
            raise FileNotFoundError(f"Approved character source not found: {source}")
        output = output_directory / f"character_{sex}_{body_type}.glb"
        reports.append(
            build_one(source, output, sex, body_type, texture_size)
        )
    print(
        "REALM_CHARACTER_BUILD="
        + json.dumps(
            {
                "schema": "realm.character-runtime-build.v1",
                "textureSize": texture_size,
                "models": reports,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
