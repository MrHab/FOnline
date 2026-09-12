"""Build missing Kromka items from pinned CC0 donors, not runtime primitives."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import build_ground_item_library as materials

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / 'source-assets/items/free-catalog-v1'
SOURCES = {row['id']: row for row in json.loads((SOURCE_DIR / 'sources.json').read_text())['sources']}
ARTIFACTS = json.loads((ROOT / 'data/artifacts.json').read_text(encoding='utf8'))['types']
ITEMS = {row['id']: row for row in json.loads((ROOT / 'data/kromka/items.json').read_text(encoding='utf8'))['items']}
USED = set()
MAT_CACHE = {}
PIXELS = {}


def bounds(objects):
    points = [obj.matrix_world @ v.co for obj in objects for v in obj.data.vertices]
    return (Vector([min(p[a] for p in points) for a in range(3)]),
            Vector([max(p[a] for p in points) for a in range(3)]))


def color_hex(value):
    return tuple(int(value.lstrip('#')[i:i+2], 16) / 255 for i in (0,2,4))


def mat(color, metal=.25, glow=0):
    key = (tuple(round(c, 3) for c in color), metal, glow)
    if key in MAT_CACHE:
        return MAT_CACHE[key]
    name = 'ITEM_WORN_' + hashlib.sha256(str(key).encode()).hexdigest()[:10]
    result = materials.pbr_material(name, color, .69 if metal else .88, metal)
    shader = next(n for n in result.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    if glow:
        shader.inputs['Emission Color'].default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = glow
    MAT_CACHE[key] = result
    return result


def face_color(obj, face):
    original = obj.data.materials[face.material_index] if face.material_index < len(obj.data.materials) else None
    color = (.45, .45, .45)
    if original:
        color = tuple(original.diffuse_color[:3])
        if original.use_nodes:
            shader = next((n for n in original.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if shader:
                color = tuple(shader.inputs['Base Color'].default_value[:3])
                links = shader.inputs['Base Color'].links
                texture = links[0].from_node if links else None
                if texture and texture.type == 'TEX_IMAGE' and texture.image and obj.data.uv_layers.active:
                    image = texture.image
                    if image.name not in PIXELS:
                        PIXELS[image.name] = list(image.pixels[:])
                    pixels = PIXELS[image.name]
                    uv = sum((obj.data.uv_layers.active.data[index].uv for index in face.loop_indices), Vector((0,0))) / len(face.loop_indices)
                    x, y = int((uv.x % 1) * image.size[0]), int((uv.y % 1) * image.size[1])
                    index = (y * image.size[0] + x) * 4
                    if index + 3 < len(pixels):
                        color = tuple(pixels[index:index+3])
    return color


def finish_materials(obj, theme, artifact=False):
    colors = [face_color(obj, face) for face in obj.data.polygons]
    choices = []
    for color in colors:
        value = max(color)
        saturation = value - min(color)
        if artifact:
            crystal = 'rock_crystals' in obj.get('realm_source_id','')
            accent = color[1] > color[0] * 1.15 if crystal else saturation > .15
            chosen = mat(tuple(c * (.52 if accent else .17) for c in theme), .42, .20 if accent else .015)
        elif value < .23:
            chosen = mat((.037, .043, .042), .1)
        elif saturation > .20:
            chosen = mat(theme, .22)
        elif value > .68:
            chosen = mat((.55, .51, .40), .22)
        else:
            chosen = mat((.18, .205, .20), .62)
        choices.append(chosen)
    obj.data.materials.clear()
    indices = {}
    for face, material in zip(obj.data.polygons, choices):
        if material.name not in indices:
            indices[material.name] = len(obj.data.materials)
            obj.data.materials.append(material)
        face.material_index = indices[material.name]
    if obj.data.polygons:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=.02)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)


def donor(source_id, parent, size, position=(0,0,0), rotation=(0,0,0), theme=(.2,.28,.18), artifact=False):
    source = SOURCES[source_id]
    file = SOURCE_DIR / source['file']
    if hashlib.sha256(file.read_bytes()).hexdigest().upper() != source['sha256']:
        raise RuntimeError('Source hash changed: ' + source_id)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(file))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    visible = [obj for obj in imported if not any(c.name.startswith('glTF_not_exported') for c in obj.users_collection)]
    for obj in imported:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = True
    if source_id == 'spring':
        # Use the real fully extended bounce pose before baking the source skin.
        for obj in imported:
            if obj.animation_data:
                for track in obj.animation_data.nla_tracks:
                    track.mute = 'Bounce' not in track.name
        best_frame, best_height = 1, 0
        for frame in (1, 6, 12, 18, 24, 30):
            bpy.context.scene.frame_set(frame)
            meshes = [obj.evaluated_get(bpy.context.evaluated_depsgraph_get()) for obj in visible if obj.type == 'MESH']
            low, high = bounds(meshes)
            if high.z - low.z > best_height:
                best_frame, best_height = frame, high.z - low.z
        bpy.context.scene.frame_set(best_frame)
    bpy.context.view_layer.update()
    meshes = []
    rotate = Matrix.Rotation(math.radians(rotation[2]), 4, 'Z') @ Matrix.Rotation(math.radians(rotation[1]), 4, 'Y') @ Matrix.Rotation(math.radians(rotation[0]), 4, 'X')
    for obj in visible:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        data = bpy.data.meshes.new_from_object(evaluated)
        data.transform(rotate @ obj.matrix_world)
        model = bpy.data.objects.new(f'Donor_{source_id}_{len(meshes)}', data)
        bpy.context.collection.objects.link(model)
        model['realm_source_id'] = source_id
        model['realm_source_sha256'] = source['sha256']
        meshes.append(model)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    low, high = bounds(meshes)
    extent = high - low
    center = (low + high) * .5
    # All derivatives are metres in a shared upright frame. Nonuniform fitting
    # is intentional for handheld housings and retains the source topology.
    fit = Vector([size[a] / max(extent[a], .00001) for a in range(3)])
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertex.co = Vector([(vertex.co[a] - center[a]) * fit[a] + position[a] for a in range(3)])
        obj.parent = parent
        finish_materials(obj, theme, artifact)
    USED.add(source_id)
    return meshes


def socket(root, name, location):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent, obj.location = root, location
    return obj


def strap(root, radius_x=.18, radius_y=.115, height=.065):
    # Authored connective leather strap; the visible canisters are CC0 donors.
    points = []
    for z in (-height/2, height/2):
        for thickness in (-.008, .008):
            for i in range(48):
                a = i * math.tau/48
                points.append(((radius_x+thickness)*math.cos(a), (radius_y+thickness)*math.sin(a), z))
    faces = []
    for i in range(48):
        n = (i+1)%48
        for a,b in ((0,48),(48,144),(144,96),(96,0)):
            faces.append((a+i,a+n,b+n,b+i))
    mesh = bpy.data.meshes.new('WornLeatherBelt')
    mesh.from_pydata(points, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('WornLeatherBelt', mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(mat((.14,.08,.035), 0))
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=.02)
    bpy.ops.object.mode_set(mode='OBJECT')


def build(item_id, root):
    if item_id.startswith('artifactBelt'):
        count = int(item_id[-1])
        strap(root)
        for i in range(count):
            angle = math.radians(-145 + i * 110 / max(count-1,1))
            donor('station-container-flat', root, (.065,.065,.095),
                  (.20*math.cos(angle), .137*math.sin(angle), -.025), theme=(.22,.29,.15))
        socket(root, 'socket_waist', (0,0,0))
    elif item_id.startswith('artifactDetector'):
        level = int(item_id[-1])
        theme = [( .29,.25,.13),(.18,.29,.20),(.13,.24,.31)][level-1]
        if level == 1:
            donor('radio', root, (.16,.065,.21), theme=theme)
        elif level == 2:
            donor('space-machine_wireless', root, (.16,.08,.24), rotation=(0,0,180), theme=theme)
        else:
            donor('station-computer-screen', root, (.17,.075,.22), rotation=(0,0,180), theme=theme)
            donor('station-container-flat', root, (.065,.065,.065), (0,.03,-.105), theme=theme)
        socket(root, 'socket_grip_r', (0,.03,-.055))
        socket(root, 'socket_belt_clip', (0,.035,.02))
    elif item_id == 'artifactContainer':
        donor('station-container', root, (.18,.18,.29), theme=(.30,.33,.29))
    elif item_id == 'blue':
        donor('station-wall-switch', root, (.13,.065,.22), theme=(.06,.20,.39))
        donor('gem-pink', root, (.04,.028,.09), (0,-.037,.02), theme=(.04,.36,.8), artifact=True)
    elif item_id == 'medkit':
        donor('medkit', root, (.30,.12,.25), theme=(.20,.32,.15))
        socket(root, 'socket_grip_r', (0,0,.118))
    elif item_id == 'artifactUnknown':
        donor('space-meteor_detailed', root, (.27,.24,.24), theme=(.23,.28,.32), artifact=True)
        root['realm_presentation_only'] = True
    else:
        definition = next(row for row in ARTIFACTS if row['itemId'] == item_id)
        color = color_hex(definition['color'])
        spec = {
            'spring': ('spring',(.22,.22,.34)),
            'vein': ('space-rock_crystalsLargeA',(.40,.20,.22)),
            'node': ('space-pipe_cross',(.27,.27,.20)),
            'drop': ('gem-green',(.19,.16,.30)),
            'bloodkin': ('heart',(.25,.16,.28)),
            'shell': ('space-meteor_half',(.35,.28,.18)),
            'warmer': ('space-meteor_detailed',(.25,.25,.25)),
            'sieve': ('space-pipe_ringHigh',(.26,.24,.16)),
            'thunderer': ('space-machine_generator',(.28,.23,.30)),
            'husher': ('space-rock',(.28,.18,.21)),
            'anchor': ('anchor',(.25,.16,.30)),
            'dew': ('space-rock_crystals',(.26,.22,.18)),
            'memory': ('gem-pink',(.20,.16,.33))
        }[definition['id']]
        rotation = (90,0,0) if definition['id'] == 'anchor' else (0,0,0)
        donor(spec[0], root, spec[1], rotation=rotation, theme=color, artifact=True)
        root['realm_artifact_type'] = definition['id']
        root['realm_artifact_color'] = definition['color']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/models/items/kromka')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    ids = ['artifactDetectorMk1','artifactDetectorMk2','artifactDetectorMk3',
           'artifactBelt2','artifactBelt3','artifactBelt4','artifactContainer','blue','medkit'] + [row['itemId'] for row in ARTIFACTS] + ['artifactUnknown']
    rows = []
    materials.TEXTURE_SIZE = 64
    for item_id in ids:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        USED.clear(); MAT_CACHE.clear(); PIXELS.clear()
        root = bpy.data.objects.new('item_' + item_id, None)
        bpy.context.collection.objects.link(root)
        root['realm_item_id'] = item_id
        root['realm_schema'] = 'realm.free-item-runtime.v1'
        root['realm_model_revision'] = 1
        root['realm_source_license'] = 'CC0-1.0'
        build(item_id, root)
        meshes = [obj for obj in root.children_recursive if obj.type == 'MESH']
        bpy.context.view_layer.update()
        low, high = bounds(meshes)
        triangles = 0
        for obj in meshes:
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
        if triangles > 12000 or not USED:
            raise RuntimeError(f'{item_id}: invalid model budget or missing donor')
        file = args.output / ('item_' + item_id + '.glb')
        bpy.ops.object.select_all(action='DESELECT')
        root.select_set(True)
        for obj in root.children_recursive:
            obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(file), export_format='GLB', use_selection=True,
            export_extras=True, export_yup=True, export_animations=False, export_skins=False,
            export_cameras=False, export_lights=False, export_materials='EXPORT', export_image_format='AUTO')
        rows.append({'id':item_id,'name':ITEMS[item_id]['name'] if item_id in ITEMS else 'Нераспознанный артефакт',
            'presentationOnly': item_id == 'artifactUnknown',
            'file':'/assets/models/items/kromka/' + file.name,
            'sha256':hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes':file.stat().st_size,
            'triangles':triangles,'meshes':len(meshes), 'bounds':{'min':list(low),'max':list(high)},
            'sources':[{'id':s,'sha256':SOURCES[s]['sha256'],'page':SOURCES[s]['page'], 'creator':SOURCES[s]['creator']} for s in sorted(USED)],
            'modifications':['metre-scale fitting','static rest-pose bake','worn PBR materials'] + (['authored leather connecting strap'] if item_id.startswith('artifactBelt') else []),
            'sockets':[obj.name for obj in root.children_recursive if obj.name.startswith('socket_')]})
    fingerprint = hashlib.sha256(''.join(row['sha256'] for row in rows).encode()).hexdigest()[:8]
    (args.output / 'manifest.json').write_text(json.dumps({'schema':'realm.free-item-catalog.v1',
        'version':'1-'+fingerprint,'license':'CC0-1.0 + project-authored adaptations',
        'generator':'tools/blender/build_free_item_models.py','files':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'FREE_ITEM_BUILD={len(rows)} models; fingerprint 1-{fingerprint}')


if __name__ == '__main__':
    main()
