"""Build six body-fitted armor variants from pinned free Internet models.

The downloaded meshes provide the visible silhouettes.  Existing approved
materials and a small number of fitted underlayers/details are retained so the
new geometry keeps Realm of Ashes' B+C surface language and never exposes the
base body through gaps.  Every external vertex is rebound to the exact current
65-bone player rig by nearest-surface weight transfer.
"""

from __future__ import annotations

import argparse
import bmesh
import hashlib
import json
import math
import pathlib
import sys
from dataclasses import dataclass
from typing import Callable, Iterable

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree


BODY_IDS = (
    "female_slim",
    "female_medium",
    "female_large",
    "male_slim",
    "male_medium",
    "male_large",
)
TRIANGLE_BUDGET = 12_000


@dataclass(frozen=True)
class ArmorSpec:
    item_id: str
    output_folder: str
    output_prefix: str
    runtime_prefix: str
    materials: tuple[str, ...]
    source_for_body: Callable[[str], str]
    selected_mesh_tokens: tuple[str, ...]
    discarded_materials: tuple[str, ...] = ()
    retained_donor_tokens: tuple[str, ...] = ()
    join_source: bool = True
    join_donor: bool = False
    crop: tuple[float, float, float] | None = None
    fit_scale: tuple[float, float, float] = (1.04, 1.06, 1.0)
    surface_clearance: float = 0.018
    vertical_offset: float = 0.0
    creator: str = "Quaternius"
    pack: str = ""
    page: str = ""
    license_id: str = "CC0-1.0"
    source_sha256: str = ""


def source_by_gender(male: str, female: str) -> Callable[[str], str]:
    return lambda body_id: female if body_id.startswith("female_") else male


SPECS = (
    ArmorSpec(
        item_id="leather",
        output_folder="unified-equipment-leather-jacket-v1/jacket",
        output_prefix="equipment_leather_jacket_unified_v1",
        runtime_prefix="equipment_leather_jacket",
        materials=(
            "jacket_weathered_oxblood_leather",
            "jacket_dark_edge_leather",
            "jacket_tarnished_hardware",
        ),
        source_for_body=source_by_gender("quaternius_male_punk.gltf", "quaternius_female_punk.gltf"),
        selected_mesh_tokens=("punk_body", "punk_legs"),
        discarded_materials=("skin",),
        join_source=False,
        crop=(0.0, 1.0, 0.36),
        fit_scale=(1.035, 1.08, 0.985),
        pack="Ultimate Modular Men / Ultimate Modular Women",
        page="https://quaternius.com/packs/ultimatemodularcharacters.html",
        source_sha256="F9224072F5E6CBB207ECA250FAA7F1868614A1A984074FE79C7B2862DF4FEB42/61CC7F85A8E9B700CDB92AE8EBD6E3BDD1E8A510B57027F6C7D8C2B6FF3B0E0F",
    ),
    ArmorSpec(
        item_id="metalArmor",
        output_folder="unified-equipment-metal-armor-v1/armor",
        output_prefix="equipment_metal_armor_unified_v1",
        runtime_prefix="equipment_metal_armor",
        materials=(
            "metal_armour_charcoal_padding",
            "metal_armour_worn_steel",
            "metal_armour_oxidised_edges",
            "metal_armour_aged_straps",
        ),
        source_for_body=lambda _body_id: "quaternius_mech_stan.gltf",
        selected_mesh_tokens=("stan",),
        crop=(0.34, 0.84, 0.36),
        fit_scale=(1.10, 1.13, 0.99),
        surface_clearance=0.028,
        pack="Animated Mech Pack",
        page="https://quaternius.com/packs/animatedmechs.html",
        source_sha256="C9A87E0DFE4E39E0C8D7DEE7696758AFFC5B13D011D94A60ACB1600A49045FE7",
    ),
    ArmorSpec(
        item_id="ballisticVest",
        output_folder="unified-equipment-ballistic-vest-v1/vest",
        output_prefix="equipment_ballistic_vest_unified_v1",
        runtime_prefix="equipment_ballistic_vest",
        materials=(
            "ballistic_vest_faded_olive_carrier",
            "ballistic_vest_charcoal_insert",
            "ballistic_vest_dusty_webbing",
            "ballistic_vest_oxidised_hardware",
            "ballistic_vest_faded_repair_cloth",
        ),
        source_for_body=source_by_gender("quaternius_male_swat.gltf", "quaternius_female_soldier.gltf"),
        selected_mesh_tokens=("swat_body", "soldier_body"),
        discarded_materials=("skin",),
        fit_scale=(1.055, 1.10, 0.99),
        vertical_offset=-0.04,
        pack="Ultimate Modular Men / Ultimate Modular Women",
        page="https://quaternius.com/packs/ultimatemodularcharacters.html",
        source_sha256="622B3F36FCAC90539EF8F7121EC1F11B5E1AE603A085019B3FA96EBA20DDDFD3/37112E60AF92FF84D882A34E21F0F78A2AFC14282E950FB0E3652E51D06E0B2D",
    ),
    ArmorSpec(
        item_id="combatArmor",
        output_folder="unified-equipment-combat-armor-v1/armor",
        output_prefix="equipment_combat_armor_unified_v1",
        runtime_prefix="equipment_combat_armor",
        materials=(
            "combat_armor_chipped_olive_composite",
            "combat_armor_black_shock_strip",
            "combat_armor_tarnished_alloy",
            "combat_armor_faded_tan_repair",
            "combat_armor_graphite_underlayer",
        ),
        source_for_body=lambda _body_id: "poly_pizza_scifi_soldier.glb",
        selected_mesh_tokens=("vest",),
        crop=(0.34, 0.90, 0.28),
        fit_scale=(1.06, 1.11, 0.985),
        surface_clearance=0.024,
        creator="Manaos",
        pack="Soldier",
        page="https://poly.pizza/m/tGGCGep9kS",
        license_id="CC-BY",
        source_sha256="0B612C75C5A6E22282219C4C38C035CBB2AC9A8562EAF466A10172288E5F4B6C",
    ),
    ArmorSpec(
        item_id="heavyArmor",
        output_folder="unified-equipment-heavy-armor-v1/armor",
        output_prefix="equipment_heavy_armor_unified_v1",
        runtime_prefix="equipment_heavy_armor",
        materials=(
            "heavy_armor_black_padded_underlayer",
            "heavy_armor_worn_gunmetal",
            "heavy_armor_olive_composite_inserts",
            "heavy_armor_aged_webbing",
            "heavy_armor_oxidised_hardware",
            "heavy_armor_faded_hazard_repair",
        ),
        source_for_body=lambda _body_id: "poly_pizza_scifi_soldier.glb",
        selected_mesh_tokens=("vest", "scarf"),
        crop=(0.38, 0.98, 0.28),
        fit_scale=(1.10, 1.16, 0.985),
        surface_clearance=0.030,
        creator="Manaos",
        pack="Soldier",
        page="https://poly.pizza/m/tGGCGep9kS",
        license_id="CC-BY",
        source_sha256="0B612C75C5A6E22282219C4C38C035CBB2AC9A8562EAF466A10172288E5F4B6C",
    ),
    ArmorSpec(
        item_id="hazmatSuit",
        output_folder="unified-equipment-hazmat-suit-v1/suit",
        output_prefix="equipment_hazmat_suit_unified_v1",
        runtime_prefix="equipment_hazmat_suit",
        materials=(
            "hazmat_faded_mustard_canvas",
            "hazmat_aged_black_rubber",
            "hazmat_oxidized_filter_metal",
            "hazmat_scratched_smoke_visor",
            "hazmat_dusty_olive_repairs",
            "hazmat_faded_warning_panel",
        ),
        source_for_body=lambda _body_id: "quaternius_male_spacesuit.gltf",
        selected_mesh_tokens=("spacesuit_body", "spacesuit_legs", "spacesuit_feet"),
        retained_donor_tokens=("helmet_optional_ho", "sealed_details"),
        join_donor=True,
        fit_scale=(1.075, 1.15, 0.985),
        pack="Ultimate Modular Men",
        page="https://quaternius.com/packs/ultimatemodularcharacters.html",
        source_sha256="33E0E0FBC6140FFC936A099FD84A274BE406115C4B32AA0A697641710B67392A",
    ),
    ArmorSpec(
        item_id="energySuit",
        output_folder="unified-equipment-energy-suit-v1/suit",
        output_prefix="equipment_energy_suit_unified_v1",
        runtime_prefix="equipment_energy_suit",
        materials=(
            "energy_suit_weathered_graphite_composite",
            "energy_suit_aged_charcoal_insulation",
            "energy_suit_tarnished_copper_channels",
            "energy_suit_cyan_field_glass",
            "energy_suit_chipped_blue_ceramic",
            "energy_suit_oxidized_service_patch",
        ),
        # A sealed energy suit needs a continuous donor garment on every body.
        # The modular SciFi woman has exposed joints; using its skin as a liner
        # produced intersecting plates after the full-body fit.
        source_for_body=lambda _body_id: "quaternius_male_spacesuit.gltf",
        selected_mesh_tokens=(
            "spacesuit_body",
            "spacesuit_legs",
            "spacesuit_feet",
        ),
        discarded_materials=("skin",),
        retained_donor_tokens=("field_details",),
        fit_scale=(1.055, 1.10, 0.985),
        pack="Ultimate Modular Men",
        page="https://quaternius.com/packs/ultimatemodularcharacters.html",
        source_sha256="33E0E0FBC6140FFC936A099FD84A274BE406115C4B32AA0A697641710B67392A",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument(
        "--output-root",
        help="write generated review assets beneath this root; defaults to --root",
    )
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--item", action="append", choices=[spec.item_id for spec in SPECS])
    parser.add_argument("--body", action="append", choices=BODY_IDS)
    parser.add_argument("--skip-renders", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def triangle_count(obj: bpy.types.Object) -> int:
    return sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)


def import_gltf(path: pathlib.Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def mesh_is_helper(obj: bpy.types.Object) -> bool:
    lowered = obj.name.lower()
    return obj.type != "MESH" or "icosphere" in lowered or not obj.data.polygons


def mesh_is_weapon(obj: bpy.types.Object) -> bool:
    lowered = obj.name.lower()
    return any(
        token in lowered
        for token in (
            "pistol",
            "revolver",
            "rifle",
            "sniper",
            "shotgun",
            "launcher",
            "cannon",
            "grenade",
            "shovel",
            "knife",
            "smg",
            "gun",
        )
    )


def evaluated_points(obj: bpy.types.Object) -> list[Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        matrix = obj.matrix_world.copy()
        return [matrix @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def bounds(points: Iterable[Vector]) -> tuple[Vector, Vector]:
    values = list(points)
    if not values:
        raise RuntimeError("cannot calculate empty bounds")
    minimum = Vector(tuple(min(point[index] for point in values) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in values) for index in range(3)))
    return minimum, maximum


def bake_rest_mesh(source: bpy.types.Object) -> bpy.types.Object:
    duplicate = source.copy()
    duplicate.data = source.data.copy()
    bpy.context.scene.collection.objects.link(duplicate)
    world = source.matrix_world.copy()
    duplicate.parent = source.parent
    duplicate.matrix_world = world
    bpy.ops.object.select_all(action="DESELECT")
    duplicate.select_set(True)
    bpy.context.view_layer.objects.active = duplicate
    for modifier in list(duplicate.modifiers):
        if modifier.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    world = duplicate.matrix_world.copy()
    duplicate.parent = None
    duplicate.data.transform(world)
    duplicate.matrix_world = Matrix.Identity(4)
    return duplicate


def delete_faces(obj: bpy.types.Object, predicate: Callable) -> int:
    mesh = obj.data
    source_materials = [slot.material.name.lower() if slot.material else "" for slot in obj.material_slots]
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    doomed = []
    for face in bm.faces:
        material = source_materials[face.material_index] if face.material_index < len(source_materials) else ""
        if predicate(face, material):
            doomed.append(face)
    before = len(bm.faces)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return before - len(mesh.polygons)


def fit_mesh(
    obj: bpy.types.Object,
    source_bounds: tuple[Vector, Vector],
    target_bounds: tuple[Vector, Vector],
    scale_adjustment: tuple[float, float, float],
) -> None:
    source_min, source_max = source_bounds
    target_min, target_max = target_bounds
    source_center = (source_min + source_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    source_extent = source_max - source_min
    target_extent = target_max - target_min
    scales = Vector(
        (
            target_extent.x / max(source_extent.x, 1e-6) * scale_adjustment[0],
            target_extent.y / max(source_extent.y, 1e-6) * scale_adjustment[1],
            target_extent.z / max(source_extent.z, 1e-6) * scale_adjustment[2],
        )
    )
    for vertex in obj.data.vertices:
        point = vertex.co
        vertex.co = Vector(
            (
                (point.x - source_center.x) * scales.x + target_center.x,
                (point.y - source_center.y) * scales.y + target_center.y,
                (point.z - source_min.z) * scales.z + target_min.z,
            )
        )
    obj.data.update()


def crop_fitted_mesh(
    obj: bpy.types.Object,
    crop: tuple[float, float, float] | None,
    target_bounds: tuple[Vector, Vector],
) -> int:
    if crop is None:
        return 0
    minimum, maximum = target_bounds
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    min_z = minimum.z + crop[0] * extent.z
    max_z = minimum.z + crop[1] * extent.z
    max_x = crop[2] * extent.x
    return delete_faces(
        obj,
        lambda face, _material: (
            (sum(vertex.co.z for vertex in face.verts) / len(face.verts)) < min_z
            or (sum(vertex.co.z for vertex in face.verts) / len(face.verts)) > max_z
            or abs((sum(vertex.co.x for vertex in face.verts) / len(face.verts)) - center.x) > max_x
        ),
    )


def fit_upper_by_joints(obj, original_points, source_rig, target_rig, height_scale):
    """Refit downloaded sleeves/torso by anatomical joints, not whole-model bounds.

    Both rigs use a T-pose, but their shoulder, elbow and waist landmarks differ.
    A global stretch followed by nearest-skin projection collapses sleeve rings.
    Preserve the source skin's joint correspondence before transferring weights.
    The existing validated lower-leg fitting remains unchanged below the waist.
    """
    names={'Root':'root','Body':'root','Hips':'pelvis','Abdomen':'spine_01',
        'Torso':'spine_02','Chest':'spine_03','Neck':'neck_01','Head':'head'}
    for side in ('l','r'):
        for old,new in (('Shoulder','clavicle'),('UpperArm','upperarm'),('LowerArm','lowerarm'),
            ('Wrist','hand'),('UpperLeg','thigh'),('LowerLeg','calf'),('Foot','foot'),('PT','ball')):
            names[old+'.'+side.upper()]=new+'_'+side
        for finger in ('Index','Middle','Ring','Pinky','Thumb'):
            for i in range(1,5):names[finger+str(i)+'.'+side.upper()]=finger.lower()+'_'+str(min(i,3)).zfill(2)+'_'+side
    frames={}
    for group in obj.vertex_groups:
        old=source_rig.data.bones.get(group.name)
        new=target_rig.data.bones.get(names.get(group.name,''))
        if group.name.startswith('Shoulder.'):
            # These rigs place the clavicle's inner pivot differently. Using
            # their length ratio shears the armpit. Follow the common humerus
            # frame instead, blending to the torso through the source weights.
            side=group.name[-1].lower()
            old=source_rig.data.bones.get('UpperArm.'+side.upper())
            new=target_rig.data.bones.get('upperarm_'+side)
        if old is None or new is None:continue
        a=source_rig.matrix_world@old.head_local
        b=source_rig.matrix_world@old.tail_local
        c=target_rig.matrix_world@new.head_local
        d=target_rig.matrix_world@new.tail_local
        direction=(b-a).normalized()
        frames[group.index]=(a,c,direction,direction.rotation_difference((d-c).normalized()),
            (d-c).length/max((b-a).length,1e-6))
    heights=[]
    for source_name,target_name in [('Hips','pelvis'),('UpperArm.L','upperarm_l'),('Neck','neck_01')]:
        heights.append(((source_rig.matrix_world@source_rig.data.bones[source_name].head_local).z,
                        (target_rig.matrix_world@target_rig.data.bones[target_name].head_local).z))
    def torso_height(z):
        a,b=heights[:2] if z<heights[1][0] else heights[1:]
        return a[1]+(z-a[0])*(b[1]-a[1])/(b[0]-a[0])
    for vertex,original in zip(obj.data.vertices,original_points):
        blend=max(0,min(1,(vertex.co.z-.85)/.12))
        if blend==0:continue
        torso_point=vertex.co.copy()
        torso_point.z=torso_height(original.z)
        fitted=Vector();total=0
        for member in vertex.groups:
            if member.group not in frames or member.weight<=0:continue
            a,c,axis,rotation,length_scale=frames[member.group]
            offset=original-a
            along=axis*offset.dot(axis)
            point=c+rotation@(along*length_scale+(offset-along)*height_scale)
            # Torso segment counts/pivots are not one-to-one. Keep its overall
            # fit and use a surface enclosure separately; only articulate arms.
            group_name=obj.vertex_groups[member.group].name
            if not any(group_name.startswith(prefix) for prefix in
                ('Shoulder.','UpperArm.','LowerArm.','Wrist.','Index','Middle','Ring','Pinky','Thumb')):
                point=torso_point
            fitted+=point*member.weight;total+=member.weight
        if total>1e-6:vertex.co=vertex.co.lerp(fitted/total,blend)
    obj.data.update()


def choose_material_index(spec: ArmorSpec, source_name: str, source_index: int) -> int:
    lowered = source_name.lower()
    count = len(spec.materials)
    if spec.item_id == "leather":
        if "black" in lowered:
            return 1
        if "grey" in lowered or "ear" in lowered:
            return 2
        return 0
    if spec.item_id == "ballisticVest":
        if "black" in lowered:
            return 1
        if "grey" in lowered or "metal" in lowered:
            return 3
        if "light" in lowered:
            return 4
        return 0
    if spec.item_id == "metalArmor":
        if "black" in lowered:
            return 0
        if "accent" in lowered:
            return 2
        if "grey" in lowered:
            return 3
        return 1
    if spec.item_id == "combatArmor":
        return (source_index % 4) if source_index % 4 < 4 else 0
    if spec.item_id == "heavyArmor":
        if "black" in lowered:
            return 0
        if "accent" in lowered:
            return 2
        if "lightgrey" in lowered:
            return 4
        if "grey" in lowered:
            return 3
        if "eye" in lowered:
            return 5
        return 1
    if spec.item_id == "hazmatSuit":
        if "dark" in lowered or "black" in lowered:
            return 1
        if "accent" in lowered:
            return 5
        if "grey" in lowered or "metal" in lowered:
            return 2
        return 0
    if spec.item_id == "energySuit":
        if "dark" in lowered or "black" in lowered or "skin" in lowered:
            return 1
        if "accent" in lowered:
            return 2
        if "blue" in lowered:
            return 4
        if "grey" in lowered or "metal" in lowered:
            return 5
        return 0
    return source_index % count


def remap_materials(
    obj: bpy.types.Object,
    spec: ArmorSpec,
    target_materials: dict[str, bpy.types.Material],
) -> None:
    source_names = [slot.material.name if slot.material else "" for slot in obj.material_slots]
    old_indices = [polygon.material_index for polygon in obj.data.polygons]
    obj.data.materials.clear()
    for name in spec.materials:
        obj.data.materials.append(target_materials[name])
    for polygon, old_index in zip(obj.data.polygons, old_indices):
        source_name = source_names[old_index] if old_index < len(source_names) else ""
        polygon.material_index = choose_material_index(spec, source_name, old_index)


def decimate_objects(objects: list[bpy.types.Object], available_triangles: int,
                     safety_margin: float = .97) -> tuple[int, bool]:
    before = sum(triangle_count(obj) for obj in objects)
    if before <= available_triangles:
        return before, False
    if not 0<safety_margin<=1:raise ValueError('Invalid decimation safety margin')
    ratio = max(0.08, min(1.0, available_triangles / max(before, 1) * safety_margin))
    for obj in objects:
        if triangle_count(obj) < 80:
            continue
        modifier = obj.modifiers.new("realm_budget_decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return sum(triangle_count(obj) for obj in objects), True


def target_skin_data(
    body: bpy.types.Object,
) -> tuple[KDTree, list[Vector], list[Vector], list[list[tuple[str, float]]]]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    matrix = body.matrix_world.copy()
    normal_matrix = matrix.to_3x3().inverted().transposed()
    try:
        points = [matrix @ vertex.co for vertex in mesh.vertices]
        normals = [(normal_matrix @ vertex.normal).normalized() for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()
    if len(points) != len(body.data.vertices):
        raise RuntimeError("base body evaluation changed topology")
    tree = KDTree(len(points))
    for index, point in enumerate(points):
        tree.insert(point, index)
    tree.balance()
    weights = []
    for vertex in body.data.vertices:
        row = []
        for membership in vertex.groups:
            group = body.vertex_groups[membership.group]
            row.append((group.name, float(membership.weight)))
        row.sort(key=lambda pair: pair[1], reverse=True)
        weights.append(row[:4])
    return tree, points, normals, weights


def conform_outside_body(
    obj: bpy.types.Object,
    tree: KDTree,
    target_points: list[Vector],
    target_normals: list[Vector],
    clearance: float,
    minimum_height: float = -1e9,
) -> int:
    moved = 0
    for vertex in obj.data.vertices:
        if vertex.co.z < minimum_height:
            continue
        _point, nearest_index, _distance = tree.find(vertex.co)
        surface_point = target_points[nearest_index]
        surface_normal = target_normals[nearest_index]
        signed_distance = (vertex.co - surface_point).dot(surface_normal)
        if signed_distance < clearance:
            vertex.co += surface_normal * (clearance - signed_distance)
            moved += 1
    obj.data.update()
    return moved


def transfer_skin(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    tree: KDTree,
    target_weights: list[list[tuple[str, float]]],
) -> None:
    obj.vertex_groups.clear()
    groups = {bone.name: obj.vertex_groups.new(name=bone.name) for bone in armature.data.bones}
    root_index = groups["root"].index
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    deform = bm.verts.layers.deform.verify()
    bm.verts.ensure_lookup_table()
    group_indices = {name: group.index for name, group in groups.items()}
    for vertex in bm.verts:
        _point, nearest_index, _distance = tree.find(vertex.co)
        row = [(name, weight) for name, weight in target_weights[nearest_index] if name in group_indices]
        total = sum(weight for _name, weight in row)
        if total <= 1e-8:
            vertex[deform][root_index] = 1.0
            continue
        for name, weight in row:
            vertex[deform][group_indices[name]] = weight / total
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    # Fitting and weight lookup above use world-space vertices. Imported player
    # rigs carry body-size scale (for example 1.035 for female_large). Convert
    # once to rig-local space before parenting, otherwise that scale is applied
    # again and lifts the sleeves away from the actual arms.
    obj.data.transform(armature.matrix_world.inverted())
    obj.parent = armature
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Identity(4)
    modifier = obj.modifiers.new("realm_player_rig", "ARMATURE")
    modifier.object = armature
    modifier.use_vertex_groups = True


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    if not objects:
        raise RuntimeError(f"cannot join empty object set for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    active = max(objects, key=triangle_count)
    bpy.context.view_layer.objects.active = active
    if len(objects) > 1:
        bpy.ops.object.join()
    active.name = name
    return active


def ensure_material_usage(
    objects: list[bpy.types.Object],
    spec: ArmorSpec,
    target_materials: dict[str, bpy.types.Material],
) -> None:
    used = set()
    for obj in objects:
        for polygon in obj.data.polygons:
            if polygon.material_index < len(obj.material_slots):
                material = obj.material_slots[polygon.material_index].material
                if material:
                    used.add(material.name)
    missing = [name for name in spec.materials if name not in used]
    if not missing:
        return
    target = max(objects, key=triangle_count)
    slot_by_name = {}
    for name in spec.materials:
        existing = next(
            (index for index, slot in enumerate(target.material_slots) if slot.material and slot.material.name == name),
            None,
        )
        if existing is None:
            target.data.materials.append(target_materials[name])
            existing = len(target.material_slots) - 1
        slot_by_name[name] = existing
    polygons = list(target.data.polygons)
    for offset, name in enumerate(missing, start=1):
        polygons[-offset].material_index = slot_by_name[name]


def prepare_review_body(objects: list[bpy.types.Object]) -> None:
    material = bpy.data.materials.new("realm_review_mannequin")
    material.diffuse_color = (0.055, 0.065, 0.075, 1.0)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.055, 0.065, 0.075, 1.0)
    shader.inputs["Roughness"].default_value = 0.92
    for obj in objects:
        if obj.type != "MESH" or mesh_is_helper(obj):
            continue
        obj.data.materials.clear()
        obj.data.materials.append(material)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_review(
    output: pathlib.Path,
    target_bounds: tuple[Vector, Vector],
    view: str,
) -> None:
    minimum, maximum = target_bounds
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    size = max(extent.x, extent.z)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 600
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "Medium High Contrast"
    except TypeError:
        pass
    if scene.world is None:
        scene.world = bpy.data.worlds.new("realm_review_world")
    scene.world.color = (0.012, 0.017, 0.021)

    for obj in [obj for obj in bpy.context.scene.objects if obj.name.startswith("realm_review_")]:
        bpy.data.objects.remove(obj, do_unlink=True)

    camera_data = bpy.data.cameras.new("realm_review_camera")
    camera = bpy.data.objects.new("realm_review_camera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.lens = 64 if view == "detail" else 58
    if view == "back":
        camera.location = (center.x, maximum.y + size * 2.15, center.z + 0.02 * size)
    elif view == "detail":
        camera.location = (center.x, minimum.y - size * 1.45, minimum.z + extent.z * 0.67)
        center = Vector((center.x, center.y, minimum.z + extent.z * 0.67))
    else:
        camera.location = (center.x, minimum.y - size * 2.15, center.z + 0.02 * size)
    look_at(camera, center)
    scene.camera = camera

    lights = (
        ("key", (-size * 0.85, -size * 0.9, maximum.z + size * 0.22), 1100, (1.0, 0.78, 0.58), size * 0.75),
        ("fill", (size * 0.85, -size * 0.3, center.z + size * 0.1), 850, (0.48, 0.68, 1.0), size * 0.8),
        ("rim", (0.0, size * 0.9, maximum.z + size * 0.1), 1050, (1.0, 0.48, 0.22), size * 0.6),
    )
    for name, relative, energy, color, radius in lights:
        data = bpy.data.lights.new(f"realm_review_{name}", "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = max(radius, 0.4)
        light = bpy.data.objects.new(f"realm_review_{name}", data)
        scene.collection.objects.link(light)
        light.location = center + Vector(relative)
        look_at(light, center)
    bpy.ops.render.render(write_still=True)


def export_review(
    output: pathlib.Path,
    armature: bpy.types.Object,
    equipment: list[bpy.types.Object],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in equipment:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(output),
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
        export_animations=False,
        export_skins=True,
        export_morph=False,
    )


def build_variant(
    root: pathlib.Path,
    output_root: pathlib.Path,
    source_dir: pathlib.Path,
    spec: ArmorSpec,
    body_id: str,
    skip_renders: bool,
    split_footwear: bool = False,
    refit_upper: bool = False,
) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    donor_dir = root / "docs" / "art" / "reviews" / spec.output_folder
    review_dir = output_root / "docs" / "art" / "reviews" / spec.output_folder
    review_dir.mkdir(parents=True, exist_ok=True)
    output = review_dir / f"{spec.output_prefix}_{body_id}.glb"
    donor_output = donor_dir / f"{spec.output_prefix}_{body_id}.glb"
    if not donor_output.is_file():
        raise RuntimeError(f"approved material donor is missing: {donor_output}")

    donor_objects = import_gltf(donor_output)
    target_armature = next(obj for obj in donor_objects if obj.type == "ARMATURE")
    target_armature.name = "character_root"
    target_armature.data.pose_position = "REST"
    if target_armature.animation_data:
        target_armature.animation_data_clear()
    target_materials = {}
    for name in spec.materials:
        material = bpy.data.materials.get(name)
        if material is None:
            raise RuntimeError(f"{spec.item_id} donor lacks material {name}")
        target_materials[name] = material

    donor_meshes = [obj for obj in donor_objects if obj.type == "MESH" and not mesh_is_helper(obj)]
    retained_donor = [
        obj
        for obj in donor_meshes
        if any(token in obj.name.lower() for token in spec.retained_donor_tokens)
        or (split_footwear and spec.join_donor and 'retained_details' in obj.name.lower())
    ]
    for obj in donor_meshes:
        if obj not in retained_donor:
            bpy.data.objects.remove(obj, do_unlink=True)
    if spec.retained_donor_tokens and not retained_donor:
        raise RuntimeError(f"{spec.item_id} donor layer was not found")

    character_file = root / "public" / "assets" / "models" / "characters" / "base" / f"character_{body_id}.glb"
    character_objects = import_gltf(character_file)
    character_armature = next(obj for obj in character_objects if obj.type == "ARMATURE")
    character_armature.data.pose_position = "REST"
    if character_armature.animation_data:
        character_armature.animation_data_clear()
    body = next(obj for obj in character_objects if obj.type == "MESH" and "body_base" in obj.name.lower())
    bpy.context.view_layer.update()
    target_points = evaluated_points(body)
    target_bounds = bounds(target_points)
    tree, target_points, target_normals, weights = target_skin_data(body)

    source_file = source_dir / spec.source_for_body(body_id)
    if not source_file.is_file():
        raise RuntimeError(f"downloaded source is missing: {source_file}")
    source_objects = import_gltf(source_file)
    for armature in [obj for obj in source_objects if obj.type == "ARMATURE"]:
        armature.data.pose_position = "REST"
        if armature.animation_data:
            armature.animation_data_clear()
    bpy.context.view_layer.update()
    source_reference_meshes = [
        obj for obj in source_objects if obj.type == "MESH" and not mesh_is_helper(obj) and not mesh_is_weapon(obj)
    ]
    source_reference_points = []
    for obj in source_reference_meshes:
        source_reference_points.extend(evaluated_points(obj))
    source_bounds = bounds(source_reference_points)
    source_armature = next(obj for obj in source_objects if obj.type == 'ARMATURE')
    selected = [
        obj
        for obj in source_reference_meshes
        if any(token in obj.name.lower() for token in spec.selected_mesh_tokens)
    ]
    if not selected:
        raise RuntimeError(f"{spec.item_id} source mesh selection is empty in {source_file.name}")
    source_original_triangles = sum(triangle_count(obj) for obj in selected)
    fitted = []
    removed_faces = 0
    discarded = {name.lower() for name in spec.discarded_materials}
    for source in selected:
        baked = bake_rest_mesh(source)
        baked.name = f"{spec.output_prefix}_{body_id}_downloaded_{source.name}"
        baked['realm_armor_layer'] = 'builtin_footwear' if split_footwear and '_feet' in source.name.lower() else 'shell'
        # Layered suits need a continuous liner, including the female donor's
        # exposed upper joints. Remap its Skin material to insulation, not holes.
        if discarded and not (split_footwear and (refit_upper or any(t in source.name.lower() for t in ('_feet','_legs')))):
            removed_faces += delete_faces(baked, lambda _face, material: material in discarded)
        original_points=[v.co.copy() for v in baked.data.vertices]
        if split_footwear and refit_upper:
            from fit_suit_leg_ownership import remember_source_legs
            remember_source_legs(baked)
        fit_mesh(baked, source_bounds, target_bounds, spec.fit_scale)
        if split_footwear:
            if refit_upper:
                fit_upper_by_joints(baked,original_points,source_armature,target_armature,
                    (target_bounds[1].z-target_bounds[0].z)/(source_bounds[1].z-source_bounds[0].z))
            # Global bounds align the overall silhouette, not bent calf axes.
            # Preserve each donor ring around its own leg before projecting it
            # onto the wearer; projecting an offset ring can fold it inside out.
            smin,smax=source_bounds; tmin,tmax=target_bounds
            sc=(smin+smax)*.5; tc=(tmin+tmax)*.5
            scales=Vector(tuple((tmax[i]-tmin[i])/(smax[i]-smin[i])*spec.fit_scale[i] for i in range(3)))
            def source_landmark(name):
                p=source_armature.matrix_world@source_armature.data.bones[name].head_local
                return Vector(((p.x-sc.x)*scales.x+tc.x,(p.y-sc.y)*scales.y+tc.y,(p.z-smin.z)*scales.z+tmin.z))
            axes={}
            for side in ('l','r'):
                axes[side]=([source_landmark(name+'.'+side.upper()) for name in ('Foot','LowerLeg','UpperLeg')],
                    [target_armature.matrix_world@target_armature.data.bones[name+'_'+side].head_local for name in ('foot','calf','thigh')])
            def axis_at(points,z):
                a,b=points[:2] if z<points[1].z else points[1:]
                return a.lerp(b,max(0,min(1,(z-a.z)/(b.z-a.z))))
            for vertex in baked.data.vertices:
                p=vertex.co
                if p.z>=1.04: continue
                if refit_upper:
                    from fit_suit_leg_ownership import source_leg_side
                    leg_side=source_leg_side(baked,vertex.index)
                else:leg_side=p.x
                old,new=axes['l' if leg_side>0 else 'r']
                delta=axis_at(new,p.z)-axis_at(old,p.z)
                blend=max(0,min(1,(1.04-p.z)/.18))
                p.x+=delta.x*blend; p.y+=delta.y*blend
        if spec.vertical_offset:
            for vertex in baked.data.vertices:
                vertex.co.z += spec.vertical_offset
        removed_faces += crop_fitted_mesh(baked, spec.crop, target_bounds)
        if not refit_upper:
            conform_outside_body(
                baked,
                tree,
                target_points,
                target_normals,
                spec.surface_clearance,
                minimum_height=.94 if split_footwear else -1e9,
            )
        remap_materials(baked, spec, target_materials)
        fitted.append(baked)

    for obj in source_objects:
        if bpy.context.scene.objects.get(obj.name) is obj:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    donor_triangles = sum(triangle_count(obj) for obj in retained_donor)
    available = max(500, TRIANGLE_BUDGET - donor_triangles)
    fitted_triangles, decimated = decimate_objects(fitted, available)
    for obj in fitted:
        transfer_skin(obj, target_armature, tree, weights)

    if spec.join_source:
        if split_footwear:
            footwear = [obj for obj in fitted if obj.get('realm_armor_layer') == 'builtin_footwear']
            shell = [obj for obj in fitted if obj not in footwear]
            if not footwear or not shell:
                raise RuntimeError(f'{spec.item_id}: cannot isolate built-in footwear')
            fitted = [join_objects(shell, f"{spec.output_prefix}_{body_id}_downloaded_shell"),
                join_objects(footwear, f"{spec.output_prefix}_{body_id}_builtin_footwear")]
        else:
            fitted = [join_objects(fitted, f"{spec.output_prefix}_{body_id}_downloaded_shell")]
    else:
        fitted.sort(key=lambda obj: obj.name)
        for index, obj in enumerate(fitted, start=1):
            obj.name = f"{spec.output_prefix}_{body_id}_downloaded_layer_{index}"
    if spec.join_donor and retained_donor:
        retained_donor = [join_objects(retained_donor, f"{spec.output_prefix}_{body_id}_retained_details")]

    equipment = retained_donor + fitted
    ensure_material_usage(equipment, spec, target_materials)
    for obj in equipment:
        obj["realm_asset_id"] = f"{spec.output_prefix}_{body_id}"
        obj["realm_item_id"] = spec.item_id
        obj["realm_equipment_slot"] = "armor"
        obj["realm_body_id"] = body_id
        obj["realm_source_creator"] = spec.creator
        obj["realm_source_license"] = spec.license_id
        obj["realm_source_page"] = spec.page
        obj["realm_source_sha256"] = spec.source_sha256
        obj["realm_geometry_origin"] = "downloaded_refit"
        obj["realm_review_only"] = True
        obj["realm_runtime_integration_allowed"] = False
    target_armature["realm_asset_id"] = f"{spec.output_prefix}_{body_id}"
    target_armature["realm_item_id"] = spec.item_id
    target_armature["realm_body_id"] = body_id
    target_armature["realm_source_license"] = spec.license_id
    target_armature["realm_review_only"] = True
    target_armature["realm_runtime_integration_allowed"] = False

    export_review(output, target_armature, equipment)
    final_triangles = sum(triangle_count(obj) for obj in equipment)
    if final_triangles > TRIANGLE_BUDGET:
        raise RuntimeError(f"{spec.item_id} {body_id} exceeds {TRIANGLE_BUDGET} triangles: {final_triangles}")

    prepare_review_body(character_objects)
    for obj in character_objects:
        if obj.type == "MESH" and mesh_is_helper(obj):
            obj.hide_render = True
    if not skip_renders:
        render_review(review_dir / f"{spec.output_prefix}_{body_id}_front.png", target_bounds, "front")
        if body_id == "male_medium":
            render_review(review_dir / f"{spec.output_prefix}_{body_id}_back.png", target_bounds, "back")
            render_review(review_dir / f"{spec.output_prefix}_{body_id}_detail.png", target_bounds, "detail")
            bpy.ops.wm.save_as_mainfile(
                filepath=str(review_dir / f"{spec.output_prefix}_{body_id}_review.blend")
            )

    report = {
        "schema": "realm.free-armor-replacement-review.v1",
        "assetId": f"{spec.output_prefix}_{body_id}",
        "itemId": spec.item_id,
        "slot": "armor",
        "bodyId": body_id,
        "reviewOnly": True,
        "runtimeIntegrationAllowed": False,
        "sha256": sha256(output),
        "source": {
            "creator": spec.creator,
            "pack": spec.pack,
            "page": spec.page,
            "license": spec.license_id,
            "downloadedFile": source_file.name,
            "sha256": spec.source_sha256,
            "geometryOrigin": "downloaded_refit",
        },
        "optimization": {
            "triangleBudget": TRIANGLE_BUDGET,
            "sourceSelectedTriangles": source_original_triangles,
            "removedFaces": removed_faces,
            "donorCoverageTriangles": donor_triangles,
            "fittedSourceTriangles": fitted_triangles,
            "decimated": decimated,
            "method": "material isolation, regional crop, bounded decimation, nearest-surface 65-bone weight transfer",
        },
        "actualGlb": {
            "triangles": final_triangles,
            "meshes": len(equipment),
            "materials": len(spec.materials),
            "skins": 1,
            "joints": 65,
            "bytes": output.stat().st_size,
        },
        "materials": list(spec.materials),
        "fit": {
            "targetBoundsMin": [round(value, 5) for value in target_bounds[0]],
            "targetBoundsMax": [round(value, 5) for value in target_bounds[1]],
            "sourceFitScale": list(spec.fit_scale),
            "verticalOffset": spec.vertical_offset,
        },
    }
    report_file = review_dir / f"{spec.output_prefix}_{body_id}.report.json"
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"ROA_ARMOR_VARIANT={spec.item_id}:{body_id}:"
        f"{final_triangles}tri:{output.stat().st_size}bytes"
    )
    return report


def main() -> None:
    args = parse_args()
    root = pathlib.Path(args.root).resolve()
    output_root = pathlib.Path(args.output_root).resolve() if args.output_root else root
    source_dir = pathlib.Path(args.source_dir).resolve()
    selected_items = set(args.item or [spec.item_id for spec in SPECS])
    selected_bodies = tuple(args.body or BODY_IDS)
    for spec in SPECS:
        if spec.item_id not in selected_items:
            continue
        reports = [
            build_variant(root, output_root, source_dir, spec, body_id, args.skip_renders)
            for body_id in selected_bodies
        ]
        review_dir = output_root / "docs" / "art" / "reviews" / spec.output_folder
        summary = {
            "schema": "realm.free-armor-replacement-family.v1",
            "assetFamily": spec.output_prefix,
            "itemId": spec.item_id,
            "slot": "armor",
            "bodyIds": list(selected_bodies),
            "variantCount": len(reports),
            "reviewOnly": True,
            "runtimeIntegrationAllowed": False,
            "triangleBudgetPerVariant": TRIANGLE_BUDGET,
            "source": {
                "creator": spec.creator,
                "pack": spec.pack,
                "page": spec.page,
                "license": spec.license_id,
                "sha256": spec.source_sha256,
            },
            "variants": reports,
        }
        (review_dir / "fit-report-all.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"ROA_ARMOR_FAMILY={spec.item_id}:{len(reports)}")


if __name__ == "__main__":
    main()
