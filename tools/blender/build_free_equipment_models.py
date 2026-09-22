"""Refit downloaded equipment to the current six player rigs.

Builds a separate runtime candidate catalog. It does not overwrite reviewed v1
assets or pretend a generated file has already passed the Unity fitting probe.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
import build_free_item_models as items
import build_free_armor_replacements as rig

ROOT = Path(__file__).resolve().parents[2]
BODIES = rig.RUNTIME_BODY_IDS
GEAR_DIR = ROOT / 'source-assets/equipment/free-gear-v2'
GEAR_SOURCES = {r['id']:r for r in json.loads((GEAR_DIR/'sources.json').read_text())['sources']}
GEAR = {
    'helmet': ('helmet','soldier-helmet','Head','equipment_steel_helmet',(.27,.29,.19)),
    'tacticalHelmet': ('helmet','swat','Swat_Head','equipment_tactical_helmet',(.16,.20,.15)),
    'assaultHelmet': ('helmet','swat','Swat_Head','equipment_assault_helmet',(.17,.18,.17)),
    'preWarHelmet': ('helmet','spacesuit','SpaceSuit_Head','equipment_prewar_helmet',(.27,.30,.29)),
    'weldedHelmet': ('helmet','bucket-helmet','*','equipment_welded_helmet',(.27,.23,.18)),
    'boots': ('boots','swat','Swat_Feet','equipment_boots',(.17,.13,.08)),
    'scoutBoots': ('boots','soldier-boots','Soldier_Feet','equipment_scout_boots',(.23,.22,.14)),
    'reinforcedBoots': ('boots','scifi-boots','SciFi_Feet','equipment_reinforced_boots',(.24,.25,.21)),
    'assaultBoots': ('boots','spacesuit','SpaceSuit_Feet','equipment_assault_boots',(.17,.20,.15)),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    items.USED.clear(); items.MAT_CACHE.clear(); items.PIXELS.clear()


def world_skin(obj, armature, body_tree=None, body_weights=None, sample_weights=None, sample_vertex_weights=None):
    """Bind world-space geometry once, without retaining a second donor skeleton."""
    obj.vertex_groups.clear()
    groups = {}
    for vertex in obj.data.vertices:
        weights = sample_vertex_weights(vertex) if sample_vertex_weights else sample_weights(vertex.co) if sample_weights else [('head',1.0)] if body_tree is None else body_weights[body_tree.find(vertex.co)[1]]
        total = sum(weight for name,weight in weights)
        for name,weight in weights:
            if name not in groups: groups[name] = obj.vertex_groups.new(name=name)
            groups[name].add([vertex.index],weight/max(total,.000001),'REPLACE')
    obj.data.transform(armature.matrix_world.inverted())
    obj.parent = armature
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Identity(4)
    modifier = obj.modifiers.new('PlayerRig','ARMATURE')
    modifier.object = armature


def surface_weight_sampler(body, points, weights, triangles=None):
    """Interpolate skin weights across a surface, not isolated nearest vertices."""
    if triangles is None:
        body.data.calc_loop_triangles()
        triangles=[tuple(t.vertices) for t in body.data.loop_triangles]
    bvh=BVHTree.FromPolygons(points,triangles,all_triangles=True)
    def sample(point):
        hit,_,index,_=bvh.find_nearest(point)
        ids=triangles[index]
        a,b,c=(points[i] for i in ids)
        ab,ac,ap=b-a,c-a,hit-a
        aa,bb,cc=ab.dot(ab),ab.dot(ac),ac.dot(ac)
        denominator=max(aa*cc-bb*bb,1e-15)
        v=(cc*ap.dot(ab)-bb*ap.dot(ac))/denominator
        w=(aa*ap.dot(ac)-bb*ap.dot(ab))/denominator
        combined={}
        for vertex,factor in zip(ids,(1-v-w,v,w)):
            for name,weight in weights[vertex]:
                combined[name]=combined.get(name,0)+weight*max(0,factor)
        return sorted(combined.items(),key=lambda row:row[1],reverse=True)[:4]
    return sample


def gear_materials(obj, theme, slot):
    old_names = [m.name.lower() for m in obj.data.materials]
    old_indices = [p.material_index for p in obj.data.polygons]
    # Reuse the UV/texture generator but choose semantic finishes for gear.
    items.finish_materials(obj, theme)
    palette = [items.mat(theme,.45 if slot=='helmet' else .10),
        items.mat((.035,.041,.039),.15),items.mat((.24,.25,.23),.68),
        items.mat((.11,.17,.19),.65)]
    obj.data.materials.clear()
    for mat in palette: obj.data.materials.append(mat)
    for face,index in zip(obj.data.polygons,old_indices):
        name=old_names[index] if index<len(old_names) else ''
        face.material_index = 3 if 'visor' in name else 2 if any(t in name for t in ('metal','grey','lightsteel')) else 1 if 'black' in name and slot=='boots' else 0


def fit_boot(boot, desired, body, armature, side, subdivision_cuts=2):
    """Fit the forefoot and shaft separately, then clear the actual skin surface.

    A single AABB squash makes the flat donor feet shorter than the player's
    instep. Nearest-vertex normals also push a sunken upper onto the sole. Use
    a foot-height landmark and outward rays from the player's leg/foot axis.
    Subdivision preserves the donor silhouette while giving large flat faces
    enough vertices to fit around the toes instead of cutting through them.
    """
    source_low, source_high = rig.bounds(v.co for v in boot.data.vertices)
    front_limit = source_low.y + (source_high.y-source_low.y)*.35
    source_roof = max(v.co.z for v in boot.data.vertices if v.co.y < front_limit)
    source_pivot = source_roof + .012
    body_points = rig.evaluated_points(body)
    foot_points = [p for p in body_points if p.x*side>0 and p.z<.20]
    foot_low, foot_high = rig.bounds(foot_points)
    target_front = foot_low.y + (foot_high.y-foot_low.y)*.35
    target_pivot = max(p.z for p in foot_points if p.y<target_front)+.028
    z_min = foot_low.z-.012
    z_max = desired[1].z
    rig.fit_mesh(boot,(source_low,source_high),desired,(1,1,1))
    mapped_pivot = desired[0].z+(source_pivot-source_low.z)/(source_high.z-source_low.z)*(z_max-desired[0].z)
    for vertex in boot.data.vertices:
        z=vertex.co.z
        vertex.co.z = z_min+(z-desired[0].z)/(mapped_pivot-desired[0].z)*(target_pivot-z_min) if z<=mapped_pivot else target_pivot+(z-mapped_pivot)/(z_max-mapped_pivot)*(z_max-target_pivot)
    bm=bmesh.new();bm.from_mesh(boot.data)
    bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=subdivision_cuts,use_grid_fill=True)
    bm.to_mesh(boot.data);bm.free()
    faces=[tuple(p.vertices) for p in body.data.polygons]
    bvh=BVHTree.FromPolygons(body_points,faces)
    # The player's toes fan out from the rig's straight foot bone. A convex
    # footwear envelope follows that fan without copying individual toe bumps.
    hull=bmesh.new()
    for point in foot_points: hull.verts.new(point)
    bmesh.ops.convex_hull(hull,input=list(hull.verts),use_existing_faces=False)
    hull.verts.index_update()
    foot_bvh=BVHTree.FromPolygons([v.co.copy() for v in hull.verts],
        [tuple(v.index for v in f.verts) for f in hull.faces])
    hull.free()
    suffix='l' if side>0 else 'r'
    ankle=armature.matrix_world @ armature.data.bones['foot_'+suffix].head_local
    toe_low,toe_high=rig.bounds(p for p in foot_points if p.y<target_front)
    toe=(toe_low+toe_high)*.5
    calf=armature.matrix_world @ armature.data.bones['calf_'+suffix].head_local
    # Keep the ray origins inside the sole volume even near the toe tip.
    toe.z=max(toe.z,.025)
    segments=[(ankle,toe),(ankle,calf)]
    def closest(a,b,p):
        direction=b-a
        return a+direction*max(0,min(1,(p-a).dot(direction)/direction.length_squared))
    for vertex in boot.data.vertices:
        point=vertex.co
        origin=min((closest(a,b,point) for a,b in segments),key=lambda q:(point-q).length_squared)
        direction=(point-origin).normalized()
        envelope=foot_bvh if point.z<.16 else bvh
        hit,normal,_,distance=envelope.ray_cast(origin,direction,.4)
        if hit is not None:
            # A radial offset also protects faceted triangles between samples.
            radial_clearance=.016/max(.4,abs(normal.dot(direction)))
            vertex.co=origin+direction*max((point-origin).length,distance+radial_clearance)
    boot.data.update()


def gear_variant(item_id, body_id, destination, review):
    reset()
    slot,source_id,selection,reference_prefix,theme=GEAR[item_id]
    source=GEAR_SOURCES[source_id]
    source_file=GEAR_DIR/source['file']
    if hashlib.sha256(source_file.read_bytes()).hexdigest().upper()!=source['sha256']:
        raise RuntimeError('Source hash changed: '+source_id)
    before=set(bpy.context.scene.objects)
    if source_file.suffix=='.fbx':
        bpy.ops.import_scene.fbx(filepath=str(source_file),use_anim=False)
    else:
        bpy.ops.import_scene.gltf(filepath=str(source_file))
    imported=[obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in imported:
        if obj.type=='ARMATURE': obj.data.pose_position='REST'
        if obj.animation_data: obj.animation_data_clear()
    bpy.context.view_layer.update()
    selected=[obj for obj in imported if obj.type=='MESH' and not rig.mesh_is_helper(obj)
        and (selection=='*' or obj.name.split('.')[0]==selection)]
    if not selected: raise RuntimeError(f'{source_id}: empty gear mesh selection {selection}')
    original_triangles=sum(rig.triangle_count(obj) for obj in selected)
    baked=[rig.bake_rest_mesh(obj) for obj in selected]
    for obj in imported: bpy.data.objects.remove(obj,do_unlink=True)
    gear=rig.join_objects(baked,'DownloadedGear')
    # Source neck stumps are not part of a helmet. The SWAT tactical variant is
    # an open crown; the assault variant retains its visor and lower face armor.
    low,high=rig.bounds(v.co for v in gear.data.vertices)
    removed=0
    if item_id=='assaultHelmet':
        removed=rig.delete_faces(gear,lambda f,m:f.calc_center_median().z<1.56)
    elif item_id=='tacticalHelmet':
        removed=rig.delete_faces(gear,lambda f,m:m!='swat_black' or f.calc_center_median().z<1.66)
    elif item_id=='preWarHelmet':
        removed=rig.delete_faces(gear,lambda f,m:f.calc_center_median().z<1.54)
    elif item_id=='reinforcedBoots':
        removed=rig.delete_faces(gear,lambda f,m:f.calc_center_median().z>.375)
    character_file=ROOT/f'public/assets/models/characters/base/character_{body_id}.glb'
    character_objects=rig.import_gltf(character_file)
    armature=next(obj for obj in character_objects if obj.type=='ARMATURE')
    armature.data.pose_position='REST'
    if armature.animation_data: armature.animation_data_clear()
    body=next(obj for obj in character_objects if obj.type=='MESH' and 'body_base' in obj.name)
    bpy.context.view_layer.update()
    tree,body_points,normals,weights=rig.target_skin_data(body)
    sample_weights=surface_weight_sampler(body,body_points,weights)
    outputs=[]
    if slot=='helmet':
        head_points=[body.matrix_world @ v.co for v in body.data.vertices if v.groups
            and body.vertex_groups[max(v.groups,key=lambda g:g.weight).group].name=='head']
        target_low,target_high=rig.bounds(head_points)
        target_low-=Vector((.016,.014,.003))
        target_high+=Vector((.016,.014,.022))
        if item_id in ('helmet','tacticalHelmet'):
            target_low.z=target_low.z+(target_high.z-target_low.z)*.46
        source_bounds=rig.bounds(v.co for v in gear.data.vertices)
        rig.fit_mesh(gear,source_bounds,(target_low,target_high),(1,1,1))
        rig.conform_outside_body(gear,tree,body_points,normals,.012)
        gear_materials(gear,theme,slot)
        world_skin(gear,armature)
        outputs=[gear]
    else:
        reference_file=ROOT/f'public/assets/models/equipment/boots/{reference_prefix}_{body_id}.glb'
        reference_objects=rig.import_gltf(reference_file)
        for obj in reference_objects:
            if obj.type=='ARMATURE': obj.data.pose_position='REST'
            if obj.animation_data: obj.animation_data_clear()
        bpy.context.view_layer.update()
        reference_points=[p for obj in reference_objects if obj.type=='MESH' and not rig.mesh_is_helper(obj) for p in rig.evaluated_points(obj)]
        for side in (-1,1):
            boot=gear.copy();boot.data=gear.data.copy()
            bpy.context.collection.objects.link(boot)
            rig.delete_faces(boot,lambda f,m:f.calc_center_median().x*side<0)
            source_bounds=rig.bounds(v.co for v in boot.data.vertices)
            desired=rig.bounds(p for p in reference_points if p.x*side>0)
            fit_boot(boot,desired,body,armature,side)
            gear_materials(boot,theme,slot)
            world_skin(boot,armature,tree,weights,sample_weights)
            outputs.append(boot)
        bpy.data.objects.remove(gear,do_unlink=True)
        for obj in reference_objects: bpy.data.objects.remove(obj,do_unlink=True)
    for i,obj in enumerate(outputs):
        obj.name=f'free_{item_id}_{body_id}_downloaded_{i}'
        obj['realm_item_id']=item_id
        obj['realm_body_id']=body_id
        obj['realm_equipment_slot']=slot
        obj['realm_source_page']=source['page']
        obj['realm_source_sha256']=source['sha256']
        obj['realm_source_license']='CC0-1.0'
        obj['realm_geometry_origin']='downloaded_refit'
    rig.decimate_objects(outputs,11000)
    file=destination/f'equipment_{item_id}_{body_id}.glb'
    rig.export_review(file,armature,outputs)
    row={'itemId':item_id,'bodyId':body_id,'slot':slot,
        'file':'/assets/models/equipment/free-v2/'+file.name,
        'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size,
        'triangles':sum(rig.triangle_count(obj) for obj in outputs),'meshes':len(outputs),'joints':len(armature.data.bones),
        'source':{'id':source_id,'page':source['page'],'creator':source['creator'],'file':source['file'],
            'sha256':source['sha256'],'license':'CC0-1.0'},
        'sourceSelection':selection,'sourceSelectedTriangles':original_triangles,'removedSourceFaces':removed,
        'fitReference':{'file':str(character_file.relative_to(ROOT)).replace('\\','/'),
            'sha256':hashlib.sha256(character_file.read_bytes()).hexdigest()},
        'modifications':['equipment-only isolation','metre-scale body fitting','worn PBR materials','65-bone skin transfer']}
    if slot=='boots':
        row['fittingReferences']=[{'file':str(reference_file.relative_to(ROOT)).replace('\\','/'),
            'sha256':hashlib.sha256(reference_file.read_bytes()).hexdigest()}]
        row['modifications']+=['independent forefoot height fitting','subdivided donor surface','toe envelope clearance']
    if review and body_id=='male_medium':
        rig.prepare_review_body(character_objects)
        for obj in character_objects:
            if obj.type=='MESH' and (rig.mesh_is_helper(obj) or (slot=='helmet' and 'hair' in obj.name)):
                obj.hide_render=True
        review.mkdir(parents=True,exist_ok=True)
        bb=rig.bounds(rig.evaluated_points(body))
        rig.render_review(review/f'{item_id}_{body_id}_front.png',bb,'front')
        rig.render_review(review/f'{item_id}_{body_id}_back.png',bb,'back')
    return row


def backpack(body_id, destination, review):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    items.USED.clear(); items.MAT_CACHE.clear(); items.PIXELS.clear()
    reference = ROOT / f'public/assets/models/equipment/backpack/equipment_backpack_{body_id}.glb'
    imported = rig.import_gltf(reference)
    armature = next(obj for obj in imported if obj.type == 'ARMATURE')
    armature.data.pose_position = 'REST'
    if armature.animation_data:
        armature.animation_data_clear()
    meshes = [obj for obj in imported if obj.type == 'MESH' and not rig.mesh_is_helper(obj)]
    harness = next(obj for obj in meshes if obj.get('realm_backpack_layer') == 'harness')
    old_pack = next(obj for obj in meshes if obj.get('realm_backpack_layer') == 'pack')
    bpy.context.view_layer.update()
    # Fit the sack itself, not the old frame/blanket/handle envelope that extends
    # above the shoulders and below the waist.
    evaluated = old_pack.evaluated_get(bpy.context.evaluated_depsgraph_get())
    sack_points = [evaluated.matrix_world @ evaluated.data.vertices[index].co
        for face in evaluated.data.polygons
        if evaluated.data.materials[face.material_index].name.startswith('backpack_faded_olive_canvas')
        for index in face.vertices]
    low, high = rig.bounds(sack_points)
    extent, center = high - low, (high + low) * .5
    extent.x *= .88
    bpy.data.objects.remove(old_pack, do_unlink=True)
    holder = bpy.data.objects.new('SourceBackpack', None)
    bpy.context.collection.objects.link(holder)
    # Keep the already fitted shoulder/chest harness; replace the entire visible sack.
    downloaded = items.donor('backpack', holder, tuple(extent), tuple(center),
        rotation=(0,0,180), theme=(.26,.29,.16))
    for obj in downloaded:
        obj.parent = armature
        obj.matrix_parent_inverse = armature.matrix_world.inverted()
        obj.name = f'free_backpack_{body_id}_downloaded_sack'
        for bone, weight in [('spine_02', .42), ('spine_03', .58)]:
            group = obj.vertex_groups.new(name=bone)
            group.add(list(range(len(obj.data.vertices))), weight, 'REPLACE')
        modifier = obj.modifiers.new('CharacterRig', 'ARMATURE')
        modifier.object = armature
        obj['realm_backpack_layer'] = 'pack'
    bpy.data.objects.remove(holder, do_unlink=True)
    equipment = [harness] + downloaded
    source = items.SOURCES['backpack']
    for obj in [armature] + equipment:
        for key in list(obj.keys()):
            if 'approved' in key or 'approval' in key or key in ('realm_runtime_integration_allowed','realm_review_only','realm_preview_only'):
                del obj[key]
        obj['realm_item_id'] = 'backpack'
        obj['realm_body_id'] = body_id
        obj['realm_equipment_slot'] = 'backpack'
        obj['realm_source_page'] = source['page']
        obj['realm_source_sha256'] = source['sha256']
        obj['realm_source_license'] = 'CC0-1.0'
        obj['realm_geometry_origin'] = 'retained_fitted_harness' if obj == harness else 'downloaded_refit'
    file = destination / f'equipment_backpack_{body_id}.glb'
    rig.export_review(file, armature, equipment)
    triangles = sum(rig.triangle_count(obj) for obj in equipment)
    if triangles > 12000:
        raise RuntimeError(f'backpack {body_id}: triangle budget exceeded')
    row = {'itemId':'backpack','bodyId':body_id,'slot':'backpack',
        'file':'/assets/models/equipment/free-v2/' + file.name,
        'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size,
        'triangles':triangles,'meshes':len(equipment),'joints':len(armature.data.bones),
        'source':{'id':'backpack','page':source['page'],'creator':source['creator'],
                  'sha256':source['sha256'],'license':'CC0-1.0'},
        'retainedReference':{'file':str(reference.relative_to(ROOT)).replace('\\','/'),
            'sha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'parts':['body-fitted shoulder/chest harness']},
        'modifications':['metre-scale body fitting','worn PBR materials','65-bone skin, shared spine weights for whole sack']}
    if review:
        body_objects = rig.import_gltf(ROOT / f'public/assets/models/characters/base/character_{body_id}.glb')
        rig.prepare_review_body(body_objects)
        for obj in body_objects:
            if obj.type == 'MESH' and rig.mesh_is_helper(obj): obj.hide_render = True
        body = next(obj for obj in body_objects if obj.type == 'MESH' and 'body_base' in obj.name)
        character_bounds = rig.bounds(rig.evaluated_points(body))
        review.mkdir(parents=True, exist_ok=True)
        rig.render_review(review / f'backpack_{body_id}_back.png', character_bounds, 'back')
        if body_id == 'male_medium':
            rig.render_review(review / f'backpack_{body_id}_front.png', character_bounds, 'front')
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/models/equipment/free-v2')
    parser.add_argument('--review', type=Path)
    parser.add_argument('--body',choices=BODIES)
    parser.add_argument('--item',choices=['backpack']+list(GEAR),action='append')
    parser.add_argument('--merge',action='store_true',help='Keep verified untouched rows when iterating on a subset')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.output = (ROOT / args.output).resolve()
    if args.review: args.review = (ROOT / args.review).resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    previous=[]
    if args.merge:
        previous=json.loads((args.output/'manifest.json').read_text(encoding='utf8'))['files']
    items.materials.TEXTURE_SIZE = 64
    bodies=[args.body] if args.body else BODIES
    selected=args.item or ['backpack']+list(GEAR)
    rows = [backpack(body, args.output, args.review) for body in bodies] if 'backpack' in selected else []
    rows += [gear_variant(item,body,args.output,args.review) for item in GEAR if item in selected for body in bodies]
    if args.merge:
        generated={(row['itemId'],row['bodyId']):row for row in rows}
        for row in previous:
            key=(row['itemId'],row['bodyId'])
            if key not in generated:
                file=args.output/Path(row['file']).name
                if hashlib.sha256(file.read_bytes()).hexdigest()!=row['sha256']:
                    raise RuntimeError('Cannot merge changed, unverified prior model '+file.name)
                generated[key]=row
        rows=sorted(generated.values(),key=lambda row:((['backpack']+list(GEAR)).index(row['itemId']),list(BODIES).index(row['bodyId'])))
    fingerprint = hashlib.sha256(''.join(row['sha256'] for row in rows).encode()).hexdigest()[:8]
    (args.output / 'manifest.json').write_text(json.dumps({'schema':'realm.free-equipment-catalog.v2',
        'version':'2-'+fingerprint,'generator':'tools/blender/build_free_equipment_models.py',
        'validationStatus':'awaiting Unity fitting probe','files':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'FREE_EQUIPMENT_BUILD={len(rows)} candidates; fingerprint 2-{fingerprint}')


if __name__ == '__main__':
    main()
