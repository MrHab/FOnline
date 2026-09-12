"""All-six-body source seam regression; changes only temporary glove copies."""
import sys,hashlib
from pathlib import Path
import bpy,bmesh
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
from refit_suit_gloves import hand_groups,seal_hand_boundaries
from suit_surface_metrics import freeze_surface_triangles

root=Path(__file__).resolve().parents[2]
for body_id in rig.BODY_IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source=root/f'public/assets/models/characters/base/character_{body_id}.glb'
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    objects=rig.import_gltf(source)
    for o in objects:
        if o.type=='ARMATURE':o.data.pose_position='REST'
    bpy.context.view_layer.update()
    body=next(o for o in objects if o.type=='MESH' and 'body_base' in o.name)
    original=[v.co.copy() for v in body.data.vertices]
    glove=rig.bake_rest_mesh(body);groups=hand_groups(glove)
    influence=[sum(g.weight for g in v.groups if g.group in groups) for v in glove.data.vertices]
    rig.delete_faces(glove,lambda f,_:sum(influence[v.index] for v in f.verts)/len(f.verts)<.1)
    bm=bmesh.new();bm.from_mesh(glove.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    deform=bm.verts.layers.deform.active
    owned=lambda v:sum(w for g,w in v[deform].items() if g in groups)>.5
    cuffs={e for e in bm.edges if e.is_boundary and not all(owned(v) for v in e.verts)}
    cuff_positions={v:tuple(v.co) for e in cuffs for v in e.verts}
    result=seal_hand_boundaries(bm,groups)
    print('GLOVE_SEAM_RESULT',body_id,result,flush=True)
    assert all(e.is_valid and e.is_boundary for e in cuffs), 'Forearm overlap must remain open'
    assert all(tuple(v.co)==p for v,p in cuff_positions.items()), 'Cuff vertices must not move'
    assert result['unsealedHandBoundaryEdges']==0 and result['maxSourceSlitWeldMetres']<=.0002
    if body_id=='female_slim':assert result['weldedSourceSlitPairs']>=4, 'Four diagnosed female-slim fingertip slits must be repaired'
    assert all((v.co-p).length==0 for v,p in zip(body.data.vertices,original)), 'Base hand geometry must stay unchanged'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before, 'Base GLB must stay unchanged'
    bm.normal_update()
    for vertex in bm.verts:vertex.co+=vertex.normal*.003
    bm.to_mesh(glove.data);bm.free()
    material=bpy.data.materials.new('double_sided_glove');material.use_backface_culling=False
    glove.data.materials.clear();glove.data.materials.append(material)
    for face in glove.data.polygons:face.material_index=0
    preparation=freeze_surface_triangles(glove,deduplicate_double_sided=True)
    bm=bmesh.new();bm.from_mesh(glove.data);deform=bm.verts.layers.deform.active
    unsealed=[e for e in bm.edges if e.is_boundary and all(
        sum(w for g,w in v[deform].items() if g in groups)>.5 for v in e.verts)]
    print('GLOVE_NORMALIZED_TOPOLOGY',body_id,preparation,'unsealed',len(unsealed),flush=True)
    for edge in unsealed:print('NORMALIZED_OPEN_EDGE',[list(v.co) for v in edge.verts],flush=True)
    assert not unsealed,'Normalized glove must not reopen hand-owned boundaries'
    test=glove.data.copy()
    assert not test.validate(verbose=True),'Glove export must not discard duplicate faces'
    bpy.data.meshes.remove(test);bm.free()
    print('GLOVE_SEAM_PASS',body_id,result,flush=True)
