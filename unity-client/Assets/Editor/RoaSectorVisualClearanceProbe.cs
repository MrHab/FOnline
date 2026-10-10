using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Measures native visual envelopes without changing scenes or collision.</summary>
    public static class RoaSectorVisualClearanceProbe
    {
        public static void Run()
        {
            try
            {
                var profiles=new List<object>();
                string repo=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    if(p.legacyDam)continue;
                    EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                    var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                    RoaSectorSurface.RestoreSource(location.GroundRenderer);
                    string source=p.locationId==p.zoneId?"data/zones/authored/":"data/locations/";
                    var definition=JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(Path.Combine(repo,source+p.locationId+".json")));
                    RoaWaterCistern.Ensure(definition,location.GroundRenderer);
                    var rows=new List<object>();
                    foreach(var marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                    {
                        if(marker.transform.parent?.GetComponentInParent<KromkaPlacedObjectAuthoring>()!=null)continue;
                        bool cistern=marker.GetComponentInChildren<RoaWaterCistern>(true)!=null;
                        var renderers=marker.GetComponentsInChildren<Renderer>(true).Where(r=>!(r is ParticleSystemRenderer)&&!(r is TrailRenderer)&&!(r is LineRenderer)
                            &&(!cistern||(r.enabled&&r.gameObject.activeInHierarchy))).ToArray();
                        if(renderers.Length==0)continue;
                        Bounds bounds=renderers[0].bounds;foreach(var renderer in renderers)bounds.Encapsulate(renderer.bounds);
                        Vector3 delta=bounds.center-marker.transform.position;
                        rows.Add(new{id=marker.StableObjectId,tags=marker.GameplayTags.ToArray(),role=marker.Role,
                            sourceX=marker.transform.position.x,sourceZ=marker.transform.position.z,
                            centerX=delta.x,centerZ=delta.z,halfX=bounds.extents.x,halfZ=bounds.extents.z,
                            minY=bounds.min.y-marker.transform.position.y,maxY=bounds.max.y-marker.transform.position.y});
                    }
                    profiles.Add(new{p.zoneId,p.locationId,objects=rows});
                    if(profiles.Count%10==0)Debug.Log("[VISUAL ENVELOPES] Measured "+profiles.Count);
                }
                string output=Environment.GetEnvironmentVariable("ROA_VISUAL_BOUNDS_OUT")
                    ??Path.GetFullPath(Path.Combine(Application.dataPath,"../../Build/sector-visual-envelopes.json"));
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                File.WriteAllText(output,JsonConvert.SerializeObject(new{schema="roa.sectorVisualEnvelopes.v1",profiles},Formatting.Indented));
                Debug.Log("[VISUAL ENVELOPES] PASS: native visual bounds measured; scene geometry and gameplay collision unchanged.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
    }
}
