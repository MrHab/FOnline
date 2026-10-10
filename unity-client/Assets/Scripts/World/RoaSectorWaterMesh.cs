using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>Intersect authored water with the actual playable terrain planes.</summary>
    public static class RoaSectorWaterMesh
    {
        private readonly struct Point
        {
            public readonly double x,y,z;
            public Point(double x,double y,double z){this.x=x;this.y=y;this.z=z;}
            public Point(Vector3 value):this(value.x,value.y,value.z){}
            public Vector3 Vector=>new Vector3((float)x,(float)y,(float)z);
            public static Point operator -(Point a,Point b)=>new Point(a.x-b.x,a.y-b.y,a.z-b.z);
            public static Point Lerp(Point a,Point b,double t)=>new Point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
        }
        public static Mesh Build(RoaSectorSurface.Profile p,Vector3[] ground,int segments,int[] groundIndices=null)
        {
            var vertices=new List<Vector3>();var indices=new List<int>();var flow=new List<Vector3>();var lookup=new Dictionary<Vector3,int>();
            int side=segments+1;
            for(int i=0;i<p.waterIndices.Length;i+=3)
            {
                Vector3 a=p.waterVertices[p.waterIndices[i]].Vector,b=p.waterVertices[p.waterIndices[i+1]].Vector,c=p.waterVertices[p.waterIndices[i+2]].Vector;
                int x0=Mathf.Clamp(Mathf.FloorToInt((Mathf.Min(a.x,b.x,c.x)/p.width+.5f)*segments)-1,0,segments-1),x1=Mathf.Clamp(Mathf.CeilToInt((Mathf.Max(a.x,b.x,c.x)/p.width+.5f)*segments)+1,0,segments-1);
                int z0=Mathf.Clamp(Mathf.FloorToInt((Mathf.Min(a.z,b.z,c.z)/p.depth+.5f)*segments)-1,0,segments-1),z1=Mathf.Clamp(Mathf.CeilToInt((Mathf.Max(a.z,b.z,c.z)/p.depth+.5f)*segments)+1,0,segments-1);
                if(groundIndices!=null)
                {
                    // A patched shoreline is an indexed ground mesh. Never
                    // reconstruct its old two triangles from lattice indices.
                    for(int j=0;j<groundIndices.Length;j+=3)
                    {
                        Vector3 ga=ground[groundIndices[j]],gb=ground[groundIndices[j+1]],gc=ground[groundIndices[j+2]];
                        float left=Mathf.Min(ga.x,gb.x,gc.x),right=Mathf.Max(ga.x,gb.x,gc.x);
                        float bottom=Mathf.Min(ga.z,gb.z,gc.z),top=Mathf.Max(ga.z,gb.z,gc.z);
                        if(right<Mathf.Min(a.x,b.x,c.x)||left>Mathf.Max(a.x,b.x,c.x)
                           ||top<Mathf.Min(a.z,b.z,c.z)||bottom>Mathf.Max(a.z,b.z,c.z))continue;
                        Intersect(a,b,c,ga,gb,gc);
                    }
                    continue;
                }
                for(int z=z0;z<=z1;z++)for(int x=x0;x<=x1;x++)
                {
                    int j=z*side+x;Intersect(a,b,c,ground[j],ground[j+side],ground[j+1]);Intersect(a,b,c,ground[j+1],ground[j+side],ground[j+side+1]);
                }
            }
            var mesh=new Mesh {name="SectorWater_"+p.zoneId,indexFormat=IndexFormat.UInt32};
            mesh.vertices=vertices.ToArray();mesh.triangles=indices.ToArray();mesh.SetUVs(1,flow);mesh.RecalculateNormals();mesh.RecalculateBounds();return mesh;
            void Intersect(Vector3 a,Vector3 b,Vector3 c,Vector3 ga,Vector3 gb,Vector3 gc)
            {
                // Intersect the actual saved float vertices in double precision.
                // Repeated float clipping can move the wet footprint noticeably
                // where the water and terrain planes are almost coincident.
                var polygon=new List<Point>{new Point(a),new Point(b),new Point(c)};
                Point[] triangle={new Point(ga),new Point(gb),new Point(gc)};
                Point u=triangle[1]-triangle[0],v=triangle[2]-triangle[0];
                double normalX=u.y*v.z-u.z*v.y,normalY=u.z*v.x-u.x*v.z,normalZ=u.x*v.y-u.y*v.x;
                if(System.Math.Abs(normalY)<.0000001)return;
                double orientation=System.Math.Sign(Cross(u,v));
                double Ground(Point point)=>triangle[0].y-(normalX*(point.x-triangle[0].x)+normalZ*(point.z-triangle[0].z))/normalY;
                for(int edge=0;edge<3&&polygon.Count>=3;edge++)
                {
                    Point start=triangle[edge],delta=triangle[(edge+1)%3]-start;
                    polygon=Clip(polygon,v=>Cross(delta,v-start)*orientation);
                }
                if(polygon.Count<3)return;
                polygon=Clip(polygon,v=>v.y-Ground(v));if(polygon.Count<3)return;
                int first=Vertex(polygon[0].Vector,(float)Ground(polygon[0]));
                for(int k=1;k+1<polygon.Count;k++)
                {
                    Point roundedA=new Point(polygon[0].Vector),roundedB=new Point(polygon[k].Vector),roundedC=new Point(polygon[k+1].Vector);
                    double area=Cross(roundedB-roundedA,roundedC-roundedA);
                    if(System.Math.Abs(area)<.0000001)continue;
                    int second=Vertex(polygon[k].Vector,(float)Ground(polygon[k])),third=Vertex(polygon[k+1].Vector,(float)Ground(polygon[k+1]));
                    if(area>0)indices.AddRange(new[]{first,third,second});else indices.AddRange(new[]{first,second,third});
                }
            }
            int Vertex(Vector3 point,float floor)
            {
                if(lookup.TryGetValue(point,out int found))return found;
                int index=vertices.Count;lookup[point]=index;vertices.Add(point);float distance=float.PositiveInfinity;
                var shoreline=p.physicalShore?.Length>0?p.physicalShore:p.visibleShore??p.waterEdges;
                foreach(var edge in shoreline)
                {
                    Vector2 a=new Vector2(edge.a.x,edge.a.z),b=new Vector2(edge.b.x,edge.b.z),q=new Vector2(point.x,point.z),d=b-a;
                    float t=d.sqrMagnitude>0?Mathf.Clamp01(Vector2.Dot(q-a,d)/d.sqrMagnitude):0;distance=Mathf.Min(distance,Vector2.Distance(q,a+d*t));
                }
                if(point.y-floor<.003f)distance=0;
                Vector2 map=RoaSectorSurface.MapPoint(p,point.x,point.z);flow.Add(new Vector3(map.x*16,-map.y*16,float.IsInfinity(distance)?100:distance));return index;
            }
        }
        private static List<Point> Clip(List<Point> polygon,System.Func<Point,double> distance)
        {
            var result=new List<Point>();
            for(int i=0;i<polygon.Count;i++)
            {
                Point a=polygon[i],b=polygon[(i+1)%polygon.Count];double da=distance(a),db=distance(b);
                if(da>=0)result.Add(a);if((da<0)!=(db<0))result.Add(Point.Lerp(a,b,da/(da-db)));
            }
            return result;
        }
        private static double Cross(Point a,Point b)=>a.x*b.z-a.z*b.x;
    }
}
