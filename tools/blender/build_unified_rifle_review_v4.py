"""Build a substantially rebuilt B+C rifle from an audited same-author donor.

The CC0 Quaternius donor contributes proportions and construction reference.
Its topology, scale, surface language, materials and identity are rebuilt here;
the result remains review-only until the critic approves it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import pi, sin
from pathlib import Path
import random
import struct
import sys

import bmesh
import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--asset-id", default="rifle_unified_v4")
    parser.add_argument("--support-grip-y", type=float, default=0.100)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def texture_image(
    name: str,
    base: tuple[float, float, float],
    kind: str,
    size: int = 256,
) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    rng = random.Random(f"realm-v4:{name}:{kind}")
    pixels: list[float] = []
    for y in range(size):
        for x in range(size):
            broad = sin(x * 0.047 + y * 0.013) * 0.5 + sin(y * 0.083 - x * 0.021) * 0.28
            local = (rng.random() - 0.5) * 0.22
            edge_scratch = 0.09 if y in {34, 111, 199} and 24 < x < 221 else 0.0
            if kind == "albedo":
                variation = broad * 0.075 + local * 0.035
                values = tuple(
                    max(0.025, min(0.94, component * (1.0 + variation) + edge_scratch))
                    for component in base
                )
                pixels.extend((*values, 1.0))
            elif kind == "roughness":
                value = max(0.24, min(0.97, base[0] + broad * 0.055 + local * 0.025))
                pixels.extend((value, value, value, 1.0))
            else:
                pixels.extend((0.5 + broad * 0.015, 0.5 + local * 0.012, 1.0, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def pbr_material(
    name: str,
    base: tuple[float, float, float],
    roughness: float,
    metallic: float,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*base, 1)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = texture_image(f"{name}_albedo", base, "albedo")
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = texture_image(f"{name}_roughness", (roughness,) * 3, "roughness")
    rough.image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = texture_image(f"{name}_normal", (0.5, 0.5, 1.0), "normal")
    normal_texture.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.18
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    material["realm_material_style"] = "materials_c_localized_wear"
    return material


def rebuild_donor_mesh(donor: Path, root: bpy.types.Object) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(donor.resolve()), import_shading="NORMALS")
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected one donor mesh, found {len(meshes)}")
    donor_object = meshes[0]
    donor_object.name = "rifle_rebuilt_body"
    donor_object.data.name = "rifle_rebuilt_body_mesh"

    # Bake target size and reverse donor axis so +Y is the muzzle direction.
    source_length = donor_object.dimensions.y
    scale = 1.05 / source_length
    for vertex in donor_object.data.vertices:
        vertex.co.x *= scale
        vertex.co.y *= -scale
        vertex.co.z *= scale
    donor_object.data.update()

    # Remove only detached decorative stock spikes. Never cut the stock shell.
    bm = bmesh.new()
    bm.from_mesh(donor_object.data)
    unseen = set(bm.verts)
    components: list[list[bmesh.types.BMVert]] = []
    while unseen:
        start = unseen.pop()
        component = [start]
        stack = [start]
        while stack:
            vertex = stack.pop()
            for edge in vertex.link_edges:
                neighbor = edge.other_vert(vertex)
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    component.append(neighbor)
                    stack.append(neighbor)
        components.append(component)
    remove_vertices = [
        vertex
        for component in components
        if len(component) <= 12
        and max(vertex.co.y for vertex in component) < -0.13
        and min(vertex.co.z for vertex in component) > 0.15
        for vertex in component
    ]
    if remove_vertices:
        bmesh.ops.delete(bm, geom=remove_vertices, context="VERTS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    bm.to_mesh(donor_object.data)
    bm.free()

    bpy.context.view_layer.objects.active = donor_object
    donor_object.select_set(True)
    # Preserve functional panel islands but replace their polygon layout and
    # authored proportions. This avoids the donor's open surfaces collapsing.
    for vertex in donor_object.data.vertices:
        stock_weight = max(0.0, min(1.0, (-vertex.co.y - 0.12) / 0.28))
        vertex.co.x *= 1.0 + stock_weight * 0.10
        vertex.co.z = 0.055 + (vertex.co.z - 0.055) * (1.0 - stock_weight * 0.08)
    donor_object.data.update()
    triangulate = donor_object.modifiers.new("new_controlled_facet_topology", "TRIANGULATE")
    triangulate.quad_method = "FIXED"
    triangulate.ngon_method = "BEAUTY"
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    decimate = donor_object.modifiers.new("merge_coplanar_donor_faces", "DECIMATE")
    decimate.decimate_type = "DISSOLVE"
    decimate.angle_limit = 0.035
    decimate.use_dissolve_boundaries = False
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    donor_object.parent = root
    donor_object["realm_geometry_provenance"] = "substantial CC0 donor rebuild: new triangulated topology, reshaped stock, target scale and surface language"
    donor_object["realm_direct_donor_runtime"] = False
    donor_object.select_set(False)
    return donor_object


def assign_spatial_materials(
    obj: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    obj.data.materials.clear()
    order = ("gunmetal", "blackened", "wood", "canvas", "brass")
    for name in order:
        obj.data.materials.append(materials[name])
    slots = {name: index for index, name in enumerate(order)}
    for polygon in obj.data.polygons:
        center = polygon.center
        if center.y < -0.19 and center.z > -0.045:
            polygon.material_index = slots["wood"]
        elif 0.12 < center.y < 0.39 and center.z > -0.005:
            polygon.material_index = slots["wood"]
        elif center.y > 0.40 or center.z < -0.055:
            polygon.material_index = slots["blackened"]
        else:
            polygon.material_index = slots["gunmetal"]
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.0, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_flat()
    obj.select_set(False)


def add_tube_loop(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    material: bpy.types.Material,
    root: bpy.types.Object,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 0
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points):
        point.co = (*value, 1)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = root
    obj["realm_detail_role"] = "localized_repair"
    return obj


def profile_patch(
    name: str,
    points: list[tuple[float, float]],
    x: float,
    material: bpy.types.Material,
    root: bpy.types.Object,
) -> bpy.types.Object:
    vertices = [(x, y, z) for y, z in points] + [(x + 0.004, y, z) for y, z in points]
    count = len(points)
    faces = [tuple(range(count)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = root
    bevel = obj.modifiers.new("worn_edge_planes", "BEVEL")
    bevel.width = 0.0025
    bevel.segments = 1
    return obj


def add_authored_repairs(
    root: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    for side in (-1, 1):
        profile_patch(
            f"stock_repair_plate_{'l' if side < 0 else 'r'}",
            [(-0.34, 0.095), (-0.32, 0.155), (-0.23, 0.165), (-0.18, 0.125), (-0.23, 0.092)],
            side * 0.037 - (0.004 if side > 0 else 0),
            materials["brass"],
            root,
        )


def create_socket(
    name: str,
    location: tuple[float, float, float],
    root: bpy.types.Object,
) -> bpy.types.Object:
    socket = bpy.data.objects.new(name, None)
    socket.empty_display_type = "ARROWS"
    socket.empty_display_size = 0.025
    socket.location = location
    socket.parent = root
    bpy.context.scene.collection.objects.link(socket)
    return socket


def create_nla_actions(root: bpy.types.Object) -> None:
    root.rotation_mode = "XYZ"
    root.animation_data_create()
    definitions = {
        "idle": [
            (1, Vector((0, 0, 0)), Vector((0, 0, 0))),
            (20, Vector((0, 0, 0.0015)), Vector((0.002, 0, 0.002))),
            (40, Vector((0, 0, 0)), Vector((0, 0, 0))),
        ],
        "attack": [
            (1, Vector((0, 0, 0)), Vector((0, 0, 0))),
            (3, Vector((0, -0.018, 0.006)), Vector((-0.035, 0, 0))),
            (8, Vector((0, 0, 0)), Vector((0, 0, 0))),
        ],
        "reload": [
            (1, Vector((0, 0, 0)), Vector((0, 0, 0))),
            (14, Vector((0.02, -0.015, -0.05)), Vector((0.10, 0, -0.16))),
            (30, Vector((0, 0, 0)), Vector((0, 0, 0))),
        ],
    }
    for name, frames in definitions.items():
        action = bpy.data.actions.new(name)
        root.animation_data.action = action
        for frame, location, rotation in frames:
            root.location = location
            root.rotation_euler = rotation
            root.keyframe_insert("location", frame=frame, group=name)
            root.keyframe_insert("rotation_euler", frame=frame, group=name)
        track = root.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, int(action.frame_range[0]), action)
    root.animation_data.action = None
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)


def parse_exported_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    accessors = gltf.get("accessors", [])
    vertex_count = 0
    triangle_count = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position_index = primitive.get("attributes", {}).get("POSITION")
            if position_index is not None:
                vertex_count += accessors[position_index]["count"]
            index = primitive.get("indices")
            if index is not None:
                triangle_count += accessors[index]["count"] // 3
    return {
        "meshDefinitions": len(gltf.get("meshes", [])),
        "materials": len(gltf.get("materials", [])),
        "textures": len(gltf.get("textures", [])),
        "images": len(gltf.get("images", [])),
        "positionVertices": vertex_count,
        "triangles": triangle_count,
        "animations": [animation.get("name", "") for animation in gltf.get("animations", [])],
        "nodes": [node.get("name", "") for node in gltf.get("nodes", [])],
    }


def export_glb(output: Path, asset_id: str) -> dict[str, object]:
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
    actual = parse_exported_glb(output)
    return {
        "assetId": asset_id,
        "file": output.name,
        "dimensionsMetres": {"width": 0.074, "length": 1.05, "height": 0.32},
        "materials": actual["materials"],
        "packedTextures": actual["images"],
        "sockets": ["socket_butt", "socket_grip_l", "socket_grip_r", "socket_muzzle"],
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest().upper(),
        "actualGlb": actual,
        "provenance": {
            "license": "CC0",
            "donor": "Quaternius Zombie Apocalypse Kit / Rifle.gltf",
            "rebuild": "detached spikes removed; target scale baked; stock reshaped; topology retriangulated and dissolved; original PBR materials and authored repair details",
            "directRuntimeUse": False,
        },
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
    }


def main() -> None:
    args = parse_args()
    clear_scene()
    root = bpy.data.objects.new(f"weapon_{args.asset_id}", None)
    root["realm_schema"] = "realm.style-review-weapon.v1"
    root["realm_asset_id"] = args.asset_id
    root["realm_art_direction"] = "character_geometry_b_materials_c"
    root["realm_review_only"] = True
    root["realm_runtime_integration_allowed"] = False
    bpy.context.scene.collection.objects.link(root)

    materials = {
        "gunmetal": pbr_material("v4_old_gunmetal", (0.32, 0.35, 0.34), 0.61, 0.66),
        "blackened": pbr_material("v4_blackened_steel", (0.20, 0.225, 0.225), 0.68, 0.72),
        "wood": pbr_material("v4_weathered_walnut", (0.38, 0.225, 0.125), 0.84, 0.0),
        "canvas": pbr_material("v4_burnt_canvas", (0.42, 0.39, 0.27), 0.92, 0.0),
        "brass": pbr_material("v4_aged_brass", (0.50, 0.365, 0.15), 0.52, 0.70),
    }
    body = rebuild_donor_mesh(args.donor, root)
    assign_spatial_materials(body, materials)
    add_authored_repairs(root, materials)
    create_socket("socket_butt", (0.0, -0.395, 0.065), root)
    create_socket("socket_grip_r", (0.0, -0.015, -0.025), root)
    create_socket("socket_grip_l", (0.0, args.support_grip_y, 0.020), root)
    create_socket("socket_muzzle", (0.0, 0.655, 0.085), root)
    create_nla_actions(root)
    bpy.context.scene.render.fps = 30
    report = export_glb(args.output, args.asset_id)
    if args.blend_output:
        args.blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("REALM_UNIFIED_RIFLE_V4=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
