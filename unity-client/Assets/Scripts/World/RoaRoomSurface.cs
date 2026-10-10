using System;
using System.Collections.Generic;
using Kromka.Authoring;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Playable natural relief in retained raid and encounter rooms.</summary>
    public sealed class RoaRoomSurface : MonoBehaviour
    {
        [Serializable] public sealed class Feature {public float x,z,halfX,halfZ,height,flat;}
        [Serializable] public sealed class Foundation {public float x,z,halfX,halfZ,height,blend,rotationY;}
        [Serializable] public sealed class Profile {public string locationId,theme,surfaceStyle;public float width,depth;public int terrainSegments;public bool fixedAuthoredPoses;public Feature[] features;public Foundation[] foundations;public RoaSectorSurface.Route[] routes;}
        [Serializable] private sealed class Catalog {public Profile[] profiles;}
        [Serializable] private sealed class Pose {public Transform transform;public Vector3 position;}
        private static Dictionary<string,Profile> _profiles;
        private static RoaRoomSurface _active;
        [SerializeField] private string _locationId;
        [SerializeField] private Mesh _sourceMesh;
        [SerializeField] private Material _sourceMaterial;
        [SerializeField] private Collider[] _sourceColliders;
        [SerializeField] private bool[] _sourceEnabled;
        [SerializeField] private MeshCollider _surfaceCollider;
        [SerializeField] private Pose[] _poses;
        private Profile _profile;
        private Vector3[] _vertices;
        private int _segments=Segments;
        private const int Segments=128;
        public static bool Active=>_active!=null;
        public static Profile Find(string id)
        {
            if(_profiles==null)
            {
                _profiles=new Dictionary<string,Profile>(StringComparer.Ordinal);
                TextAsset source=Resources.Load<TextAsset>("RealmOfAshes/RoomSurfaces");
                if(source!=null)foreach(Profile p in JsonUtility.FromJson<Catalog>(source.text).profiles)_profiles.Add(p.locationId,p);
            }
            return id!=null && _profiles.TryGetValue(id,out Profile ready)?ready:null;
        }
        public static float Height(Profile p,float x,float z)
        {
            float h=0;
            foreach(Feature f in p.features)
            {
                float q=new Vector2((x-f.x)/f.halfX,(z-f.z)/f.halfZ).magnitude;
                float t=Mathf.Clamp01((q-f.flat)/(1-f.flat));
                h+=f.height*(1-t*t*(3-2*t));
            }
            foreach(Foundation f in p.foundations??Array.Empty<Foundation>())
            {
                float dx=x-f.x,dz=z-f.z,c=Mathf.Cos(f.rotationY),s=Mathf.Sin(f.rotationY);
                float d=new Vector2(Mathf.Max(0,Mathf.Abs(dx*c-dz*s)-f.halfX),Mathf.Max(0,Mathf.Abs(dx*s+dz*c)-f.halfZ)).magnitude;
                float t=Mathf.Clamp01(d/f.blend);h=f.height+(h-f.height)*t*t*(3-2*t);
            }
            return h;
        }
        public static float GroundHeightAt(float x,float z)
        {
            if(_active==null || _active._vertices==null)return 0;
            Profile p=_active._profile;
            int n=_active._segments;
            float gx=Mathf.Clamp((x/p.width+.5f)*n,0,n),gz=Mathf.Clamp((z/p.depth+.5f)*n,0,n);
            int ix=Mathf.Min(n-1,Mathf.FloorToInt(gx)),iz=Mathf.Min(n-1,Mathf.FloorToInt(gz));
            float u=gx-ix,v=gz-iz;int a=iz*(n+1)+ix;
            float ah=_active._vertices[a].y,bh=_active._vertices[a+1].y,ch=_active._vertices[a+n+1].y,dh=_active._vertices[a+n+2].y;
            return (u+v<=1?ah+(bh-ah)*u+(ch-ah)*v:dh+(ch-dh)*(1-u)+(bh-dh)*(1-v))+.05f;
        }
        public static bool Project(string id,Renderer ground)
        {
            Profile p=Find(id);if(p==null || ground==null)return false;
            var prior=ground.GetComponent<RoaRoomSurface>();if(prior!=null){prior.Bind();return true;}
            var component=ground.gameObject.AddComponent<RoaRoomSurface>();
            component._locationId=id;component._profile=p;
            component._sourceMesh=ground.GetComponent<MeshFilter>().sharedMesh;component._sourceMaterial=ground.sharedMaterial;
            component._sourceColliders=ground.GetComponents<Collider>();component._sourceEnabled=new bool[component._sourceColliders.Length];
            for(int i=0;i<component._sourceColliders.Length;i++){component._sourceEnabled[i]=component._sourceColliders[i].enabled;component._sourceColliders[i].enabled=false;}
            int n=p.terrainSegments>0?p.terrainSegments:Segments;
            if(n<128 || n>512)throw new InvalidOperationException("Unsupported authored room ground density "+id);
            var vertices=new Vector3[(n+1)*(n+1)];var uv=new Vector2[vertices.Length];var indices=new int[n*n*6];int next=0;
            for(int iz=0;iz<=n;iz++)for(int ix=0;ix<=n;ix++)
            {
                float x=(ix/(float)n-.5f)*p.width,z=(iz/(float)n-.5f)*p.depth;int a=iz*(n+1)+ix;
                vertices[a]=ground.transform.InverseTransformPoint(new Vector3(x,Height(p,x,z)-.05f,z));uv[a]=new Vector2(ix/(float)n,iz/(float)n);
                if(ix==n || iz==n)continue;
                int b=a+1,c=a+n+1,d=c+1;indices[next++]=a;indices[next++]=c;indices[next++]=b;indices[next++]=b;indices[next++]=c;indices[next++]=d;
            }
            var mesh=new Mesh{name="RoomRelief_"+id,indexFormat=vertices.Length>65535?UnityEngine.Rendering.IndexFormat.UInt32:UnityEngine.Rendering.IndexFormat.UInt16};mesh.vertices=vertices;mesh.uv=uv;mesh.triangles=indices;mesh.RecalculateNormals();mesh.RecalculateBounds();
            ground.GetComponent<MeshFilter>().sharedMesh=mesh;
            component._surfaceCollider=ground.gameObject.AddComponent<MeshCollider>();component._surfaceCollider.sharedMesh=mesh;
            var poses=new List<Pose>();
            foreach(var placed in ground.transform.root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if(placed.gameObject==ground.gameObject || placed.transform.parent?.GetComponentInParent<KromkaPlacedObjectAuthoring>()!=null)continue;
                poses.Add(new Pose{transform=placed.transform,position=placed.transform.position});
                float offset=p.fixedAuthoredPoses?0:Height(p,placed.transform.position.x,placed.transform.position.z);
                placed.transform.position+=Vector3.up*offset;
                (placed.GetComponent<RoaTerrainPlacement>()??placed.gameObject.AddComponent<RoaTerrainPlacement>()).GroundOffset=offset;
            }
            foreach(var spawn in ground.transform.root.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
            {
                if(spawn.GetComponentInParent<KromkaPlacedObjectAuthoring>()!=null || spawn.transform.parent?.GetComponentInParent<KromkaSpawnAuthoring>()!=null)continue;
                poses.Add(new Pose{transform=spawn.transform,position=spawn.transform.position});if(!p.fixedAuthoredPoses)spawn.transform.position+=Vector3.up*Height(p,spawn.transform.position.x,spawn.transform.position.z);
            }
            component._poses=poses.ToArray();component.Bind();return true;
        }
        private void Bind()
        {
            _profile=Find(_locationId);if(_profile==null)return;
            _segments=_profile.terrainSegments>0?_profile.terrainSegments:Segments;
            Mesh mesh=GetComponent<MeshFilter>()?.sharedMesh;if(mesh==null)return;
            _vertices=mesh.vertices;for(int i=0;i<_vertices.Length;i++)_vertices[i]=transform.TransformPoint(_vertices[i]);_active=this;
        }
        private void OnEnable(){if(!string.IsNullOrEmpty(_locationId))Bind();}
        private void OnDisable(){if(_active==this)_active=null;}
#if UNITY_EDITOR
        public static void RestoreSource(Renderer ground)
        {
            var component=ground?.GetComponent<RoaRoomSurface>();if(component==null)return;
            foreach(Pose pose in component._poses??Array.Empty<Pose>())if(pose.transform!=null){pose.transform.position=pose.position;var placement=pose.transform.GetComponent<RoaTerrainPlacement>();if(placement!=null)DestroyImmediate(placement);}
            ground.GetComponent<MeshFilter>().sharedMesh=component._sourceMesh;ground.sharedMaterial=component._sourceMaterial;
            for(int i=0;i<component._sourceColliders.Length;i++)if(component._sourceColliders[i]!=null)component._sourceColliders[i].enabled=component._sourceEnabled[i];
            if(component._surfaceCollider!=null)DestroyImmediate(component._surfaceCollider);DestroyImmediate(component);
        }
#endif
    }
}
