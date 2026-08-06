"""Upgrade the approved B+C assault rifle with a physical removable magazine.

The v5 review mesh already contains the accepted silhouette and materials.  This
script separates its authored magazine islands into a dedicated object, adds an
animated service socket and exports a reproducible v6 review asset.  Geometry is
therefore changed through Blender, while the repository only stores the source
generator and its generated review/runtime GLB.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--render-directory", type=Path, required=True)
    parser.add_argument("--asset-id", default="rifle_unified_v6")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def find_root() -> bpy.types.Object:
    root = bpy.data.objects.get("weapon_rifle_unified_v5")
    if root is None:
        root = next(
            (obj for obj in bpy.context.scene.objects if obj.get("realm_asset_id") == "rifle_unified_v5"),
            None,
        )
    if root is None:
        raise RuntimeError("Imported v5 scene has no approved rifle root")
    return root


def separate_magazine(body: bpy.types.Object, root: bpy.types.Object) -> bpy.types.Object:
    """Separate the disconnected curved-magazine islands without rebuilding v5."""
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(body.data)
    bm.verts.ensure_lookup_table()
    unseen = set(bm.verts)
    selected = 0
    selected_vertices: set[bmesh.types.BMVert] = set()
    while unseen:
        start = unseen.pop()
        stack = [start]
        component = [start]
        while stack:
            vertex = stack.pop()
            for edge in vertex.link_edges:
                neighbor = edge.other_vert(vertex)
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    stack.append(neighbor)
                    component.append(neighbor)
        ys = [vertex.co.y for vertex in component]
        zs = [vertex.co.z for vertex in component]
        is_magazine = min(ys) >= 0.12 and max(ys) <= 0.25 and min(zs) < -0.035
        if is_magazine:
            for vertex in component:
                vertex.select_set(True)
                selected_vertices.add(vertex)
                selected += 1
    if selected < 100:
        raise RuntimeError(f"Magazine topology selection is incomplete: {selected} vertices")
    for edge in bm.edges:
        edge.select_set(edge.verts[0] in selected_vertices and edge.verts[1] in selected_vertices)
    selected_faces = 0
    for face in bm.faces:
        is_selected = all(vertex in selected_vertices for vertex in face.verts)
        face.select_set(is_selected)
        selected_faces += int(is_selected)
    if selected_faces < 40:
        raise RuntimeError(f"Magazine face selection is incomplete: {selected_faces} faces")
    bmesh.update_edit_mesh(body.data, loop_triangles=True, destructive=False)
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    separated = [obj for obj in bpy.context.selected_objects if obj is not body and obj.type == "MESH"]
    if len(separated) != 1:
        raise RuntimeError(f"Expected one separated magazine object, found {len(separated)}")
    magazine = separated[0]
    magazine.name = "magazine"
    magazine.data.name = "magazine_mesh"
    magazine.parent = root
    bpy.ops.object.select_all(action="DESELECT")
    magazine.select_set(True)
    bpy.context.view_layer.objects.active = magazine
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    magazine["realm_interaction_part"] = "removable_magazine"
    magazine["realm_reload_motion"] = "release_draw_insert_lock"
    if len(magazine.data.polygons) < 40:
        raise RuntimeError(f"Separated magazine has too little geometry: {len(magazine.data.polygons)} polygons")
    return magazine


def create_socket(name: str, parent: bpy.types.Object, location: tuple[float, float, float]) -> bpy.types.Object:
    socket = bpy.data.objects.new(name, None)
    socket.empty_display_type = "ARROWS"
    socket.empty_display_size = 0.025
    socket.location = location
    socket.parent = parent
    bpy.context.scene.collection.objects.link(socket)
    return socket


def add_magazine_reload(magazine: bpy.types.Object) -> None:
    magazine.rotation_mode = "XYZ"
    magazine.animation_data_create()
    base_location = magazine.location.copy()
    base_rotation = magazine.rotation_euler.copy()
    action = bpy.data.actions.new("reload_magazine")
    magazine.animation_data.action = action
    keyframes = (
        (1, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.0))),
        (8, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.0))),
        (17, Vector((0.025, -0.025, -0.19)), Vector((0.20, -0.08, 0.08))),
        (25, Vector((0.07, -0.09, -0.15)), Vector((0.34, -0.18, 0.16))),
        (34, Vector((0.015, -0.018, -0.055)), Vector((0.08, -0.03, 0.04))),
        (42, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.0))),
    )
    for frame, offset, rotation in keyframes:
        magazine.location = base_location + offset
        magazine.rotation_euler = tuple(base_rotation[index] + rotation[index] for index in range(3))
        magazine.keyframe_insert("location", frame=frame, group="reload")
        magazine.keyframe_insert("rotation_euler", frame=frame, group="reload")
    track = magazine.animation_data.nla_tracks.new()
    track.name = "reload"
    track.strips.new("reload", int(action.frame_range[0]), action)
    magazine.animation_data.action = None
    magazine.location = base_location
    magazine.rotation_euler = base_rotation


def parse_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    offset = 12
    gltf = None
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
            break
        offset += 8 + length
    if gltf is None:
        raise RuntimeError("Exported GLB has no JSON chunk")
    node_names = [node.get("name", "") for node in gltf.get("nodes", [])]
    animations = []
    for animation in gltf.get("animations", []):
        targets = sorted({node_names[channel["target"]["node"]] for channel in animation.get("channels", [])})
        animations.append({"name": animation.get("name", ""), "targets": targets})
    accessors = gltf.get("accessors", [])
    vertices = 0
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position = primitive.get("attributes", {}).get("POSITION")
            if position is not None:
                vertices += accessors[position]["count"]
            indices = primitive.get("indices")
            if indices is not None:
                triangles += accessors[indices]["count"] // 3
    return {
        "nodes": node_names,
        "animations": animations,
        "meshes": len(gltf.get("meshes", [])),
        "materials": len(gltf.get("materials", [])),
        "images": len(gltf.get("images", [])),
        "vertices": vertices,
        "triangles": triangles,
    }


def export_glb(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()),
        export_format="GLB",
        use_selection=True,
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
        export_animation_mode="NLA_TRACKS",
        export_frame_range=False,
        export_force_sampling=True,
        export_skins=False,
        export_morph=False,
    )


def material(name: str, color: tuple[float, float, float], roughness: float, metallic: float = 0.0) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return result


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def activate_clip(name: str) -> None:
    for obj in bpy.context.scene.objects:
        animation = obj.animation_data
        if not animation:
            continue
        for track in animation.nla_tracks:
            track.mute = track.name != name


def setup_review_scene() -> bpy.types.Object:
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.color = (0.035, 0.04, 0.045)
    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0.0, 0.1, -0.24))
    floor = bpy.context.object
    floor.name = "review_floor"
    floor.data.materials.append(material("review_floor_mat", (0.055, 0.06, 0.065), 0.88))
    for name, location, energy, size in (
        ("key", (1.4, -0.8, 1.7), 900.0, 2.2),
        ("fill", (-1.2, 0.2, 0.9), 520.0, 2.5),
        ("rim", (0.4, 1.5, 1.2), 650.0, 1.8),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        light.location = location
        look_at(light, Vector((0.0, 0.13, 0.02)))
        bpy.context.scene.collection.objects.link(light)
    camera_data = bpy.data.cameras.new("review_camera")
    camera = bpy.data.objects.new("review_camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = (1.35, -1.12, 0.52)
    camera_data.lens = 62
    look_at(camera, Vector((0.0, 0.14, 0.01)))
    bpy.context.scene.camera = camera
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    return floor


def render_review(directory: Path, floor: bpy.types.Object) -> list[str]:
    directory.mkdir(parents=True, exist_ok=True)
    outputs = []
    for clip, frame, suffix in (("idle", 1, "idle"), ("reload", 17, "reload_draw"), ("reload", 25, "reload_service")):
        activate_clip(clip)
        bpy.context.scene.frame_set(frame)
        floor.hide_render = False
        path = directory / f"rifle_unified_v6_{suffix}.png"
        bpy.context.scene.render.filepath = str(path.resolve())
        bpy.ops.render.render(write_still=True)
        outputs.append(path.name)
    activate_clip("idle")
    bpy.context.scene.frame_set(1)
    return outputs


def main() -> None:
    args = parse_args()
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()), import_shading="NORMALS")
    root = find_root()
    body = bpy.data.objects.get("rifle_rebuilt_body")
    if body is None:
        raise RuntimeError("Imported v5 scene has no rifle body")
    root.name = f"weapon_{args.asset_id}"
    root["realm_asset_id"] = args.asset_id
    root["realm_interaction_profile"] = "physical_grips_reload_v2"
    root["realm_reload_kind"] = "magazine"
    root["realm_reload_revision"] = "physical detachable magazine with hand service socket"
    root["realm_review_only"] = True
    root["realm_runtime_integration_allowed"] = False
    magazine = separate_magazine(body, root)
    socket = create_socket("socket_reload", magazine, (0.0, 0.0, -0.035))
    add_magazine_reload(magazine)
    bpy.context.scene.render.fps = 30
    export_glb(args.output)
    technical = parse_glb(args.output)
    reload_animation = next((row for row in technical["animations"] if row["name"] == "reload"), None)
    if not reload_animation or "magazine" not in reload_animation["targets"]:
        raise RuntimeError("Exported reload clip does not animate the physical magazine")
    required_nodes = {"socket_grip_r", "socket_grip_l", "socket_muzzle", "socket_reload", "magazine"}
    missing = sorted(required_nodes.difference(technical["nodes"]))
    if missing:
        raise RuntimeError(f"Exported v6 rifle is missing interaction nodes: {missing}")
    floor = setup_review_scene()
    renders = render_review(args.render_directory, floor)
    floor.hide_render = True
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    report = {
        "schema": "realm.weapon-review.v2",
        "assetId": args.asset_id,
        "sourceAsset": "rifle_unified_v5",
        "sourceFile": args.source.name,
        "file": args.output.name,
        "bytes": args.output.stat().st_size,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(),
        "artDirection": "geometry_b_materials_c",
        "interactionProfile": "physical_grips_reload_v2",
        "reloadKind": "magazine",
        "reloadPart": magazine.name,
        "reloadSocket": socket.name,
        "renders": renders,
        "actualGlb": technical,
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_RIFLE_V6=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
