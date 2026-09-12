"""Build a real articulated textile insert beneath the downloaded sleeves."""
import bpy
import bmesh
from mathutils import Matrix
import build_free_armor_replacements as rig
from suit_surface_metrics import triangle_surface,sampled_surface_error,freeze_surface_triangles,stress_surface,surface_samples
from simplify_articulated_mesh import simplify_endpoints
from refit_suit_gloves import boundary_components


def sleeve_span_bounds(shoulder_x,elbow_x):
    """Keep the shoulder and elbow patches continuous for long upper arms.

    A fixed shoulder + 8 cm endpoint leaves a 6 cm bare band on male-large.
    Preserve at least 2 cm of overlap with the elbow patch before selecting
    body triangles; the inward donor-removal margin must not extend the cut.
    """
    elbow_start=abs(elbow_x)-.11
    return (max(abs(shoulder_x)+.08,elbow_start+.02),elbow_start,abs(elbow_x)+.11)


def inside_sleeve_span(x,bounds,margin=0):
    shoulder_end,elbow_start,elbow_end=bounds
    return abs(x)<shoulder_end-margin or elbow_start+margin<abs(x)<elbow_end-margin


def seal_upperarm_slits(bm,group_ids,shoulder_x,elbow_x):
    """Close narrow five-edge source creases inside the upper-arm textile.

    The female body has two open underside creases. Copying/offsetting them
    leaves an actual slit in the garment. Only seal fully arm-owned internal
    loops, never the torso/cuff cuts or any part of the original player mesh.
    """
    deform=bm.verts.layers.deform.active;closed=0;triangles=0
    for edges in boundary_components(bm):
        vertices={v for e in edges for v in e.verts}
        if len(edges)!=5 or len(vertices)!=5:continue
        if not all(sum(w for g,w in v[deform].items() if g in group_ids)>.95
            and abs(shoulder_x)+.02<abs(v.co.x)<abs(elbow_x)-.115 for v in vertices):continue
        low,high=rig.bounds(v.co for v in vertices);size=high-low
        if size.x>.1 or size.y>.004 or size.z>.015:continue
        faces=bmesh.ops.holes_fill(bm,edges=list(edges),sides=5)['faces']
        if not faces:raise RuntimeError('Internal upper-arm slit could not be filled')
        triangles+=sum(len(f.verts)-2 for f in faces)
        bmesh.ops.triangulate(bm,faces=faces)
        if any(e.is_valid and e.is_boundary for e in edges):
            raise RuntimeError('Internal upper-arm slit remains open')
        closed+=1
    return {'closedSourceSlits':closed,'addedTriangles':triangles,'baseBodyHidden':False}


def detail_lod(equipment, requested_triangles, include_shell=False):
    """Recover budget from generated details/shell with two-pose 1 mm gates.

    The source/approval GLBs are untouched. An unsuccessful reduction restores
    its in-memory mesh; extra budget must never silently cost a missing feature.
    """
    rows=[]
    for obj in equipment:
        if ('downloaded_shell' in obj.name)!=include_shell or 'builtin_footwear' in obj.name:continue
        before=rig.triangle_count(obj)
        if requested_triangles<=0 or before<200:continue
        reference=triangle_surface(obj)
        print('LOD_REFERENCE_SELF_ERROR',obj.name,sampled_surface_error(reference,obj),flush=True)
        armature=next(m.object for m in obj.modifiers if m.type=='ARMATURE')
        posed_reference=stress_surface(obj,armature)
        freeze_surface_triangles(obj)
        old_materials={f.material_index for f in obj.data.polygons}
        for fraction in (1,.75,.5,.25,.125):
            backup=obj.data.copy()
            simplify_endpoints(obj,reference,posed_reference,max(int(before*.65),before-int(requested_triangles*fraction)),.001)
            reduced=rig.triangle_count(obj)
            error=sampled_surface_error(reference,obj)
            posed=stress_surface(obj,armature)
            posed_error=max(posed[2].find_nearest(p)[3] for p in surface_samples(posed_reference[0],posed_reference[1]))
            present={f.material_index for f in obj.data.polygons}
            accepted=error<=.001 and posed_error<=.001 and present==old_materials
            record={'mesh':obj.name,'sourceTriangles':before,'candidateTriangles':reduced,
                'sampledRestErrorMetres':error,'sampledStressErrorMetres':posed_error,'accepted':accepted}
            print('JOINT_DETAIL_LOD',record,flush=True)
            if accepted:
                requested_triangles-=before-reduced
                bpy.data.meshes.remove(backup)
            else:
                failed=obj.data;obj.data=backup
                if failed.users==0:bpy.data.meshes.remove(failed)
            rows.append(record)
            if accepted:break
    return rows


def add_joint_liner(equipment, armature, body, material):
    """Keep body-derived joint weights within the complete outfit budget.

    This is additional garment geometry. The base player mesh is not hidden,
    removed or edited. Only selected joint patches become garment geometry,
    overlapping the donor sleeve edges and using the suit's textile PBR.
    """
    liner=rig.bake_rest_mesh(body)
    for modifier in list(liner.modifiers):liner.modifiers.remove(modifier)
    deform_names={g.index:g.name for g in liner.vertex_groups}
    influence=[]
    for vertex in liner.data.vertices:
        influence.append(sum(m.weight for m in vertex.groups
            if deform_names[m.group].startswith(('clavicle_','upperarm_','lowerarm_'))))
    # The underarm's inner wall is spine-owned, not arm-owned. Extend the
    # insert onto the upper side of the chest so bending cannot open its seam.
    shoulder=armature.matrix_world@armature.data.bones['upperarm_l'].head_local
    elbow=armature.matrix_world@armature.data.bones['lowerarm_l'].head_local
    chest=shoulder.z-.18
    neck=(armature.matrix_world@armature.data.bones['neck_01'].head_local).z
    side_limit=abs(shoulder.x)*.55
    span_bounds=sleeve_span_bounds(shoulder.x,elbow.x)
    def joint_span(point,margin=0):
        return inside_sleeve_span(point.x,span_bounds,margin)
    def outside_insert(face,_):
        center=face.calc_center_median()
        # Bound the torso patch on BOTH sides. In the T-pose the fingers have
        # the same height; an unbounded x test would also copy all hand meshes.
        side_chest=side_limit<abs(center.x)<abs(shoulder.x)+.03 and chest<center.z<neck-.03
        arm_joint=joint_span(center) and sum(influence[v.index] for v in face.verts)/len(face.verts)>=.12
        return not (side_chest or arm_joint)
    rig.delete_faces(liner,outside_insert)
    bm=bmesh.new();bm.from_mesh(liner.data)
    # GLB hard-normal/UV seams duplicate positions. They must share the same
    # outward offset or the fabric splits into individual shifted triangles.
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    arm_group_ids={g.index for g in liner.vertex_groups if g.name.startswith(('clavicle_','upperarm_','lowerarm_'))}
    closure=seal_upperarm_slits(bm,arm_group_ids,shoulder.x,elbow.x)
    print('JOINT_SOURCE_SLIT_CLOSURE',closure,flush=True)
    bm.normal_update()
    for vertex in bm.verts:
        # Flexed elbows need more ease than a flat rest surface. Add a smooth
        # 4 mm local allowance to the textile, not to the outer armor plates.
        elbow_ease=max(0,1-abs(abs(vertex.co.x)-abs(elbow.x))/.06)
        vertex.co+=vertex.normal*(.008+.004*elbow_ease)
    deform=bm.verts.layers.deform.active
    def same_weights(vertices):
        rows=[dict(v[deform]) for v in vertices]
        keys=set().union(*rows)
        return all(max(row.get(k,0) for row in rows)-min(row.get(k,0) for row in rows)<1e-6 for k in keys)
    # Dissolve only planar edges with identical joint weights. This preserves
    # the deformed surface; it is not a lossy whole-liner decimation.
    edges=[e for e in bm.edges if len(e.link_faces)==2 and e.calc_face_angle()<.0001
        and same_weights(set(v for f in e.link_faces for v in f.verts))]
    if edges:bmesh.ops.dissolve_edges(bm,edges=edges,use_verts=True,use_face_split=False)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bm.to_mesh(liner.data);bm.free()
    liner.data.update()
    liner.data.materials.clear();liner.data.materials.append(material)
    for face in liner.data.polygons:face.material_index=0
    liner.data.transform(armature.matrix_world.inverted())
    liner.parent=armature;liner.matrix_parent_inverse=Matrix.Identity(4)
    liner.matrix_basis=Matrix.Identity(4)
    modifier=liner.modifiers.new('ArticulatedTextile','ARMATURE');modifier.object=armature
    liner.name='articulated_sleeve_insert'
    triangles=rig.triangle_count(liner)
    shell=next(o for o in equipment if 'downloaded_shell' in o.name)
    before=rig.triangle_count(shell)
    bm=bmesh.new();bm.from_mesh(shell.data)
    deform=bm.verts.layers.deform.active
    arm_groups={g.index for g in shell.vertex_groups
        if g.name.startswith(('clavicle_','upperarm_','lowerarm_'))}
    textile={i for i,m in enumerate(shell.data.materials) if m==material}
    # Replace only the old inner sleeve textile, well inside the new insert's
    # overlap. Keep the downloaded outer plates, cuffs, gloves and all leg cloth.
    doomed=[f for f in bm.faces if f.material_index in textile
        and all(joint_span(shell.matrix_world@v.co,.02)
            and sum(weight for group,weight in v[deform].items() if group in arm_groups)>.2 for v in f.verts)]
    if doomed:
        bmesh.ops.delete(bm,geom=doomed,context='FACES')
        loose=[v for v in bm.verts if not v.link_faces]
        if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bm.to_mesh(shell.data);bm.free()
    replaced=before-rig.triangle_count(shell)
    # Stay inside the existing mobile geometry budget. First try a tightly
    # bounded LOD of generated copies when they crowd the joint textile.
    # Both rest and bent geometry must stay within 1 mm; shoes are untouched.
    budget=11980-sum(rig.triangle_count(o) for o in equipment)
    detail_optimization=detail_lod(equipment,max(0,triangles-budget))
    budget=11980-sum(rig.triangle_count(o) for o in equipment)
    shell_optimization=detail_lod(equipment,max(0,triangles-budget),include_shell=True)
    budget=11980-sum(rig.triangle_count(o) for o in equipment)
    if budget<triangles*.4:raise RuntimeError('No safe triangle budget for articulated sleeve insert')
    reference=triangle_surface(liner)
    posed_reference=stress_surface(liner,armature)
    # The complete outfit allocation already reserves twenty triangles. Do not
    # discard another three percent of this small joint-only mesh unnecessarily.
    lod_trials=simplify_endpoints(liner,reference,posed_reference,budget,.003) if triangles>budget else None
    actual_triangles=rig.triangle_count(liner);optimized=lod_trials is not None
    if actual_triangles>budget:raise RuntimeError('Textile LOD exceeded its assigned triangle budget')
    print('JOINT_LINER_BUDGET',triangles,replaced,budget,actual_triangles,flush=True)
    max_error=sampled_surface_error(reference,liner)
    posed=stress_surface(liner,armature)
    posed_error=max(posed[2].find_nearest(p)[3] for p in surface_samples(posed_reference[0],posed_reference[1]))
    print('JOINT_LINER_POSE_ERROR',posed_error,flush=True)
    if max_error>.003:raise RuntimeError(f'Textile simplification exceeded 3 mm: {max_error}')
    if posed_error>.003:raise RuntimeError(f'Bent textile simplification exceeded 3 mm: {posed_error}')
    name=shell.name
    equipment.remove(shell)
    combined=rig.join_objects([shell,liner],name)
    equipment.append(combined)
    return {'triangles':actual_triangles,'sourceTriangles':triangles,'optimized':optimized,
        'detailOptimization':detail_optimization,
        'shellOptimization':shell_optimization,
        'maxRestSurfaceErrorMetres':max_error,
        'maxStressSurfaceErrorMetres':posed_error,
        'lodTrials':lod_trials,
        'replacedDonorTextileTriangles':replaced,'clearanceMetres':.008,
        'elbowEaseMetres':.004,
        'spanBoundsMetres':{'shoulderEnd':span_bounds[0],'elbowStart':span_bounds[1],
            'elbowEnd':span_bounds[2],'minimumOverlap':.02},
        'sourceSlitClosure':closure,
        'skinTransfer':'body weights with rest and stress-pose bounded simplification','baseBodyHidden':False,
        'geometry':'project-authored shoulder, underarm and elbow textile inserts from body reference'}
