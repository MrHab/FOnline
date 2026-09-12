using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.Networking;
using Object = UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Exercises production loaders in a temporary Play scene. No account/server mutations.</summary>
    public static class RoaFreeItemProbe
    {
        private static bool _suitCandidateRun;
        private static string Origin => Environment.GetEnvironmentVariable("ROA_UNITY_PROBE_ORIGIN")
            ?? (_suitCandidateRun ? "http://127.0.0.1:3002" : "http://127.0.0.1:3000");
        private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        private static SceneSetup[] _scenes;
        private static bool _oldOptionsEnabled;
        private static EnterPlayModeOptions _oldOptions;
        private static bool _running;
        private static bool _batchRun;
        private static int _batchExitCode=1;
        private static bool _reloadLocked;
        private static int _cuffExitSamples;
        private const string RecoveryFile = "Library/roa-free-item-probe-recovery.json";
        private static string _runId;
        private static string _status="idle";
        private static string Output => Path.GetFullPath(_suitCandidateRun
            ? "Logs/UpperSuitUnityReview/runtime" : "Logs/FreeItemReview/runtime");
        public static string Status
        {
            get => _status;
            private set
            {
                _status=value;
                Directory.CreateDirectory(Output);
                File.WriteAllText(Path.Combine(Output,"progress.json"),new JObject {
                    ["runId"]=_runId, ["status"]=value, ["at"]=DateTime.UtcNow.ToString("O"),
                    ["equipmentCatalogVersion"]=RoaEquipmentModelCatalog.CatalogVersion }.ToString());
            }
        }

        [InitializeOnLoadMethod]
        private static void InitializeRecovery()
        {
            if(AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.delayCall+=()=>
            {
                if(!_running && File.Exists(RecoveryFile) && !EditorApplication.isPlayingOrWillChangePlaymode)
                    RestoreInterruptedScene();
            };
            EditorApplication.playModeStateChanged+=state=>
            {
                if(state==PlayModeStateChange.EnteredEditMode && !_running && File.Exists(RecoveryFile)) RestoreInterruptedScene();
            };
        }

        [MenuItem("Realm of Ashes/Восстановить сцену после проверки предметов")]
        public static void RestoreInterruptedScene()
        {
            if(_running || EditorApplication.isPlayingOrWillChangePlaymode || !File.Exists(RecoveryFile)) return;
            Scene current=SceneManager.GetActiveScene();
            if(SceneManager.sceneCount>1 || (SceneManager.sceneCount==1
                && (!string.IsNullOrEmpty(current.path) || current.isDirty || current.rootCount!=0)))
            {
                Debug.LogWarning("[ROA FREE ITEMS] Recovery will not replace a non-empty or edited scene.");
                return;
            }
            JObject recovery=JObject.Parse(File.ReadAllText(RecoveryFile));
            SceneSetup[] scenes=((JArray)recovery["scenes"]).Select(s=>new SceneSetup {
                path=s["path"].ToString(), isLoaded=s["isLoaded"].Value<bool>(), isActive=s["isActive"].Value<bool>() }).ToArray();
            if(recovery["restoreOptions"]?.Value<bool>()==true)
            {
                EditorSettings.enterPlayModeOptionsEnabled=recovery["optionsEnabled"].Value<bool>();
                EditorSettings.enterPlayModeOptions=(EnterPlayModeOptions)recovery["options"].Value<int>();
            }
            RestoreScenes(scenes);
            File.Delete(RecoveryFile);
            Status="interrupted run recovered; original scene restored";
        }

        [MenuItem("Realm of Ashes/Проверить новые предметы и аптечку")]
        public static void Run()
        {
            if (_running) throw new InvalidOperationException("A model probe is already running.");
            _suitCandidateRun=false;
            _batchRun=false;
            StartRun();
        }

        [MenuItem("Realm of Ashes/Проверить кандидаты костюмов")]
        public static void RunSuitCandidate()
        {
            if (_running) throw new InvalidOperationException("A model probe is already running.");
            _suitCandidateRun=true;
            _batchRun=false;
            StartRun();
        }

        private static void StartRun()
        {
            if(!Uri.TryCreate(Origin,UriKind.Absolute,out Uri origin) || !origin.IsLoopback
                || (origin.Scheme!="http" && origin.Scheme!="https"))
                throw new InvalidOperationException("The asset probe requires a loopback HTTP(S) origin.");
            if (_running || EditorApplication.isPlaying || EditorApplication.isCompiling)
                throw new InvalidOperationException("Probe requires idle Edit mode.");
            if(File.Exists(RecoveryFile)) throw new InvalidOperationException("Resolve the previous probe recovery before starting another run.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save your scene before running this probe.");
            _scenes = EditorSceneManager.GetSceneManagerSetup();
            _oldOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
            _oldOptions = EditorSettings.enterPlayModeOptions;
            _runId=Guid.NewGuid().ToString("N");
            File.WriteAllText(RecoveryFile,new JObject {
                ["runId"]=_runId, ["restoreOptions"]=true,
                ["optionsEnabled"]=_oldOptionsEnabled, ["options"]=(int)_oldOptions,
                ["scenes"]=new JArray(_scenes.Select(s=>new JObject {
                    ["path"]=s.path,["isLoaded"]=s.isLoaded,["isActive"]=s.isActive })) }.ToString());
            EditorSettings.enterPlayModeOptionsEnabled = true;
            EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
            _running = true;
            // Keep another script import from destroying the async probe's
            // continuation midway through Play mode. Release immediately on exit.
            EditorApplication.LockReloadAssemblies();
            _reloadLocked=true;
            Status = "entering Play mode";
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorApplication.playModeStateChanged += PlayState;
                EditorApplication.EnterPlaymode();
            }
            catch
            {
                EditorApplication.playModeStateChanged-=PlayState;
                _running=false;
                if(_reloadLocked) { _reloadLocked=false; EditorApplication.UnlockReloadAssemblies(); }
                RestoreInterruptedScene();
                throw;
            }
        }

        // Keep the graphics device: the probe verifies real rendered models.
        // Invoke with -batchmode -executeMethod ...RoaFreeItemProbe.RunBatch, without -quit/-nographics.
        public static void RunBatch()
        {
            if(!Application.isBatchMode) throw new InvalidOperationException("RunBatch requires -batchmode.");
            _batchRun=true;
            try { RestoreInterruptedScene(); StartRun(); }
            catch(Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
        }

        // A separate immutable loopback asset host serves candidates; no public
        // catalog or compiled runtime fingerprint is changed for this review.
        public static void RunSuitCandidateBatch()
        {
            _suitCandidateRun=true;
            RunBatch();
        }

        private static void RestoreScenes(SceneSetup[] scenes)
        {
            // A fresh batch process has no loaded scene, unlike the interactive editor.
            if(scenes.Length==0) EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            else EditorSceneManager.RestoreSceneManagerSetup(scenes);
        }

        private static async void PlayState(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.EnteredEditMode && _running)
            {
                EditorApplication.playModeStateChanged -= PlayState;
                try
                {
                    EditorSettings.enterPlayModeOptionsEnabled = _oldOptionsEnabled;
                    EditorSettings.enterPlayModeOptions = _oldOptions;
                    RestoreScenes(_scenes);
                    File.Delete(RecoveryFile);
                }
                catch(Exception error)
                {
                    _batchExitCode=1;
                    Status="FAIL restoring original scene: "+error.Message;
                    throw;
                }
                finally
                {
                    _running = false;
                    if(_reloadLocked) { _reloadLocked=false; EditorApplication.UnlockReloadAssemblies(); }
                    if(_batchRun) EditorApplication.delayCall+=()=>EditorApplication.Exit(_batchExitCode);
                }
            }
            if (state != PlayModeStateChange.EnteredPlayMode || !_running) return;
            Directory.CreateDirectory(Output);
            try
            {
                JObject report = await RunAsync();
                report["catalogVersion"] = RoaItemModelCatalog.CatalogVersion;
                report["runId"]=_runId;
                report["at"]=DateTime.UtcNow.ToString("O");
                report["result"] = "PASS";
                _batchExitCode=0;
                File.WriteAllText(Path.Combine(Output, "report.json"), report.ToString());
                Status = "PASS";
                Debug.Log("[ROA FREE ITEMS] PASS " + report.ToString(Newtonsoft.Json.Formatting.None));
            }
            catch (Exception error)
            {
                Status = "FAIL: " + error.Message;
                File.WriteAllText(Path.Combine(Output, "report.json"), new JObject { ["result"] = "FAIL", ["runId"]=_runId,
                    ["at"]=DateTime.UtcNow.ToString("O"), ["error"] = error.ToString() }.ToString());
                Debug.LogError("[ROA FREE ITEMS] " + error);
            }
            finally { EditorApplication.ExitPlaymode(); }
        }

        private static async Task<JObject> RunAsync()
        {
            if(_suitCandidateRun) return await RunSuitCandidateAsync();
            _cuffExitSamples=0;
            var host = new GameObject("FreeItemProbe");
            var socket = host.AddComponent<RoaSocketClient>();
            Field(socket, "_baseUrl").SetValue(socket, Origin); // Asset origin only. Do not connect a test player.
            var ground = host.AddComponent<RoaGroundItems>();
            ground.Socket = socket;
            var manifest = JObject.Parse(File.ReadAllText("../public/assets/models/items/kromka/manifest.json"));
            var catalog = (JArray)manifest["files"];
            var physical = catalog.OfType<JObject>().Where(r => r["presentationOnly"].Value<bool>() == false).ToArray();
            var allItems = (JArray)JObject.Parse(File.ReadAllText("../data/kromka/items.json"))["items"];
            MethodInfo pathMethod = typeof(RoaGroundItems).GetMethod("ModelPath", BindingFlags.Static | BindingFlags.NonPublic);
            int mapped = 0;
            foreach (JObject item in allItems)
            {
                if (item["id"].ToString() == "fists") continue;
                object[] args = { item["id"].ToString(), null };
                string path = (string)pathMethod.Invoke(null, args);
                Check(!string.IsNullOrEmpty(path), "Missing runtime lookup " + item["id"]);
                Check(File.Exists("../public" + path.Split('?')[0]), "Missing GLB " + path);
                mapped++;
            }
            Status = "loading dropped items";
            for (int i = 0; i < physical.Length; i++)
                ground.ApplyDropAck(new JObject { ["ok"] = true, ["item"] = Drop("probe" + i, physical[i]["id"].ToString(), i) });
            await Until(() => ground.LoadedVisualCount == physical.Length, "ground models", 60000);
            Check(ground.FallbackVisualCount == 0, "Permanent ground placeholders");
            foreach (JObject row in physical)
            {
                string id = row["id"].ToString();
                Transform visual = ground.GetComponentsInChildren<Transform>().First(t => t.name == "GroundItemModel:" + id);
                Bounds box = BoundsOf(visual);
                JArray min = (JArray)row["bounds"]["min"], max = (JArray)row["bounds"]["max"];
                Vector3 expected = new Vector3(max[0].Value<float>() - min[0].Value<float>(),
                    max[2].Value<float>() - min[2].Value<float>(), max[1].Value<float>() - min[1].Value<float>());
                Check(Vector3.Distance(box.size, expected) < .007f, id + ": distorted ground scale " + box.size + " vs " + expected);
                Check(Mathf.Abs(box.min.y - .025f) < .007f, id + ": does not rest on floor " + box.min.y);
            }
            var light = new GameObject("ProbeSun").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.2f;
            light.transform.rotation = Quaternion.Euler(45, -20, 0);
            var camera = new GameObject("ProbeCamera").AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.16f,.19f,.18f);
            camera.orthographic = true;
            camera.orthographicSize = 2.5f;
            camera.transform.position = new Vector3(2.0f, 6, 6.6f);
            camera.transform.LookAt(new Vector3(2.0f, 0, 1.6f));
            await Capture(camera, "ground-desktop", 1440, 900);
            await Capture(camera, "ground-mobile", 960, 540);
            ground.ApplyDropAck(new JObject { ["ok"] = true, ["item"] = Drop("backpack", "backpack", 24) });
            await Until(() => ground.LoadedVisualCountForItem("backpack") == 1, "dropped backpack", 30000);
            Transform droppedPack = ground.GetComponentsInChildren<Transform>().First(t => t.name == "GroundItemModel:backpack");
            Check(droppedPack.GetComponentsInChildren<Transform>().Any(t => t.name.Contains("downloaded_sack")), "Dropped backpack uses old model");
            Bounds packBounds = BoundsOf(droppedPack);
            Check(Mathf.Abs(packBounds.min.y - .025f) < .01f && packBounds.size.x > .4f && packBounds.size.x < .9f
                && packBounds.size.z > .35f && packBounds.size.z < .85f, "Dropped backpack scale/floor wrong: " + packBounds);
            Invoke(ground, "Remove", "backpack");
            // A request replaced and then removed in the same frame must not leave a late clone.
            ground.ApplyDropAck(new JObject { ["ok"] = true, ["item"] = Drop("race", "medkit", 30) });
            ground.ApplyDropAck(new JObject { ["ok"] = true, ["item"] = Drop("race", "blue", 30) });
            Invoke(ground, "Remove", "race");
            await Task.Delay(300);
            Check(ground.Count == physical.Length, "Late ground replacement survived removal");
            ground.Clear();
            await Task.Yield();

            string[] helmets = { "helmet", "tacticalHelmet", "assaultHelmet", "preWarHelmet", "weldedHelmet" };
            string[] boots = { "boots", "scoutBoots", "reinforcedBoots", "assaultBoots" };
            string[] gearIds = helmets.Concat(boots).ToArray();
            for (int i=0; i<gearIds.Length; i++)
                ground.ApplyDropAck(new JObject { ["ok"] = true, ["item"] = Drop("gear"+i, gearIds[i], i) });
            await Until(() => ground.LoadedVisualCount == gearIds.Length, "new dropped helmets/boots", 60000);
            foreach (string id in gearIds)
            {
                Transform visual = ground.GetComponentsInChildren<Transform>().First(t => t.name == "GroundItemModel:"+id);
                Check(visual.GetComponentsInChildren<Transform>().Any(t => t.name.StartsWith("free_"+id+"_")), "Old dropped gear: "+id);
                Bounds box=BoundsOf(visual);
                Check(Mathf.Abs(box.min.y-.025f)<.01f && box.size.magnitude<1f && box.size.magnitude>.15f, "Dropped gear size/floor: "+id+" "+box);
            }
            await Capture(camera,"equipment-drops-desktop",1440,900);
            await Capture(camera,"equipment-drops-mobile",960,540);
            ground.Clear();
            await Task.Yield();

            string[] suits = { "hazmatSuit", "energySuit" };
            for (int i=0; i<suits.Length; i++)
                ground.ApplyDropAck(new JObject { ["ok"]=true, ["item"]=Drop("suit"+i,suits[i],i) });
            await Until(()=>ground.LoadedVisualCount==suits.Length,"dropped layered suits",60000);
            foreach(string id in suits)
            {
                Transform visual=ground.GetComponentsInChildren<Transform>().First(t=>t.name=="GroundItemModel:"+id);
                Check(visual.GetComponentsInChildren<Renderer>(true).Any(r=>r.name.Contains(RoaSuitModelCatalog.FootwearLayer)
                    && r.gameObject.activeInHierarchy && r.enabled),"Dropped suit lost its integrated footwear: "+id);
                Check(Mathf.Abs(BoundsOf(visual).min.y-.025f)<.01f,"Dropped suit not resting on ground: "+id);
            }
            await Capture(camera,"suit-drops-desktop",1440,900);
            await Capture(camera,"suit-drops-mobile",960,540);
            ground.Clear();
            await Task.Yield();

            Status = "loading revealed artifacts";
            var detector = host.AddComponent<RoaKromkaShiftAndDetector>();
            Field(detector, "_socket").SetValue(detector, socket);
            JObject defs = JObject.Parse(File.ReadAllText("../data/artifacts.json"));
            string[] types = ((JArray)defs["types"]).Select(t => t["id"].ToString()).Concat(new[] { "" }).ToArray();
            var artifactRows = new JArray();
            for (int i = 0; i < types.Length; i++) artifactRows.Add(Artifact("art" + i, types[i], i));
            Invoke(detector, "ApplyArtifactState", ArtifactState(artifactRows));
            await Until(() => ArtifactModels(detector).Count == types.Length, "artifact models", 60000);
            foreach (JObject row in artifactRows)
                Check(ArtifactModels(detector).Any(m => m.name == "ItemModel:" + RoaItemModelCatalog.ArtifactItemId(row["typeId"].ToString())), "Incorrect artifact identity");
            await Capture(camera, "artifacts-desktop", 1440, 900);
            await Capture(camera, "artifacts-mobile", 960, 540);
            // Same server artifact id: known -> unknown -> hidden -> removed, including an in-flight request.
            var known = Artifact("identity", "spring", 0);
            Invoke(detector, "ApplyArtifactState", ArtifactState(new JArray(known)));
            await Until(() => ArtifactModels(detector).Count == 1, "known artifact", 15000);
            GameObject previous = ArtifactModels(detector)[0];
            known["typeId"] = "";
            Invoke(detector, "ApplyArtifactState", ArtifactState(new JArray(known)));
            Check(!previous.activeSelf, "Detector downgrade leaked the previously identified model");
            await Until(() => ArtifactModels(detector).Count == 1 && ArtifactModels(detector)[0].name.EndsWith("artifactUnknown"), "unknown artifact", 15000);
            known["revealed"] = false;
            known.Remove("x"); known.Remove("z");
            Invoke(detector, "ApplyArtifactState", ArtifactState(new JArray(known)));
            Check(!ArtifactModels(detector)[0].activeInHierarchy, "Hidden artifact is visible");
            Invoke(detector, "ClearViews");
            Invoke(detector, "ApplyArtifactState", ArtifactState(new JArray(Artifact("race", "memory", 0))));
            Invoke(detector, "ClearViews");
            await Task.Delay(300);
            Check(ArtifactModels(detector).Count == 0, "Late artifact clone survived room clear");

            Status = "testing medical case on all bodies";
            var medical = new JArray();
            var equipmentResults = new JArray();
            var utilityResults = new JArray();
            var suitResults = new JArray();
            var offhandResults = new JArray();
            Check(RoaLocalModelReview.AcceptsUrl("http://127.0.0.1:3000/?roaModelReview=1"),"Loopback model review rejected");
            Check(!RoaLocalModelReview.AcceptsUrl("https://rangir.ru/?roaModelReview=1")
                && !RoaLocalModelReview.AcceptsUrl("http://127.0.0.1:3000/?roaModelReview=0"),"Review must never activate for production or normal login");
            var tutorialCase = RoaTutorialProps.Build("medkit", host.transform);
            var tutorialView = tutorialCase.GetComponent<RoaItemPropView>();
            await tutorialView.Load(Origin);
            Check(tutorialView.Ready, "Tutorial medical case not loaded");
            Check(tutorialCase.GetComponentsInChildren<Transform>().Any(t=>t.name=="item_medkit"), "Tutorial still uses procedural case");
            Check(!tutorialCase.GetComponentsInChildren<Transform>().Any(t=>t.name=="MedicalCase"), "Old tutorial cubes remain");
            Object.Destroy(tutorialCase);
            foreach (string sex in new[] { "male", "female" }) foreach (string body in new[] { "slim", "medium", "large" })
            {
                var previewHost = new GameObject("MedicalCase:" + sex + "_" + body);
                var preview = previewHost.AddComponent<RoaCharacterPreview>();
                preview.Show(Origin, new CharacterAppearance { Sex = sex, BodyType = body, FaceId = sex + "_04", HairId = "short_crop", HairColorId = "hair_08" }, 640, 640);
                // The production preview hides below the game at y=-10000.
                // This isolated test scene needs no such separation, and moving
                // its complete stage to the origin avoids centimetre-scale
                // floating-point cancellation in skinned-mesh bake matrices.
                previewHost.transform.Find("CharacterPreviewScene").position=Vector3.zero;
                await Until(() => preview.IsReady, "body " + sex + "_" + body, 60000);
                var character = previewHost.GetComponentInChildren<RoaCharacterView>(true);
                await character.EquipWeapon(Origin, "medkit");
                await character.EquipItems(Origin, new JObject { ["offhand"] = "medkit", ["backpack"] = "backpack" });
                Check(character.HasLoadedEquipment("backpack", "backpack"), "New backpack not equipped");
                var packRenderers = new List<SkinnedMeshRenderer>();
                character.CollectEquipmentRenderers(packRenderers);
                Check(packRenderers.Any(r => r.name.Contains("downloaded_sack")), "Old backpack loaded instead of downloaded replacement");
                foreach (var renderer in packRenderers) foreach (Transform bone in renderer.bones)
                    Check(bone != null && bone.IsChildOf(character.transform), "Backpack retained a disconnected donor skeleton");
                Check(character.WeaponReady, "Right medical case not ready");
                var weapon = (RoaWeaponView)Field(character, "_weapon").GetValue(character);
                var offhand = (RoaOffhandWeaponView)Field(character, "_offhandWeapon").GetValue(character);
                Check(offhand.Ready && offhand.WeaponId == "medkit", "Left medical case not ready");
                Check(!weapon.DualWield, "Medical case triggered dual firearm pose");
                Transform right = (Transform)Field(weapon, "_weapon").GetValue(weapon);
                Transform left = (Transform)Field(offhand, "_weapon").GetValue(offhand);
                Check(right.GetComponentInParent<Animation>() != null && left.GetComponentInParent<Animation>() != null, "Case not parented to animated character");
                var animation = character.GetComponentInChildren<Animation>(true);
                int samples = 0;
                foreach (AnimationState clip in animation)
                {
                    animation.Play(clip.name);
                    foreach (float fraction in new[] { 0f, .45f, .9f })
                    {
                        clip.time = clip.length * fraction;
                        animation.Sample();
                        foreach (Transform item in new[] { right, left })
                        {
                            Transform grip = RoaItemModelCatalog.FindSocket(item, "socket_grip_r");
                            Check(Vector3.Distance(grip.position, item.parent.TransformPoint(RoaItemModelCatalog.MedicalPalmOffset)) < .003f, "Medical handle separates during " + clip.name);
                            Check(item.GetComponentsInChildren<MeshFilter>(true).Length > 0, "Medical model geometry absent");
                        }
                        samples++;
                    }
                }
                animation.Play("idle"); animation["idle"].time = .3f; animation.Sample();
                foreach (Transform item in new[] { right, left })
                {
                    Transform grip = RoaItemModelCatalog.FindSocket(item, "socket_grip_r");
                    Check(BoundsOf(item).center.y < grip.position.y - .07f,
                        "Idle case projects into the forearm instead of hanging below the palm");
                }
                foreach (Transform node in previewHost.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = RoaCharacterPreview.PreviewLayer;
                Camera medicalCamera = previewHost.GetComponentInChildren<Camera>(true);
                medicalCamera.transform.localPosition = new Vector3(2,1.5f,2.8f);
                medicalCamera.transform.LookAt(character.transform.position + Vector3.up * 1.1f);
                await Capture(medicalCamera, "medkit-" + sex + "_" + body + "-desktop", 1440,900);
                await Capture(medicalCamera, "medkit-" + sex + "_" + body + "-mobile", 960,540);
                medicalCamera.transform.localPosition = new Vector3(-1.4f,1.6f,-3f);
                medicalCamera.transform.LookAt(character.transform.position + Vector3.up * 1.15f);
                await Capture(medicalCamera, "backpack-" + sex + "_" + body + "-desktop", 1440,900);
                await Capture(medicalCamera, "backpack-" + sex + "_" + body + "-mobile", 960,540);
                // A medical item beside a pistol must still not select dual firearm IK.
                await character.EquipWeapon(Origin, "pistol");
                Check(!weapon.DualWield, "Pistol + medkit incorrectly selects dual firearm IK");
                medical.Add(new JObject { ["body"] = sex + "_" + body, ["animationSamplesPerHand"] = samples });
                equipmentResults.Add(await TestEquipment(character,previewHost,medicalCamera,sex+"_"+body,helmets,boots));
                utilityResults.Add(await TestUtilities(character,previewHost,medicalCamera,sex+"_"+body));
                suitResults.Add(await TestSuitLayers(character,previewHost,medicalCamera,sex+"_"+body,boots));
                offhandResults.Add(await TestOffhandModels(character,previewHost,medicalCamera,sex+"_"+body));
                Object.Destroy(previewHost);
                await Task.Yield();
            }
            Object.Destroy(host); Object.Destroy(light.gameObject); Object.Destroy(camera.gameObject);
            await Task.Yield();
            await TestLocalReview();
            return new JObject { ["runtimeGroundLookups"] = mapped, ["loadedGroundModels"] = physical.Length,
                ["revealedArtifactModels"] = types.Length, ["identityDowngradeAndHide"] = true,
                ["removeDuringLoad"] = true, ["medicalCases"] = medical,
                ["backpackBodies"] = medical.Count, ["equipmentCatalogVersion"] = RoaEquipmentModelCatalog.CatalogVersion,
                ["equipmentBodies"] = equipmentResults, ["newDroppedGear"] = gearIds.Length,
                ["utilityBodies"] = utilityResults, ["utilityCatalogVersion"] = RoaWornUtilityCatalog.CatalogVersion,
                ["suitBodies"] = suitResults, ["suitCatalogVersion"] = RoaSuitModelCatalog.CatalogVersion,
                ["offhandBodies"] = offhandResults,
                ["droppedLayeredSuits"] = suits.Length,
                ["tutorialMedicalCase"] = true,
                ["localBrowserReview"] = true,
                ["animatedRaysExitingOpenCuff"] = _cuffExitSamples,
                ["captureSizes"] = new JArray("1440x900", "960x540") };
        }

        private static async Task<JObject> TestEquipment(RoaCharacterView character, GameObject host, Camera camera,
            string bodyKey, string[] helmets, string[] boots)
        {
            string[] armor = { "leather", "metalArmor", "ballisticVest", "combatArmor", "heavyArmor", "hazmatSuit", "energySuit" };
            var bones=(Dictionary<string,Transform>)Field(character,"_bones").GetValue(character);
            Animation animation=character.GetComponentInChildren<Animation>(true);
            int poseSamples=0, coverageSamples=0;
            float maxHeadSlip=0;
            await character.EquipWeapon(Origin, "");
            for(int outfit=0; outfit<helmets.Length+armor.Length; outfit++)
            {
                Status="gear "+bodyKey+" outfit "+(outfit+1)+"/12";
                string helmet=helmets[outfit%helmets.Length], boot=boots[outfit%boots.Length];
                var equipment=new JObject { ["helmet"]=helmet, ["boots"]=boot, ["backpack"]="backpack" };
                if(outfit>=helmets.Length) equipment["armor"]=armor[outfit-helmets.Length];
                await character.EquipItems(Origin,equipment);
                foreach(Transform node in character.GetComponentsInChildren<Transform>(true).Where(t=>t.name.StartsWith("EquipmentSource:")))
                    Check(!node.gameObject.activeInHierarchy,"Unanimated import staging rig became visible");
                await Task.Yield();
                Check(character.HasLoadedEquipment("helmet",helmet) && character.HasLoadedEquipment("boots",boot),"Gear not ready "+bodyKey);
                Check(!character.AnyHairVisible,"Hair protrudes through helmet");
                var renderers=new List<SkinnedMeshRenderer>();
                character.CollectEquipmentRenderers(renderers);
                foreach(string id in new[]{helmet,boot})
                    Check(renderers.Any(r=>r.name.StartsWith("free_"+id+"_")),"Old worn gear: "+id);
                foreach(var renderer in renderers) foreach(Transform bone in renderer.bones)
                    Check(bone!=null && bones.TryGetValue(bone.name,out Transform actual) && actual==bone,"Disconnected donor bone "+renderer.name);
                if(outfit<helmets.Length)
                {
                    var rigidHeadOffsets=new Dictionary<string,Vector3>();
                    foreach(AnimationState clip in animation)
                    {
                        animation.Play(clip.name);
                        foreach(float fraction in new[]{0f,.45f,.9f})
                        {
                            clip.time=clip.length*fraction; animation.Sample();
                            foreach(var renderer in renderers.Where(r=>r.name.StartsWith("free_"+helmet+"_") || r.name.StartsWith("free_"+boot+"_")))
                            {
                                // BakeMesh(true) compensates renderer scale;
                                // TransformPoint below applies that scale once.
                                var mesh=new Mesh(); renderer.BakeMesh(mesh,true);
                                var points=mesh.vertices.Select(v=>renderer.transform.TransformPoint(v)).ToArray();
                                Check(points.Length>0,"Empty deformed equipment");
                                var box=new Bounds(points[0],Vector3.zero);
                                foreach(Vector3 p in points) box.Encapsulate(p);
                                Check(box.size.magnitude<.85f,"Equipment explodes during "+clip.name+": "+renderer.name);
                                string anchor=renderer.name.Contains("Helmet") || renderer.name.StartsWith("free_helmet_") ? "head" : renderer.name.EndsWith("_0") ? "foot_r" : "foot_l";
                                float distance=Vector3.Distance(box.center,bones[anchor].position);
                                Check(distance<(anchor=="head"?.45f:.30f),"Equipment detached from "+anchor+" during "+clip.name+" item="+renderer.name
                                    +" distance="+distance+" bounds="+box+" bone="+bones[anchor].position);
                                if(anchor=="head")
                                {
                                    // Head pivots are not at the skull centre and
                                    // differ between the male/female base rigs.
                                    // A rigid helmet must keep its vertex centroid
                                    // fixed in its actual head-bone space instead.
                                    Vector3 centroid=Vector3.zero;
                                    foreach(Vector3 point in points) centroid+=point-points[0];
                                    centroid=points[0]+centroid/points.Length;
                                    Vector3 offset=bones[anchor].InverseTransformPoint(centroid);
                                    if(rigidHeadOffsets.TryGetValue(renderer.name,out Vector3 baseline))
                                    {
                                        // Imported bone-local coordinates may be
                                        // centimetres; compare the residual in world metres.
                                        float slip=Vector3.Distance(bones[anchor].TransformPoint(baseline),centroid);
                                        maxHeadSlip=Mathf.Max(maxHeadSlip,slip);
                                        if(slip>=.004f)
                                        {
                                            Vector3 cpu=Vector3.zero;
                                            var raw=renderer.sharedMesh.vertices;
                                            var bw=renderer.sharedMesh.boneWeights;
                                            var bp=renderer.sharedMesh.bindposes;
                                            for(int n=0;n<raw.Length;n++)
                                                cpu+=renderer.bones[bw[n].boneIndex0].TransformPoint(bp[bw[n].boneIndex0].MultiplyPoint3x4(raw[n]));
                                            cpu/=raw.Length;
                                            throw new InvalidOperationException("Helmet slips during "+clip.name+": "+renderer.name+" metres="+slip
                                                +" baked="+centroid.ToString("F5")+" cpu="+cpu.ToString("F5")
                                                +" meshScale="+renderer.transform.lossyScale.ToString("F5")+" boneScale="+bones[anchor].lossyScale.ToString("F5"));
                                        }
                                    }
                                    else rigidHeadOffsets[renderer.name]=offset;
                                }
                                Object.Destroy(mesh);
                            }
                            if(fraction==.45f)
                            {
                                try { coverageSamples+=CheckAnimatedFootCoverage(character,renderers,boot,clip.name); }
                                catch
                                {
                                    foreach(Transform node in host.GetComponentsInChildren<Transform>(true)) node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
                                    Vector3 feet=(bones["foot_l"].position+bones["foot_r"].position)*.5f;
                                    camera.transform.position=feet+new Vector3(.55f,.4f,.85f);
                                    camera.transform.LookAt(feet);
                                    await Capture(camera,"gear-failure-"+bodyKey+"-"+boot+"-"+clip.name,1440,900);
                                    throw;
                                }
                            }
                            poseSamples++;
                        }
                    }
                }
                animation.Play("idle"); animation["idle"].time=.3f; animation.Sample();
                foreach(Transform node in host.GetComponentsInChildren<Transform>(true)) node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
                camera.transform.localPosition=new Vector3(1.3f,1.4f,3.0f);
                camera.orthographicSize=1.15f;
                camera.fieldOfView=40f;
                camera.transform.LookAt(character.transform.position+Vector3.up*.95f);
                await Capture(camera,"gear-"+bodyKey+"-"+outfit+"-desktop",1440,900);
                await Capture(camera,"gear-"+bodyKey+"-"+outfit+"-mobile",960,540);
                camera.transform.localPosition=new Vector3(-1.3f,1.4f,-3f);
                camera.transform.LookAt(character.transform.position+Vector3.up*.95f);
                await Capture(camera,"gear-"+bodyKey+"-"+outfit+"-back",1440,900);
                await Task.Yield();
            }
            await character.EquipItems(Origin,new JObject());
            Check(character.AnyHairVisible,"Removing helmet did not restore hair");
            Check(!character.HasLoadedEquipment("helmet",helmets[1]),"Removed gear remained visible");
            return new JObject { ["body"]=bodyKey, ["helmetModels"]=helmets.Length, ["bootModels"]=boots.Length,
                ["armorCombinations"]=armor.Length, ["animationPoses"]=poseSamples, ["footCoverageRays"]=coverageSamples,
                ["maxHelmetBoneSlipMetres"]=maxHeadSlip };
        }

        private static async Task TestLocalReview()
        {
            Status="testing account-free browser review";
            var host=new GameObject("LocalReviewProbe");
            var review=host.AddComponent<RoaLocalModelReview>();
            Field(review,"_origin").SetValue(review,Origin);
            try
            {
                await Until(()=>Field(review,"_status").GetValue(review).ToString().StartsWith("Готово"),"local model review",60000);
                var character=host.GetComponentInChildren<RoaCharacterView>(true);
                Check(character.HasLoadedEquipment("armor","energySuit") && character.HasLoadedEquipment("boots","assaultBoots"),"Review did not use production equipment loader");
                var renderers=new List<SkinnedMeshRenderer>();character.CollectEquipmentRenderers(renderers);
                Check(renderers.Where(r=>r.name.Contains(RoaSuitModelCatalog.FootwearLayer)).All(r=>!r.gameObject.activeSelf),"Review showed double footwear");
                Field(review,"_itemMode").SetValue(review,true);
                await (Task)typeof(RoaLocalModelReview).GetMethod("Apply",Private).Invoke(review,null);
                Check(host.GetComponentsInChildren<Transform>().Any(t=>t.name=="item_medkit"),"Review ground-mode item not rendered");
                Check(!character.gameObject.activeSelf,"Review item mode left the character visible");
                Field(review,"_itemMode").SetValue(review,false);
                await (Task)typeof(RoaLocalModelReview).GetMethod("Apply",Private).Invoke(review,null);
                Check(character.gameObject.activeSelf,"Review could not restore character mode");
                Field(review,"_offhand").SetValue(review,2);
                await (Task)typeof(RoaLocalModelReview).GetMethod("Apply",Private).Invoke(review,null);
                Check(character.OffhandWeaponReady && character.OffhandWeaponId=="revolver","Review offhand control did not load the new model");
                Check(RoaUiFont.Default!=null && RoaUiFont.Default.HasCharacter('Я') && RoaUiFont.Default.HasCharacter('ё'),
                    "Local review font lacks Cyrillic glyphs");
            }
            finally { Object.Destroy(host); }
        }

        private static async Task<JObject> TestOffhandModels(RoaCharacterView character,GameObject host,Camera camera,string bodyKey)
        {
            var catalog=(JArray)JObject.Parse(File.ReadAllText("../data/kromka/items.json"))["items"];
            string[] ids=catalog.Where(i=>i["id"].ToString()!="fists" && i["compatibleSlots"] is JArray slots
                && slots.Any(s=>s.ToString()=="offhand")).Select(i=>i["id"].ToString()).ToArray();
            Check(ids.Length==6 && ids.All(RoaOffhandWeaponView.CanRender),"Incomplete authoritative offhand model coverage");
            var bones=(Dictionary<string,Transform>)Field(character,"_bones").GetValue(character);
            var gate=character.gameObject.AddComponent<RoaVisibilityGate>();
            Animation animation=character.GetComponentInChildren<Animation>(true);
            await character.EquipWeapon(Origin,"pistol");
            int samples=0;
            float maxGripError=0;
            foreach(string id in ids)
            {
                Status="offhand "+bodyKey+" / "+id;
                gate.SetVisible(false);
                await character.EquipItems(Origin,new JObject { ["offhand"]=id });
                Check(character.OffhandWeaponReady && character.OffhandWeaponId==id,"Missing offhand model: "+id);
                var offhand=(RoaOffhandWeaponView)Field(character,"_offhandWeapon").GetValue(character);
                var primary=(RoaWeaponView)Field(character,"_weapon").GetValue(character);
                var model=(Transform)Field(offhand,"_weapon").GetValue(offhand);
                var grip=(Transform)Field(offhand,"_socketGrip").GetValue(offhand);
                Check(model.GetComponentsInChildren<Renderer>(true).All(r=>!r.enabled),"Offhand flashed through hidden-owner gate: "+id);
                Check(primary.DualWield==RoaOffhandWeaponView.IsSupported(id),"Non-firearm selected dual-gun IK: "+id);
                Check(offhand.TryGetMuzzle(out _)==RoaOffhandWeaponView.IsSupported(id),"Incorrect offhand muzzle semantics: "+id);
                gate.SetVisible(true);
                foreach(AnimationState clip in animation)
                {
                    animation.Play(clip.name);
                    foreach(float fraction in new[]{0f,.45f,.9f})
                    {
                        clip.time=clip.length*fraction; animation.Sample();
                        primary.Apply(character.transform.position+Vector3.forward*5,false);
                        Quaternion rightFinger=bones["index_01_r"].localRotation;
                        offhand.Apply(character.transform.position+Vector3.forward*5,false);
                        if(id=="knife")Check(Quaternion.Angle(rightFinger,bones["index_01_r"].localRotation)<.001f,"Left knife changed right fingers");
                        Matrix4x4 target=bones["hand_l"].localToWorldMatrix*RoaOffhandWeaponView.MirrorRigid(RoaWeaponGrip.HandToMount)
                            *Matrix4x4.Translate(new Vector3(-.03f,-.02f,.025f));
                        Vector3 expected=id=="medkit"?bones["hand_l"].TransformPoint(RoaItemModelCatalog.MedicalPalmOffset):(Vector3)target.GetColumn(3);
                        float error=Vector3.Distance(grip.position,expected);
                        maxGripError=Mathf.Max(maxGripError,error);
                        Check(error<.002f,"Offhand detached from palm: "+id+" / "+clip.name+" / "+error);
                        Bounds box=BoundsOf(model);
                        Check(box.size.magnitude<1.6f && Vector3.Distance(box.center,grip.position)<.65f,"Offhand parts detached: "+id);
                        offhand.ApplyReduced();
                        Check(Vector3.Distance(grip.position,expected)<.002f,"Offhand LOD lost palm mount: "+id);
                        samples++;
                    }
                }
                animation.Play("idle");animation["idle"].time=.3f;animation.Sample();
                primary.Apply(character.transform.position+Vector3.forward*5,false);
                offhand.Apply(character.transform.position+Vector3.forward*5,false);
                foreach(var node in host.GetComponentsInChildren<Transform>(true))node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
                camera.transform.localPosition=new Vector3(-1.4f,1.35f,2.5f);
                camera.transform.LookAt(character.transform.position+Vector3.up*1.1f);camera.fieldOfView=35;
                await Capture(camera,"offhand-"+bodyKey+"-"+id+"-desktop",1440,900);
                await Capture(camera,"offhand-"+bodyKey+"-"+id+"-mobile",960,540);
                // Independent of the synchronous pose sweep: allow normal Animation/LateUpdate
                // and skinning frames to run. Do not call Apply or Sample before this capture.
                await Task.Delay(250);
                Check(Vector3.Distance(grip.position,bones["hand_l"].position)<.16f,"Live offhand lost its wrist: "+id);
                await Capture(camera,"offhand-"+bodyKey+"-"+id+"-live",1440,900,false);
            }
            Task old=character.EquipItems(Origin,new JObject { ["offhand"]="revolver" });
            Task latest=character.EquipItems(Origin,new JObject { ["offhand"]="knife" });
            await Task.WhenAll(old,latest);
            Check(character.OffhandWeaponReady && character.OffhandWeaponId=="knife","Late offhand model replaced the current one");
            Task loading=character.EquipItems(Origin,new JObject { ["offhand"]="sawedOffShotgun" });
            Task removal=character.EquipItems(Origin,new JObject());
            await Task.WhenAll(loading,removal);
            Check(!character.OffhandWeaponReady,"Offhand survived removal during loading");
            Object.Destroy(gate);await Until(()=>gate==null,"offhand gate cleanup",5000);
            return new JObject { ["body"]=bodyKey,["items"]=new JArray(ids),["animationPoses"]=samples,
                ["maxPalmErrorMetres"]=maxGripError,["liveFrameCaptures"]=ids.Length,["visibilityAndRemovalRaces"]=true };
        }

        private static async Task<JObject> RunSuitCandidateAsync()
        {
            string clientSourceHash=RoaWebGlBuild.ClientSourceFingerprint();
            Status="verifying immutable candidate asset host";
            JObject served;
            using(var request=UnityWebRequest.Get(Origin+"/__roa_probe_catalogs"))
            {
                var operation=request.SendWebRequest();
                await Until(()=>operation.isDone,"candidate host manifest",30000);
                Check(request.result==UnityWebRequest.Result.Success,"Candidate host unavailable: "+request.error);
                served=JObject.Parse(request.downloadHandler.text);
            }
            Check((string)served["mode"]=="suit-candidate","The probe host is not serving isolated candidates");
            var manifest=(JObject)served["suitCandidate"];
            var local=JObject.Parse(File.ReadAllText("Logs/UpperSuitCandidate/manifest.json"));
            Check((string)manifest["version"]==(string)local["version"],"Candidate host snapshot is stale");
            var files=(JArray)manifest["files"];
            Check(files.Count==12,"Expected twelve suit candidates");
            foreach(JObject row in files)
            {
                string url=Origin+row["file"].ToString().Replace("/models/","/models-lite/");
                using(var request=UnityWebRequest.Get(url))
                {
                    var operation=request.SendWebRequest();
                    await Until(()=>operation.isDone,"candidate bytes "+row["itemId"]+"/"+row["bodyId"],30000);
                    Check(request.result==UnityWebRequest.Result.Success,"Candidate model download failed");
                    using(var sha=SHA256.Create())
                    {
                        string actual=BitConverter.ToString(sha.ComputeHash(request.downloadHandler.data)).Replace("-","").ToLowerInvariant();
                        Check(actual==(string)row["sha256"],"Served candidate bytes do not match the manifest");
                    }
                    Check(request.GetResponseHeader("X-ROA-Suit-Catalog")==manifest["version"].ToString(),"Wrong candidate response version");
                }
            }
            var results=new JArray();
            var sun=new GameObject("CandidateSuitSun").AddComponent<Light>();
            sun.type=LightType.Directional;sun.intensity=2.2f;
            sun.transform.rotation=Quaternion.Euler(45,-20,0);
            foreach(string sex in new[]{"male","female"}) foreach(string body in new[]{"slim","medium","large"})
            {
                var host=new GameObject("CandidateSuit:"+sex+"_"+body);
                try
                {
                    var preview=host.AddComponent<RoaCharacterPreview>();
                    preview.Show(Origin,new CharacterAppearance { Sex=sex,BodyType=body,FaceId=sex+"_04",
                        HairId="short_crop",HairColorId="hair_08" },640,640);
                    host.transform.Find("CharacterPreviewScene").position=Vector3.zero;
                    await Until(()=>preview.IsReady,"candidate body "+sex+"_"+body,60000);
                    var character=host.GetComponentInChildren<RoaCharacterView>(true);
                    await character.EquipWeapon(Origin,"pistol");
                    Check(character.WeaponReady,"Candidate motion review requires a loaded pistol");
                    results.Add(await TestSuitLayers(character,host,host.GetComponentInChildren<Camera>(true),
                        sex+"_"+body,new[]{"boots","scoutBoots","reinforcedBoots","assaultBoots"}));
                }
                finally { Object.Destroy(host); }
                await Task.Yield();
            }
            Object.Destroy(sun.gameObject);
            string clientSourceHashAtFinish=RoaWebGlBuild.ClientSourceFingerprint();
            Check(clientSourceHash==clientSourceHashAtFinish,"Client source changed during the candidate probe");
            return new JObject { ["assetMode"]="isolated-suit-candidate",["assetOrigin"]=Origin,
                ["clientSourceHash"]=clientSourceHash,["clientSourceHashAtFinish"]=clientSourceHashAtFinish,
                ["compiledSuitCatalogVersion"]=RoaSuitModelCatalog.CatalogVersion,
                ["servedSuitCatalogVersion"]=manifest["version"],["servedSuitFiles"]=files.DeepClone(),
                ["suitBodies"]=results,["runtimeOrBrowserApproval"]=false };
        }

        private static async Task<JObject> TestSuitLayers(RoaCharacterView character,GameObject host,Camera camera,string bodyKey,string[] bootIds)
        {
            int poses=0;
            int animatedCaptures=0;
            int upperCaptures=0,liveReloadCaptures=0;
            var upperClips=new HashSet<string>();
            Animation animation=character.GetComponentInChildren<Animation>(true);
            var bones=(Dictionary<string,Transform>)Field(character,"_bones").GetValue(character);
            var gate=character.gameObject.GetComponent<RoaVisibilityGate>();
            bool ownGate=gate==null;
            if(ownGate) gate=character.gameObject.AddComponent<RoaVisibilityGate>();
            foreach(string suit in new[]{"hazmatSuit","energySuit"})
            {
                foreach(string boot in new[]{""}.Concat(bootIds))
                {
                    Status="suit footwear "+bodyKey+" / "+suit+" / "+boot;
                    await character.EquipItems(Origin,new JObject { ["armor"]=suit,["boots"]=boot });
                    Check(character.HasLoadedEquipment("armor",suit),"Suit failed to load before hair coverage check");
                    Check(character.AnyHairVisible==(suit!="hazmatSuit"),"Loaded hood/hair visibility mismatch");
                    var appearance=((JObject)Field(character,"_appearance").GetValue(character)).ToObject<CharacterAppearance>();
                    Check(character.ApplyAppearance(appearance),"Same-body appearance update failed");
                    Check(character.AnyHairVisible==(suit!="hazmatSuit"),"Appearance update restored hair through the hood");
                    var gear=new List<SkinnedMeshRenderer>(); character.CollectEquipmentRenderers(gear);
                    foreach(var renderer in gear) foreach(Transform bone in renderer.bones)
                        Check(bone!=null && bone.IsChildOf(character.transform),"Suit retains a detached donor skeleton");
                    var integrated=gear.Where(r=>r.name.Contains(RoaSuitModelCatalog.FootwearLayer)).ToArray();
                    Check(integrated.Length>0,"Suit has no switchable footwear layer");
                    bool separate=boot.Length>0;
                    foreach(var node in host.GetComponentsInChildren<Transform>(true)) node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
                    Check(!separate || character.HasLoadedEquipment("boots",boot),"Separate boots failed to load");
                    gate.SetVisible(false); gate.SetVisible(true);
                    Check(character.AnyHairVisible==(suit!="hazmatSuit"),"Fog update changed hood/hair visibility");
                    foreach(var renderer in integrated) Check(renderer.gameObject.activeSelf==!separate,"Double or missing footwear after fog update");
                    foreach(AnimationState clip in animation)
                    {
                        animation.Play(clip.name);
                        foreach(float fraction in new[]{0f,.45f,.9f})
                        {
                            clip.time=clip.length*fraction; animation.Sample();
                            foreach(var renderer in integrated) Check(renderer.gameObject.activeSelf==!separate,"Animation restored hidden suit shoes");
                            Check(character.GetComponentsInChildren<SkinnedMeshRenderer>(true).Any(r=>r.name.Contains("body_base") && r.gameObject.activeInHierarchy),"Base body was removed to conceal overlap");
                            if((boot.Length==0 || boot=="assaultBoots") && fraction==.45f
                                && (clip.name=="walk" || clip.name.StartsWith("death")))
                            {
                                Vector3 feet=(bones["foot_l"].position+bones["foot_r"].position)*.5f;
                                camera.transform.position=feet+new Vector3(-.95f,.45f,-1.45f);
                                camera.transform.LookAt(feet+Vector3.up*.2f); camera.fieldOfView=35;
                                string key="suit-motion-"+bodyKey+"-"+suit+"-"+(boot.Length==0?"integrated":boot)+"-"+clip.name;
                                await Capture(camera,key+"-desktop",1440,900);
                                await Capture(camera,key+"-mobile",960,540);
                                animatedCaptures+=2;
                            }
                            if((boot.Length==0 || boot=="assaultBoots") && fraction==.45f
                                && (clip.name=="walk" || clip.name=="attack" || clip.name.StartsWith("death")))
                            {
                                // Follow the actual posed body, including a lying death pose;
                                // the earlier fixed low camera certified only feet and calves.
                                Vector3 center=(bones["head"].position+bones["pelvis"].position)*.5f;
                                camera.transform.position=center+new Vector3(-1.5f,.7f,-2.5f);
                                camera.transform.LookAt(center);camera.fieldOfView=38;
                                string key="suit-upper-"+bodyKey+"-"+suit+"-"+(boot.Length==0?"integrated":boot)+"-"+clip.name;
                                await Capture(camera,key+"-desktop",1440,900);
                                await Capture(camera,key+"-mobile",960,540);
                                upperCaptures+=2;upperClips.Add(clip.name);
                            }
                            poses++;
                        }
                    }
                    animation.Play("idle"); animation["idle"].time=.3f; animation.Sample();
                    foreach(var node in host.GetComponentsInChildren<Transform>(true)) node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
                    camera.transform.localPosition=new Vector3(-.85f,.50f,-1.25f);
                    camera.transform.LookAt(character.transform.position+Vector3.up*.23f);
                    camera.fieldOfView=35;
                    string suffix=boot.Length==0 ? "integrated" : boot;
                    await Capture(camera,"suit-feet-"+bodyKey+"-"+suit+"-"+suffix+"-desktop",1440,900);
                    await Capture(camera,"suit-feet-"+bodyKey+"-"+suit+"-"+suffix+"-mobile",960,540);
                    if(boot.Length==0 || boot=="assaultBoots")
                    {
                        Vector3 center=(bones["head"].position+bones["pelvis"].position)*.5f;
                        camera.transform.position=center+new Vector3(-1.5f,.7f,-2.5f);
                        camera.transform.LookAt(center);camera.fieldOfView=38;
                        var weapon=(RoaWeaponView)Field(character,"_weapon").GetValue(character);
                        character.StartReload(4f);
                        try
                        {
                            await Task.Delay(500);
                            Check(weapon.Reloading,"Live reload pose did not start");
                            string key="suit-upper-"+bodyKey+"-"+suit+"-"+suffix+"-reload-live";
                            await Capture(camera,key+"-desktop",1440,900,false);
                            await Capture(camera,key+"-mobile",960,540,false);
                            liveReloadCaptures+=2;
                        }
                        finally { character.CancelReload(); }
                    }
                    await Task.Yield();
                }
                // The base shoes return when replacement loading is cancelled.
                Task old=character.EquipItems(Origin,new JObject { ["armor"]=suit,["boots"]=bootIds[0] });
                Task latest=character.EquipItems(Origin,new JObject { ["armor"]=suit });
                await Task.WhenAll(old,latest);
                var finalGear=new List<SkinnedMeshRenderer>(); character.CollectEquipmentRenderers(finalGear);
                Check(finalGear.Where(r=>r.name.Contains(RoaSuitModelCatalog.FootwearLayer)).All(r=>r.gameObject.activeSelf),"Suit footwear did not return after removal race");
            }
            await character.EquipItems(Origin,new JObject());
            Check(character.AnyHairVisible,"Removing the suit hood did not restore hair");
            if(ownGate)
            {
                Object.Destroy(gate);
                await Until(()=>gate==null,"suit visibility gate cleanup",5000);
            }
            Check(animatedCaptures>=8,"Missing walking/death suit captures");
            Check(upperClips.Contains("walk") && upperClips.Contains("attack") && upperClips.Any(c=>c.StartsWith("death")),
                "Missing upper-body walking/attack/death evidence");
            Check(liveReloadCaptures==8,"Missing live reload suit captures");
            return new JObject { ["body"]=bodyKey,["suits"]=2,["bootConfigurations"]=5,["animationPoses"]=poses,
                ["animatedCaptures"]=animatedCaptures,["upperMotionCaptures"]=upperCaptures,
                ["upperMotionClips"]=new JArray(upperClips.OrderBy(c=>c)),["liveReloadCaptures"]=liveReloadCaptures,
                ["restorationAndFog"]=true,["loadedHoodHairLifecycle"]=true };
        }

        private static async Task<JObject> TestUtilities(RoaCharacterView character,GameObject host,Camera camera,string bodyKey)
        {
            var bones=(Dictionary<string,Transform>)Field(character,"_bones").GetValue(character);
            Transform pelvis=bones["pelvis"];
            Animation animation=character.GetComponentInChildren<Animation>(true);
            string[] armors={ "none","leather","metalArmor","ballisticVest","combatArmor","heavyArmor","hazmatSuit","energySuit" };
            int samples=0;
            float maxSlip=0;
            var gate=character.gameObject.GetComponent<RoaVisibilityGate>();
            bool ownGate=gate==null;
            if(ownGate) gate=character.gameObject.AddComponent<RoaVisibilityGate>();
            JObject Outfit(string armor,int variant) => new JObject {
                ["armor"]=armor=="none" ? "" : armor, ["helmet"]="tacticalHelmet", ["boots"]="scoutBoots", ["backpack"]="backpack",
                ["detector"]="artifactDetectorMk"+(variant+1), ["artifactBelt"]="artifactBelt"+(variant+2) };
            foreach(string armor in armors) for(int variant=0;variant<3;variant++)
            {
                Status="utilities "+bodyKey+" / "+armor+" / "+variant;
                JObject outfit=Outfit(armor,variant);
                gate.SetVisible(false);
                await character.EquipItems(Origin,outfit);
                Check(character.HasLoadedEquipment("detector",outfit["detector"].ToString())
                    && character.HasLoadedEquipment("artifactBelt",outfit["artifactBelt"].ToString()),"Missing worn utility "+bodyKey);
                var all=new List<SkinnedMeshRenderer>(); character.CollectEquipmentRenderers(all);
                var renderers=all.Where(r=>r.name.StartsWith("utility_")).ToArray();
                Check(renderers.Length>=2,"Utility donor geometry missing");
                foreach(var renderer in renderers)
                {
                    Check(!renderer.enabled,"Utility leaked through hidden-owner gate");
                    Check(renderer.name.Contains("_"+bodyKey+"_"+armor+"_"),"Stale utility body/armor fit "+renderer.name);
                    foreach(var bone in renderer.bones) Check(bone!=null && bones.TryGetValue(bone.name,out Transform actual) && actual==bone,"Disconnected utility skeleton");
                }
                gate.SetVisible(true);
                var offsets=new Dictionary<string,Vector3>();
                foreach(AnimationState clip in animation)
                {
                    animation.Play(clip.name);
                    foreach(float fraction in new[]{0f,.45f,.9f})
                    {
                        clip.time=clip.length*fraction; animation.Sample();
                        foreach(var renderer in renderers)
                        {
                            var mesh=new Mesh(); renderer.BakeMesh(mesh,true);
                            Vector3 centroid=Vector3.zero;
                            foreach(var vertex in mesh.vertices) centroid+=renderer.transform.TransformPoint(vertex);
                            centroid/=mesh.vertexCount;
                            Check(Vector3.Distance(centroid,pelvis.position)<.65f,"Utility detached from waist "+renderer.name);
                            if(offsets.TryGetValue(renderer.name,out Vector3 offset))
                                maxSlip=Mathf.Max(maxSlip,Vector3.Distance(centroid,pelvis.TransformPoint(offset)));
                            else offsets[renderer.name]=pelvis.InverseTransformPoint(centroid);
                            Object.Destroy(mesh);
                        }
                        Check(maxSlip<.004f,"Utility parts move separately from pelvis "+bodyKey+" "+clip.name+": "+maxSlip);
                        samples++;
                    }
                }
                animation.Play("idle"); animation["idle"].time=.3f; animation.Sample();
                foreach(Transform node in host.GetComponentsInChildren<Transform>(true)) node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
                camera.fieldOfView=40f;
                camera.transform.localPosition=new Vector3(1.6f,1.35f,2.8f);
                camera.transform.LookAt(character.transform.position+Vector3.up*.95f);
                await Capture(camera,"utility-"+bodyKey+"-"+armor+"-"+variant+"-desktop",1440,900);
                await Capture(camera,"utility-"+bodyKey+"-"+armor+"-"+variant+"-mobile",960,540);
                await Task.Yield();
            }
            // Equipment and armor can change while previous GLBs are awaiting import.
            Task old=character.EquipItems(Origin,Outfit("heavyArmor",0));
            Task latest=character.EquipItems(Origin,Outfit("leather",2));
            await Task.WhenAll(old,latest);
            Check(character.HasLoadedEquipment("detector","artifactDetectorMk3") && character.HasLoadedEquipment("artifactBelt","artifactBelt4"),"Late utility import replaced current item");
            var current=new List<SkinnedMeshRenderer>(); character.CollectEquipmentRenderers(current);
            Check(current.Where(r=>r.name.StartsWith("utility_")).All(r=>r.name.Contains("_leather_")),"Late utility import restored wrong armor fit");
            Task loading=character.EquipItems(Origin,Outfit("energySuit",1));
            Task removing=character.EquipItems(Origin,new JObject());
            await Task.WhenAll(loading,removing);
            Check(character.LoadedEquipmentSlotCount==0,"Utility survived removal during load");
            gate.SetVisible(true);
            if(ownGate)
            {
                Object.Destroy(gate);
                // Destroy is deferred until the end of the frame. The next
                // test must not adopt a component already pending destruction.
                await Until(()=>gate==null,"utility visibility gate cleanup",5000);
            }
            return new JObject { ["body"]=bodyKey,["utilityModels"]=6,["armorFits"]=armors.Length,
                ["animationPoses"]=samples,["maxPelvisSlipMetres"]=maxSlip,
                ["hiddenOwner"]=true,["changeDuringLoad"]=true,["removeDuringLoad"]=true };
        }

        private static int CheckAnimatedFootCoverage(RoaCharacterView character,List<SkinnedMeshRenderer> gear,string bootId,string clip)
        {
            var body=character.GetComponentsInChildren<SkinnedMeshRenderer>(true).First(r=>r.name.Contains("body_base"));
            var bodyMesh=new Mesh(); body.BakeMesh(bodyMesh,true);
            var vertices=bodyMesh.vertices; var triangles=bodyMesh.triangles; var weights=body.sharedMesh.boneWeights;
            var colliders=new Dictionary<string,MeshCollider>(); var meshes=new List<Mesh>();
            bool oldBackfaces=Physics.queriesHitBackfaces;
            int count=0;
            try
            {
                Physics.queriesHitBackfaces=true;
                foreach(var renderer in gear.Where(r=>r.name.StartsWith("free_"+bootId+"_")))
                {
                    var baked=new Mesh(); renderer.BakeMesh(baked,true); meshes.Add(baked);
                    var obj=new GameObject("ProbeBootSurface");
                    obj.transform.SetPositionAndRotation(renderer.transform.position,renderer.transform.rotation);
                    obj.transform.localScale=renderer.transform.lossyScale;
                    var collider=obj.AddComponent<MeshCollider>(); collider.sharedMesh=baked;
                    colliders[renderer.name.EndsWith("_0")?"foot_r":"foot_l"]=collider;
                }
                Physics.SyncTransforms();
                // Sample triangles strongly weighted to either foot. Selection
                // uses bind weights, so walking/jumping height cannot skip a foot.
                for(int i=0;i<triangles.Length;i+=15)
                {
                    int a=triangles[i],b=triangles[i+1],c=triangles[i+2];
                    if(FootWeight(weights[a],body.bones)<.85f || FootWeight(weights[b],body.bones)<.85f || FootWeight(weights[c],body.bones)<.85f) continue;
                    Vector3 p=body.transform.TransformPoint(vertices[a]),q=body.transform.TransformPoint(vertices[b]),r=body.transform.TransformPoint(vertices[c]);
                    Vector3 normal=Vector3.Cross(q-p,r-p).normalized;
                    if(normal.sqrMagnitude<.9f) continue;
                    var ray=new Ray((p+q+r)/3f+normal*.001f,normal);
                    string foot=FootSide(weights[a],body.bones);
                    bool surfaceHit=colliders[foot].Raycast(ray,out RaycastHit hit,.5f);
                    // Boots are intentionally open at the cuff. An outward skin
                    // normal can rotate toward that opening when the ankle bends.
                    // Close only that opening mathematically for containment;
                    // otherwise a ray exiting the empty cuff is a false clipping report.
                    bool cuffExit=!surfaceHit && ExitsBootCuff(colliders[foot],ray,
                        body.bones.First(bone=>bone.name==foot),body.bones.First(bone=>bone.name==foot.Replace("foot_","calf_")));
                    if(cuffExit) _cuffExitSamples++;
                    Check(surfaceHit || cuffExit,"Foot clips through "+bootId+" during "+clip
                        +" triangle="+(i/3)+" point="+character.transform.InverseTransformPoint(ray.origin).ToString("F4")
                        +" weights="+FootWeight(weights[a],body.bones)+","+FootWeight(weights[b],body.bones)+","+FootWeight(weights[c],body.bones));
                    count++;
                }
                Check(count>20,"No meaningful animated foot surface samples");
                return count;
            }
            finally
            {
                Physics.queriesHitBackfaces=oldBackfaces;
                foreach(var collider in colliders.Values) Object.DestroyImmediate(collider.gameObject);
                foreach(var mesh in meshes) Object.Destroy(mesh);
                Object.Destroy(bodyMesh);
            }
        }

        private static float FootWeight(BoneWeight w,Transform[] bones)
        {
            float sum=0;
            if(bones[w.boneIndex0].name.StartsWith("foot_")) sum+=w.weight0;
            if(bones[w.boneIndex1].name.StartsWith("foot_")) sum+=w.weight1;
            if(bones[w.boneIndex2].name.StartsWith("foot_")) sum+=w.weight2;
            if(bones[w.boneIndex3].name.StartsWith("foot_")) sum+=w.weight3;
            return sum;
        }

        private static string FootSide(BoneWeight w,Transform[] bones)
        {
            int[] indices={w.boneIndex0,w.boneIndex1,w.boneIndex2,w.boneIndex3};
            foreach(int index in indices) if(bones[index].name.StartsWith("foot_")) return bones[index].name;
            throw new InvalidOperationException("Foot sample has no foot bone");
        }

        private static bool ExitsBootCuff(MeshCollider boot,Ray ray,Transform foot,Transform calf)
        {
            Vector3 axis=(calf.position-foot.position).normalized;
            float upward=Vector3.Dot(ray.direction,axis);
            if(upward<=.001f) return false;
            Vector3 right=Vector3.Cross(axis,Vector3.forward).normalized;
            if(right.sqrMagnitude<.5f) right=Vector3.Cross(axis,Vector3.right).normalized;
            Vector3 forward=Vector3.Cross(right,axis).normalized;
            Vector3[] points=boot.sharedMesh.vertices.Select(p=>boot.transform.TransformPoint(p)).ToArray();
            float height=points.Max(p=>Vector3.Dot(p-foot.position,axis));
            float originHeight=Vector3.Dot(ray.origin-foot.position,axis);
            if(originHeight>=height-.02f) return false; // Do not pardon exposed skin above the cuff.
            float distance=(height-originHeight)/upward;
            if(distance<=0 || distance>.5f) return false;
            Vector3 capHit=ray.GetPoint(distance)-foot.position;
            var ring=points.Where(p=>Vector3.Dot(p-foot.position,axis)>height-.018f)
                .Select(p=>new Vector2(Vector3.Dot(p-foot.position,right),Vector3.Dot(p-foot.position,forward)))
                .Distinct().OrderBy(p=>p.x).ThenBy(p=>p.y).ToArray();
            if(ring.Length<3) return false;
            var hull=new List<Vector2>();
            foreach(var p in ring)
            {
                while(hull.Count>=2 && Cross2(hull[hull.Count-1]-hull[hull.Count-2],p-hull[hull.Count-1])<=0) hull.RemoveAt(hull.Count-1);
                hull.Add(p);
            }
            int lower=hull.Count;
            for(int i=ring.Length-2;i>=0;i--)
            {
                var p=ring[i];
                while(hull.Count>lower && Cross2(hull[hull.Count-1]-hull[hull.Count-2],p-hull[hull.Count-1])<=0) hull.RemoveAt(hull.Count-1);
                hull.Add(p);
            }
            var point=new Vector2(Vector3.Dot(capHit,right),Vector3.Dot(capHit,forward));
            for(int i=0;i<hull.Count-1;i++)
                if(Cross2(hull[i+1]-hull[i],point-hull[i])<-.000001f) return false;
            return true;
        }

        private static float Cross2(Vector2 a,Vector2 b) => a.x*b.y-a.y*b.x;

        private static JObject Drop(string id, string itemId, int index) => new JObject
        { ["id"] = id, ["itemId"] = itemId, ["qty"] = 1, ["x"] = index % 5, ["z"] = -(index / 5) * .85f };
        private static JObject Artifact(string id, string type, int index) => new JObject
        { ["id"] = id, ["typeId"] = type, ["signal"] = 1, ["revealed"] = true, ["x"] = index % 5, ["z"] = -(index / 5) * .85f };
        private static JObject ArtifactState(JArray artifacts) => new JObject
        { ["roomId"] = "local-probe", ["detector"] = new JObject(), ["artifacts"] = artifacts };
        private static List<GameObject> ArtifactModels(object detector)
        {
            var result = new List<GameObject>();
            var views = (IDictionary)Field(detector, "_views").GetValue(detector);
            foreach (object view in views.Values)
            {
                var model = (GameObject)view.GetType().GetField("Model").GetValue(view);
                if (model != null) result.Add(model);
            }
            return result;
        }
        private static FieldInfo Field(object obj, string name) => obj.GetType().GetField(name, Private);
        private static object Invoke(object obj, string name, params object[] args) => obj.GetType().GetMethod(name, Private).Invoke(obj,args);
        private static Bounds BoundsOf(Transform root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            Check(renderers.Length > 0, "No renderers on " + root.name);
            Bounds box = renderers[0].bounds;
            foreach (Renderer renderer in renderers.Skip(1)) box.Encapsulate(renderer.bounds);
            return box;
        }
        private static void Check(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
        private static async Task Until(Func<bool> condition, string label, int milliseconds)
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            while (!condition())
            {
                if (watch.ElapsedMilliseconds > milliseconds) throw new TimeoutException(label);
                await Task.Delay(30);
            }
        }
        private static async Task Capture(Camera camera, string name, int width, int height, bool sampledPose=true)
        {
            var root=camera.transform.root;
            // Ignore inactive importer staging rigs awaiting deferred Destroy.
            var skins=root.GetComponentsInChildren<SkinnedMeshRenderer>(true)
                .Where(r=>r.enabled && r.gameObject.activeInHierarchy).ToArray();
            var previousRecalculation=skins.Select(r=>r.forceMatrixRecalculationPerRender).ToArray();
            var previousOffscreen=skins.Select(r=>r.updateWhenOffscreen).ToArray();
            var writers=root.GetComponentsInChildren<Behaviour>(true).Where(b=>
                b is Animation || b is RoaCharacterView || b is RoaCharacterPreview).ToArray();
            var previousEnabled=writers.Select(b=>b.enabled).ToArray();
            var bones=skins.SelectMany(r=>r.bones).Where(b=>b!=null).Distinct().ToArray();
            var positions=bones.Select(b=>b.localPosition).ToArray();
            var rotations=bones.Select(b=>b.localRotation).ToArray();
            try
            {
                if(sampledPose && skins.Length>0)
                {
                    // A manual render in the same frame can reuse the previous skin palette.
                    // Freeze the sampled pose, let native skinning advance, and verify that
                    // no animation/IK writer moved the bones while waiting. Live captures
                    // deliberately skip all of this and use the normal production frame.
                    foreach(var writer in writers) writer.enabled=false;
                    foreach(var skin in skins)
                    { skin.updateWhenOffscreen=true; skin.forceMatrixRecalculationPerRender=true; }
                    int frame=Time.frameCount;
                    await Until(()=>Time.frameCount>=frame+2,"native skinning frame for "+name,5000);
                    for(int i=0;i<bones.Length;i++)
                        Check(Vector3.Distance(positions[i],bones[i].localPosition)<.00001f
                            && Quaternion.Angle(rotations[i],bones[i].localRotation)<.05f,
                            "Sampled capture pose changed: "+name+" / "+bones[i].name);
                }
                if(_suitCandidateRun && (name=="suit-upper-male_large-energySuit-integrated-reload-live-desktop"
                    || name=="suit-upper-male_large-energySuit-integrated-walk-desktop"
                    || name=="suit-upper-male_medium-hazmatSuit-integrated-walk-desktop"))
                    RoaSuitDeformationSnapshot.Write(Output,name,_runId,skins,camera);
                RenderTexture previous=camera.targetTexture, active=RenderTexture.active;
                var target=RenderTexture.GetTemporary(width,height,24);
                var pixels=new Texture2D(width,height,TextureFormat.RGBA32,false);
                try
                {
                    camera.targetTexture=target;
                    if(GraphicsSettings.currentRenderPipeline!=null)
                        RenderPipeline.SubmitRenderRequest(camera,new RenderPipeline.StandardRequest { destination=target });
                    else camera.Render();
                    RenderTexture.active=target;
                    pixels.ReadPixels(new Rect(0,0,width,height),0,0);pixels.Apply(false,false);
                    File.WriteAllBytes(Path.Combine(Output,name+".png"),pixels.EncodeToPNG());
                }
                finally
                {
                    camera.targetTexture=previous;RenderTexture.active=active;
                    Object.Destroy(pixels);RenderTexture.ReleaseTemporary(target);
                }
            }
            finally
            {
                for(int i=0;i<skins.Length;i++) if(skins[i]!=null)
                { skins[i].forceMatrixRecalculationPerRender=previousRecalculation[i];skins[i].updateWhenOffscreen=previousOffscreen[i]; }
                for(int i=0;i<writers.Length;i++) if(writers[i]!=null) writers[i].enabled=previousEnabled[i];
            }
        }
    }
}
