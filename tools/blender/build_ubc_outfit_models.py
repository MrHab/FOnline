"""Одежда Quaternius «Modular Character Outfits – Fantasy» на наши шесть тел.

Набор сшит под Universal Base Characters — тот же 65-костный скелет, что у
нашего тела, поэтому одежду не растягивают по габаритам, как прежних доноров,
а переносят по костям: каждая вершина сдвигается так, как сдвинулись её кости
между скелетом набора и нашим. Наши фигуры плотнее «обычной» фигуры набора,
поэтому затем вся стопка слоёв (куртка, ремни, наплечник) раздувается над
ближайшей точкой тела ровно настолько, чтобы тело нигде не торчало. Веса
костей остаются родными — одежда гнётся так, как её задумал автор.

blender --background --factory-startup --python-exit-code 1 --python tools/blender/build_ubc_outfit_models.py -- --item=leather --body=male_medium
Без --item/--body собираются все вещи на все тела. Результат — кандидат в
unity-client/Logs/OutfitCandidate; в игру его переносит tools/build-outfit-models.js.
"""
import hashlib
import json
import math
import sys
import tempfile
import zipfile
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).parent))
import build_free_armor_replacements as rig  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ZIP = ROOT / 'Build/SourceDownloads/quaternius-outfits-fantasy-20260922/Modular Character Outfits - Fantasy[Standard].zip'
SOURCE_SHA256 = 'c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70'
SOURCE_PAGE = 'https://quaternius.com/packs/modularcharacteroutfitsfantasy.html'
PARTS_DIR = 'Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Modular Parts/'
TEXTURES_DIR = 'Modular Character Outfits - Fantasy[Standard]/Textures/'
OUT = ROOT / 'unity-client/Logs/OutfitCandidate'
# Тело — 10.5 тыс. треугольников; одежда с сапогами, наручами и наплечниками
# укладывается в 16 тыс. (прежние костюмы — 12 тыс., но без ремней и пряжек).
TRIANGLE_BUDGET = 16000
# Слияние почти плоских граней (градусы) — упрощение, не меняющее силуэт.
DISSOLVE_DEGREES = 6
# Зазор между кожей и изнанкой одежды. Тело рисуется под одеждой (его никто не
# прячет), так что при сгибах суставов ему нужен запас.
CLEARANCE = 0.010
# Ниже этой высоты обувь снимается отдельно: если в слоте «Обувь» свои
# ботинки, клиент прячет слой builtin_footwear (голенище остаётся со штанами).
FOOTWEAR_CUT = 0.22

OUTFITS = {
    'leather': {
        'title': 'Следопыт: кожаная куртка, штаны, высокие сапоги, наплечник',
        'parts': {
            'male': ('Male_Ranger_Body', 'Male_Ranger_Arms', 'Male_Ranger_Legs',
                     'Male_Ranger_Feet_Boots', 'Male_Ranger_Acc_Pauldron'),
            'female': ('Female_Ranger_Body', 'Female_Ranger_Arms', 'Female_Ranger_Legs',
                       'Female_Ranger_Feet', 'Female_Ranger_Acc_Pauldrons'),
        },
        'footwear': ('_Feet',),
        'base_color': 'Ranger/T_Ranger_3_BaseColor.png',
        'normal': 'Ranger/T_Ranger_Normal.png',
        'material': 'outfit_ranger_weathered_leather',
    },
}
BODY_IDS = rig.BODY_IDS
SKIN_MATERIALS = ('mi_regular_male', 'mi_regular_female')


def arg(name):
    return next((a.split('=', 1)[1] for a in sys.argv if a.startswith(f'--{name}=')), None)


def extract_sources(target):
    data = SOURCE_ZIP.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != SOURCE_SHA256:
        raise RuntimeError(f'Unexpected source archive {SOURCE_ZIP.name}: {actual}')
    with zipfile.ZipFile(SOURCE_ZIP) as archive:
        wanted = [n for n in archive.namelist() if n.startswith(PARTS_DIR) and n.endswith(('.gltf', '.bin'))]
        wanted += [TEXTURES_DIR + spec[key] for spec in OUTFITS.values() for key in ('base_color', 'normal')]
        for name in set(wanted):
            archive.extract(name, target)
    return Path(target)


def world_heads(armature):
    return {bone.name.lower(): armature.matrix_world @ bone.head_local for bone in armature.data.bones}


def dominant_group(obj, vertex):
    best = max(vertex.groups, key=lambda g: g.weight, default=None)
    return obj.vertex_groups[best.group].name.lower() if best else ''


def side_of(bone):
    return 'l' if bone.endswith('_l') else 'r' if bone.endswith('_r') else 'c'


class BodySurface:
    """Тело для примерки: ближайшие вершины и поверхность по сторонам тела.

    Внутренняя сторона штанины не должна «видеть» соседнюю ногу, иначе её
    выдавит поперёк паха. Вершина одежды на левой кости ищет тело только
    среди левых и срединных вершин.
    """

    def __init__(self, body):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = body.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        matrix = body.matrix_world.copy()
        normal_matrix = matrix.to_3x3().inverted().transposed()
        self.points = [matrix @ v.co for v in mesh.vertices]
        self.normals = [(normal_matrix @ v.normal).normalized() for v in mesh.vertices]
        faces = [tuple(p.vertices) for p in mesh.polygons]
        self.edges = [tuple(e.vertices) for e in mesh.edges]
        evaluated.to_mesh_clear()
        self.bone = [dominant_group(body, v) for v in body.data.vertices]
        self.side = [side_of(bone) for bone in self.bone]
        self.trees = {}
        self.bvhs = {}
        for key, allowed in (('l', 'lc'), ('r', 'rc'), ('c', 'lrc')):
            indices = [i for i, s in enumerate(self.side) if s in allowed]
            tree = KDTree(len(indices))
            for i in indices:
                tree.insert(self.points[i], i)
            tree.balance()
            self.trees[key] = tree
            self.bvhs[key] = BVHTree.FromPolygons(
                self.points, [f for f in faces if all(self.side[i] in allowed for i in f)])

    def nearest(self, point, side):
        _, index, _ = self.trees[side].find(point)
        location, normal, _, _ = self.bvhs[side].find_nearest(point)
        if location is None:
            location, normal = self.points[index], self.normals[index]
        return index, (point - location).dot(normal)


def retarget(obj, donor_heads, target_heads):
    """Сдвиг вершин вслед за костями: скелеты одинаковы, отличаются только суставы."""
    groups = {g.index: g.name.lower() for g in obj.vertex_groups}
    offsets = {name: target_heads[name] - donor_heads[name] for name in groups.values()
               if name in target_heads and name in donor_heads}
    for vertex in obj.data.vertices:
        shift = Vector()
        total = 0.0
        for member in vertex.groups:
            offset = offsets.get(groups[member.group])
            if offset is None or member.weight <= 0:
                continue
            shift += offset * member.weight
            total += member.weight
        if total > 1e-6:
            vertex.co += shift / total
    obj.data.update()


BARE_BONES = ('head', 'hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_')


def is_bare(bone):
    return any(bone.startswith(prefix) for prefix in BARE_BONES)


def cloth_tree(cloth):
    points, faces = [], []
    for obj in cloth:
        start = len(points)
        points += [v.co.copy() for v in obj.data.vertices]
        faces += [tuple(start + i for i in f.vertices) for f in obj.data.polygons]
    return BVHTree.FromPolygons(points, faces)


def skin_pokes(cloth, surface):
    """Точки кожи, прорвавшие одежду: снаружи ничего нет, а грань одежды — позади.

    Одежда редкая (грань сапога — в ладонь шириной), а тело густое; проверка
    одних вершин одежды пропускает кожу, выпирающую посреди грани.
    """
    tree = cloth_tree(cloth)
    pokes = {}
    for index, (point, normal) in enumerate(zip(surface.points, surface.normals)):
        if is_bare(surface.bone[index]):
            continue
        origin = point + normal * 0.0005
        if tree.ray_cast(origin, normal, 0.25)[0] is not None:
            continue
        behind = tree.ray_cast(origin, -normal, 0.05)[0]
        if behind is not None:
            pokes[index] = (point - behind).length
    return pokes


def inflate(cloth, surface, rounds=6, sigma=0.025):
    """Раздуть одежду гладким полем сдвига над телом.

    Каждой точке тела нужно, чтобы одежда над ней отстояла на зазор: либо
    вершина одежды рядом ближе зазора, либо кожа прорвала грань. Сдвиг точки
    одежды — это наибольшая из потребностей тела вокруг неё, ослабленная
    гауссом по расстоянию, вдоль средней нормали тела. Поле непрерывно в
    пространстве, поэтому ремень поверх куртки, пройма и верх рукава, пряжка
    и сапог двигаются одинаково: ни шипов, ни новых щелей между слоями.
    """
    radius = sigma * 2.5
    moved = set()
    largest = 0.0
    for _ in range(rounds):
        need = {}
        for obj in cloth:
            for vertex in obj.data.vertices:
                index, distance = surface.nearest(vertex.co, side_of(dominant_group(obj, vertex)))
                if distance < CLEARANCE:
                    need[index] = max(need.get(index, 0.0), CLEARANCE - distance)
        for index, depth in skin_pokes(cloth, surface).items():
            need[index] = max(need.get(index, 0.0), depth + CLEARANCE * 1.5)
        if not need or max(need.values()) <= 0.0005:
            break
        trees = {}
        for side, allowed in (('l', 'lc'), ('r', 'rc'), ('c', 'lrc')):
            indices = [i for i in need if surface.side[i] in allowed]
            tree = KDTree(len(indices))
            for i in indices:
                tree.insert(surface.points[i], i)
            tree.balance()
            trees[side] = tree
        for obj in cloth:
            for vertex in obj.data.vertices:
                strongest = 0.0
                direction = Vector()
                for _point, index, distance in trees[side_of(dominant_group(obj, vertex))].find_range(vertex.co, radius):
                    falloff = math.exp(-(distance * distance) / (2 * sigma * sigma))
                    strongest = max(strongest, need[index] * falloff)
                    direction += surface.normals[index] * need[index] * falloff
                if strongest <= 0.0002 or direction.length < 1e-9:
                    continue
                push = min(0.03, strongest)
                vertex.co += direction.normalized() * push
                moved.add((obj.name, vertex.index))
                largest = max(largest, push)
            obj.data.update()
    return len(moved), largest


def remaining_contacts(cloth, surface):
    """Итог примерки: точки кожи, прорвавшие одежду, и самая глубокая из них."""
    pokes = skin_pokes(cloth, surface)
    where = {}
    for index in pokes:
        where[surface.bone[index]] = where.get(surface.bone[index], 0) + 1
    if where:
        print('OUTFIT_POKES', sorted(where.items(), key=lambda kv: -kv[1])[:12], flush=True)
    return len(pokes), max(pokes.values(), default=0.0)


def strip_gloves(obj):
    """Перчатки набора сидят на ладонях тоньше наших — кисти остаются голыми."""
    bare = {v.index for v in obj.data.vertices if is_bare(dominant_group(obj, v)) and not dominant_group(obj, v) == 'head'}
    if not bare:
        return 0
    return rig.delete_faces(obj, lambda face, _material: all(v.index in bare for v in face.verts))


def normalise_weights(obj, armature):
    bones = {bone.name.lower(): bone.name for bone in armature.data.bones}
    for group in obj.vertex_groups:
        name = bones.get(group.name.lower())
        if name is None:
            raise RuntimeError(f'{obj.name}: bone {group.name} is not in the player rig')
        group.name = name
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    for vertex in obj.data.vertices:
        if not vertex.groups:
            raise RuntimeError(f'{obj.name}: unweighted vertex {vertex.index}')


def cut_at(obj, height, keep_above):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                           plane_co=Vector((0, 0, height)), plane_no=Vector((0, 0, 1)),
                           clear_inner=keep_above, clear_outer=not keep_above, dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def strip_extra_layers(obj):
    """Убрать запасные развёртки и цвета вершин: в игре рисуется одна текстура.

    Части набора несут по несколько UV-слоёв и слоёв цвета; после склейки они
    занимали больше половины файла, ничего не давая картинке.
    """
    mesh = obj.data
    while len(mesh.uv_layers) > 1:
        mesh.uv_layers.remove(mesh.uv_layers[-1])
    if mesh.uv_layers:
        # У частей развёртки названы по-разному; после склейки разные имена
        # снова дали бы несколько слоёв.
        mesh.uv_layers[0].name = 'UVMap'
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])
    mesh.update()


def weld(obj):
    """Сшить вершины, разрезанные экспортом по швам UV и жёстким рёбрам.

    Без этого сапог — тысяча отдельных клочков: упрощение не может слить
    плоские грани через разрез, а сдвиг рвёт шов. Нормали потом считаются
    заново по углу: форма после примерки уже не та, что у исходника.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.00001)
    bm.to_mesh(obj.data)
    bm.free()
    if obj.data.has_custom_normals:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(40))
    obj.data.update()


def decimate(obj, angle_degrees):
    """Упростить без искажения силуэта: слить почти плоские соседние грани.

    Схлопывание рёбер (COLLAPSE) до нужной доли рвало сапоги: ремешки и
    пряжки превращались в клочья. Слияние плоских граней не трогает изгибы.
    """
    modifier = obj.modifiers.new('realm_budget', 'DECIMATE')
    modifier.decimate_type = 'DISSOLVE'
    modifier.angle_limit = math.radians(angle_degrees)
    modifier.delimit = {'UV'}
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


LINER_BONES = ('spine_', 'pelvis', 'clavicle_', 'upperarm_', 'lowerarm_', 'thigh_', 'calf_')
LINER_OFFSET = 0.002


def sleeve_colour(cloth, image):
    """Средний цвет рубахи набора — по развёртке рукавов на текстуре."""
    width, height = image.size
    pixels = image.pixels[:]
    total = [0.0, 0.0, 0.0]
    count = 0
    for obj in cloth:
        if not obj['realm_part'].endswith('_Arms') or 'bracer' in obj.name.lower():
            continue
        uv = obj.data.uv_layers.active
        for loop in list(uv.data)[::7]:
            x = min(width - 1, max(0, int(loop.uv.x * width)))
            y = min(height - 1, max(0, int(loop.uv.y * height)))
            offset = (y * width + x) * 4
            for channel in range(3):
                total[channel] += pixels[offset + channel]
            count += 1
    if not count:
        raise RuntimeError('no sleeve to take the undershirt colour from')
    return [value / count for value in total]


def add_liner(body, colour, name):
    """Нижняя рубаха и кальсоны по форме нашего тела, на 2 мм над кожей.

    Одежда набора рассчитана на более узкую фигуру: у крупных тел между
    проймой куртки и рукавом остаётся щель, а на сгибах суставов тело
    выходит из-под ткани. Подкладка идёт за телом по тем же весам костей,
    поэтому в щелях и на сгибах видна рубаха, а не голая кожа. Кисти, голова,
    шея и ступни остаются открытыми.
    """
    liner = body.copy()
    liner.data = body.data.copy()
    bpy.context.collection.objects.link(liner)
    for modifier in list(liner.modifiers):
        liner.modifiers.remove(modifier)
    liner.parent = None
    liner.matrix_world = body.matrix_world.copy()
    liner.data.transform(liner.matrix_world)
    liner.matrix_world = Matrix.Identity(4)
    covered = {v.index for v in liner.data.vertices
               if any(dominant_group(liner, v).startswith(prefix) for prefix in LINER_BONES)}
    rig.delete_faces(liner, lambda face, _material: not all(v.index in covered for v in face.verts))
    liner.data.materials.clear()
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*colour, 1.0)
    material.diffuse_color = (*colour, 1.0)
    print('OUTFIT_LINER_COLOUR', [round(c, 3) for c in colour], flush=True)
    shader.inputs['Roughness'].default_value = 0.95
    shader.inputs['Metallic'].default_value = 0.0
    liner.data.materials.append(material)
    modifier = liner.modifiers.new('realm_liner_budget', 'DECIMATE')
    modifier.ratio = 0.3
    bpy.ops.object.select_all(action='DESELECT')
    liner.select_set(True)
    bpy.context.view_layer.objects.active = liner
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    liner.data.update()
    for vertex in liner.data.vertices:
        vertex.co += vertex.normal * LINER_OFFSET
    for polygon in liner.data.polygons:
        polygon.use_smooth = True
    liner.data.update()
    print('OUTFIT_LINER', rig.triangle_count(liner), 'tri', flush=True)
    strip_extra_layers(liner)
    liner['realm_part'] = 'undershirt'
    liner['realm_footwear'] = False
    return liner


def outfit_material(spec, sources):
    material = bpy.data.materials.get(spec['material'])
    if material:
        return material
    material = bpy.data.materials.new(spec['material'])
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Metallic'].default_value = 0.0
    shader.inputs['Roughness'].default_value = 0.85
    base = nodes.new('ShaderNodeTexImage')
    base.image = bpy.data.images.load(str(sources / TEXTURES_DIR / spec['base_color']))
    base.image.scale(1024, 1024)
    links.new(base.outputs['Color'], shader.inputs['Base Color'])
    normal_map = nodes.new('ShaderNodeNormalMap')
    normal = nodes.new('ShaderNodeTexImage')
    normal.image = bpy.data.images.load(str(sources / TEXTURES_DIR / spec['normal']))
    normal.image.colorspace_settings.name = 'Non-Color'
    normal.image.scale(512, 512)
    links.new(normal.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], shader.inputs['Normal'])
    return material


def build(item, body_id, sources):
    spec = OUTFITS[item]
    sex = 'female' if body_id.startswith('female_') else 'male'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    character = rig.import_gltf(ROOT / 'public/assets/models/characters/base' / f'character_{body_id}.glb')
    armature = next(o for o in character if o.type == 'ARMATURE')
    armature.data.pose_position = 'REST'
    if armature.animation_data:
        armature.animation_data_clear()
    body = next(o for o in character if o.type == 'MESH' and 'body_base' in o.name.lower())
    bpy.context.view_layer.update()
    surface = BodySurface(body)
    target_heads = world_heads(armature)
    material = outfit_material(spec, sources)

    cloth = []
    source_triangles = 0
    for part in spec['parts'][sex]:
        imported = rig.import_gltf(sources / PARTS_DIR / f'{part}.gltf')
        donor = next(o for o in imported if o.type == 'ARMATURE')
        donor.data.pose_position = 'REST'
        bpy.context.view_layer.update()
        donor_heads = world_heads(donor)
        for source in [o for o in imported if o.type == 'MESH' and not rig.mesh_is_helper(o)]:
            baked = rig.bake_rest_mesh(source)
            for modifier in list(baked.modifiers):
                baked.modifiers.remove(modifier)
            # Кисти рук в наборе — кожа тела набора; у нас кисти рисует своё тело.
            rig.delete_faces(baked, lambda _face, name: name in SKIN_MATERIALS)
            strip_gloves(baked)
            weld(baked)
            if not baked.data.polygons:
                bpy.data.objects.remove(baked, do_unlink=True)
                continue
            source_triangles += rig.triangle_count(baked)
            retarget(baked, donor_heads, target_heads)
            baked.data.materials.clear()
            baked.data.materials.append(material)
            strip_extra_layers(baked)
            baked['realm_part'] = part
            baked['realm_footwear'] = any(token in part for token in spec['footwear'])
            cloth.append(baked)
        for obj in imported:
            if bpy.context.scene.objects.get(obj.name) is obj:
                bpy.data.objects.remove(obj, do_unlink=True)

    for obj in cloth:
        # Тяжёлые части (сапоги — 9 тыс. треугольников на пару, женские наручи —
        # почти 3 тыс.) сливаются смелее, остальное — только почти плоское.
        decimate(obj, DISSOLVE_DEGREES * (2 if rig.triangle_count(obj) > 2500 else 1))
        print('OUTFIT_PART', obj['realm_part'], rig.triangle_count(obj), flush=True)

    moved, largest = inflate(cloth, surface)
    pokes, deepest = remaining_contacts(cloth, surface)
    print('OUTFIT_FIT', item, body_id, 'moved', moved, 'largestPush', round(largest, 4),
          'skinPokes', pokes, 'deepest', round(deepest, 4), flush=True)

    liner = add_liner(body, sleeve_colour(cloth, material.node_tree.nodes['Image Texture'].image),
                      spec['material'] + '_undershirt')
    footwear_parts = [o for o in cloth if o['realm_footwear']]
    shell_parts = [o for o in cloth if not o['realm_footwear']] + [liner]
    for boot in footwear_parts:
        shaft = boot.copy()
        shaft.data = boot.data.copy()
        bpy.context.collection.objects.link(shaft)
        cut_at(shaft, FOOTWEAR_CUT, True)
        cut_at(boot, FOOTWEAR_CUT, False)
        if shaft.data.polygons:
            shell_parts.append(shaft)
        else:
            bpy.data.objects.remove(shaft, do_unlink=True)
    shell = rig.join_objects(shell_parts, f'{item}_{body_id}_outfit_shell')
    footwear = rig.join_objects(footwear_parts, f'{item}_{body_id}_builtin_footwear')
    footwear['realm_armor_layer'] = 'builtin_footwear'
    shell['realm_armor_layer'] = 'shell'

    equipment = [shell, footwear]
    for obj in equipment:
        normalise_weights(obj, armature)
        obj.data.transform(armature.matrix_world.inverted())
        obj.parent = armature
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Identity(4)
        modifier = obj.modifiers.new('realm_player_rig', 'ARMATURE')
        modifier.object = armature
        modifier.use_vertex_groups = True
        for key in list(obj.keys()):
            if key.startswith('realm_') and key not in ('realm_armor_layer',):
                del obj[key]
        obj['realm_item_id'] = item
        obj['realm_body_id'] = body_id
        obj['realm_source_license'] = 'CC0-1.0'
        obj['realm_source_page'] = SOURCE_PAGE
    triangles = sum(rig.triangle_count(o) for o in equipment)
    if triangles > TRIANGLE_BUDGET:
        raise RuntimeError(f'{item} {body_id}: {triangles} triangles over budget')

    OUT.mkdir(parents=True, exist_ok=True)
    output = OUT / f'equipment_{item}_{body_id}.glb'
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    for obj in equipment:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
                              export_extras=True, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='JPEG', export_jpeg_quality=85, export_cameras=False,
                              export_lights=False, export_animations=False, export_skins=True,
                              export_morph=False)
    report = {
        'itemId': item, 'bodyId': body_id, 'file': output.name,
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size,
        'triangles': triangles, 'sourceTriangles': source_triangles, 'parts': list(spec['parts'][sex]),
        'fit': {'method': 'bone-retarget+body-anchored-inflation-v1', 'clearanceMetres': CLEARANCE,
                'movedVertices': moved, 'largestPushMetres': round(largest, 4),
                'skinPokes': pokes, 'deepestPokeMetres': round(deepest, 4), 'baseBodyHidden': False},
        'source': {'creator': 'Quaternius', 'pack': 'Modular Character Outfits - Fantasy (Standard)',
                   'page': SOURCE_PAGE, 'license': 'CC0-1.0', 'archiveSha256': SOURCE_SHA256},
    }
    (OUT / f'equipment_{item}_{body_id}.report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('OUTFIT_BUILT', output.name, triangles, 'tri', output.stat().st_size, 'bytes', flush=True)


def main():
    items = [arg('item')] if arg('item') else list(OUTFITS)
    bodies = [arg('body')] if arg('body') else list(BODY_IDS)
    with tempfile.TemporaryDirectory() as temp:
        sources = extract_sources(temp)
        for item in items:
            for body_id in bodies:
                build(item, body_id, sources)


if __name__ == '__main__':
    main()
