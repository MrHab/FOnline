using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Kromka;
using Newtonsoft.Json;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Compares actual saved geometry and physics before and after a second bake.</summary>
    public static class RoaWorldRebuildPersistenceProbe
    {
        private sealed class Snapshot
        {
            public string id,hash;
            public int objects,renderers,colliders,meshVertices;
        }
        public static void Run()
        {
            try
            {
                string output=Environment.GetEnvironmentVariable("ROA_REBUILD_SNAPSHOT");
                if(string.IsNullOrEmpty(output))throw new InvalidOperationException("Set ROA_REBUILD_SNAPSHOT");
                string baseline=Environment.GetEnvironmentVariable("ROA_REBUILD_BASELINE");
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var selected=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                var rows=new List<Snapshot>();
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                    if(!p.legacyDam&&(selected==null||selected.Contains(p.locationId)))
                    {
                        Scene scene=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                        var location=UnityEngine.Object.FindFirstObjectByType<RoaUnityLocationScene>();
                        if(location?.GroundRenderer.GetComponent<RoaSectorSurface>()==null)
                            throw new InvalidOperationException("Unbaked saved sector "+p.locationId);
                        rows.Add(Capture(scene,p.locationId));
                    }
                if(Environment.GetEnvironmentVariable("ROA_REBUILD_SKIP_WORLD")!="1")
                {
                    Scene scene=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
                    if(UnityEngine.Object.FindObjectsByType<RoaWorldMapSectorAppearance>(FindObjectsInactive.Include,FindObjectsSortMode.None).Length!=RoaSectorSurface.AllProfiles.Count())
                        throw new InvalidOperationException("Unbaked saved world overview");
                    rows.Add(Capture(scene,"global-map"));
                }
                File.WriteAllText(output,JsonConvert.SerializeObject(rows,Formatting.Indented)+"\n");
                if(!string.IsNullOrEmpty(baseline))
                {
                    var previous=JsonConvert.DeserializeObject<Snapshot[]>(File.ReadAllText(baseline)).ToDictionary(r=>r.id);
                    if(previous.Count!=rows.Count)throw new InvalidOperationException("Different rebuild selection");
                    var changed=rows.Where(r=>!previous.TryGetValue(r.id,out var old)||old.hash!=r.hash).Select(r=>r.id).ToArray();
                    if(changed.Length>0)throw new InvalidOperationException("Saved geometry or physics changed on repeat bake: "+string.Join(",",changed));
                }
                Debug.Log("[WORLD REBUILD PERSISTENCE] PASS: "+rows.Count+" saved scenes"+(string.IsNullOrEmpty(baseline)?" captured":" unchanged against the saved baseline"));
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static Snapshot Capture(Scene scene,string id)
        {
            var transforms=scene.GetRootGameObjects().SelectMany(g=>g.GetComponentsInChildren<Transform>(true)).ToArray();
            var meshHashes=new Dictionary<Mesh,string>();var materialHashes=new Dictionary<Material,string>();
            var lines=new List<string>();int rendererCount=0,colliderCount=0,vertices=0;
            foreach(var t in transforms)
            {
                string key=Hierarchy(t);lines.Add(key+"|object|"+t.gameObject.activeSelf+"|"+t.gameObject.layer+"|"+V(t.localPosition)+"|"+V(t.localScale)+"|"+Q(t.localRotation));
                var filter=t.GetComponent<MeshFilter>();
                if(filter!=null&&filter.sharedMesh!=null){vertices+=filter.sharedMesh.vertexCount;lines.Add(key+"|mesh|"+MeshHash(filter.sharedMesh,meshHashes));}
                foreach(var renderer in t.GetComponents<Renderer>())
                {
                    rendererCount++;
                    lines.Add(key+"|renderer|"+renderer.GetType().Name+"|"+renderer.enabled+"|"+renderer.shadowCastingMode+"|"+renderer.receiveShadows+"|"+string.Join("/",renderer.sharedMaterials.Select(m=>MaterialHash(m,materialHashes))));
                }
                foreach(var c in t.GetComponents<Collider>())
                {
                    colliderCount++;string shape=c switch
                    {
                        BoxCollider b=>V(b.center)+"|"+V(b.size),
                        SphereCollider s=>V(s.center)+"|"+F(s.radius),
                        CapsuleCollider a=>V(a.center)+"|"+F(a.radius)+"|"+F(a.height)+"|"+a.direction,
                        MeshCollider m=>m.convex+"|"+MeshHash(m.sharedMesh,meshHashes),
                        _=>c.GetType().Name
                    };
                    var physics=c.sharedMaterial;
                    lines.Add(key+"|collider|"+c.GetType().Name+"|"+c.enabled+"|"+c.isTrigger+"|"+shape+"|"+(physics==null?"default":F(physics.dynamicFriction)+"/"+F(physics.staticFriction)+"/"+F(physics.bounciness)+"/"+physics.frictionCombine+"/"+physics.bounceCombine));
                }
            }
            lines.Sort(StringComparer.Ordinal);
            return new Snapshot{id=id,hash=Hash(Encoding.UTF8.GetBytes(string.Join("\n",lines))),objects=transforms.Length,renderers=rendererCount,colliders=colliderCount,meshVertices=vertices};
        }
        private static string MeshHash(Mesh mesh,Dictionary<Mesh,string> cache)
        {
            if(mesh==null)return "null";if(cache.TryGetValue(mesh,out string value))return value;
            using var bytes=new MemoryStream();using(var writer=new BinaryWriter(bytes,Encoding.UTF8,true))
            {
                writer.Write(mesh.vertexCount);writer.Write(mesh.subMeshCount);
                foreach(Vector3 v in mesh.vertices){writer.Write(Math.Round(v.x,6));writer.Write(Math.Round(v.y,6));writer.Write(Math.Round(v.z,6));}
                foreach(Vector3 n in mesh.normals){writer.Write(Math.Round(n.x,6));writer.Write(Math.Round(n.y,6));writer.Write(Math.Round(n.z,6));}
                foreach(Vector4 tangent in mesh.tangents){writer.Write(Math.Round(tangent.x,6));writer.Write(Math.Round(tangent.y,6));writer.Write(Math.Round(tangent.z,6));writer.Write(Math.Round(tangent.w,6));}
                foreach(Color color in mesh.colors){writer.Write(Math.Round(color.r,6));writer.Write(Math.Round(color.g,6));writer.Write(Math.Round(color.b,6));writer.Write(Math.Round(color.a,6));}
                var coordinates=new List<Vector4>();
                for(int channel=0;channel<8;channel++)
                {
                    mesh.GetUVs(channel,coordinates);writer.Write(coordinates.Count);
                    foreach(Vector4 uv in coordinates){writer.Write(Math.Round(uv.x,6));writer.Write(Math.Round(uv.y,6));writer.Write(Math.Round(uv.z,6));writer.Write(Math.Round(uv.w,6));}
                }
                for(int sub=0;sub<mesh.subMeshCount;sub++){writer.Write((int)mesh.GetTopology(sub));var indices=mesh.GetIndices(sub);writer.Write(indices.Length);foreach(int i in indices)writer.Write(i);}
            }
            return cache[mesh]=Hash(bytes.ToArray());
        }
        private static string MaterialHash(Material material,Dictionary<Material,string> cache)
        {
            if(material==null)return "null";if(cache.TryGetValue(material,out string value))return value;
            var parts=new List<string>{material.shader.name,material.renderQueue.ToString(),string.Join(",",material.shaderKeywords.OrderBy(k=>k,StringComparer.Ordinal))};
            for(int i=0;i<ShaderUtil.GetPropertyCount(material.shader);i++)
            {
                string name=ShaderUtil.GetPropertyName(material.shader,i);string property=ShaderUtil.GetPropertyType(material.shader,i) switch
                {
                    ShaderUtil.ShaderPropertyType.Color=>V4(material.GetColor(name)),
                    ShaderUtil.ShaderPropertyType.Vector=>V4(material.GetVector(name)),
                    ShaderUtil.ShaderPropertyType.TexEnv=>TextureKey(material.GetTexture(name))+"|"+V2(material.GetTextureScale(name))+"|"+V2(material.GetTextureOffset(name)),
                    _=>F(material.GetFloat(name))
                };
                parts.Add(name+"="+property);
            }
            return cache[material]=Hash(Encoding.UTF8.GetBytes(string.Join("\n",parts)));
        }
        private static string TextureKey(Texture texture)
        {
            if(texture==null)return "null";string path=AssetDatabase.GetAssetPath(texture);
            return texture.GetType().Name+"/"+texture.width+"/"+texture.height+"/"+(string.IsNullOrEmpty(path)?texture.name:AssetDatabase.GetAssetDependencyHash(path).ToString());
        }
        private static string Hierarchy(Transform t)=>t.parent==null?t.name:Hierarchy(t.parent)+"/"+t.name;
        private static string Hash(byte[] bytes){using var sha=SHA256.Create();return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
        private static string F(float f)=>Math.Round(f,5).ToString("R",System.Globalization.CultureInfo.InvariantCulture);
        private static string V(Vector3 v)=>F(v.x)+","+F(v.y)+","+F(v.z);
        private static string Q(Quaternion q)=>F(q.x)+","+F(q.y)+","+F(q.z)+","+F(q.w);
        private static string V2(Vector2 v)=>F(v.x)+","+F(v.y);
        private static string V4(Vector4 v)=>F(v.x)+","+F(v.y)+","+F(v.z)+","+F(v.w);
    }
}
