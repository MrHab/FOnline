"""Export layered suits without replacing the old reviewed files or approvals."""
import dataclasses
import hashlib
import json
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
import build_free_equipment_models as gear
from suit_enclosure import covered_body_faces, enclosure_hit, skin_surface_samples
from refit_suit_details import fit_retained
from refit_suit_collar import refit_collar
from build_suit_joint_liner import add_joint_liner
from refit_suit_gloves import refit_gloves
from fit_suit_leg_ownership import source_leg_side,leg_weight_sampler
from suit_surface_metrics import freeze_surface_triangles

ROOT=Path(__file__).resolve().parents[2]

# Броня, которую собирают слоями: цельный донор — торс, штаны и ботинки — сажается
# на тело с подкладкой вместо открытой кожи, поэтому любая броня идёт с ногами и
# тело сквозь неё не просвечивает. Общий список rig.SPECS не трогаем: от него
# зависят прежние торсы и десяток проверок; здесь только слоистые отличия.
SWAT_TOKENS=('swat_body','swat_legs','swat_feet','soldier_body','soldier_legs','soldier_feet')
SWAT_HASHES='622B3F36FCAC90539EF8F7121EC1F11B5E1AE603A085019B3FA96EBA20DDDFD3/37112E60AF92FF84D882A34E21F0F78A2AFC14282E950FB0E3652E51D06E0B2D'
# Пластины прежней брони (одобренный донор) поверх полной формы Swat/Soldier:
# форма даёт штаны, рукава и обувь, пластины — облик брони.
PLATED={'source_for_body':rig.source_by_gender('quaternius_male_swat.gltf','quaternius_female_soldier.gltf'),
    'selected_mesh_tokens':SWAT_TOKENS,'discarded_materials':('skin',),'join_source':True,
    'join_donor':True,'retained_donor_tokens':('downloaded_shel',),'crop':None,'vertical_offset':0.0,
    'source_sha256':SWAT_HASHES}
LAYERED={
    'hazmatSuit':{},
    'energySuit':{},
    'ballisticVest':{'selected_mesh_tokens':SWAT_TOKENS,'join_source':True,'vertical_offset':0.0},
    'leather':{'selected_mesh_tokens':('punk_body','punk_legs','punk_feet'),'join_source':True,'crop':None},
    'combatArmor':{**PLATED,'fit_scale':(1.055,1.10,0.99),'surface_clearance':0.018},
    'heavyArmor':{**PLATED,'fit_scale':(1.06,1.11,0.99),'surface_clearance':0.018},
    'metalArmor':{**PLATED,'fit_scale':(1.055,1.10,0.99),'surface_clearance':0.018},
}
# У доноров Punk/Swat/Soldier шея — часть сетки тела; слоистая сборка делает из
# неё ткань, и воротник вставал до носа, а шарф тяжёлой брони закрывал лицо.
# Всё, что выше основания шеи на столько метров в колонке головы, срезается.
NECK_TRIM={'ballisticVest':.045,'leather':.045,'combatArmor':.045,'heavyArmor':.045,'metalArmor':.045}
DEST=ROOT/'public/assets/models/equipment/suits-v2'
REVIEW=ROOT/'unity-client/Temp/LayeredSuitReview'
SOURCES=ROOT/'Build/SourceDownloads/free-armor-replacements-20260908'

def ref(file):
    return {'file':file.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}

def cut_at(obj,height,keep_above):
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
        plane_co=Vector((0,0,height)),plane_no=Vector((0,0,1)),
        clear_inner=keep_above,clear_outer=not keep_above,dist=1e-6)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()

def fit_upper_contacts(shell,body,armature,points,body_bvh):
    """Resolve remaining cloth/body contacts without replacing source topology."""
    samples=[]
    for face in covered_body_faces(body):
        center=sum((points[i] for i in face),Vector())/len(face)
        if center.z<=.85:continue
        normal=body_bvh.find_nearest(center)[1]
        samples.extend((p,normal) for p in skin_surface_samples(face,points,include_boundary=True))
    faces=[tuple(f.vertices) for f in shell.data.polygons]
    # Broad shoulders can require more small contact steps. Stop immediately
    # when settled; the cap prevents an unstable fit from running indefinitely.
    steps=next((int(a.split('=',1)[1]) for a in sys.argv if a.startswith('--contact-steps=')),24)
    if steps!=24 and '--candidate' not in sys.argv:raise RuntimeError('Contact experiments require --candidate')
    for iteration in range(steps):
        cloth=BVHTree.FromPolygons([v.co for v in shell.data.vertices],faces)
        low,high=rig.bounds(v.co for v in shell.data.vertices)
        moves={};missing=0; stalled=[]
        for point,normal in samples:
            valid,_=enclosure_hit(cloth,point,normal,.3,(high-low).length+.01)
            if valid:continue
            missing+=1
            # In an armpit the Euclidean-nearest triangle can be the other
            # wall of the sleeve. Resolve the actual crossing along the skin
            # normal first, instead of pulling that unrelated wall sideways.
            nearest,face_normal,face_id,distance=cloth.ray_cast(point-normal*.001,-normal,.15)
            if nearest is None or face_normal.dot(normal)<=0:
                nearest,_,face_id,distance=cloth.find_nearest(point)
            if nearest is None or distance>.15:
                stalled.append((list(point),'distant',distance))
                continue
            penetration=(point-nearest).dot(normal)
            if penetration<-.003:
                stalled.append((list(point),list(nearest),penetration))
                continue
            push=normal*min(.04,max(.006,penetration+.018))
            for index in faces[face_id]:
                if index not in moves or moves[index].length<push.length:moves[index]=push
        print('UPPER_CONTACTS',iteration,missing,len(moves),flush=True)
        if not moves:
            print('UPPER_UNRESOLVED',stalled[:3]+stalled[-3:],flush=True)
            break
        for index,delta in moves.items():shell.data.vertices[index].co+=delta
        shell.data.update()

def drop_stray_islands(equipment):
    """Куски пластин, за которыми нет ткани формы, убираются.

    Прежняя броня сидела на голом торсе, и её боковые лезвия и кобуры висели в
    воздухе у бёдер; на полной форме их не на что посадить (луч вдоль y через
    середину и углы куска не встречает ткань), и в игре они торчали спицами.
    """
    from refit_suit_details import islands,surface
    shell=next(o for o in equipment if 'downloaded_shell' in o.name)
    cloth=BVHTree.FromPolygons(*surface([shell]))
    removed=[]
    for obj in equipment:
        if obj==shell or 'builtin_foot' in obj.name:continue
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        bm.to_mesh(obj.data);bm.free()
        mesh=obj.data;doomed=set()
        for group in islands(mesh):
            points=[obj.matrix_world@mesh.vertices[i].co for i in group]
            low=Vector(tuple(min(p[k] for p in points) for k in range(3)))
            high=Vector(tuple(max(p[k] for p in points) for k in range(3)))
            centre=(low+high)*.5;size=high-low
            probes=[(centre.x,centre.z)]+[(centre.x+size.x*x,centre.z+size.z*z) for x,z in ((-.3,-.3),(.3,-.3),(-.3,.3),(.3,.3))]
            if any(cloth.ray_cast(Vector((x,2,z)),Vector((0,-1,0)),4)[0] is not None for x,z in probes):continue
            doomed.update(group);removed.append([round(v,3) for v in centre])
        if not doomed:continue
        bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[bm.verts[i] for i in doomed],context='VERTS')
        bm.to_mesh(mesh);bm.free();mesh.update()
    return removed

def drop_floating_plates(equipment,limit=.07):
    """Пластины, отошедшие от формы дальше limit, убираются.

    Посадка деталей ставит каждый остров на ткань по его середине, но шарф и
    длинные полы прежней брони — не пластины: они вставали жёсткой плитой,
    торчащей из-за плеча. То, что не прилегает к форме, здесь и отсекается.
    """
    from refit_suit_details import islands
    shell=[o for o in equipment if 'downloaded_shell' in o.name or 'builtin_foot' in o.name]
    points=[];faces=[]
    for obj in shell:
        start=len(points)
        points.extend(rig.evaluated_points(obj))
        faces.extend(tuple(start+i for i in f.vertices) for f in obj.data.polygons)
    cloth=BVHTree.FromPolygons(points,faces)
    removed=[]
    for obj in equipment:
        if obj in shell:continue
        mesh=rig.bake_rest_mesh(obj)
        doomed=set()
        for group in islands(mesh.data):
            far=max((mesh.data.vertices[i].co-cloth.find_nearest(mesh.data.vertices[i].co)[0]).length
                for i in group if cloth.find_nearest(mesh.data.vertices[i].co)[0] is not None)
            if far>limit:
                doomed.update(group)
                removed.append(round(far,3))
        bpy.data.objects.remove(mesh,do_unlink=True)
        if not doomed:continue
        bm=bmesh.new();bm.from_mesh(obj.data);bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[bm.verts[i] for i in doomed],context='VERTS')
        bm.to_mesh(obj.data);bm.free();obj.data.update()
    return removed

def refit_lower_suit(equipment,armature,body,refit_upper=False):
    """Keep shin armor above the shoe slot and fit both layers around real skin.

    The modular female Feet donor includes shin plates as well as shoes. Hiding
    that whole source removes trousers. Only geometry below the ankle cuff is
    switchable. Nearest-vertex projection is not an enclosure test: calf and
    heel facets can still cut through the wearer, so use outward surface rays.
    """
    foot=next(o for o in equipment if 'builtin_footwear' in o.name)
    shell=next(o for o in equipment if 'downloaded_shell' in o.name)
    baked_foot=rig.bake_rest_mesh(foot); baked_shell=rig.bake_rest_mesh(shell)
    for o in (baked_foot,baked_shell):
        for m in list(o.modifiers): o.modifiers.remove(m)
    points=rig.evaluated_points(body)
    tree,points,normals,weights=rig.target_skin_data(body)
    sampler=gear.surface_weight_sampler(body,points,weights)
    bvh=BVHTree.FromPolygons(points,[tuple(p.vertices) for p in body.data.polygons])
    # Existing downloaded gloves still need the finger surfaces for fitting,
    # even though bare hands are deliberately outside the garment coverage test.
    upper_bvh=BVHTree.FromPolygons(points,covered_body_faces(body,exclude_hands=False)) if refit_upper else None
    upper=baked_foot.copy(); upper.data=baked_foot.data.copy(); bpy.context.collection.objects.link(upper)
    cut_at(upper,.22,True)
    cut_at(baked_foot,.22,False)
    shell_parts=[baked_shell]
    if upper.data.polygons: shell_parts.append(upper)
    else: bpy.data.objects.remove(upper,do_unlink=True)
    fitted_shell=rig.join_objects(shell_parts,shell.name+'_fitted')
    bm=bmesh.new();bm.from_mesh(fitted_shell.data)
    if refit_upper:
        # Imported material/UV seams duplicate positions. Contact fitting must
        # move both sides together or a closed source sleeve tears along them.
        bmesh.ops.remove_doubles(bm,verts=[v for v in bm.verts if v.co.z>.85],dist=.00001)
    for _ in range(2):
        edges=[e for e in bm.edges if max(v.co.z for v in e.verts)<.99 and e.calc_length()>.055]
        if edges: bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
    if refit_upper:
        edges=[e for e in bm.edges if min(v.co.z for v in e.verts)>.9 and e.calc_length()>.075]
        if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
        neck_height=(armature.matrix_world@armature.data.bones['neck_01'].head_local).z
        # The neck bulges between the source's sparse horizontal rings.
        # Refine their vertical intervals before fitting, instead of inflating
        # a coarse collar until its top flares away from the jaw.
        for _ in range(2):
            edges=[e for e in bm.edges if max(v.co.z for v in e.verts)>neck_height-.01
                and min(v.co.z for v in e.verts)>neck_height-.08
                and max(abs(v.co.x) for v in e.verts)<.145
                and abs(e.verts[0].co.z-e.verts[1].co.z)>.018]
            if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
    bm.to_mesh(fitted_shell.data);bm.free()
    collar_reference=[v.co.copy() for v in fitted_shell.data.vertices] if refit_upper else None
    def landmark(name):return armature.matrix_world@armature.data.bones[name].head_local
    spine=[landmark(n) for n in ('pelvis','spine_01','spine_02','spine_03','neck_01')]
    arm_segments=[]
    for side in ('l','r'):
        chain=[landmark(n+'_'+side) for n in ('upperarm','lowerarm','hand')]
        arm_segments.extend(zip(chain,chain[1:]))
    def nearest_axis(p):
        candidates=[]
        for a,b in list(zip(spine,spine[1:]))+arm_segments:
            delta=b-a
            candidates.append(a+delta*max(0,min(1,(p-a).dot(delta)/delta.length_squared)))
        return min(candidates,key=lambda c:(p-c).length_squared)
    original_cloth=BVHTree.FromPolygons([v.co.copy() for v in fitted_shell.data.vertices],
        [tuple(f.vertices) for f in fitted_shell.data.polygons]) if refit_upper else None
    crossed_legs=0
    for vertex in fitted_shell.data.vertices:
        p=vertex.co
        if refit_upper and p.z>=.94:
            origin=nearest_axis(p)
            direction=(p-origin).normalized()
            # This surface excludes head/hand-owned faces, so collar vertices
            # cannot jump onto the forehead, while high shoulders remain fitted.
            hit,normal,_,distance=upper_bvh.ray_cast(origin,direction,.45)
            if hit is not None:
                clearance=.024/max(.4,abs(normal.dot(direction)))
                # Preserve the donor's plate/insulation separation. Projecting
                # every sunken layer onto one radius creates coplanar faces and
                # visible triangular flicker even when coverage is perfect.
                old_hit,old_normal,_,old_distance=original_cloth.ray_cast(origin,direction,.45)
                layer_depth=max(0,(p-origin).length-old_distance) if old_hit is not None and old_normal.dot(direction)>0 else 0
                vertex.co=origin+direction*max((p-origin).length,distance+clearance+min(layer_depth,.008))
            continue
        if not .18<p.z<.94: continue
        ownership=source_leg_side(fitted_shell,vertex.index) if refit_upper else p.x
        if ownership*p.x<0:crossed_legs+=1
        side='l' if ownership>0 else 'r'
        ankle=armature.matrix_world@armature.data.bones['foot_'+side].head_local
        knee=armature.matrix_world@armature.data.bones['calf_'+side].head_local
        hip=armature.matrix_world@armature.data.bones['thigh_'+side].head_local
        a,b=(ankle,knee) if p.z<knee.z else (knee,hip)
        origin=a.lerp(b,max(0,min(1,(p.z-a.z)/(b.z-a.z)))); origin.z=p.z
        direction=(p-origin).normalized()
        hit,normal,_,distance=bvh.ray_cast(origin,direction,.35)
        if hit is not None:
            clearance=.022/max(.4,abs(normal.dot(direction)))
            vertex.co=origin+direction*max((p-origin).length,distance+clearance)
    fitted_shell.data.update()
    print('SOURCE_LEG_OWNERSHIP','crossedMidlineVertices',crossed_legs,flush=True)
    if refit_upper:
        fit_upper_contacts(fitted_shell,body,armature,points,bvh)
        refit_collar(fitted_shell,collar_reference,body,armature,points,bvh)
        # A source facet can graze the skin between sampled points even after
        # its vertices have been fitted. Give the complete upper garment a
        # small, continuous body-normal ease allowance (3 mm), fading into
        # the already fitted trousers. This never removes or hides body faces.
        for vertex in fitted_shell.data.vertices:
            blend=max(0,min(1,(vertex.co.z-.90)/.08))
            if abs(vertex.co.x)<.15:
                # The coherently fitted collar has its own radial clearance.
                # A later arbitrary normal offset can lower/flare its rim.
                blend*=max(0,min(1,(landmark('neck_01').z-.015-vertex.co.z)/.055))
            if blend==0:continue
            _,normal,_,_=bvh.find_nearest(vertex.co)
            if normal is not None:vertex.co+=normal*(.003*blend)
        fitted_shell.data.update()
    # Joined/subdivided donor cloth can tessellate into duplicate, opposite
    # double-sided triangles. Normalize those exact overlaps explicitly before
    # any glove/joint LOD reference is captured, never in the exporter.
    preparation=freeze_surface_triangles(fitted_shell,deduplicate_double_sided=True) if refit_upper else None
    if preparation:print('FITTED_SURFACE_PREPARATION',preparation,flush=True)
    shoes=[]
    for side in (-1,1):
        shoe=baked_foot.copy();shoe.data=baked_foot.data.copy();bpy.context.collection.objects.link(shoe)
        rig.delete_faces(shoe,lambda f,m:f.calc_center_median().x*side<0)
        low,high=rig.bounds(p for p in points if p.x*side>0 and p.z<.20)
        low-=Vector((.018,.018,.012));high+=Vector((.018,.018,0));high.z=.245
        gear.fit_boot(shoe,(low,high),body,armature,side,subdivision_cuts=1)
        shoes.append(shoe)
    bpy.data.objects.remove(baked_foot,do_unlink=True)
    fitted_foot=rig.join_objects(shoes,foot.name+'_fitted')
    for original,replacement in ((shell,fitted_shell),(foot,fitted_foot)):
        name=original.name
        for key in original.keys(): replacement[key]=original[key]
        equipment.remove(original);bpy.data.objects.remove(original,do_unlink=True)
        replacement.name=name
        vertex_sampler=leg_weight_sampler(replacement,body,points,weights,sampler) if refit_upper and original==shell else None
        gear.world_skin(replacement,armature,tree,weights,sampler,sample_vertex_weights=vertex_sampler)
        equipment.append(replacement)
    return {'method':'donor-leg-side-v1' if refit_upper else 'position-side-v1',
        'crossedMidlineSourceVertices':crossed_legs,'sameLegSkinSampling':refit_upper,'baseBodyHidden':False,
        **({'surfacePreparation':preparation} if preparation else {})}

def main():
    global DEST
    candidate='--candidate' in sys.argv
    if not candidate:
        raise RuntimeError('Generate with --candidate --joint-liner, then promote reviewed bytes with tools/build-layered-suit-models.js --promote-candidate')
    joint_liner='--joint-liner' in sys.argv
    if joint_liner and not candidate:raise RuntimeError('Joint liner trials require --candidate')
    if candidate:DEST=ROOT/'unity-client/Logs/UpperSuitCandidate'
    selected_body=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--body=')),None)
    selected_item=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--item=')),None)
    if (selected_body or selected_item) and not candidate:
        raise RuntimeError('Partial generation is only allowed in the isolated candidate catalog')
    DEST.mkdir(parents=True,exist_ok=True)
    rows=[]
    for spec in rig.SPECS:
        if spec.item_id not in LAYERED: continue
        spec=dataclasses.replace(spec,**LAYERED[spec.item_id])
        if selected_item and spec.item_id!=selected_item:continue
        for body in rig.BODY_IDS:
            if selected_body and body!=selected_body:continue
            source=SOURCES/spec.source_for_body(body)
            actual=hashlib.sha256(source.read_bytes()).hexdigest().upper()
            if actual not in spec.source_sha256.split('/'):
                raise RuntimeError('Unexpected source hash: '+str(source))
            rig.build_variant(ROOT,REVIEW,SOURCES,spec,body,True,split_footwear=True,refit_upper=candidate)
            equipment=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('realm_asset_id')==f'{spec.output_prefix}_{body}']
            # Имя объекта в Blender — не длиннее 63 знаков: у длинных префиксов
            # (бронежилет) хвост «_builtin_footwear» обрезался, и слой обуви
            # не находился. Слои называем коротко, по id вещи.
            for obj in equipment:
                if 'builtin_foot' in obj.name:obj.name=f'{spec.item_id}_{body}_builtin_footwear'
                elif 'downloaded_sh' in obj.name:obj.name=f'{spec.item_id}_{body}_downloaded_shell'
            armature=next(m.object for o in equipment for m in o.modifiers if m.type=='ARMATURE')
            body_mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'body_base' in o.name)
            leg_fit=refit_lower_suit(equipment,armature,body_mesh,refit_upper=candidate)
            glove_fit=refit_gloves(equipment,armature,body_mesh,bpy.data.materials[spec.materials[1]]) if joint_liner else None
            if spec.item_id in ('combatArmor','heavyArmor','metalArmor'):
                print('STRAY_ISLANDS_REMOVED',drop_stray_islands(equipment),flush=True)
            detail_fit=fit_retained(equipment,armature,body_mesh) if candidate else []
            if spec.item_id in ('combatArmor','heavyArmor','metalArmor'):
                print('FLOATING_PLATES_REMOVED',drop_floating_plates(equipment),flush=True)
            liner_fit=add_joint_liner(equipment,armature,body_mesh,bpy.data.materials[spec.materials[1]]) if joint_liner else None
            if spec.item_id in NECK_TRIM:
                neck=(armature.matrix_world@armature.data.bones['neck_01'].head_local).z+NECK_TRIM[spec.item_id]
                def above_neck(face,_material):
                    centre=face.calc_center_median()
                    return centre.z>neck and abs(centre.x)<.14
                for obj in equipment:
                    if 'builtin_foot' in obj.name:continue
                    print('NECK_TRIM',obj.name,rig.delete_faces(obj,above_neck),flush=True)
            for obj in [armature]+equipment:
                for key in list(obj.keys()):
                    if key in ('realm_review_only','realm_runtime_integration_allowed') or 'approval' in key or 'approved' in key:
                        del obj[key]
                obj['realm_catalog']='realm.layered-suits.v2'
            footwear=[o for o in equipment if 'builtin_footwear' in o.name]
            if len(footwear)!=1: raise RuntimeError('Expected one independently switchable footwear layer')
            footwear[0]['realm_armor_layer']='builtin_footwear'
            if candidate:
                # The glTF exporter validates and mutates its input. Reject a
                # repair here rather than silently exporting different topology
                # from the geometry whose surface/LOD budgets were measured.
                for obj in equipment:
                    test=obj.data.copy()
                    try:
                        before=(len(test.vertices),len(test.edges),len(test.polygons))
                        if test.validate(verbose=True):
                            print('PREEXPORT_REPAIR',obj.name,before,
                                (len(test.vertices),len(test.edges),len(test.polygons)),flush=True)
                            raise RuntimeError('Generated mesh needs exporter repair: '+obj.name)
                    finally:bpy.data.meshes.remove(test)
            file=DEST/f'equipment_{spec.item_id}_{body}.glb'
            rig.export_review(file,armature,equipment)
            rows.append({'itemId':spec.item_id,'bodyId':body,'file':'/assets/models/equipment/suits-v2/'+file.name,
                **({'candidateFile':file.relative_to(ROOT).as_posix()} if candidate else {}),
                'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size,
                'triangles':sum(rig.triangle_count(o) for o in equipment),'meshes':len(equipment),
                **({'detailFit':detail_fit} if candidate else {}),
                **({'legFit':leg_fit} if candidate else {}),
                **({'jointLiner':liner_fit} if joint_liner else {}),
                **({'gloveFit':glove_fit} if joint_liner else {}),
                'source':dict(ref(source),page=spec.page,creator=spec.creator,license=spec.license_id),
                'bodyReference':ref(ROOT/f'public/assets/models/characters/base/character_{body}.glb'),
                'retainedReference':ref(ROOT/'docs/art/reviews'/spec.output_folder/f'{spec.output_prefix}_{body}.glb'),
                'modifications':['downloaded source mesh isolation','body fitting','canonical skin transfer',
                    'independent ankle footwear layer; shin plates remain with suit',
                    'radial calf clearance and independent heel/forefoot fitting','interpolated body-surface skin weights']
                    +(['anatomical sleeve alignment; continuous insulation liner; upper surface contact fitting',
                        'vertically refined sector-fitted collar; 3 mm torso/sleeve ease',
                        'same-leg seals, fitted arm gaskets, conforming panels and flexible zipper/conduits'] if candidate else [])})
    version='2-'+hashlib.sha256(''.join(r['sha256'] for r in rows).encode()).hexdigest()[:8]
    (DEST/'manifest.json').write_text(json.dumps({'schema':'realm.layered-suits.v2','version':version,
        'generator':'tools/blender/build_layered_suit_models.py','files':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('LAYERED_SUITS='+version,flush=True)

if __name__=='__main__': main()
