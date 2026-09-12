"""Isolate downloaded modular gear for a visual selection sheet; not runtime output."""
import json
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'unity-client/Temp/FreeEquipmentSources'
SOURCES = ROOT / 'Build/SourceDownloads/free-armor-replacements-20260908'
selections = [
    ('swat-head','quaternius_male_swat.gltf','Swat_Head'),
    ('spacesuit-head','quaternius_male_spacesuit.gltf','SpaceSuit_Head'),
    ('swat-feet','quaternius_male_swat.gltf','Swat_Feet'),
    ('soldier-feet','quaternius_female_soldier.gltf','Soldier_Feet'),
    ('scifi-feet','quaternius_female_scifi.gltf','SciFi_Feet'),
    ('spacesuit-feet','quaternius_male_spacesuit.gltf','SpaceSuit_Feet'),
    ('punk-feet','quaternius_male_punk.gltf','Punk_Feet'),
]
OUT.mkdir(parents=True,exist_ok=True)
rows=[]
for name,file,mesh_name in selections:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    imported = rig.import_gltf(SOURCES/file)
    for obj in imported:
        if obj.type=='ARMATURE':
            obj.data.pose_position='REST'
            if obj.animation_data: obj.animation_data_clear()
    bpy.context.view_layer.update()
    source=next(obj for obj in imported if obj.name==mesh_name)
    mesh=rig.bake_rest_mesh(source)
    print('SOURCE_MATERIAL_BOUNDS',name)
    for index, material in enumerate(mesh.data.materials):
        points=[mesh.data.vertices[i].co for face in mesh.data.polygons if face.material_index==index for i in face.vertices]
        if points:
            low,high=rig.bounds(points)
            print(material.name,tuple(round(x,4) for x in low),tuple(round(x,4) for x in high))
    if name=='punk-feet': rig.delete_faces(mesh,lambda face,material:material=='skin')
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_skins=False,export_animations=False)
    rows.append({'id':name,'file':name+'.glb'})
(OUT/'manifest.json').write_text(json.dumps({'files':rows},indent=2),encoding='utf8')
