"""Replace retargeted donor finger spikes with fitted, skinned garment gloves."""
import bpy
import bmesh
from mathutils import Matrix
import build_free_armor_replacements as rig
from suit_surface_metrics import triangle_surface,sampled_surface_error,freeze_surface_triangles,stress_surface,surface_samples
from simplify_articulated_mesh import simplify_endpoints

HAND_PREFIXES=('hand_','thumb_','index_','middle_','ring_','pinky_')


def hand_groups(obj):
    return {g.index for g in obj.vertex_groups if g.name.startswith(HAND_PREFIXES)}


def boundary_components(bm):
    boundary=[edge for edge in bm.edges if edge.is_boundary]
    by_vertex={}
    for edge in boundary:
        for vertex in edge.verts:by_vertex.setdefault(vertex,set()).add(edge)
    remaining=set(boundary);components=[]
    while remaining:
        component={remaining.pop()};pending=list(component)
        while pending:
            for vertex in pending.pop().verts:
                for adjacent in by_vertex[vertex]&remaining:
                    remaining.remove(adjacent);component.add(adjacent);pending.append(adjacent)
        components.append(component)
    return components


def seal_hand_boundaries(bm,group_ids):
    """Close copied nail/crease openings, preserving the forearm-blended cuff."""
    deform=bm.verts.layers.deform.active
    owned=lambda v:sum(w for g,w in v[deform].items() if g in group_ids)>.5
    dominant=lambda v:max(v[deform].keys(),key=lambda g:v[deform][g])
    closed_faces=[]
    seam_pairs=0;maximum_weld=0.0
    for component in boundary_components(bm):
        vertices={v for edge in component for v in edge.verts}
        if len(component) not in (4,5) or len(vertices)!=len(component) or not all(owned(v) for v in vertices):continue
        # Some source fingertip seams use a near-duplicate vertex rather than
        # an exact UV split. Weld these BEFORE filling: holes_fill can appear
        # to close a tiny slit with an opposite duplicate triangle, which then
        # disappears during export/normalization and reopens its boundary.
        # Weld only nonadjacent corners of that closed slit with the same owner;
        # never merge arbitrary nearby fingers or the forearm opening.
        ordered=sorted(vertices,key=lambda v:tuple(v.co))
        pairs=[((a.co-b.co).length,a,b) for i,a in enumerate(ordered) for b in ordered[i+1:]
            if not any(a in e.verts and b in e.verts for e in component) and dominant(a)==dominant(b)]
        if not pairs:continue
        distance,keep,remove=min(pairs,key=lambda row:row[0])
        if distance<=.0002:
            bmesh.ops.weld_verts(bm,targetmap={remove:keep})
            seam_pairs+=1;maximum_weld=max(maximum_weld,distance)
    # A subdivided side of a slit can leave a small triangular cap after welding.
    for component in boundary_components(bm):
        if all(owned(v) for edge in component for v in edge.verts):
            closed_faces.extend(bmesh.ops.holes_fill(bm,edges=list(component),sides=0)['faces'])
    if closed_faces:bmesh.ops.triangulate(bm,faces=closed_faces)
    remaining=sum(e.is_boundary and all(owned(v) for v in e.verts) for e in bm.edges)
    if remaining:raise RuntimeError(f'Copied glove has {remaining} unsealed hand-owned boundary edges')
    return {'closedSourceBoundaryLoops':len(closed_faces),'weldedSourceSlitPairs':seam_pairs,
        'maxSourceSlitWeldMetres':maximum_weld,'unsealedHandBoundaryEdges':remaining}


def refit_gloves(equipment,armature,body,material):
    glove=rig.bake_rest_mesh(body)
    for modifier in list(glove.modifiers):glove.modifiers.remove(modifier)
    group_ids=hand_groups(glove)
    influence=[sum(g.weight for g in v.groups if g.group in group_ids) for v in glove.data.vertices]
    rig.delete_faces(glove,lambda f,_:sum(influence[v.index] for v in f.verts)/len(f.verts)<.1)
    bm=bmesh.new();bm.from_mesh(glove.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    # The body contains open nail/crease boundaries. Inflating these separate
    # skin patches creates slits, even when every face centre has clearance.
    # Close only boundary loops fully owned by the hand, leaving the sleeve
    # opening (which blends into forearm weights) untouched.
    closure=seal_hand_boundaries(bm,group_ids)
    print('GLOVE_CLOSED_BOUNDARIES',closure,flush=True)
    bm.normal_update()
    for vertex in bm.verts:vertex.co+=vertex.normal*.003
    bm.to_mesh(glove.data);bm.free()
    glove.data.materials.clear();glove.data.materials.append(material)
    for face in glove.data.polygons:face.material_index=0
    glove.data.transform(armature.matrix_world.inverted())
    glove.parent=armature;glove.matrix_parent_inverse=Matrix.Identity(4);glove.matrix_basis=Matrix.Identity(4)
    modifier=glove.modifiers.new('FittedGloves','ARMATURE');modifier.object=armature
    glove.name='fitted_glove_textile'
    preparation=freeze_surface_triangles(glove,deduplicate_double_sided=True)
    bm=bmesh.new();bm.from_mesh(glove.data)
    deform=bm.verts.layers.deform.active
    unsealed=sum(e.is_boundary and all(sum(w for g,w in v[deform].items() if g in group_ids)>.5
        for v in e.verts) for e in bm.edges)
    bm.free()
    if unsealed:raise RuntimeError(f'Glove normalization reopened {unsealed} hand-owned edges')
    reference=triangle_surface(glove)
    print('GLOVE_REFERENCE_SELF_ERROR',sampled_surface_error(reference,glove),len(reference[0]),
        len(set(i for f in reference[1] for i in f)),flush=True)
    source_triangles=rig.triangle_count(glove)
    posed_reference=stress_surface(glove,armature)
    # The finger silhouette must stay within 1 mm of the fitted glove surface.
    # Only generated cloth is reduced; the player's hand mesh stays untouched.
    # Leave a small margin for the final welded topology/global surface audit.
    lod=simplify_endpoints(glove,reference,posed_reference,1650,.0008)
    error=sampled_surface_error(reference,glove)
    posed=stress_surface(glove,armature)
    posed_error=max(posed[2].find_nearest(p)[3] for p in surface_samples(posed_reference[0],posed_reference[1]))
    print('GLOVE_LOD',rig.triangle_count(glove),error,posed_error,flush=True)
    if max(error,posed_error)>.001:raise RuntimeError(f'Glove LOD exceeded 1 mm: {error}, {posed_error}')
    shell=next(o for o in equipment if 'downloaded_shell' in o.name)
    before=rig.triangle_count(shell)
    groups=hand_groups(shell)
    bm=bmesh.new();bm.from_mesh(shell.data);deform=bm.verts.layers.deform.active
    doomed=[f for f in bm.faces if all(sum(w for g,w in v[deform].items() if g in groups)>.65 for v in f.verts)]
    bmesh.ops.delete(bm,geom=doomed,context='FACES')
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bm.to_mesh(shell.data);bm.free()
    removed=before-rig.triangle_count(shell)
    if removed<1000:raise RuntimeError('Unexpected donor glove selection; wrist/finger mapping requires review')
    triangles=rig.triangle_count(glove)
    name=shell.name;equipment.remove(shell)
    combined=rig.join_objects([shell,glove],name);equipment.append(combined)
    record={'sourceTriangles':source_triangles,'triangles':triangles,'removedDonorFingerTriangles':removed,
        'surfacePreparation':preparation,
        **closure,
        'clearanceMetres':.003,'maxRestSurfaceErrorMetres':error,
        'maxStressSurfaceErrorMetres':posed_error,'lod':lod,
        'geometry':'project-authored fitted gloves from body reference','baseHandsHidden':False}
    print('FITTED_GLOVES',record,flush=True)
    return record
