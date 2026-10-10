using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Subtracts authored map cells without losing vertex attributes outside them.</summary>
    internal static class RoaWorldSurfaceMeshClip
    {
        private struct Vertex
        {
            public Vector3 p,n;public Vector4 tangent;public Vector2 uv,uv2;public Color color;
            public static Vertex Lerp(Vertex a,Vertex b,float t)=>new Vertex {p=Vector3.Lerp(a.p,b.p,t),n=Vector3.Lerp(a.n,b.n,t),
                tangent=Vector4.Lerp(a.tangent,b.tangent,t),uv=Vector2.Lerp(a.uv,b.uv,t),uv2=Vector2.Lerp(a.uv2,b.uv2,t),color=Color.Lerp(a.color,b.color,t)};
        }
        public static Mesh Subtract(Mesh source,Transform meshTransform,Transform mapTransform,Rect[] cells)
            =>SubtractPolygons(source,meshTransform,mapTransform,cells.Select(c=>new[]{new Vector2(c.xMin,c.yMin),new Vector2(c.xMax,c.yMin),new Vector2(c.xMax,c.yMax),new Vector2(c.xMin,c.yMax)}).ToArray(),"_OutsidePreparedCells");

        /// <summary>Ground decoration must terminate at the authored water footprint, even where its mesh floats above the river.</summary>
        public static Mesh SubtractWater(Mesh source,Transform meshTransform,Transform mapTransform,Vector2[][] water)
            =>SubtractPolygons(source,meshTransform,mapTransform,water,"_OutsideAuthoredWater");

        /// <summary>Intersect decoration with the real land triangles and use their plane, including holes in the land footprint.</summary>
        public static Mesh ProjectGround(Mesh source,Transform meshTransform,Transform mapTransform,Mesh land,Transform landTransform)
        {
            Vertex[] input=ReadVertices(source,meshTransform,mapTransform),ground=ReadVertices(land,landTransform,mapTransform);
            int[] ids=land.triangles;const float size=2;
            var buckets=new Dictionary<Vector2Int,List<int>>();
            Rect Bounds(Vertex a,Vertex b,Vertex c)=>Rect.MinMaxRect(Mathf.Min(a.p.x,b.p.x,c.p.x),Mathf.Min(a.p.z,b.p.z,c.p.z),Mathf.Max(a.p.x,b.p.x,c.p.x),Mathf.Max(a.p.z,b.p.z,c.p.z));
            IEnumerable<Vector2Int> Keys(Rect box)
            {
                for(int z=Mathf.FloorToInt(box.yMin/size);z<=Mathf.FloorToInt(box.yMax/size);z++)
                    for(int x=Mathf.FloorToInt(box.xMin/size);x<=Mathf.FloorToInt(box.xMax/size);x++)yield return new Vector2Int(x,z);
            }
            for(int i=0;i<ids.Length;i+=3)
                foreach(var key in Keys(Bounds(ground[ids[i]],ground[ids[i+1]],ground[ids[i+2]])))
                {
                    if(!buckets.TryGetValue(key,out var list))buckets.Add(key,list=new List<int>());list.Add(i);
                }
            var result=new List<Vertex>();var distinct=new Dictionary<Vertex,int>();var submeshes=new List<int>[source.subMeshCount];
            int Add(Vertex v){if(distinct.TryGetValue(v,out int id))return id;id=result.Count;distinct.Add(v,id);result.Add(v);return id;}
            for(int sub=0;sub<submeshes.Length;sub++)
            {
                var output=submeshes[sub]=new List<int>();int[] triangles=source.GetTriangles(sub);
                for(int i=0;i<triangles.Length;i+=3)
                {
                    Vertex a=input[triangles[i]],b=input[triangles[i+1]],c=input[triangles[i+2]];Rect box=Bounds(a,b,c);
                    var candidates=new HashSet<int>();foreach(var key in Keys(box))if(buckets.TryGetValue(key,out var list))foreach(int id in list)candidates.Add(id);
                    foreach(int id in candidates.OrderBy(v=>v))
                    {
                        Vertex ga=ground[ids[id]],gb=ground[ids[id+1]],gc=ground[ids[id+2]];Rect groundBox=Bounds(ga,gb,gc);
                        if(groundBox.xMin>=box.xMax||groundBox.xMax<=box.xMin||groundBox.yMin>=box.yMax||groundBox.yMax<=box.yMin)continue;
                        float den=(gb.p.z-gc.p.z)*(ga.p.x-gc.p.x)+(gc.p.x-gb.p.x)*(ga.p.z-gc.p.z);
                        if(Mathf.Abs(den)<1e-10f)continue;
                        var edges=den>0?new[]{ga.p,gb.p,gc.p}:new[]{ga.p,gc.p,gb.p};
                        var polygon=new List<Vertex>{a,b,c};
                        for(int plane=0;plane<3&&polygon.Count>0;plane++)
                        {
                            Vector3 startEdge=edges[plane],edge=edges[(plane+1)%3]-startEdge;var inside=new List<Vertex>();
                            float Distance(Vertex v)=>edge.x*(v.p.z-startEdge.z)-edge.z*(v.p.x-startEdge.x);
                            for(int j=0;j<polygon.Count;j++)
                            {
                                Vertex start=polygon[j],end=polygon[(j+1)%polygon.Count];float ds=Distance(start),de=Distance(end);
                                if(ds>=0)inside.Add(start);
                                if((ds<0)!=(de<0))inside.Add(Vertex.Lerp(start,end,ds/(ds-de)));
                            }
                            polygon=inside;
                        }
                        for(int j=0;j<polygon.Count;j++)
                        {
                            Vertex v=polygon[j];float u=((gb.p.z-gc.p.z)*(v.p.x-gc.p.x)+(gc.p.x-gb.p.x)*(v.p.z-gc.p.z))/den;
                            float w=((gc.p.z-ga.p.z)*(v.p.x-gc.p.x)+(ga.p.x-gc.p.x)*(v.p.z-gc.p.z))/den;
                            v.p.y=u*ga.p.y+w*gb.p.y+(1-u-w)*gc.p.y+.002f;
                            v.n=(u*ga.n+w*gb.n+(1-u-w)*gc.n).normalized;polygon[j]=v;
                        }
                        for(int j=1;j+1<polygon.Count;j++)
                        {
                            if(Vector3.Cross(polygon[j].p-polygon[0].p,polygon[j+1].p-polygon[0].p).sqrMagnitude<1e-16f)continue;
                            output.Add(Add(polygon[0]));output.Add(Add(polygon[j]));output.Add(Add(polygon[j+1]));
                        }
                    }
                }
            }
            return BuildMesh(source.name+"_OnCanonicalLand",result,submeshes,meshTransform,mapTransform);
        }

        public static Vector2[][] WaterFootprints(IEnumerable<(Mesh mesh,Transform transform)> sources,Transform mapTransform)
        {
            var footprints=new List<Vector2[]>();
            foreach(var source in sources)
            {
                Vector2[] positions=source.mesh.vertices.Select(v=>{
                    Vector3 p=mapTransform.InverseTransformPoint(source.transform.TransformPoint(v));return new Vector2(p.x,p.z);
                }).ToArray();
                int[] triangles=source.mesh.triangles;
                for(int i=0;i<triangles.Length;i+=3)
                {
                    Vector2 a=positions[triangles[i]],b=positions[triangles[i+1]],c=positions[triangles[i+2]];
                    float cross=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
                    if(Mathf.Abs(cross)<1e-10f)continue;
                    footprints.Add(cross>0?new[]{a,b,c}:new[]{a,c,b});
                }
            }
            return footprints.ToArray();
        }

        private static Mesh SubtractPolygons(Mesh source,Transform meshTransform,Transform mapTransform,Vector2[][] cuts,string suffix)
        {
            var bounds=cuts.Select(c=>Rect.MinMaxRect(c.Min(v=>v.x),c.Min(v=>v.y),c.Max(v=>v.x),c.Max(v=>v.y))).ToArray();
            // Restrict clipping to nearby footprints; this also keeps full-map generation practical.
            const float bucketSize=2;
            var buckets=new Dictionary<Vector2Int,List<int>>();
            for(int i=0;i<bounds.Length;i++)
                for(int z=Mathf.FloorToInt(bounds[i].yMin/bucketSize);z<=Mathf.FloorToInt(bounds[i].yMax/bucketSize);z++)
                    for(int x=Mathf.FloorToInt(bounds[i].xMin/bucketSize);x<=Mathf.FloorToInt(bounds[i].xMax/bucketSize);x++)
                    {
                        var key=new Vector2Int(x,z);
                        if(!buckets.TryGetValue(key,out var list))buckets.Add(key,list=new List<int>());
                        list.Add(i);
                    }
            Vertex[] vertices=ReadVertices(source,meshTransform,mapTransform);
            var result=new List<Vertex>();var distinct=new Dictionary<Vertex,int>();var submeshes=new List<int>[source.subMeshCount];
            int Add(Vertex v){if(distinct.TryGetValue(v,out int id))return id;id=result.Count;distinct.Add(v,id);result.Add(v);return id;}
            for(int sub=0;sub<source.subMeshCount;sub++)
            {
                var output=submeshes[sub]=new List<int>();int[] triangles=source.GetTriangles(sub);
                for(int i=0;i<triangles.Length;i+=3)
                {
                    Vertex a=vertices[triangles[i]],b=vertices[triangles[i+1]],c=vertices[triangles[i+2]];
                    var bbox=Rect.MinMaxRect(Mathf.Min(a.p.x,b.p.x,c.p.x),Mathf.Min(a.p.z,b.p.z,c.p.z),Mathf.Max(a.p.x,b.p.x,c.p.x),Mathf.Max(a.p.z,b.p.z,c.p.z));
                    var pieces=new List<List<Vertex>> {new List<Vertex>{a,b,c}};
                    var nearby=new HashSet<int>();
                    for(int z=Mathf.FloorToInt(bbox.yMin/bucketSize);z<=Mathf.FloorToInt(bbox.yMax/bucketSize);z++)
                        for(int x=Mathf.FloorToInt(bbox.xMin/bucketSize);x<=Mathf.FloorToInt(bbox.xMax/bucketSize);x++)
                            if(buckets.TryGetValue(new Vector2Int(x,z),out var list))foreach(int cut in list)nearby.Add(cut);
                    foreach(int cut in nearby.OrderBy(id=>id))
                    {
                        Rect cell=bounds[cut];Vector2[] edges=cuts[cut];
                        if(cell.xMin>=bbox.xMax || cell.xMax<=bbox.xMin || cell.yMin>=bbox.yMax || cell.yMax<=bbox.yMin)continue;
                        var remaining=new List<List<Vertex>>();
                        foreach(var original in pieces)
                        {
                            List<Vertex> polygon=original;
                            for(int plane=0;plane<edges.Length && polygon.Count>0;plane++)
                            {
                                var inside=new List<Vertex>();var outside=new List<Vertex>();
                                Vector2 startEdge=edges[plane],edge=edges[(plane+1)%edges.Length]-startEdge;
                                float Distance(Vertex v)=>edge.x*(v.p.z-startEdge.y)-edge.y*(v.p.x-startEdge.x);
                                for(int j=0;j<polygon.Count;j++)
                                {
                                    Vertex start=polygon[j],end=polygon[(j+1)%polygon.Count];float ds=Distance(start),de=Distance(end);
                                    (ds>=0?inside:outside).Add(start);
                                    if((ds<0)!=(de<0)){Vertex split=Vertex.Lerp(start,end,ds/(ds-de));inside.Add(split);outside.Add(split);}
                                }
                                if(outside.Count>=3)remaining.Add(outside);polygon=inside;
                            }
                        }
                        pieces=remaining;if(pieces.Count==0)break;
                    }
                    foreach(var polygon in pieces)for(int j=1;j+1<polygon.Count;j++)
                    {
                        if(Vector3.Cross(polygon[j].p-polygon[0].p,polygon[j+1].p-polygon[0].p).sqrMagnitude<1e-16f)continue;
                        output.Add(Add(polygon[0]));output.Add(Add(polygon[j]));output.Add(Add(polygon[j+1]));
                    }
                }
            }
            return BuildMesh(source.name+suffix,result,submeshes,meshTransform,mapTransform);
        }
        private static Vertex[] ReadVertices(Mesh source,Transform meshTransform,Transform mapTransform)
        {
            Vector3[] positions=source.vertices,normals=source.normals;Vector4[] tangents=source.tangents;
            Vector2[] uv=source.uv,uv2=source.uv2;Color[] colors=source.colors;
            var vertices=new Vertex[positions.Length];
            for(int i=0;i<vertices.Length;i++)vertices[i]=new Vertex {p=mapTransform.InverseTransformPoint(meshTransform.TransformPoint(positions[i])),
                n=normals.Length==vertices.Length?mapTransform.InverseTransformDirection(meshTransform.TransformDirection(normals[i])):Vector3.up,
                tangent=tangents.Length==vertices.Length?tangents[i]:new Vector4(1,0,0,1),uv=uv.Length==vertices.Length?uv[i]:Vector2.zero,
                uv2=uv2.Length==vertices.Length?uv2[i]:Vector2.zero,color=colors.Length==vertices.Length?colors[i]:Color.white};
            return vertices;
        }
        private static Mesh BuildMesh(string name,List<Vertex> result,List<int>[] submeshes,Transform meshTransform,Transform mapTransform)
        {
            var mesh=new Mesh {name=name,indexFormat=IndexFormat.UInt32};
            mesh.vertices=result.Select(v=>meshTransform.InverseTransformPoint(mapTransform.TransformPoint(v.p))).ToArray();
            mesh.normals=result.Select(v=>meshTransform.InverseTransformDirection(mapTransform.TransformDirection(v.n)).normalized).ToArray();
            mesh.tangents=result.Select(v=>v.tangent).ToArray();mesh.uv=result.Select(v=>v.uv).ToArray();mesh.uv2=result.Select(v=>v.uv2).ToArray();
            mesh.colors=result.Select(v=>v.color).ToArray();mesh.subMeshCount=submeshes.Length;
            for(int i=0;i<submeshes.Length;i++)mesh.SetTriangles(submeshes[i],i);
            mesh.RecalculateBounds();return mesh;
        }
    }
}
