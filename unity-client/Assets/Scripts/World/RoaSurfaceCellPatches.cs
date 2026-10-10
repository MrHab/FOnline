// Shared indexed refinement of authored terrain cells. Serialized vertices drive
// the playable mesh, height sampling, water clipping and overview geometry.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    public static class RoaSurfaceCellPatches
    {
        [Serializable] public sealed class Vertex {public float x,z,h; public Vector3 Vector=>new Vector3(x,h,z);}
        [Serializable] public sealed class Cell {public int ix,iz; public Vertex[] vertices; public int[] indices;}

        private sealed class BoundaryWater
        {
            public RoaSectorSurface.Point[] source;
            public int[] ids;
            public readonly List<Vector3[]> triangles=new List<Vector3[]>();
            public readonly List<Vector3> roots=new List<Vector3>();
        }
        private static readonly Dictionary<RoaSectorSurface.Profile,BoundaryWater> BoundaryWaters=
            new Dictionary<RoaSectorSurface.Profile,BoundaryWater>();
        internal static void ReleaseRuntimeProfiles()=>BoundaryWaters.Clear();
        private static double AreaXZ(Vector3 a,Vector3 b,Vector3 c)=>
            ((double)b.x-a.x)*((double)c.z-a.z)-((double)b.z-a.z)*((double)c.x-a.x);

        // Match the server's dry boundary quad topology. No vertices or wet
        // faces move: only the redundant spoke of an open boundary fan is removed.
        private static bool DryBoundaryDiagonal(RoaSectorSurface.Profile p,int ix,int iz,int n,
            Vector3 a,Vector3 b,Vector3 c,Vector3 d)
        {
            if(ix!=0&&ix!=n-1&&iz!=0&&iz!=n-1)return false;
            if(p.waterVertices==null||p.waterVertices.Length==0||p.waterIndices==null||p.waterIndices.Length==0)return false;
            if(!BoundaryWaters.TryGetValue(p,out BoundaryWater water)||water.source!=p.waterVertices||water.ids!=p.waterIndices)
            {
                water=new BoundaryWater{source=p.waterVertices,ids=p.waterIndices};
                var edges=new Dictionary<(int,int),int>();
                for(int i=0;i<p.waterIndices.Length;i+=3)
                {
                    int ia=p.waterIndices[i],ib=p.waterIndices[i+1],ic=p.waterIndices[i+2];
                    var tri=new[]{p.waterVertices[ia].Vector,p.waterVertices[ib].Vector,p.waterVertices[ic].Vector};
                    if(Math.Abs(AreaXZ(tri[0],tri[1],tri[2]))<1e-9)continue;
                    water.triangles.Add(tri);
                    foreach(var pair in new[]{(ia,ib),(ib,ic),(ic,ia)})
                    {
                        var key=pair.Item1<pair.Item2?pair:(pair.Item2,pair.Item1);
                        edges.TryGetValue(key,out int count);edges[key]=count+1;
                    }
                }
                var rootIds=new HashSet<int>();
                foreach(var edge in edges)if(edge.Value==1){rootIds.Add(edge.Key.Item1);rootIds.Add(edge.Key.Item2);}
                foreach(int id in rootIds)
                {
                    Vector3 v=p.waterVertices[id].Vector;
                    if(Math.Abs(Math.Abs((double)v.x)-p.width/2d)<=.00002||Math.Abs(Math.Abs((double)v.z)-p.depth/2d)<=.00002)
                        water.roots.Add(v);
                }
                BoundaryWaters[p]=water;
            }
            bool Root(Vector3 v)
            {
                foreach(Vector3 q in water.roots)
                {double dx=(double)q.x-v.x,dz=(double)q.z-v.z;if(dx*dx+dz*dz<=4e-10)return true;}
                return false;
            }
            if(Root(a)||Root(d)||(Root(b)?1:0)+(Root(c)?1:0)!=1)return false;
            var quad=new[]{a,c,d,b};
            for(int k=0;k<4;k++)
            {
                Vector3 q=quad[k],r=quad[(k+1)%4],s=quad[(k+2)%4];
                float nativeCross=(r.x-q.x)*(s.z-q.z)-(r.z-q.z)*(s.x-q.x);
                if(AreaXZ(q,r,s)>=-1e-7||nativeCross>=-1e-7)return false;
            }
            double minX=Math.Min(Math.Min(a.x,b.x),Math.Min(c.x,d.x)),maxX=Math.Max(Math.Max(a.x,b.x),Math.Max(c.x,d.x));
            double minZ=Math.Min(Math.Min(a.z,b.z),Math.Min(c.z,d.z)),maxZ=Math.Max(Math.Max(a.z,b.z),Math.Max(c.z,d.z));
            foreach(Vector3[] tri in water.triangles)
            {
                if(Math.Max(tri[0].x,Math.Max(tri[1].x,tri[2].x))<minX||Math.Min(tri[0].x,Math.Min(tri[1].x,tri[2].x))>maxX||
                   Math.Max(tri[0].z,Math.Max(tri[1].z,tri[2].z))<minZ||Math.Min(tri[0].z,Math.Min(tri[1].z,tri[2].z))>maxZ)continue;
                var clipped=new List<(double x,double z)>();foreach(Vector3 v in quad)clipped.Add((v.x,v.z));
                double sign=Math.Sign(AreaXZ(tri[0],tri[1],tri[2]));
                for(int k=0;k<3&&clipped.Count>=3;k++)
                {
                    var next=new List<(double x,double z)>();Vector3 u=tri[k],v=tri[(k+1)%3];
                    double Side((double x,double z) q)=>sign*(((double)v.x-u.x)*(q.z-u.z)-((double)v.z-u.z)*(q.x-u.x));
                    for(int j=0;j<clipped.Count;j++)
                    {
                        var q=clipped[j];var r=clipped[(j+1)%clipped.Count];double sq=Side(q),sr=Side(r);
                        if(sq>=0)next.Add(q);
                        if((sq<0)!=(sr<0)){double t=sq/(sq-sr);next.Add((q.x+(r.x-q.x)*t,q.z+(r.z-q.z)*t));}
                    }
                    clipped=next;
                }
                double twiceArea=0;
                for(int k=1;k+1<clipped.Count;k++)
                    twiceArea+=(clipped[k].x-clipped[0].x)*(clipped[k+1].z-clipped[0].z)-
                               (clipped[k].z-clipped[0].z)*(clipped[k+1].x-clipped[0].x);
                if(Math.Abs(twiceArea)>0)return false;
            }
            // The two piecewise-linear surfaces differ most at the diagonal
            // intersection. This geometry edit is bounded to 5 mm, not a probe tolerance.
            double oldX=(double)c.x-b.x,oldZ=(double)c.z-b.z,newX=(double)d.x-a.x,newZ=(double)d.z-a.z;
            double den=oldX*newZ-oldZ*newX;
            if(Math.Abs(den)<1e-7)return false;
            double tOld=(((double)a.x-b.x)*newZ-((double)a.z-b.z)*newX)/den;
            double tNew=(((double)a.x-b.x)*oldZ-((double)a.z-b.z)*oldX)/den;
            if(tOld<=0||tOld>=1||tNew<=0||tNew>=1)return false;
            return Math.Abs(b.y+((double)c.y-b.y)*tOld-(a.y+((double)d.y-a.y)*tNew))<=.005;
        }

        // This exact mesh supplies all refined cells to both overview LODs.
        // Their unmodified inland cells may be simplified separately.
        public static Mesh BuildOverview(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Cell[] patches)
        {
            int n=p.terrainSegments==256?256:128,side=n+1;
            var vertices=new Vector3[side*side];var uv=new Vector2[vertices.Length];var ids=new int[n*n*6];int next=0;
            for(int iz=0;iz<=n;iz++)for(int ix=0;ix<=n;ix++)
            {
                Vector3 world=RoaSectorSurface.GridVertex(p,relief,ix,iz,n);
                int at=iz*side+ix;
                vertices[at]=world;
                Vector2 map=RoaSectorSurface.MapPoint(p,world.x,world.z);uv[at]=new Vector2(map.x/380,map.y/300);
                if(ix==n||iz==n)continue;
                int a=at,b=at+1,c=at+side,d=c+1;
                ids[next++]=a;ids[next++]=c;ids[next++]=b;
                ids[next++]=b;ids[next++]=c;ids[next++]=d;
            }
            var regular=new Mesh{name="WorldSectorGround_"+p.zoneId+"_Fine",indexFormat=IndexFormat.UInt32,
                vertices=vertices,triangles=ids,uv=uv};
            Mesh patched=Apply(p,regular,null,patches,(x,z)=>{
                Vector2 map=RoaSectorSurface.MapPoint(p,x,z);return new Vector2(map.x/380,map.y/300);
            });
            if(Application.isPlaying)UnityEngine.Object.Destroy(regular);else UnityEngine.Object.DestroyImmediate(regular);
            return patched;
        }

        // The input mesh must contain the unmodified complete (n+1)^2 lattice
        // in row-major order. Existing UVs of all original vertices are kept.
        public static Mesh Apply(RoaSectorSurface.Profile profile,Mesh regular,Transform transform,
            Cell[] patches,Func<float,float,Vector2> uvAt)
        {
            if(patches==null || patches.Length==0)return regular;
            int n=profile.terrainSegments==256?256:128,side=n+1;
            Vector3[] old=regular.vertices;
            if(old.Length!=side*side)throw new InvalidOperationException("Shore patch requires a complete regular grid");
            Vector2[] oldUv=regular.uv;
            var cells=new Dictionary<int,Cell>();
            foreach(Cell cell in patches)
            {
                if(cell.ix<0||cell.ix>=n||cell.iz<0||cell.iz>=n||cell.indices.Length%3!=0)
                    throw new InvalidOperationException("Malformed shoreline patch cell");
                int key=cell.iz*n+cell.ix;
                if(cells.ContainsKey(key))throw new InvalidOperationException("Duplicate shoreline patch cell "+key);
                cells.Add(key,cell);
            }
            var vertices=new List<Vector3>(old);var uv=new List<Vector2>(oldUv);
            var triangles=new List<int>(regular.triangles.Length+patches.Length*36);
            var index=new Dictionary<(int,int,int),int>();
            Vector3 World(Vector3 local)=>transform==null?local:transform.TransformPoint(local);
            Vector3 Local(Vector3 world)=>transform==null?world:transform.InverseTransformPoint(world);
            (int,int,int) Key(Vector3 v)=>(Mathf.RoundToInt(v.x*10000),Mathf.RoundToInt(v.y*10000),Mathf.RoundToInt(v.z*10000));
            for(int i=0;i<old.Length;i++)index[Key(World(old[i]))]=i;
            int Add(Vector3 world)
            {
                var key=Key(world);
                if(index.TryGetValue(key,out int known))return known;
                int id=vertices.Count;index.Add(key,id);vertices.Add(Local(world));uv.Add(uvAt(world.x,world.z));return id;
            }
            int At(int ix,int iz)=>iz*side+ix;
            void Emit(int ia,int ib,int ic)
            {
                Vector3 a=World(vertices[ia]),b=World(vertices[ib]),c=World(vertices[ic]);
                float cross=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
                if(Mathf.Abs(cross)<.0000001f)return;
                if(cross>0){triangles.Add(ia);triangles.Add(ic);triangles.Add(ib);}
                else {triangles.Add(ia);triangles.Add(ib);triangles.Add(ic);}
            }
            // An unpatched neighbor is stitched on the *original two planes*.
            // Its extra edge vertices never replace a native gameplay height.
            List<Vector3> SplitEdge(Vector3 start,Vector3 end,Cell neighbor)
            {
                var outPoints=new List<(float t,Vector3 point)>();
                if(neighbor==null)return new List<Vector3>();
                Vector2 a=new Vector2(start.x,start.z),b=new Vector2(end.x,end.z),d=b-a;
                foreach(Vertex v in neighbor.vertices)
                {
                    Vector3 q=v.Vector;Vector2 flat=new Vector2(q.x,q.z);
                    float t=Vector2.Dot(flat-a,d)/d.sqrMagnitude;
                    if(t<=.00001f||t>=.99999f||Vector2.Distance(flat,a+d*t)>.00003f)continue;
                    float expected=Mathf.Lerp(start.y,end.y,t);
                    if(Mathf.Abs(q.y-expected)>.0015f)throw new InvalidOperationException("Nonplanar shoreline patch seam");
                    outPoints.Add((t,q));
                }
                outPoints.Sort((u,v)=>u.t.CompareTo(v.t));
                var distinct=new List<Vector3>();
                foreach(var item in outPoints)
                    if(distinct.Count==0||Vector3.Distance(distinct[distinct.Count-1],item.point)>.00002f)
                        distinct.Add(item.point);
                return distinct;
            }
            Cell Neighbor(int ix,int iz)=>ix>=0&&ix<n&&iz>=0&&iz<n&&cells.TryGetValue(iz*n+ix,out Cell found)?found:null;
            void Fan(Vector3 center,List<Vector3> edge)
            {
                int mid=Add(center);
                for(int i=0;i+1<edge.Count;i++)Emit(mid,Add(edge[i]),Add(edge[i+1]));
            }
            for(int iz=0;iz<n;iz++)for(int ix=0;ix<n;ix++)
            {
                if(cells.TryGetValue(iz*n+ix,out Cell patch))
                {
                    foreach(int patchIndex in patch.indices)
                        if(patchIndex<0||patchIndex>=patch.vertices.Length)throw new InvalidOperationException("Invalid shoreline patch index");
                    for(int k=0;k<patch.indices.Length;k+=3)
                        Emit(Add(patch.vertices[patch.indices[k]].Vector),Add(patch.vertices[patch.indices[k+1]].Vector),
                             Add(patch.vertices[patch.indices[k+2]].Vector));
                    continue;
                }
                int ia=At(ix,iz),ib=At(ix+1,iz),ic=At(ix,iz+1),id=At(ix+1,iz+1);
                Cell left=Neighbor(ix-1,iz),right=Neighbor(ix+1,iz),below=Neighbor(ix,iz-1),above=Neighbor(ix,iz+1);
                if(left==null&&right==null&&below==null&&above==null)
                {
                    if(DryBoundaryDiagonal(profile,ix,iz,n,World(old[ia]),World(old[ib]),World(old[ic]),World(old[id])))
                    {Emit(ia,ic,id);Emit(ia,id,ib);}
                    else {Emit(ia,ic,ib);Emit(ib,ic,id);}
                    continue;
                }
                Vector3 a=World(old[ia]),b=World(old[ib]),c=World(old[ic]),d=World(old[id]);
                Vector3 middle=(b+c)*.5f;
                var first=new List<Vector3>{c};
                var leftSplit=SplitEdge(a,c,left);leftSplit.Reverse();first.AddRange(leftSplit);
                first.Add(a);first.AddRange(SplitEdge(a,b,below));first.Add(b);
                Fan(middle,first);
                var second=new List<Vector3>{b};
                second.AddRange(SplitEdge(b,d,right));second.Add(d);
                var topSplit=SplitEdge(c,d,above);topSplit.Reverse();second.AddRange(topSplit);second.Add(c);
                Fan(middle,second);
            }
            var mesh=new Mesh{name=regular.name+"_ShorePatch",indexFormat=IndexFormat.UInt32};
            mesh.SetVertices(vertices);mesh.SetUVs(0,uv);mesh.SetTriangles(triangles,0);
            mesh.RecalculateNormals();mesh.RecalculateBounds();return mesh;
        }
    }
}
