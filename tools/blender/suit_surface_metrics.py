"""Measure actual tessellated garment surfaces, including non-planar quads."""
import bmesh
import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree
import build_free_armor_replacements as rig


def freeze_surface_triangles(obj,deduplicate_double_sided=False):
    """Keep Blender's existing diagonals before editing a non-planar surface.

    A fresh BMesh/Decimate tessellation can choose the other quad diagonal,
    changing the surface even without moving a vertex. Split on the current
    loop triangles instead; face_split preserves UV loops and skin layers.
    Optional duplicate normalization removes only exact, same-material,
    double-sided overlaps. It is performed before LOD reference measurement.
    """
    mesh=obj.data
    mesh.calc_loop_triangles()
    original_triangles=sorted(tuple(sorted(t.vertices)) for t in mesh.loop_triangles)
    redundant=len(original_triangles)-len(set(original_triangles))
    if redundant and not deduplicate_double_sided:
        raise RuntimeError('Duplicate source triangles must be resolved before LOD: '+obj.name)
    if redundant:
        materials={}
        for triangle in mesh.loop_triangles:
            key=tuple(sorted(triangle.vertices))
            materials.setdefault(key,set()).add(triangle.material_index)
        counts={}
        for key in original_triangles:counts[key]=counts.get(key,0)+1
        for key,count in counts.items():
            if count<2:continue
            slots=materials[key]
            if len(slots)!=1 or any(i>=len(mesh.materials) or mesh.materials[i] is None
                    or mesh.materials[i].use_backface_culling for i in slots):
                raise RuntimeError('Cannot remove overlapping surfaces with distinct or one-sided materials')
    original_points=[tuple(v.co) for v in mesh.vertices]
    diagonals={}
    for polygon in mesh.polygons:
        vertices=list(polygon.vertices)
        boundary={tuple(sorted((a,b))) for a,b in zip(vertices,vertices[1:]+vertices[:1])}
        diagonals[polygon.index]=(boundary,set())
    for triangle in mesh.loop_triangles:
        boundary,edges=diagonals[triangle.polygon_index]
        a,b,c=triangle.vertices
        edges.update(edge for edge in (tuple(sorted((a,b))),tuple(sorted((b,c))),tuple(sorted((c,a))))
            if edge not in boundary)
    bm=bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
        vertices=list(bm.verts);faces=list(bm.faces)
        for index,(_,edges) in diagonals.items():
            descendants=[faces[index]]
            for a,b in sorted(edges):
                va,vb=vertices[a],vertices[b]
                face=next((f for f in descendants if va in f.verts and vb in f.verts
                    and not any(va in e.verts and vb in e.verts for e in f.edges)),None)
                if face is None:raise RuntimeError('Original tessellation diagonal cannot be preserved')
                new_face,_=bmesh.utils.face_split(face,va,vb)
                if new_face is None:raise RuntimeError('Original tessellation split failed')
                descendants.append(new_face)
        if any(len(face.verts)!=3 for face in bm.faces):raise RuntimeError('Untriangulated surface remains')
        if redundant:
            # Equal vertex IDs imply exactly equal positions and skin weights
            # in every animation pose. With the same double-sided material,
            # retain the first face's UVs and remove only redundant coverage.
            source_ids={v:i for i,v in enumerate(vertices)}
            seen=set();duplicates=[]
            for face in bm.faces:
                key=tuple(sorted(source_ids[v] for v in face.verts))
                if key in seen:duplicates.append(face)
                else:seen.add(key)
            if len(duplicates)!=redundant:raise RuntimeError('Unexpected duplicate triangulation count')
            bmesh.ops.delete(bm,geom=duplicates,context='FACES_ONLY')
        bm.to_mesh(mesh)
    finally:bm.free()
    mesh.update()
    mesh.calc_loop_triangles()
    expected=sorted(set(original_triangles)) if redundant else original_triangles
    if expected!=sorted(tuple(sorted(t.vertices)) for t in mesh.loop_triangles) \
        or original_points!=[tuple(v.co) for v in mesh.vertices]:
        raise RuntimeError('Frozen triangulation changed the original geometry')
    return {'method':'fixed-tessellation-double-sided-dedup-v1',
        'removedDuplicateTriangles':redundant,'sourceTriangles':len(original_triangles),
        'triangles':len(mesh.loop_triangles),'verticesMoved':0}


def triangle_surface(obj):
    points=rig.evaluated_points(obj)
    obj.data.calc_loop_triangles()
    triangles=[tuple(t.vertices) for t in obj.data.loop_triangles]
    tree=BVHTree.FromPolygons(points,triangles,all_triangles=True)
    return points,triangles,tree


def surface_samples(points,triangles):
    # The mean of four non-coplanar corners is NOT necessarily on the rendered
    # surface. Sampling it made unchanged fitted strips/soles fail a 1 mm gate.
    samples=list(points)
    for a,b,c in triangles:
        samples.extend(((points[a]+points[b]+points[c])/3,
            (points[a]+points[b])*.5,(points[b]+points[c])*.5,(points[c]+points[a])*.5))
    return samples


def sampled_surface_error(reference,obj):
    _,_,tree=triangle_surface(obj)
    return max(tree.find_nearest(p)[3] for p in surface_samples(reference[0],reference[1]))


def stress_surface(obj,armature,bone_deltas=None):
    """Sample the same arms-bent pose as the visual probe, then restore state."""
    original_position=armature.data.pose_position
    original_basis={b.name:b.matrix_basis.copy() for b in armature.pose.bones}
    try:
        armature.data.pose_position='POSE'
        for bone in armature.pose.bones:bone.matrix_basis=Matrix.Identity(4)
        bpy.context.view_layer.update()
        for name,angle,axis in [('upperarm_l',1.0,'Y'),('upperarm_r',-1.0,'Y'),
            ('lowerarm_l',-1.2,'Z'),('lowerarm_r',1.2,'Z')]:
            bone=armature.pose.bones[name];pivot=armature.matrix_world@bone.head
            rotation=Matrix.Translation(pivot)@Matrix.Rotation(angle,4,axis)@Matrix.Translation(-pivot)
            bone.matrix=armature.matrix_world.inverted()@rotation@armature.matrix_world@bone.matrix
            bpy.context.view_layer.update()
        if bone_deltas is not None:
            for bone in armature.pose.bones:
                rest_world=armature.matrix_world@bone.bone.matrix_local
                bone_deltas[bone.name]=armature.matrix_world@bone.matrix@rest_world.inverted()
        return triangle_surface(obj)
    finally:
        for bone in armature.pose.bones:bone.matrix_basis=original_basis[bone.name]
        armature.data.pose_position=original_position
        bpy.context.view_layer.update()
