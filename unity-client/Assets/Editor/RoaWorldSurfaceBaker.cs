using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    public static class RoaWorldSurfaceBaker
    {
        private const string AssetPath="Assets/Art/Kromka/WorldSectorSurfaces.asset";
        private const string RootName="PreparedWorldSectors_AUTHORED";
        private static Mesh _bundle;
        private static readonly Dictionary<Object,Object> Saved=new Dictionary<Object,Object>();
        private static readonly Dictionary<string,Material> TransientMaterials=new Dictionary<string,Material>();
        private static int _part;
        private static Material _roadMaterial;
        [MenuItem("Realm of Ashes/World map/Bake all prepared sectors")]
        public static void Run()
        {
            try{Bake();if(Application.isBatchMode)EditorApplication.Exit(0);}
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static bool IsGroundOverlay(MeshRenderer renderer)=>renderer.name.EndsWith("_SURFACE_MEP",StringComparison.Ordinal)
            &&renderer.sharedMaterials.Any(m=>m!=null&&m.shader!=null&&m.shader.name=="Realm of Ashes/Kromka Global Silent Ring");
        private static bool IsSourceWater(MeshRenderer renderer)=>renderer.name=="CleanWater_SURFACE_MEP"
            ||renderer.name=="ToxicWater_SURFACE_MEP"||renderer.name=="KarstWater_SURFACE_MEP";
        private static RoaMeshSurfaceHeight GroundSampler(Mesh mesh,Transform source,Transform map)
        {
            Vector3[] positions=mesh.vertices.Select(v=>map.InverseTransformPoint(source.TransformPoint(v))).ToArray();
            string diagnostic=Environment.GetEnvironmentVariable("ROA_WORLD_GROUND_DIAGNOSTIC");
            if(!string.IsNullOrWhiteSpace(diagnostic))File.WriteAllText(diagnostic,JsonConvert.SerializeObject(new {
                mesh=mesh.name,path=AssetDatabase.GetAssetPath(mesh),vertices=positions.Select(v=>new[]{v.x,v.y,v.z}),indices=mesh.triangles
            },Formatting.None));
            return new RoaMeshSurfaceHeight(positions,mesh.triangles);
        }
        private static Rect[] PreparedCells()=>RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal)
            .Select(p=>Rect.MinMaxRect((p.mapMinX-190)*.1f,(150-p.mapMinY-20)*.1f,(p.mapMinX+20-190)*.1f,(150-p.mapMinY)*.1f)).ToArray();

        /// <summary>Regenerates the saved decorative land cuts without rebuilding sector architecture.</summary>
        public static void RunLandOverlayWaterClip()
        {
            try
            {
                Scene scene=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
                var map=Object.FindFirstObjectByType<RoaUnityGlobalMapScene>();
                var originals=map.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true)
                    .Single(a=>a.OriginalRenderers!=null&&a.OriginalRenderers.Length>0);
                var sources=new Dictionary<MeshRenderer,Mesh>();
                for(int i=0;i<originals.OriginalRenderers.Length;i++)sources.Add(originals.OriginalRenderers[i],originals.OriginalMeshes[i]);
                var renderers=scene.GetRootGameObjects().SelectMany(g=>g.GetComponentsInChildren<MeshRenderer>(true)).ToArray();
                var land=renderers.Single(r=>r.name=="KromkaLandmass_Relief_100pct");
                Mesh canonicalLand=sources.TryGetValue(land,out var landMesh)?landMesh:land.GetComponent<MeshFilter>().sharedMesh;
                if(!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ROA_WORLD_GROUND_DIAGNOSTIC")))GroundSampler(canonicalLand,land.transform,map.transform);
                var water=RoaWorldSurfaceMeshClip.WaterFootprints(renderers.Where(IsSourceWater)
                    .Select(r=>(sources.TryGetValue(r,out var mesh)?mesh:r.GetComponent<MeshFilter>().sharedMesh,r.transform)),map.transform);
                if(water.Length==0)throw new InvalidOperationException("Canonical authored water footprints are missing");
                _bundle=AssetDatabase.LoadAssetAtPath<Mesh>(AssetPath);_part=AssetDatabase.LoadAllAssetsAtPath(AssetPath).Length;
                Rect[] cells=PreparedCells();int count=0;
                var changed=originals.OriginalRenderers.ToList();var meshes=originals.OriginalMeshes.ToList();var enabled=originals.OriginalEnabled.ToList();
                foreach(var renderer in renderers.Where(IsGroundOverlay))
                {
                    var filter=renderer.GetComponent<MeshFilter>();
                    if(!sources.TryGetValue(renderer,out Mesh original))
                    {
                        original=filter.sharedMesh;changed.Add(renderer);meshes.Add(original);enabled.Add(renderer.enabled);
                    }
                    Mesh outside=RoaWorldSurfaceMeshClip.Subtract(original,renderer.transform,map.transform,cells);
                    Mesh clipped=RoaWorldSurfaceMeshClip.SubtractWater(outside,renderer.transform,map.transform,water);
                    Mesh projected=RoaWorldSurfaceMeshClip.ProjectGround(clipped,renderer.transform,map.transform,canonicalLand,land.transform);
                    Object.DestroyImmediate(clipped);clipped=projected;
                    Object.DestroyImmediate(outside);Mesh previous=filter.sharedMesh;
                    Save(clipped);filter.sharedMesh=clipped;renderer.enabled=clipped.triangles.Length>0;
                    if(previous!=original&&AssetDatabase.GetAssetPath(previous)==AssetPath)Object.DestroyImmediate(previous,true);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(renderer);PrefabUtility.RecordPrefabInstancePropertyModifications(filter);
                    count++;Debug.Log("[WORLD LAND WATER CLIP] "+renderer.name+"; canonical vertices "+original.vertexCount+"; saved vertices "+clipped.vertexCount);
                }
                originals.OriginalRenderers=changed.ToArray();originals.OriginalMeshes=meshes.ToArray();originals.OriginalEnabled=enabled.ToArray();
                AssetDatabase.SaveAssets();EditorSceneManager.MarkSceneDirty(scene);EditorSceneManager.SaveScene(scene);
                EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
                var saved=Object.FindFirstObjectByType<RoaUnityGlobalMapScene>().GetComponentsInChildren<MeshRenderer>(true).Where(IsGroundOverlay).ToArray();
                if(count==0||saved.Length!=count||saved.Any(r=>!AssetDatabase.Contains(r.GetComponent<MeshFilter>().sharedMesh)))
                    throw new InvalidOperationException("Saved land overlay water cuts are incomplete");
                Debug.Log("[WORLD LAND WATER CLIP] PASS: "+count+" ground overlays rebuilt from canonical originals; "+water.Length+" authored water footprints; saved and reloaded.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        private static void Bake()
        {
            Saved.Clear();TransientMaterials.Clear();_part=0;
            var profiles=RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal).ToArray();
            string selectedText=Environment.GetEnvironmentVariable("ROA_WORLD_SECTOR_IDS");
            bool partial=!string.IsNullOrWhiteSpace(selectedText);
            var selectedIds=new HashSet<string>((selectedText??"").Split(new[]{',',';',' ','\t','\r','\n'},StringSplitOptions.RemoveEmptyEntries),StringComparer.Ordinal);
            var bakeProfiles=partial?profiles.Where(p=>selectedIds.Contains(p.zoneId)||selectedIds.Contains(p.locationId)).ToArray():profiles;
            if(partial&&(bakeProfiles.Length==0||selectedIds.Any(id=>!bakeProfiles.Any(p=>p.zoneId==id||p.locationId==id))))
                throw new InvalidOperationException("Unknown ROA_WORLD_SECTOR_IDS selection: "+selectedText);
            string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
            Scene global=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
            var map=Object.FindFirstObjectByType<RoaUnityGlobalMapScene>();
            var existing=map.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true);
            Transform previous=map.GetComponentsInChildren<Transform>(true).FirstOrDefault(t=>t.name==RootName);
            var originalOwners=existing.Where(a=>a.OriginalRenderers!=null&&a.OriginalRenderers.Length>0).ToArray();
            MeshRenderer[] retainedRenderers=null;Mesh[] retainedMeshes=null;bool[] retainedEnabled=null;string retainedOwnerName=null;
            if(partial)
            {
                if(previous==null||existing.Length!=profiles.Length||originalOwners.Length!=1
                    ||profiles.Any(p=>existing.Count(a=>a.name==p.zoneId+"_LocalAppearance")!=1))
                    throw new InvalidOperationException("Partial world bake requires the complete saved sector roots and one canonical-original owner");
                var owner=originalOwners[0];retainedRenderers=owner.OriginalRenderers;retainedMeshes=owner.OriginalMeshes;retainedEnabled=owner.OriginalEnabled;retainedOwnerName=owner.name;
                if(retainedMeshes==null||retainedEnabled==null||retainedRenderers.Length!=retainedMeshes.Length||retainedRenderers.Length!=retainedEnabled.Length
                    ||retainedRenderers.Any(r=>r==null)||retainedMeshes.Any(m=>m==null))
                    throw new InvalidOperationException("Incomplete canonical-original closure for partial world bake");
                _bundle=AssetDatabase.LoadAssetAtPath<Mesh>(AssetPath);
                if(_bundle==null)throw new InvalidOperationException("Missing saved world clipping asset bundle");
                _roadMaterial=AssetDatabase.LoadAllAssetsAtPath(AssetPath).OfType<Material>().SingleOrDefault(m=>m.name.StartsWith("WorldSectorDirtRoad_",StringComparison.Ordinal));
                if(_roadMaterial==null)throw new InvalidOperationException("Missing saved world road material");
                foreach(var old in existing.Where(a=>bakeProfiles.Any(p=>a.name==p.zoneId+"_LocalAppearance")))Object.DestroyImmediate(old.gameObject);
            }
            else
            {
            foreach(var old in existing)
                if(old.OriginalRenderers!=null)for(int i=0;i<old.OriginalRenderers.Length;i++)
                {
                    var renderer=old.OriginalRenderers[i];if(renderer==null)continue;
                    renderer.enabled=old.OriginalEnabled[i];renderer.GetComponent<MeshFilter>().sharedMesh=old.OriginalMeshes[i];
                    PrefabUtility.RecordPrefabInstancePropertyModifications(renderer);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(renderer.GetComponent<MeshFilter>());
                }
            if(previous!=null)Object.DestroyImmediate(previous.gameObject);
            foreach(var old in map.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true))Object.DestroyImmediate(old.gameObject);
            }
            JObject authoredMap=JObject.Parse(File.ReadAllText(Path.Combine(repository,"data/global-map.json")));
            foreach(var anchor in partial?Array.Empty<RoaGlobalMapNodeAnchor>():map.GetComponentsInChildren<RoaGlobalMapNodeAnchor>(true))
            {
                JObject node=((JArray)authoredMap["nodes"]).OfType<JObject>().FirstOrDefault(n=>n.Value<string>("id")==anchor.NodeId);
                if(node==null)continue;
                float x=node.Value<float>("x"),y=node.Value<float>("y");
                var profile=RoaSectorSurface.AllProfiles.FirstOrDefault(p=>x>=p.mapMinX&&x<=p.mapMinX+20&&y>=p.mapMinY&&y<=p.mapMinY+20);
                if(profile==null)continue;
                float px=(x-profile.mapMinX-10)/20*profile.width,pz=(profile.mapMinY+10-y)/20*profile.depth;
                float height=profile.datum+RoaSectorSurface.Height(profile,Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey),px,pz)/profile.gain;
                anchor.transform.position=map.transform.TransformPoint(new Vector3((x-190)*.1f,height,(150-y)*.1f));
                PrefabUtility.RecordPrefabInstancePropertyModifications(anchor.transform);
            }
            var sourceRenderers=global.GetRootGameObjects().SelectMany(g=>g.GetComponentsInChildren<MeshRenderer>(true)).ToArray();
            Material groundMaterial=sourceRenderers.First(r=>r.name=="KromkaLandmass_Relief_100pct").sharedMaterial;
            Material waterMaterial=sourceRenderers.First(r=>r.name=="CleanWater_SURFACE_MEP").sharedMaterial;
            var sourceLand=sourceRenderers.Single(r=>r.name=="KromkaLandmass_Relief_100pct");
            Mesh canonicalGround=sourceLand.GetComponent<MeshFilter>().sharedMesh;
            var waterFootprints=RoaWorldSurfaceMeshClip.WaterFootprints(sourceRenderers.Where(IsSourceWater)
                .Select(r=>(r.GetComponent<MeshFilter>().sharedMesh,r.transform)),map.transform);
            _bundle=AssetDatabase.LoadAssetAtPath<Mesh>(AssetPath);
            if(!partial)
            {
            if(_bundle==null){_bundle=new Mesh {name="WorldSectorSurfaceAssets"};AssetDatabase.CreateAsset(_bundle,AssetPath);}
            else foreach(Object part in AssetDatabase.LoadAllAssetsAtPath(AssetPath))if(part!=_bundle)Object.DestroyImmediate(part,true);
            _roadMaterial=new Material(Shader.Find("Universal Render Pipeline/Lit")){name="WorldSectorDirtRoad",color=new Color(.27f,.235f,.16f)};
            _roadMaterial.SetFloat("_Smoothness",.05f);Save(_roadMaterial);
            }
            var group=partial?previous.gameObject:new GameObject(RootName);
            if(!partial){SceneManager.MoveGameObjectToScene(group,global);group.transform.SetParent(map.StaticContentRoot,false);}
            var integratedPlaces=new HashSet<string>(profiles.Where(p=>p.locationId!=p.zoneId).Select(p=>p.locationId),StringComparer.Ordinal);
            foreach(var profile in profiles)
            {
                string file=profile.locationId==profile.zoneId?"data/zones/authored/"+profile.zoneId+".json":"data/locations/"+profile.locationId+".json";
                JObject definition=JObject.Parse(File.ReadAllText(Path.Combine(repository,file)));
                foreach(JObject site in (definition["sites"] as JArray ?? new JArray()).OfType<JObject>())integratedPlaces.Add(site.Value<string>("id"));
                foreach(JObject facility in (definition["facilities"] as JArray ?? new JArray()).OfType<JObject>())integratedPlaces.Add(facility.Value<string>("id"));
            }
            var cells=profiles.Select(p=>Rect.MinMaxRect((p.mapMinX-190)*.1f,(150-p.mapMinY-20)*.1f,(p.mapMinX+20-190)*.1f,(150-p.mapMinY)*.1f)).ToArray();
            var changed=new List<MeshRenderer>();var originalMeshes=new List<Mesh>();var originalEnabled=new List<bool>();
            foreach(var renderer in partial?Array.Empty<MeshRenderer>():sourceRenderers)
            {
                if(renderer.GetComponent<TextMesh>()!=null)continue;
                var anchor=renderer.GetComponentInParent<RoaGlobalMapNodeAnchor>();
                if(anchor!=null && !integratedPlaces.Contains(anchor.NodeId))continue;
                MeshFilter filter=renderer.GetComponent<MeshFilter>();if(filter?.sharedMesh==null || !renderer.enabled)continue;
                Vector3 min=map.transform.InverseTransformPoint(renderer.bounds.min),max=map.transform.InverseTransformPoint(renderer.bounds.max);
                if(!IsGroundOverlay(renderer)&&!cells.Any(c=>c.xMin<max.x && c.xMax>min.x && c.yMin<max.z && c.yMax>min.z))continue;
                changed.Add(renderer);originalMeshes.Add(filter.sharedMesh);originalEnabled.Add(renderer.enabled);
                if(renderer.GetComponentInParent<RoaGlobalMapNodeAnchor>()!=null)
                {
                    // The sector already contains this place's real architecture.
                    // Keep its ID/anchor, replace the former generic miniature.
                    renderer.enabled=false;PrefabUtility.RecordPrefabInstancePropertyModifications(renderer);continue;
                }
                Mesh clipped=RoaWorldSurfaceMeshClip.Subtract(filter.sharedMesh,renderer.transform,map.transform,cells);
                if(IsGroundOverlay(renderer))
                {
                    Mesh dry=RoaWorldSurfaceMeshClip.SubtractWater(clipped,renderer.transform,map.transform,waterFootprints);
                    Mesh projected=RoaWorldSurfaceMeshClip.ProjectGround(dry,renderer.transform,map.transform,canonicalGround,sourceLand.transform);
                    Object.DestroyImmediate(dry);dry=projected;
                    Object.DestroyImmediate(clipped);clipped=dry;
                }
                if(clipped.triangles.Length==0){renderer.enabled=false;Object.DestroyImmediate(clipped);}
                else {Save(clipped);filter.sharedMesh=clipped;}
                PrefabUtility.RecordPrefabInstancePropertyModifications(renderer);PrefabUtility.RecordPrefabInstancePropertyModifications(filter);
            }
            RoaWorldMapSectorAppearance first=null;
            foreach(var profile in bakeProfiles)
            {
                string sectorAssets="Assets/Art/Kromka/WorldSectorSurfaces/"+profile.zoneId+".asset";
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(Application.dataPath,"../",sectorAssets)));
                _bundle=AssetDatabase.LoadAssetAtPath<Mesh>(sectorAssets);
                if(_bundle==null){_bundle=new Mesh {name="WorldSectorAssets_"+profile.zoneId};AssetDatabase.CreateAsset(_bundle,sectorAssets);}
                else foreach(Object part in AssetDatabase.LoadAllAssetsAtPath(sectorAssets))if(part!=_bundle)Object.DestroyImmediate(part,true);
                Saved.Clear();TransientMaterials.Clear();_part=0;
                Scene local=EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(profile.locationId),OpenSceneMode.Additive);
                var location=local.GetRootGameObjects().SelectMany(g=>g.GetComponentsInChildren<RoaUnityLocationScene>(true)).Single();
                string definitionPath=profile.locationId==profile.zoneId?"data/zones/authored/"+profile.zoneId+".json":"data/locations/"+profile.locationId+".json";
                var definition=JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(Path.Combine(repository,definitionPath)));
                var painter=new GameObject("WorldSectorBakePainter");SceneManager.MoveGameObjectToScene(painter,local);
                painter.AddComponent<RoaLocalTerrain>().InitializeAuthoredSurface(definition,null,location.GroundRenderer);
                var root=new GameObject(profile.zoneId+"_LocalAppearance");SceneManager.MoveGameObjectToScene(root,global);root.transform.SetParent(group.transform,false);
                root.transform.localPosition=new Vector3((profile.mapMinX+10-190)*.1f,profile.datum,(150-profile.mapMinY-10)*.1f);
                root.transform.localScale=Vector3.one/profile.gain;root.layer=RoaWorldMap3D.MapLayer;
                var appearance=root.AddComponent<RoaWorldMapSectorAppearance>();first ??=appearance;
                appearance.MapMin=new Vector2(profile.mapMinX,profile.mapMinY);appearance.MapMax=appearance.MapMin+Vector2.one*20;
                appearance.HeightSide=65;appearance.Heights=new float[65*65];
                RoaGlobalMapRelief relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
                for(int z=0;z<65;z++)for(int x=0;x<65;x++)appearance.Heights[z*65+x]=profile.datum+RoaSectorSurface.Height(profile,relief,(x/64f-.5f)*profile.width,(z/64f-.5f)*profile.depth)/profile.gain;
                var desktop=new GameObject("DesktopDetail");desktop.transform.SetParent(root.transform,false);
                var mobile=new GameObject("MobileDetail");mobile.transform.SetParent(root.transform,false);
                appearance.DesktopDetail=desktop;appearance.MobileDetail=mobile;
                appearance.DesktopGround=AddGround(desktop.transform,profile,relief,groundMaterial,32);appearance.MobileGround=AddGround(mobile.transform,profile,relief,groundMaterial,16);
                int count=0;var significantRoots=new Dictionary<KromkaPlacedObjectAuthoring,bool>();var covers=new List<Mesh>();
                foreach(MeshRenderer source in local.GetRootGameObjects().SelectMany(g=>g.GetComponentsInChildren<MeshRenderer>(true)))
                {
                    if(source==location.GroundRenderer || !source.enabled || !source.gameObject.activeInHierarchy)continue;
                    MeshFilter filter=source.GetComponent<MeshFilter>();if(filter?.sharedMesh==null)continue;
                    bool infrastructure=source.GetComponentInParent<RoaSectorSurface>()!=null || Parents(source.transform).Any(t=>t.name=="SectorSurface_AUTHORED")
                        || source.GetComponentInParent<RoaDamRoadWaterProjection>()!=null || source.GetComponentInParent<RoaDamRoadRailProjection>()!=null
                        || source.GetComponentInParent<RoaSectorRailInfrastructure>()!=null
                        || source.GetComponentInParent<RoaOilExtraction>()!=null
                        || source.GetComponentInParent<RoaWaterCistern>()!=null;
                    var placed=source.GetComponentInParent<KromkaPlacedObjectAuthoring>();
                    bool landmark=false;
                    if(placed!=null&&!placed.GameplayTags.Contains("scatter"))
                    {
                        if(!significantRoots.TryGetValue(placed,out landmark))
                        {
                            var renderers=placed.GetComponentsInChildren<MeshRenderer>(true);
                            Bounds bounds=renderers.Length>0?renderers[0].bounds:new Bounds();
                            foreach(var part in renderers)bounds.Encapsulate(part.bounds);
                            landmark=placed.Role=="landmark"||placed.Role=="roof"||placed.GameplayTags.Contains("solar")||RoaOilExtraction.IsOilController(placed)||Mathf.Max(bounds.size.x,bounds.size.z)>4&&bounds.size.y>2;
                            significantRoots.Add(placed,landmark);
                        }
                    }
                    if(!infrastructure && !landmark)continue;
                    var lod=source.GetComponentInParent<LODGroup>();
                    if(lod!=null && lod.GetLODs().Length>0 && !lod.GetLODs().Last().renderers.Contains(source))continue;
                    if(Parents(source.transform).Any(t=>t.name.Contains("Boundary")||t.name.Contains("EdgeFrame")))continue;
                    if(source.bounds.max.x< -profile.width/2 || source.bounds.min.x>profile.width/2 || source.bounds.max.z< -profile.depth/2 || source.bounds.min.z>profile.depth/2)continue;
                    bool water=source.name.StartsWith("TesmaRiver",StringComparison.Ordinal) || source.name.StartsWith("SectorWater",StringComparison.Ordinal);
                    var child=new GameObject(source.name+"_"+count++);child.transform.SetParent(root.transform,false);
                    child.transform.localPosition=source.transform.position;child.transform.localRotation=source.transform.rotation;child.transform.localScale=source.transform.lossyScale;
                    child.layer=RoaWorldMap3D.MapLayer;child.AddComponent<MeshFilter>().sharedMesh=filter.sharedMesh;
                    var renderer=child.AddComponent<MeshRenderer>();renderer.sharedMaterials=water?new[]{waterMaterial}:source.sharedMaterials.Select(PersistMaterial).ToArray();
                    if(source.name==RoaSectorRailInfrastructure.CoverName)
                    {
                        Mesh cover=Object.Instantiate(filter.sharedMesh);cover.name="WorldTunnelCover_"+profile.zoneId;
                        Vector3[] vertices=cover.vertices;var uv=new Vector2[vertices.Length];
                        for(int i=0;i<vertices.Length;i++)
                        {
                            vertices[i]=source.transform.TransformPoint(vertices[i]);
                            Vector2 point=RoaSectorSurface.MapPoint(profile,vertices[i].x,vertices[i].z);uv[i]=new Vector2(point.x/380,point.y/300);
                        }
                        cover.vertices=vertices;cover.uv=uv;cover.RecalculateNormals();cover.RecalculateBounds();Save(cover);covers.Add(cover);
                        child.transform.localPosition=Vector3.zero;child.transform.localRotation=Quaternion.identity;child.transform.localScale=Vector3.one;
                        child.GetComponent<MeshFilter>().sharedMesh=cover;renderer.sharedMaterial=groundMaterial;
                        AddRoads(root.transform,profile,cover);
                    }
                    renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=true;
                }
                appearance.SurfaceCovers=covers.ToArray();appearance.SetMobile(false);
                MergeArchitecture(root.transform);
                EditorSceneManager.CloseScene(local,true);
                Debug.Log("[WORLD SURFACE BAKE] "+profile.zoneId+"; overview meshes "+count);
            }
            if(partial)
            {
                var owner=map.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true).Single(a=>a.name==retainedOwnerName);
                owner.OriginalRenderers=retainedRenderers;owner.OriginalMeshes=retainedMeshes;owner.OriginalEnabled=retainedEnabled;
            }
            else {first.OriginalRenderers=changed.ToArray();first.OriginalMeshes=originalMeshes.ToArray();first.OriginalEnabled=originalEnabled.ToArray();}
            // Place markers on the final visible mesh, including the public
            // terrain above a freight tunnel, rather than its buried floor.
            var prepared=map.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true);
            foreach(var anchor in map.GetComponentsInChildren<RoaGlobalMapNodeAnchor>(true))
            {
                JObject node=((JArray)authoredMap["nodes"]).OfType<JObject>().FirstOrDefault(n=>n.Value<string>("id")==anchor.NodeId);
                if(node==null)continue;
                var point=new Vector2(node.Value<float>("x"),node.Value<float>("y"));
                if(partial&&!bakeProfiles.Any(p=>point.x>=p.mapMinX&&point.x<=p.mapMinX+20&&point.y>=p.mapMinY&&point.y<=p.mapMinY+20))continue;
                foreach(var appearance in prepared)
                    if(appearance.TryHeight(point,out float height))
                    {
                        anchor.transform.position=map.transform.TransformPoint(new Vector3((point.x-190)*.1f,height,(150-point.y)*.1f));
                        PrefabUtility.RecordPrefabInstancePropertyModifications(anchor.transform);break;
                    }
            }
            AssetDatabase.SaveAssets();EditorSceneManager.MarkSceneDirty(global);EditorSceneManager.SaveScene(global);
            EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
            map=Object.FindFirstObjectByType<RoaUnityGlobalMapScene>();
            var saved=map.GetComponentsInChildren<RoaWorldMapSectorAppearance>(true);
            if(saved.Length!=profiles.Length || saved.Any(a=>a.GetComponentsInChildren<Collider>(true).Length!=0))throw new InvalidOperationException("Incomplete or physical world overview");
            foreach(var appearance in saved)
                if(appearance.DesktopDetail==null || appearance.MobileDetail==null || !appearance.TryHeight((appearance.MapMin+appearance.MapMax)*.5f,out _))throw new InvalidOperationException("Missing saved overview detail or picking height");
            Debug.Log("[WORLD SURFACE BAKE] PASS: "+bakeProfiles.Length+" sector appearances rebuilt; "+(profiles.Length-bakeProfiles.Length)+" saved roots retained; independent mobile detail and picking heights; no local colliders.");
        }
        private static IEnumerable<Transform> Parents(Transform node){for(;node!=null;node=node.parent)yield return node;}
        private static void MergeArchitecture(Transform root)
        {
            var sources=root.GetComponentsInChildren<MeshRenderer>(true).Where(r=>r.transform.parent==root).ToArray();
            var parts=new Dictionary<Material,List<CombineInstance>>();
            foreach(var source in sources)
            {
                Mesh mesh=source.GetComponent<MeshFilter>().sharedMesh;
                for(int sub=0;sub<mesh.subMeshCount;sub++)
                {
                    Material material=source.sharedMaterials[Mathf.Min(sub,source.sharedMaterials.Length-1)];
                    if(material==null)continue;
                    if(!parts.TryGetValue(material,out var list))parts[material]=list=new List<CombineInstance>();
                    list.Add(new CombineInstance {mesh=mesh,subMeshIndex=sub,transform=root.worldToLocalMatrix*source.transform.localToWorldMatrix});
                }
            }
            foreach(var pair in parts)
            {
                var mesh=new Mesh {name="SectorArchitecture_"+pair.Key.name,indexFormat=IndexFormat.UInt32};
                mesh.CombineMeshes(pair.Value.ToArray(),true,true);Save(mesh);
                var group=new GameObject(mesh.name);group.transform.SetParent(root,false);group.layer=RoaWorldMap3D.MapLayer;
                group.AddComponent<MeshFilter>().sharedMesh=mesh;var renderer=group.AddComponent<MeshRenderer>();renderer.sharedMaterial=pair.Key;renderer.shadowCastingMode=ShadowCastingMode.Off;
            }
            foreach(var source in sources)Object.DestroyImmediate(source.gameObject);
        }
        private static Mesh AddGround(Transform parent,RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Material material,int segments)
        {
            Mesh mesh=RoaWorldSurfaceGround.Build(p,relief,segments);Save(mesh);
            var child=new GameObject(mesh.name);child.layer=RoaWorldMap3D.MapLayer;child.transform.SetParent(parent,false);
            Mesh visible=RoaSectorRailInfrastructure.VisibleTerrain(mesh,p);if(visible!=mesh)Save(visible);
            child.AddComponent<MeshFilter>().sharedMesh=visible;var renderer=child.AddComponent<MeshRenderer>();renderer.sharedMaterial=material;renderer.shadowCastingMode=ShadowCastingMode.Off;
            AddRoads(parent,p,visible);
            return mesh;
        }
        private static void AddRoads(Transform parent,RoaSectorSurface.Profile p,Mesh surface)
        {
            Mesh road=RoaWorldSurfaceRoads.Build(p,surface);
            if(road.vertexCount>0)
            {
                Save(road);var paths=new GameObject(road.name);paths.layer=RoaWorldMap3D.MapLayer;paths.transform.SetParent(parent,false);
                paths.AddComponent<MeshFilter>().sharedMesh=road;var roadRenderer=paths.AddComponent<MeshRenderer>();roadRenderer.sharedMaterial=_roadMaterial;roadRenderer.shadowCastingMode=ShadowCastingMode.Off;
            }
            else Object.DestroyImmediate(road);
        }
        private static void Save(Object asset){asset.name+="_"+(++_part);AssetDatabase.AddObjectToAsset(asset,_bundle);}
        private static Mesh Persist(Mesh mesh)
        {
            if(AssetDatabase.Contains(mesh))return mesh;if(Saved.TryGetValue(mesh,out Object prior))return (Mesh)prior;
            Mesh copy=Object.Instantiate(mesh);Save(copy);Saved.Add(mesh,copy);return copy;
        }
        private static Material PersistMaterial(Material material)
        {
            if(material==null || AssetDatabase.Contains(material))return material;if(Saved.TryGetValue(material,out Object prior))return (Material)prior;
            string recipe=EditorJsonUtility.ToJson(material);
            if(TransientMaterials.TryGetValue(recipe,out Material shared)){Saved.Add(material,shared);return shared;}
            Material copy=Object.Instantiate(material);
            foreach(string property in copy.GetTexturePropertyNames())
                if(copy.GetTexture(property) is Texture2D texture && !AssetDatabase.Contains(texture))
                {
                    if(!Saved.TryGetValue(texture,out Object saved)){saved=Object.Instantiate(texture);Save(saved);Saved.Add(texture,saved);}copy.SetTexture(property,(Texture2D)saved);
                }
            Save(copy);Saved.Add(material,copy);TransientMaterials.Add(recipe,copy);return copy;
        }
    }
}
