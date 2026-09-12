"""Endpoint-only QEM in rest and bent space, preserving original skin weights.

Moving a collapse point and interpolating weights independently introduces a
large nonlinear skinning error. Keeping a source endpoint avoids that error;
cost and orientation are checked in both poses. Callers still audit the final
surface and reject reductions outside their error/triangle budgets.
"""
import heapq
import bmesh
import numpy as np
from mathutils.bvhtree import BVHTree
from suit_surface_metrics import surface_samples


def simplify_endpoints(obj,rest,posed,target_triangles,max_error):
    positions=np.array([[tuple(p) for p in s[0]] for s in (rest,posed)],dtype=np.float64)
    faces={i:tuple(f) for i,f in enumerate(rest[1])}
    incident=[set() for _ in rest[0]]
    for index,face in faces.items():
        for v in face:incident[v].add(index)
    count=len(incident)
    samples=[surface_samples(s[0],s[1]) for s in (rest,posed)]
    if any(not links for links in incident):raise RuntimeError('Articulated mesh has loose vertices')
    sample_faces=[min(links) for links in incident]
    for index in faces:sample_faces.extend([index]*4)
    supports=[{index:set() for index in faces} for _ in range(2)]
    for support in supports:
        for sample,index in enumerate(sample_faces):support[index].add(sample)
    quadrics=np.zeros((2,count,4,4))
    edges={}
    for index,face in faces.items():
        a,b,c=face
        for edge in ((a,b),(b,c),(c,a)):edges.setdefault(tuple(sorted(edge)),[]).append(index)
        for pose in range(2):
            pa,pb,pc=positions[pose,list(face)]
            normal=np.cross(pb-pa,pc-pa);length=np.linalg.norm(normal)
            if length<1e-12:continue
            normal/=length;plane=np.r_[normal,-normal.dot(pa)]
            for v in face:quadrics[pose,v]+=np.outer(plane,plane)
    # Preserve the open overlap boundaries, where no neighbouring face supplies
    # a plane constraint. Do not merge across disconnected garment patches.
    boundary=set()
    for (a,b),linked in edges.items():
        if len(linked)!=1:continue
        boundary.update((a,b))
        for pose in range(2):
            pa,pb=positions[pose,[a,b]]
            x,y,z=positions[pose,list(faces[linked[0]])]
            normal=np.cross(np.cross(y-x,z-x),pb-pa);length=np.linalg.norm(normal)
            if length<1e-12:continue
            normal/=length;plane=np.r_[normal,-normal.dot(pa)]
            for v in (a,b):quadrics[pose,v]+=np.outer(plane,plane)*20
    alive=set(range(count));versions=[0]*count;targets=list(range(count));heap=[]
    def neighbours(v):return {w for f in incident[v] for w in faces[f] if w!=v}
    def enqueue(a,b):
        if a not in alive or b not in alive:return
        for remove,keep in ((a,b),(b,a)):
            if remove in boundary:continue
            cost=0
            for pose in range(2):
                point=np.r_[positions[pose,keep],1]
                cost+=float(point@(quadrics[pose,remove]+quadrics[pose,keep])@point)
            heapq.heappush(heap,(max(cost,0),remove,keep,versions[remove],versions[keep]))
    for a,b in edges:enqueue(a,b)
    collapses=0
    while len(faces)>target_triangles and heap:
        _,remove,keep,rv,kv=heapq.heappop(heap)
        if remove not in alive or keep not in alive or versions[remove]!=rv or versions[keep]!=kv:continue
        nr,nk=neighbours(remove),neighbours(keep)
        if keep not in nr:continue
        common=incident[remove]&incident[keep]
        opposite={v for f in common for v in faces[f] if v not in (remove,keep)}
        if len(common)!=2 or nr&nk!=opposite:continue
        local_ids=incident[remove]|incident[keep]
        new_ids=sorted(local_ids-common)
        local_faces=[tuple(keep if v==remove else v for v in faces[index]) for index in new_ids]
        # Vertex-neighbour link checks alone allow a tetrahedron to collapse
        # into two duplicate faces. Blender's exporter then silently discards
        # one. Preserve the simplicial face topology as well as the edge link.
        if len({tuple(sorted(f)) for f in local_faces})!=len(local_faces):continue
        changed=incident[remove]-common
        valid=True
        for index in changed:
            old=faces[index];new=tuple(keep if v==remove else v for v in old)
            for pose in range(2):
                a,b,c=positions[pose,list(old)];x,y,z=positions[pose,list(new)]
                old_normal=np.cross(b-a,c-a);new_normal=np.cross(y-x,z-x)
                if old_normal.dot(new_normal)<=.2*np.linalg.norm(old_normal)*np.linalg.norm(new_normal) \
                    or np.linalg.norm(new_normal)<1e-12:
                    valid=False;break
            if not valid:break
        if not valid:continue
        # A sample can become supported by a neighbouring triangle after a
        # collapse. Track that actual supporting face in each pose; keeping
        # ownership only on the original endpoints misses later edits to it.
        assignments=[]
        for pose,surface in enumerate((rest,posed)):
            tree=BVHTree.FromPolygons(surface[0],local_faces,all_triangles=True)
            sources=set().union(*(supports[pose][index] for index in local_ids))
            assigned=[]
            for i in sources:
                hit=tree.find_nearest(samples[pose][i])
                if hit[3]>max_error:valid=False;break
                assigned.append((i,new_ids[hit[2]]))
            assignments.append(assigned)
            if not valid:break
        if not valid:continue
        affected=nr|nk|{keep}
        for index in list(common):
            for v in faces[index]:incident[v].discard(index)
            del faces[index]
        for index in list(changed):
            faces[index]=tuple(keep if v==remove else v for v in faces[index])
            incident[keep].add(index)
        incident[remove].clear();alive.remove(remove);targets[remove]=keep
        quadrics[:,keep]+=quadrics[:,remove];collapses+=1
        for pose in range(2):
            for index in local_ids:
                if index in common:supports[pose].pop(index)
                else:supports[pose][index].clear()
            for sample,index in assignments[pose]:supports[pose][index].add(sample)
        for v in affected:versions[v]+=1
        # Updating an incident face also changes the link condition at its other
        # corners, so requeue all their incident edges with current revisions.
        for v in affected:
            if v in alive:
                for w in neighbours(v):enqueue(v,w)
    def final_target(v):
        while targets[v]!=v:v=targets[v]
        return v
    planned_errors=[]
    for pose,surface in enumerate((rest,posed)):
        tree=BVHTree.FromPolygons(surface[0],list(faces.values()),all_triangles=True)
        planned_errors.append(max(tree.find_nearest(p)[3] for p in samples[pose]))
    print('ENDPOINT_PLANNED_ERRORS',planned_errors,flush=True)
    bm=bmesh.new()
    try:
        bm.from_mesh(obj.data);bm.verts.ensure_lookup_table();vertices=list(bm.verts)
        deform=bm.verts.layers.deform.active
        kept_weights={v:dict(vertices[v][deform]) for v in alive}
        kept_coordinates={v:tuple(vertices[v].co) for v in alive}
        mapping={vertices[v]:vertices[final_target(v)] for v in range(count) if v not in alive}
        bmesh.ops.weld_verts(bm,targetmap=mapping)
        source_ids={vertices[v]:v for v in alive}
        actual_faces=sorted(tuple(sorted(source_ids[v] for v in f.verts)) for f in bm.faces)
        expected_faces=sorted(tuple(sorted(f)) for f in faces.values())
        if actual_faces!=expected_faces:
            raise RuntimeError(f'Endpoint weld changed planned topology: {len(expected_faces)} to {len(actual_faces)} faces')
        if any(tuple(vertices[v].co)!=co for v,co in kept_coordinates.items()):
            raise RuntimeError('Endpoint weld moved a retained vertex')
        # Never average deform weights at a retained source endpoint.
        for v,weights in kept_weights.items():
            vertices[v][deform].clear()
            for group,weight in weights.items():vertices[v][deform][group]=weight
        bm.to_mesh(obj.data)
    finally:bm.free()
    obj.data.update()
    return {'collapses':collapses,'expectedTriangles':len(faces),'plannedSurfaceErrors':planned_errors,
            'method':'endpoint QEM in rest and arms-bent space'}
