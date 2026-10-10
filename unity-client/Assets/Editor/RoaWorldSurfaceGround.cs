using System.Collections.Generic;
using System.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    // Keep the playable shore tessellation in both LODs. Inland cells alone
    // are simplified; shared sector edges retain the same 128 samples.
    internal static class RoaWorldSurfaceGround
    {
        private struct Cell {public int x,z,size;public Cell(int x,int z,int size){this.x=x;this.z=z;this.size=size;}}
        public static Mesh Build(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,int segments)
        {
            int Fine=RoaSectorRailInfrastructure.TerrainSegments(p);
            Mesh exact=p.surfacePatches?.Length>0
                ?RoaSurfaceCellPatches.BuildOverview(p,relief,p.surfacePatches):null;
            if(exact!=null&&segments>=Fine)return exact;
            int Key(int x,int z)=>z*(Fine+1)+x;
            var wet=new bool[Fine*Fine];
            if(exact!=null)
            foreach(var patch in p.surfacePatches)
                for(int dz=-1;dz<=1;dz++)for(int dx=-1;dx<=1;dx++)
                {int x=patch.ix+dx,z=patch.iz+dz;
                 if(x>=0&&z>=0&&x<Fine&&z<Fine)wet[z*Fine+x]=true;}
            for(int i=0;i<p.waterIndices.Length;i+=3)
            {
                var t=new[]{p.waterVertices[p.waterIndices[i]],p.waterVertices[p.waterIndices[i+1]],p.waterVertices[p.waterIndices[i+2]]};
                int x0=Mathf.Clamp(Mathf.FloorToInt((t.Min(v=>v.x)/p.width+.5f)*Fine)-1,0,Fine-1),x1=Mathf.Clamp(Mathf.CeilToInt((t.Max(v=>v.x)/p.width+.5f)*Fine)+1,0,Fine-1);
                int z0=Mathf.Clamp(Mathf.FloorToInt((t.Min(v=>v.z)/p.depth+.5f)*Fine)-1,0,Fine-1),z1=Mathf.Clamp(Mathf.CeilToInt((t.Max(v=>v.z)/p.depth+.5f)*Fine)+1,0,Fine-1);
                for(int z=z0;z<=z1;z++)for(int x=x0;x<=x1;x++)wet[z*Fine+x]=true;
            }
            foreach(var foundation in p.foundations)
            {
                float radius=Mathf.Sqrt(foundation.halfX*foundation.halfX+foundation.halfZ*foundation.halfZ)+foundation.blend;
                int x0=Mathf.Clamp(Mathf.FloorToInt(((foundation.x-radius)/p.width+.5f)*Fine),0,Fine-1),x1=Mathf.Clamp(Mathf.CeilToInt(((foundation.x+radius)/p.width+.5f)*Fine),0,Fine-1);
                int z0=Mathf.Clamp(Mathf.FloorToInt(((foundation.z-radius)/p.depth+.5f)*Fine),0,Fine-1),z1=Mathf.Clamp(Mathf.CeilToInt(((foundation.z+radius)/p.depth+.5f)*Fine),0,Fine-1);
                for(int z=z0;z<=z1;z++)for(int x=x0;x<=x1;x++)wet[z*Fine+x]=true;
            }
            foreach(var road in p.roads.Where(r=>r.type!="pipeline"&&!r.blocked))
            {
                var points=road.points?.Length>1?road.points:new[]{road.a,road.b};
                float margin=road.halfWidth+4+Mathf.Sqrt(p.width*p.width+p.depth*p.depth)/Fine;
                for(int i=1;i<points.Length;i++)
                {
                    Vector2 a=new Vector2(points[i-1].x,points[i-1].z),b=new Vector2(points[i].x,points[i].z),d=b-a;
                    int x0=Mathf.Clamp(Mathf.FloorToInt(((Mathf.Min(a.x,b.x)-margin)/p.width+.5f)*Fine),0,Fine-1),x1=Mathf.Clamp(Mathf.CeilToInt(((Mathf.Max(a.x,b.x)+margin)/p.width+.5f)*Fine),0,Fine-1);
                    int z0=Mathf.Clamp(Mathf.FloorToInt(((Mathf.Min(a.y,b.y)-margin)/p.depth+.5f)*Fine),0,Fine-1),z1=Mathf.Clamp(Mathf.CeilToInt(((Mathf.Max(a.y,b.y)+margin)/p.depth+.5f)*Fine),0,Fine-1);
                    for(int z=z0;z<=z1;z++)for(int x=x0;x<=x1;x++)
                    {
                        Vector2 at=new Vector2(((x+.5f)/Fine-.5f)*p.width,((z+.5f)/Fine-.5f)*p.depth);
                        float t=d.sqrMagnitude>0?Mathf.Clamp01(Vector2.Dot(at-a,d)/d.sqrMagnitude):0;
                        if(Vector2.Distance(at,a+d*t)<=margin)wet[z*Fine+x]=true;
                    }
                }
            }
            var leaves=new List<Cell>();int size=Fine/segments;
            foreach(var cell in RoaSectorRailInfrastructure.TerrainCoverCells(p))wet[cell.y*Fine+cell.x]=true;
            var exactVertices=exact?.vertices;var exactNormals=exact?.normals;var exactUv=exact?.uv;
            var exactByCell=new Dictionary<int,List<int>>();
            if(exact!=null)
            {
                bool Inside(Vector3 a,Vector3 b,Vector3 c,float x,float z)
                {
                    float d=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
                    if(Mathf.Abs(d)<1e-8f)return false;
                    float u=((b.x-x)*(c.z-z)-(b.z-z)*(c.x-x))/d,
                        v=((c.x-x)*(a.z-z)-(c.z-z)*(a.x-x))/d;
                    return u>=-1e-5f&&v>=-1e-5f&&u+v<=1.00001f;
                }
                int SourceCell(float x,float z)
                {
                    int ix=Mathf.FloorToInt((x/p.width+.5f)*Fine),
                        iz=Mathf.FloorToInt((z/p.depth+.5f)*Fine);
                    for(int zz=Mathf.Max(0,iz-1);zz<=Mathf.Min(Fine-1,iz+1);zz++)
                    for(int xx=Mathf.Max(0,ix-2);xx<=Mathf.Min(Fine-1,ix+2);xx++)
                    {
                        Vector3 a=exactVertices[Key(xx,zz)],b=exactVertices[Key(xx+1,zz)],
                            c=exactVertices[Key(xx,zz+1)],d=exactVertices[Key(xx+1,zz+1)];
                        if(Inside(a,c,b,x,z)||Inside(b,c,d,x,z))return zz*Fine+xx;
                    }
                    throw new System.InvalidOperationException("Indexed triangle has no original fine cell "+p.zoneId+" "+x+","+z);
                }
                int[] full=exact.triangles;
                for(int i=0;i<full.Length;i+=3)
                {
                    Vector3 a=exactVertices[full[i]],b=exactVertices[full[i+1]],c=exactVertices[full[i+2]];
                    float x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;
                    int key=SourceCell(x,z);
                    if(!exactByCell.TryGetValue(key,out var list))exactByCell[key]=list=new List<int>();
                    list.Add(full[i]);list.Add(full[i+1]);list.Add(full[i+2]);
                }
            }
            for(int z=0;z<Fine;z+=size)for(int x=0;x<Fine;x+=size)Split(x,z,size);
            var corners=new HashSet<int>();
            foreach(var c in leaves){corners.Add(Key(c.x,c.z));corners.Add(Key(c.x+c.size,c.z));corners.Add(Key(c.x,c.z+c.size));corners.Add(Key(c.x+c.size,c.z+c.size));}
            var vertices=new List<Vector3>();var normals=new List<Vector3>();var uv=new List<Vector2>();var indices=new List<int>();var lookup=new Dictionary<int,int>();
            var exactLookup=new Dictionary<int,int>();
            int ExactVertex(int original)
            {
                if(exactLookup.TryGetValue(original,out int known))return known;
                int at=vertices.Count;exactLookup.Add(original,at);
                vertices.Add(exactVertices[original]);
                normals.Add(exactNormals[original]);uv.Add(exactUv[original]);return at;
            }
            foreach(var c in leaves)
            {
                if(c.size==1)
                {
                    if(exact!=null)
                    {
                        if(!exactByCell.TryGetValue(c.z*Fine+c.x,out var list)||list.Count==0)
                            throw new System.InvalidOperationException("Adaptive fine triangle hole "+p.zoneId+" "+c.x+","+c.z);
                        foreach(int id in list)indices.Add(ExactVertex(id));
                        continue;
                    }
                    int a=Vertex(c.x,c.z),b=Vertex(c.x+1,c.z),d=Vertex(c.x+1,c.z+1),e=Vertex(c.x,c.z+1);
                    indices.AddRange(new[]{a,e,b,b,e,d});continue;
                }
                var boundary=new List<int>();
                for(int x=c.x;x<c.x+c.size;x++)if(corners.Contains(Key(x,c.z)))boundary.Add(Vertex(x,c.z));
                for(int z=c.z;z<c.z+c.size;z++)if(corners.Contains(Key(c.x+c.size,z)))boundary.Add(Vertex(c.x+c.size,z));
                for(int x=c.x+c.size;x>c.x;x--)if(corners.Contains(Key(x,c.z+c.size)))boundary.Add(Vertex(x,c.z+c.size));
                for(int z=c.z+c.size;z>c.z;z--)if(corners.Contains(Key(c.x,z)))boundary.Add(Vertex(c.x,z));
                int center=Vertex(c.x+c.size/2,c.z+c.size/2);
                for(int i=0;i<boundary.Count;i++)indices.AddRange(new[]{center,boundary[(i+1)%boundary.Count],boundary[i]});
            }
            var mesh=new Mesh {name="WorldSectorGround_"+p.zoneId+"_"+segments,indexFormat=IndexFormat.UInt32};
            if(segments==Fine)
            {
                var reverse=new int[vertices.Count];foreach(var pair in lookup)reverse[pair.Value]=pair.Key;
                var ordered=lookup.OrderBy(pair=>pair.Key).Select(pair=>pair.Value).ToArray();
                mesh.vertices=ordered.Select(i=>vertices[i]).ToArray();mesh.normals=ordered.Select(i=>normals[i]).ToArray();mesh.uv=ordered.Select(i=>uv[i]).ToArray();mesh.triangles=indices.Select(i=>reverse[i]).ToArray();
            }
            else {mesh.vertices=vertices.ToArray();mesh.normals=normals.ToArray();mesh.uv=uv.ToArray();mesh.triangles=indices.ToArray();}
            mesh.RecalculateBounds();return mesh;
            void Split(int x,int z,int n)
            {
                bool refine=x==0||z==0||x+n==Fine||z+n==Fine;
                for(int zz=z;zz<z+n&&!refine;zz++)for(int xx=x;xx<x+n;xx++)if(wet[zz*Fine+xx]){refine=true;break;}
                if(n==1||!refine){leaves.Add(new Cell(x,z,n));return;}
                int h=n/2;Split(x,z,h);Split(x+h,z,h);Split(x,z+h,h);Split(x+h,z+h,h);
            }
            int Vertex(int x,int z)
            {
                if(exact!=null)return ExactVertex(Key(x,z));
                int key=Key(x,z);if(lookup.TryGetValue(key,out int found))return found;
                Vector3 world=RoaSectorSurface.GridVertex(p,relief,x,z,Fine);
                float px=world.x,pz=world.z;
                int at=vertices.Count;lookup[key]=at;
                vertices.Add(world);
                float dx=RoaSectorSurface.Height(p,relief,px+.5f,pz)-RoaSectorSurface.Height(p,relief,px-.5f,pz),dz=RoaSectorSurface.Height(p,relief,px,pz+.5f)-RoaSectorSurface.Height(p,relief,px,pz-.5f);
                normals.Add(new Vector3(-dx,1,-dz).normalized);Vector2 map=RoaSectorSurface.MapPoint(p,px,pz);uv.Add(new Vector2(map.x/380,map.y/300));return at;
            }
        }
    }
}
