using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Height on saved surface triangles without gameplay colliders.</summary>
    public sealed class RoaMeshSurfaceHeight
    {
        private const int Side=32;
        private readonly Vector3[] _vertices;
        private readonly int[] _indices;
        private readonly Dictionary<int,List<int>> _buckets=new Dictionary<int,List<int>>();
        public readonly Bounds Bounds;
        public RoaMeshSurfaceHeight(Mesh mesh):this(mesh.vertices,mesh.triangles,mesh.bounds){}
        public RoaMeshSurfaceHeight(Vector3[] vertices,int[] indices):this(vertices,indices,Extent(vertices)){}
        private static Bounds Extent(Vector3[] vertices)
        {
            if(vertices.Length==0)throw new System.ArgumentException("Empty terrain mesh");
            var bounds=new Bounds(vertices[0],Vector3.zero);
            for(int i=1;i<vertices.Length;i++)bounds.Encapsulate(vertices[i]);
            return bounds;
        }
        private RoaMeshSurfaceHeight(Vector3[] vertices,int[] indices,Bounds bounds)
        {
            _vertices=vertices;_indices=indices;Bounds=bounds;
            for(int i=0;i<_indices.Length;i+=3)
            {
                Vector3 a=_vertices[_indices[i]],b=_vertices[_indices[i+1]],c=_vertices[_indices[i+2]];
                for(int z=Z(Mathf.Min(a.z,b.z,c.z));z<=Z(Mathf.Max(a.z,b.z,c.z));z++)for(int x=X(Mathf.Min(a.x,b.x,c.x));x<=X(Mathf.Max(a.x,b.x,c.x));x++)
                {int key=z*Side+x;if(!_buckets.TryGetValue(key,out var list))_buckets[key]=list=new List<int>();list.Add(i);}
            }
        }
        private int X(float x)=>Mathf.Clamp(Mathf.FloorToInt((x-Bounds.min.x)/Bounds.size.x*Side),0,Side-1);
        private int Z(float z)=>Mathf.Clamp(Mathf.FloorToInt((z-Bounds.min.z)/Bounds.size.z*Side),0,Side-1);
        public bool TryHeight(float x,float z,out float height)
        {
            height=0;
            if(x<Bounds.min.x-.00001f||x>Bounds.max.x+.00001f||z<Bounds.min.z-.00001f||z>Bounds.max.z+.00001f)return false;
            if(!_buckets.TryGetValue(Z(z)*Side+X(x),out var candidates))return false;
            bool found=false,contained=false;
            foreach(int index in candidates)
            {
                Vector3 a=_vertices[_indices[index]],b=_vertices[_indices[index+1]],c=_vertices[_indices[index+2]];
                // Keep the saved float vertices, but evaluate their plane in
                // double precision. Thin bank triangles can lose centimetres
                // when the barycentric numerator cancels in float arithmetic.
                double az=(double)a.z-c.z,ax=(double)a.x-c.x,
                    bz=(double)b.z-c.z,bx=(double)b.x-c.x,
                    qx=(double)x-c.x,qz=(double)z-c.z;
                double den=bz*ax-bx*az;if(System.Math.Abs(den)<.0000001)continue;
                double u=(bz*qx-bx*qz)/den,w=(-az*qx+ax*qz)/den;
                if(u<-.00002f||w<-.00002f||u+w>1.00002f)continue;
                bool inside=u>=-1e-10&&w>=-1e-10&&u+w<=1+1e-10;
                float hit=(float)(u*a.y+w*b.y+(1-u-w)*c.y);
                // Prefer a containing triangle over extrapolation from a
                // neighbouring steep face. Keep edge fallback for a point
                // with no containing triangle after float serialization.
                if(contained&&!inside)continue;
                if(inside&&!contained){height=hit;found=true;contained=true;continue;}
                if(!found||hit>height)height=hit;found=true;
            }
            return found;
        }
    }
}
