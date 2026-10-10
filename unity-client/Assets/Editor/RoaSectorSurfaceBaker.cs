using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Kromka;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Persists the projected playable geometry and exports its native collision.</summary>
    public static class RoaSectorSurfaceBaker
    {
        private const string Folder="Assets/Art/Kromka/SectorSurfaces";
        private static readonly Dictionary<Object,Object> Saved=new Dictionary<Object,Object>();
        private static Mesh _bundle;
        private static string _id;
        private static int _part;
        [MenuItem("Realm of Ashes/Zones/Bake world sector surfaces")]
        public static void Run()
        {
            try
            {
                string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                string preview=Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT");
                JObject catalog=JObject.Parse(File.ReadAllText(string.IsNullOrEmpty(preview)
                    ?Path.Combine(repository,"data/kromka/sector-surfaces.json"):preview));
                string version=catalog.Value<string>("sourceHash");
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var selection=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                foreach(var profile in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                    if(!profile.legacyDam && (selection==null || selection.Contains(profile.locationId)))Bake(profile,repository,version);
                AssetDatabase.SaveAssets();
                Debug.Log("[SECTOR SURFACE BAKE] PASS: saved scenes, meshes, materials, collision and source poses.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }

        [MenuItem("Realm of Ashes/Zones/Prune archived removed markers")]
        public static void PruneArchivedRemovedMarkers()
        {
            try
            {
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                if(string.IsNullOrWhiteSpace(requested))
                    throw new InvalidOperationException("Set ROA_SECTOR_IDS for the source scenes to reconcile");
                string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                foreach(string id in requested.Split(',').Select(value=>value.Trim()).Where(value=>value.Length>0))
                {
                    if(!KromkaLocationSceneCatalog.IsZoneId(id))
                        throw new InvalidOperationException("Expected authored sector ID: "+id);
                    JObject definition=JObject.Parse(File.ReadAllText(Path.Combine(repository,
                        "data/zones/authored/"+id+".json")));
                    var current=new HashSet<string>((definition["objects"] as JArray??new JArray())
                        .OfType<JObject>().Select(row=>row.Value<string>("id")),StringComparer.Ordinal);
                    var archived=new HashSet<string>((definition["surfaceSource"]?["removedObjects"] as JArray??new JArray())
                        .OfType<JObject>().Select(row=>row.Value<string>("id")),StringComparer.Ordinal);
                    Scene scene=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(id));
                    var markers=scene.GetRootGameObjects()
                        .SelectMany(root=>root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                        .Where(marker=>marker.Role!="terrain"&&!current.Contains(marker.StableObjectId)).ToList();
                    var unexpected=markers.Where(marker=>!archived.Contains(marker.StableObjectId))
                        .Select(marker=>marker.StableObjectId).ToArray();
                    if(unexpected.Length>0)
                        throw new InvalidOperationException("Unarchived orphan markers "+id+": "+string.Join(", ",unexpected));
                    foreach(var marker in markers)Object.DestroyImmediate(marker.gameObject);
                    int aligned=0;
                    if(id=="z_09_07")
                    {
                        var rows=(definition["objects"] as JArray??new JArray()).OfType<JObject>()
                            .ToDictionary(row=>row.Value<string>("id"),StringComparer.Ordinal);
                        foreach(var marker in scene.GetRootGameObjects()
                            .SelectMany(root=>root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)))
                        {
                            if(!marker.StableObjectId.StartsWith("facility_coreZone_",StringComparison.Ordinal))continue;
                            if(!rows.TryGetValue(marker.StableObjectId,out JObject row)
                                || row["surfaceSourcePosition"]?["y"]==null)
                                throw new InvalidOperationException("Missing Core facility source position: "+marker.StableObjectId);
                            float y=row["surfaceSourcePosition"]["y"].Value<float>();
                            Vector3 position=marker.transform.position;
                            if(Mathf.Abs(position.y-y)<0.0001f)continue;
                            marker.transform.position=new Vector3(position.x,y,position.z);
                            aligned++;
                        }
                    }
                    if(markers.Count>0||aligned>0)EditorSceneManager.SaveScene(scene);
                    Debug.Log("[SECTOR SOURCE] Removed "+markers.Count+" archived markers from "+id);
                    Debug.Log("[SECTOR SOURCE] Aligned "+aligned+" Core facility source heights in "+id);
                }
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }

        private static void Bake(RoaSectorSurface.Profile profile,string repository,string version)
        {
            _id=profile.locationId;Saved.Clear();_part=0;
            string definitionPath=Path.Combine(repository,profile.locationId==profile.zoneId
                ? "data/zones/authored/"+profile.zoneId+".json":"data/locations/"+profile.locationId+".json");
            JObject definition=JObject.Parse(File.ReadAllText(definitionPath));
            Scene scene=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(_id));
            var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
            if(location?.GroundRenderer==null)throw new InvalidOperationException("Missing ground "+_id);
            RoaAuthoredIdentity.Configure(location,definition);
            var authoredRows=(definition["objects"] as JArray??new JArray()).OfType<JObject>()
                .ToDictionary(row=>row.Value<string>("id"),StringComparer.Ordinal);
            foreach(var marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                if(authoredRows.TryGetValue(marker.StableObjectId,out JObject authored))
                {
                    bool scatter=(authored["tags"] as JArray??new JArray()).Any(tag=>tag.ToString()=="scatter");
                    if(scatter==marker.GameplayTags.Contains("scatter"))continue;
                    string[] tags=marker.GameplayTags.Where(tag=>tag!="scatter")
                        .Concat(scatter?new[]{"scatter"}:Array.Empty<string>()).ToArray();
                    marker.Configure(marker.StableObjectId,marker.ServerArchetypeId,marker.Role,tags,
                        marker.ServerAuthoritative,marker.BlocksMovement,marker.BlocksVision,marker.ProvidesLowCover);
                }
            RoaSectorSurface.RestoreSource(location.GroundRenderer);
            var sourceRows=new Dictionary<string,JToken>(StringComparer.Ordinal);
            foreach(JObject row in (definition["objects"] as JArray ?? new JArray()).OfType<JObject>())
                if(row["position"]!=null)sourceRows[row.Value<string>("id")]=row["surfaceSourcePosition"]?.DeepClone()??row["position"].DeepClone();
            JObject source=definition["surfaceSource"] as JObject ?? new JObject();
            if(source["spawn"]==null)source["spawn"]=definition["spawn"]?.DeepClone();
            if(source["objectOrder"]==null)source["objectOrder"]=new JArray((definition["objects"] as JArray??new JArray()).OfType<JObject>().Select(row=>row.Value<string>("id")));
            if(!RoaSectorSurface.Project(_id,location.GroundRenderer))throw new InvalidOperationException("Projection failed "+_id);
            var deleted=new HashSet<string>((profile.placements??Array.Empty<RoaSectorSurface.Placement>()).Where(p=>p.remove).Select(p=>p.id),StringComparer.Ordinal);
            var archived=(source["removedObjects"] as JArray??new JArray()).OfType<JObject>().ToDictionary(row=>row.Value<string>("id"),row=>row.DeepClone(),StringComparer.Ordinal);
            foreach(JObject row in (definition["objects"] as JArray??new JArray()).OfType<JObject>())
                if(deleted.Contains(row.Value<string>("id")))archived[row.Value<string>("id")]=row.DeepClone();
            source["removedObjects"]=new JArray(archived.OrderBy(row=>row.Key,StringComparer.Ordinal).Select(row=>row.Value));
            foreach(var marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                if(deleted.Contains(marker.StableObjectId))Object.DestroyImmediate(marker.gameObject);
            var painterObject=new GameObject("SectorBakePainter");SceneManager.MoveGameObjectToScene(painterObject,scene);
            var painter=painterObject.AddComponent<RoaLocalTerrain>();
            painter.InitializeAuthoredSurface(JsonConvert.DeserializeObject<LocationDefinition>(definition.ToString()),null,location.GroundRenderer);
            Directory.CreateDirectory(Path.Combine(Application.dataPath,"Art/Kromka/SectorSurfaces"));
            AssetDatabase.Refresh();
            string bundlePath=Folder+"/"+_id+".asset";
            _bundle=AssetDatabase.LoadAssetAtPath<Mesh>(bundlePath);
            if(_bundle==null){_bundle=new Mesh {name="SectorSurfaceAssets_"+_id};AssetDatabase.CreateAsset(_bundle,bundlePath);}
            else foreach(Object part in AssetDatabase.LoadAllAssetsAtPath(bundlePath))if(part!=_bundle)Object.DestroyImmediate(part,true);
            foreach(var filter in location.GetComponentsInChildren<MeshFilter>(true))
                if(filter.sharedMesh!=null && !AssetDatabase.Contains(filter.sharedMesh))filter.sharedMesh=SaveMesh(filter.sharedMesh);
            foreach(var collider in location.GetComponentsInChildren<MeshCollider>(true))
                if(collider.sharedMesh!=null && !AssetDatabase.Contains(collider.sharedMesh))collider.sharedMesh=SaveMesh(collider.sharedMesh);
            foreach(var renderer in location.GetComponentsInChildren<Renderer>(true))
                renderer.sharedMaterials=renderer.sharedMaterials.Select(SaveMaterial).ToArray();
            Object.DestroyImmediate(painterObject);
            RestoreGeologicalCollisionMasks(location,authoredRows);
            RestoreGeckoEndCapCollisionMasks(location,authoredRows);
            PreserveCanonicalRelayQuestPassThrough(location,authoredRows);
            AssetDatabase.SaveAssets();
            EditorSceneManager.MarkSceneDirty(scene);EditorSceneManager.SaveScene(scene);
            KromkaWorldSceneExporter.ExportLocationScene(scene);
            definition=JObject.Parse(File.ReadAllText(definitionPath));
            definition["surfaceSource"]=source;
            definition["sectorSurfaceVersion"]=version;
            foreach(JObject row in (definition["objects"] as JArray ?? new JArray()).OfType<JObject>())
                if(sourceRows.TryGetValue(row.Value<string>("id"),out JToken original))row["surfaceSourcePosition"]=original.DeepClone();
            File.WriteAllText(definitionPath,definition.ToString(Formatting.Indented)+"\n",new UTF8Encoding(false));
            string scenePath=scene.path;
            EditorSceneManager.OpenScene(scenePath);
            location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
            if(location.GroundRenderer.GetComponent<RoaSectorSurface>()==null || location.GroundRenderer.GetComponent<MeshCollider>()?.sharedMesh==null)
                throw new InvalidOperationException("Surface persistence failed "+_id);
            foreach(var filter in location.GetComponentsInChildren<MeshFilter>(true))
                if(filter.sharedMesh!=null && !AssetDatabase.Contains(filter.sharedMesh))throw new InvalidOperationException("Unsaved mesh "+filter.name);
            foreach(var renderer in location.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.enabled&&r.gameObject.activeInHierarchy))
            {
                if(renderer.GetComponent<TextMesh>()!=null||renderer.GetComponentInParent<TMPro.TMP_Text>()!=null)continue;
                Mesh mesh=renderer.GetComponent<MeshFilter>()?.sharedMesh;
                if(mesh==null||!AssetDatabase.Contains(mesh)||renderer.sharedMaterials.Any(m=>m==null||!AssetDatabase.Contains(m)))
                    throw new InvalidOperationException("Missing or unsaved visible mesh/material after reload "+_id+"/"+renderer.name);
            }
            Debug.Log("[SECTOR SURFACE BAKE] Saved and reloaded "+_id+"; removed "+deleted.Count+" submerged/obstructing decoration.");
        }
        private static void PreserveCanonicalRelayQuestPassThrough(RoaUnityLocationScene location,
            Dictionary<string,JObject> authoredRows)
        {
            if(_id!="z_13_10")return;
            const string id="relay_outpost_antenna";
            // The standalone terrain baseline keeps the relay as a separate
            // place. Its world-site antenna is validated when that site is
            // authored into this sector.
            if(!authoredRows.ContainsKey(id))
            {
                if(location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                    .Any(marker=>marker.StableObjectId==id))
                    throw new InvalidOperationException("Orphan relay antenna marker "+id);
                return;
            }
            if(!authoredRows.TryGetValue(id,out JObject row)
                || row.Value<string>("model")!="relayAntenna"
                || row["interactive"]?.Value<string>("kind")!="questObject"
                || row["interactive"]?.Value<string>("questObjective")!="recover_measurement_block"
                || row["vision"]?.Value<bool>("blocks")!=true)
                throw new InvalidOperationException("Canonical quest antenna guard failed "+_id+"/"+id);
            var tags=(row["tags"] as JArray??new JArray()).Select(t=>t.ToString()).ToArray();
            if(!tags.Contains("interactive") || !tags.Contains("quest-object"))
                throw new InvalidOperationException("Quest antenna pass-through tags missing "+id);
            var matches=location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                .Where(m=>m.StableObjectId==id).ToArray();
            if(matches.Length!=1)throw new InvalidOperationException("Quest antenna marker count "+matches.Length);
            var marker=matches[0];
            if(marker.ServerArchetypeId!=string.Empty || marker.ServerAuthoritative || !marker.BlocksVision
                || !marker.GameplayTags.SequenceEqual(tags))
                throw new InvalidOperationException("Quest antenna native/metadata guard failed "+id);
            // Server PASS_THROUGH_TAGS already makes this exact interactive quest row nonblocking.
            // Match that authority without editing tags, native geometry, TRS or sight semantics.
            foreach(var collider in marker.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            marker.Configure(marker.StableObjectId,marker.ServerArchetypeId,marker.Role,marker.GameplayTags.ToArray(),
                marker.ServerAuthoritative,false,marker.BlocksVision,marker.ProvidesLowCover);
        }
        private static void RestoreGeologicalCollisionMasks(RoaUnityLocationScene location,
            Dictionary<string,JObject> authoredRows)
        {
            foreach(var marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if(!authoredRows.TryGetValue(marker.StableObjectId,out JObject row)
                    || row.Value<string>("model")!="quarry_face"
                    || !marker.StableObjectId.EndsWith("-cut-face",StringComparison.Ordinal))continue;
                if(!marker.BlocksMovement || row["collisionParts"] is not JArray expected || expected.Count!=27)
                    throw new InvalidOperationException("Missing authored geological collision mask "+marker.StableObjectId);
                foreach(var mesh in marker.GetComponentsInChildren<MeshCollider>(true))
                {
                    if(!mesh.name.StartsWith("Geological",StringComparison.Ordinal))
                        throw new InvalidOperationException("Unexpected geological MeshCollider "+marker.StableObjectId+"/"+mesh.name);
                    // A cut face already has primitive BoxColliders under its Collision child.
                    // New visual strata must not introduce extra client-only blocking geometry.
                    mesh.enabled=false;
                }
                AssertPrimitiveCollisionMask(marker,expected,"Geological");
            }
        }
        private static void RestoreGeckoEndCapCollisionMasks(RoaUnityLocationScene location,
            Dictionary<string,JObject> authoredRows)
        {
            if(_id!="z_16_04")return;
            var ids=new HashSet<string>(StringComparer.Ordinal) {
                "facility_geckoCanyon_fallen_strata_-15", "facility_geckoCanyon_fallen_strata_15",
                "facility_geckoCanyon_stratified_rear_-15", "facility_geckoCanyon_stratified_rear_15",
                "facility_geckoCanyon_stratified_wall_-15", "facility_geckoCanyon_stratified_wall_15"
            };
            if(!ids.Any(authoredRows.ContainsKey))
            {
                if(location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                    .Any(marker=>ids.Contains(marker.StableObjectId)))
                    throw new InvalidOperationException("Orphan Gecko outcrop markers");
                return;
            }
            int found=0;
            foreach(var marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if(!ids.Contains(marker.StableObjectId))continue;
                found++;
                int count=marker.StableObjectId.Contains("fallen_strata")?15:28;
                if(!authoredRows.TryGetValue(marker.StableObjectId,out JObject row)
                    || !marker.BlocksMovement || row["collisionParts"] is not JArray expected || expected.Count!=count)
                    throw new InvalidOperationException("Missing authored Gecko collision mask "+marker.StableObjectId);
                int endCaps=0;
                foreach(var mesh in marker.GetComponentsInChildren<MeshCollider>(true))
                {
                    if(mesh.name=="SedimentaryEndCaps") { mesh.enabled=false;endCaps++; }
                    else if(mesh.enabled && mesh.gameObject.activeInHierarchy)
                        throw new InvalidOperationException("Unexpected Gecko MeshCollider "+marker.StableObjectId+"/"+mesh.name);
                }
                if(endCaps!=1)throw new InvalidOperationException("Gecko end-cap count "+marker.StableObjectId+": "+endCaps);
                AssertPrimitiveCollisionMask(marker,expected,"Gecko");
            }
            if(found!=ids.Count)throw new InvalidOperationException("Gecko outcrop markers found "+found+"/"+ids.Count);
        }
        private static bool CloseMaskNumber(JToken a,JToken b)
        {
            double x=a?.Value<double>()??double.NaN,y=b?.Value<double>()??double.NaN;
            return !double.IsNaN(x)&&!double.IsNaN(y)&&Math.Abs(x-y)<=0.0015;
        }
        private static bool SameMaskPart(JToken actual,JToken expected)
        {
            if(actual is not JObject || expected is not JObject)return false;
            if(!CloseMaskNumber(actual["center"]?["x"],expected["center"]?["x"])
                || !CloseMaskNumber(actual["center"]?["z"],expected["center"]?["z"]))return false;
            if(actual["radius"]!=null)
                return expected["size"]==null && CloseMaskNumber(actual["radius"],expected["radius"]);
            return expected["radius"]==null
                && CloseMaskNumber(actual["size"]?["x"],expected["size"]?["x"])
                && CloseMaskNumber(actual["size"]?["z"],expected["size"]?["z"])
                && Math.Abs((actual["rotationY"]?.Value<double>()??0)-(expected["rotationY"]?.Value<double>()??0))<=0.0015;
        }
        private static double MaskPartMaxDelta(JToken a,JToken b)
        {
            var differences=new List<double> {
                Math.Abs(a["center"]["x"].Value<double>()-b["center"]["x"].Value<double>()),
                Math.Abs(a["center"]["z"].Value<double>()-b["center"]["z"].Value<double>())
            };
            if(a["radius"]!=null)differences.Add(Math.Abs(a["radius"].Value<double>()-b["radius"].Value<double>()));
            else {
                differences.Add(Math.Abs(a["size"]["x"].Value<double>()-b["size"]["x"].Value<double>()));
                differences.Add(Math.Abs(a["size"]["z"].Value<double>()-b["size"]["z"].Value<double>()));
                differences.Add(Math.Abs((a["rotationY"]?.Value<double>()??0)-(b["rotationY"]?.Value<double>()??0)));
            }
            return differences.Max();
        }
        private static void AssertPrimitiveCollisionMask(KromkaPlacedObjectAuthoring marker,JArray expected,string kind)
        {
            var transform=marker.transform;
            Vector3 euler=transform.eulerAngles*Mathf.Deg2Rad;
            var actual=KromkaWalkCollision.Parts(KromkaWalkCollision.Shapes(marker.gameObject,transform.position.y),
                new Vector3((float)KromkaWalkCollision.Round(transform.position.x),0f,
                    (float)KromkaWalkCollision.Round(transform.position.z)),
                KromkaWalkCollision.Round(euler.y),
                new Vector3((float)KromkaWalkCollision.Round(transform.lossyScale.x),1f,
                    (float)KromkaWalkCollision.Round(transform.lossyScale.z)));
            if(actual.Count!=expected.Count)
                throw new InvalidOperationException(kind+" primitive collision mask changed "+marker.StableObjectId
                    +": expected "+expected.Count+" parts, found "+actual.Count);
            var used=new bool[expected.Count];
            double maxDelta=0;
            string firstDifference=null;
            foreach(JToken part in actual)
            {
                int match=-1;
                for(int i=0;i<expected.Count;i++)if(!used[i]&&SameMaskPart(part,expected[i])){match=i;break;}
                if(match>=0)
                {
                    used[match]=true;
                    double delta=MaskPartMaxDelta(part,expected[match]);
                    maxDelta=Math.Max(maxDelta,delta);
                    if(delta>0 && firstDifference==null)
                        firstDifference="actual "+part.ToString(Formatting.None)+", authored "+expected[match].ToString(Formatting.None);
                    continue;
                }
                var nearest=expected.OfType<JObject>()
                    .OrderBy(candidate=>Math.Abs((part["center"]?["x"]?.Value<double>()??0)-(candidate["center"]?["x"]?.Value<double>()??0))
                        +Math.Abs((part["center"]?["z"]?.Value<double>()??0)-(candidate["center"]?["z"]?.Value<double>()??0)))
                    .FirstOrDefault();
                throw new InvalidOperationException(kind+" primitive collision mask mismatch "+marker.StableObjectId
                    +": actual "+part.ToString(Formatting.None)+", nearest authored "+nearest?.ToString(Formatting.None)
                    +", maxDelta="+(nearest==null?"unavailable":MaskPartMaxDelta(part,nearest)
                        .ToString("F6",System.Globalization.CultureInfo.InvariantCulture)));
            }
            Debug.Log("[SECTOR COLLISION MASK] "+kind+" "+marker.StableObjectId+" "
                +actual.Count+" parts, maxDelta="+maxDelta.ToString("F6",System.Globalization.CultureInfo.InvariantCulture)
                +(firstDifference==null?" exact":"; first "+firstDifference));
        }
        private static Mesh SaveMesh(Mesh mesh)
        {
            if(Saved.TryGetValue(mesh,out Object prior))return (Mesh)prior;
            Mesh copy=Object.Instantiate(mesh);copy.name=mesh.name+"_"+(++_part);
            AssetDatabase.AddObjectToAsset(copy,_bundle);Saved.Add(mesh,copy);return copy;
        }
        private static Material SaveMaterial(Material material)
        {
            if(material==null || AssetDatabase.Contains(material))return material;
            if(Saved.TryGetValue(material,out Object prior))return (Material)prior;
            Material copy=Object.Instantiate(material);copy.name=material.name+"_"+(++_part);
            foreach(string property in copy.GetTexturePropertyNames())
                if(copy.GetTexture(property) is Texture2D texture && !AssetDatabase.Contains(texture))copy.SetTexture(property,SaveTexture(texture));
            AssetDatabase.AddObjectToAsset(copy,_bundle);Saved.Add(material,copy);return copy;
        }
        private static Texture2D SaveTexture(Texture2D texture)
        {
            if(Saved.TryGetValue(texture,out Object prior))return (Texture2D)prior;
            string path=Folder+"/"+_id+"_"+(++_part)+".png";
            File.WriteAllBytes(path,texture.EncodeToPNG());AssetDatabase.ImportAsset(path);
            var importer=(TextureImporter)AssetImporter.GetAtPath(path);
            importer.sRGBTexture=texture.isDataSRGB;importer.mipmapEnabled=true;
            importer.wrapMode=texture.wrapMode;importer.textureCompression=TextureImporterCompression.Compressed;
            importer.maxTextureSize=Mathf.Max(texture.width,texture.height);importer.SaveAndReimport();
            Texture2D result=AssetDatabase.LoadAssetAtPath<Texture2D>(path);Saved.Add(texture,result);return result;
        }
    }
}
