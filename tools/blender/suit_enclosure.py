"""Surface ray shared by fitting and coverage checks for a one-piece garment."""


def exterior_boundary_normal(body_tree,point,face_normal,smooth_normal):
    """At a concave edge, a face normal can point into the adjacent body face.

    Do not mistake a ray travelling inside an arm and out an open cuff for
    exposed armpit skin. Only redirect a boundary probe when its first nearby
    body crossing is an EXIT, and the alternative points outside the body.
    This uses only body geometry, never the garment being tested.
    """
    if smooth_normal.length_squared<1e-12:return face_normal,False
    alternative=smooth_normal.normalized()
    if alternative.dot(face_normal)<.05:return face_normal,False
    epsilon=.00001
    _,normal,_,distance=body_tree.ray_cast(point+face_normal*epsilon,face_normal,.03)
    if normal is None or normal.dot(face_normal)<=1e-5:return face_normal,False
    _,other,_,_=body_tree.ray_cast(point+alternative*epsilon,alternative,.03)
    if other is not None and other.dot(alternative)>1e-5:return face_normal,False
    return alternative,True


def welded_surface_normals(points,faces):
    """Area-consistent normals across imported UV/hard-normal vertex splits."""
    import bpy
    import bmesh
    from mathutils.kdtree import KDTree
    mesh=bpy.data.meshes.new('coverage_normal_reference')
    mesh.from_pydata(points,[],faces)
    bm=bmesh.new()
    try:
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
        bm.normal_update()
        tree=KDTree(len(bm.verts));normals=[]
        for index,vertex in enumerate(bm.verts):
            tree.insert(vertex.co,index);normals.append(vertex.normal.copy())
        tree.balance()
        return [normals[tree.find(p)[1]] for p in points]
    finally:
        bm.free();bpy.data.meshes.remove(mesh)


def skin_surface_samples(face, points, include_boundary=False):
    center=sum((points[i] for i in face),points[face[0]]*0)/len(face)
    samples=[center]+[(center+points[i])*.5 for i in face]
    if include_boundary:
        # Narrow seams can expose a corner while all face-interior probes pass.
        samples.extend(points[i] for i in face)
        samples.extend((points[a]+points[b])*.5 for a,b in zip(face,face[1:]+face[:1]))
    return samples


def covered_body_faces(body, exclude_hands=True):
    """Exclude the face/hands by skin ownership, never by a neck-height plane.

    The trapezius can be higher than the neck pivot in the imported player rig.
    A horizontal cutoff was silently excluding visibly exposed shoulders.
    """
    excluded=[]
    for vertex in body.data.vertices:
        weight=0.0
        for member in vertex.groups:
            name=body.vertex_groups[member.group].name
            if name=='head' or (exclude_hands and name.startswith(('hand_','thumb_','index_','middle_','ring_','pinky_'))):
                weight+=member.weight
        excluded.append(weight)
    return [tuple(face.vertices) for face in body.data.polygons
            if sum(excluded[i] for i in face.vertices)/len(face.vertices)<.5]


def enclosure_hit(tree, point, normal, near_limit, extent):
    # A garment encloses air, not just the solid material of its cloth: entering
    # a nearby inner lining still covers the skin along this sampled normal.
    # Inside a layered suit a distant first crossing may ENTER an inner plate before
    # the ray eventually EXITS the enclosing sleeve. Count oriented crossings
    # in that case, rather than mistaking the inner plate for the outer shell.
    result = tree.ray_cast(point + normal * .001, normal, extent)
    hit, hit_normal, _, distance = result
    if hit is None:return False, result
    if distance<=near_limit or hit_normal.dot(normal)>1e-6:return True, result
    winding=0
    current=result
    origin=point+normal*.001
    for _ in range(64):
        hit,hit_normal,_,_=current
        if hit is None:return winding>0, result
        alignment=hit_normal.dot(normal)
        if abs(alignment)>1e-6:winding+=1 if alignment>0 else -1
        travelled=(hit-origin).dot(normal)+.00001
        if travelled>=extent:return winding>0, result
        current=tree.ray_cast(origin+normal*travelled,normal,extent-travelled)
    # A pathological mesh cannot pass by exhausting the traversal budget.
    return False,result
