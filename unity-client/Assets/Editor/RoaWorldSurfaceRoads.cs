using System;
using System.Collections.Generic;
using System.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Drapes road ribbons onto the exact triangles of each overview LOD.</summary>
    internal static class RoaWorldSurfaceRoads
    {
        public static Mesh Build(RoaSectorSurface.Profile p,Mesh ground)
        {
            var output=new List<Vector3>();var indices=new List<int>();
            const float step=16;
            int columns=Mathf.CeilToInt(p.width/step),rows=Mathf.CeilToInt(p.depth/step);
            Vector3[] surface=ground.vertices;int[] groundIndices=ground.triangles;
            var heightSampler=new RoaMeshSurfaceHeight(ground);
            var buckets=new Dictionary<int,List<int>>();
            int X(float x)=>Mathf.Clamp(Mathf.FloorToInt((x+p.width/2)/step),0,columns-1);
            int Z(float z)=>Mathf.Clamp(Mathf.FloorToInt((z+p.depth/2)/step),0,rows-1);
            for(int i=0;i<groundIndices.Length;i+=3)
            {
                Vector3 a=surface[groundIndices[i]],b=surface[groundIndices[i+1]],c=surface[groundIndices[i+2]];
                for(int z=Z(Mathf.Min(a.z,b.z,c.z));z<=Z(Mathf.Max(a.z,b.z,c.z));z++)
                for(int x=X(Mathf.Min(a.x,b.x,c.x));x<=X(Mathf.Max(a.x,b.x,c.x));x++)
                {
                    int key=z*columns+x;if(!buckets.TryGetValue(key,out var list))buckets[key]=list=new List<int>();list.Add(i);
                }
            }
            foreach(var road in p.roads.Where(r=>!r.blocked && r.type!="pipeline" && r.type!="railway"))
            {
                var points=road.points?.Length>1?road.points:new[]{road.a,road.b};
                for(int i=1;i<points.Length;i++)
                {
                    Vector2 a=new Vector2(points[i-1].x,points[i-1].z),b=new Vector2(points[i].x,points[i].z);
                    if(Vector2.Distance(a,b)<.001f)continue;
                    Vector2 direction=(b-a).normalized,normal=new Vector2(-direction.y,direction.x)*road.halfWidth;
                    var ribbon=new List<Vector2>{a-normal,a+normal,b+normal,b-normal};
                    int minX=X(ribbon.Min(v=>v.x)),maxX=X(ribbon.Max(v=>v.x)),minZ=Z(ribbon.Min(v=>v.y)),maxZ=Z(ribbon.Max(v=>v.y));
                    var candidates=new HashSet<int>();
                    for(int z=minZ;z<=maxZ;z++)for(int x=minX;x<=maxX;x++)
                        if(buckets.TryGetValue(z*columns+x,out var list))foreach(int index in list)candidates.Add(index);
                    foreach(int index in candidates.OrderBy(k=>k))AddTriangle(ribbon,surface[groundIndices[index]],surface[groundIndices[index+1]],surface[groundIndices[index+2]]);
                }
            }
            var mesh=new Mesh {name="WorldSectorRoads_"+p.zoneId,indexFormat=IndexFormat.UInt32};
            mesh.vertices=output.ToArray();mesh.triangles=indices.ToArray();mesh.RecalculateNormals();mesh.RecalculateBounds();return mesh;
            void AddTriangle(List<Vector2> ribbon,Vector3 a,Vector3 b,Vector3 c)
            {
                var polygon=new List<Vector2>(ribbon);Vector2[] triangle={new Vector2(a.x,a.z),new Vector2(b.x,b.z),new Vector2(c.x,c.z)};
                double orientation=Turn(triangle[0],triangle[1],triangle[2]);
                if(orientation==0)return;
                for(int edge=0;edge<3 && polygon.Count>0;edge++)
                {
                    var result=new List<Vector2>();Vector2 start=triangle[edge],end=triangle[(edge+1)%3];
                    double Distance(Vector2 point)=>Turn(start,end,point)*Math.Sign(orientation);
                    for(int k=0;k<polygon.Count;k++)
                    {
                        Vector2 first=polygon[k],second=polygon[(k+1)%polygon.Count];double df=Distance(first),ds=Distance(second);
                        if(df>=0)result.Add(first);
                        if((df<0)!=(ds<0))
                        {
                            double t=df/(df-ds);
                            result.Add(new Vector2((float)((double)first.x+((double)second.x-first.x)*t),
                                (float)((double)first.y+((double)second.y-first.y)*t)));
                        }
                    }
                    polygon=result;
                }
                if(polygon.Count<3)return;
                int at=output.Count;
                foreach(Vector2 point in polygon)
                {
                    // Clipping stores Float32 XZ; a rounded point can cross a
                    // thin face edge. Drape onto the face containing that final point.
                    if(!heightSampler.TryHeight(point.x,point.y,out float groundHeight))
                        throw new InvalidOperationException("Overview road outside saved ground "+p.zoneId+" point="+point.ToString("R")+" triangle="+a.ToString("R")+"/"+b.ToString("R")+"/"+c.ToString("R")+" orientation="+orientation.ToString("R"));
                    float height=groundHeight+.035f*p.gain/160;
                    output.Add(new Vector3(point.x,height,point.y));
                }
                for(int k=1;k+1<polygon.Count;k++)
                {
                    if(Cross(polygon[k]-polygon[0],polygon[k+1]-polygon[0])>0){indices.Add(at);indices.Add(at+k+1);indices.Add(at+k);}
                    else {indices.Add(at);indices.Add(at+k);indices.Add(at+k+1);}
                }
            }
        }
        private static float Cross(Vector2 a,Vector2 b)=>a.x*b.y-a.y*b.x;
        private static double Turn(Vector2 a,Vector2 b,Vector2 c)=>
            ((double)b.x-a.x)*((double)c.y-a.y)-((double)b.y-a.y)*((double)c.x-a.x);
    }
}
