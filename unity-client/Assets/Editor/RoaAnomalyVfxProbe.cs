#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static partial class RoaAnomalyVfxProbe
    {
        private const string Key = "roa.anomaly-vfx.probe";
        private static int _stage;
        private static double _next, _deadline;
        private static RoaAnomalyFieldRenderer _renderer;
        private static Camera _camera;
        private static bool _mobile;
        private static readonly Text[] _labels = new Text[8];
        private static Transform _locationTarget;
        private static readonly string[] Types = { "pull", "seam", "carousel", "glass", "dew", "sink", "chime", "mute" };
        private static readonly string[] Names = { "ТЯГА", "ШОВ", "КАРУСЕЛЬ", "СТЕКЛО", "РОСА", "ПРОВАЛ", "ЗВОН", "МОЛЧУН" };
        static RoaAnomalyVfxProbe() { if (SessionState.GetBool(Key, false)) EditorApplication.update += Tick; }
        public static void RunBaseline() { Start("before"); }
        public static void RunVisualBatch() { Start("after"); }
        public static void RunLocationBatch() { Start("location"); }
        public static void RunHeroBatch() { Start("hero"); }
        public static void RunLayerBatch() { Start("layers"); }
        public static void RunVerificationBatch()
        {
            try {
                Run(); RunPresentationContracts();
                typeof(RoaBoltThrowProbe).GetMethod("Run", System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static).Invoke(null,null);
                Start("after");
            } catch(Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
        }
        private static int _heroIndex;
        private static void Start(string prefix)
        {
            if (prefix == "location") EditorSceneManager.OpenScene("Assets/Scenes/Kromka/Locations/solarArray.unity", OpenSceneMode.Single);
            else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SessionState.SetBool(Key, true); SessionState.SetString(Key + ".prefix", prefix);
            _stage = 0; _deadline = EditorApplication.timeSinceStartup + 110;
            EditorApplication.update -= Tick; EditorApplication.update += Tick;
            EditorApplication.EnterPlaymode();
        }
        public static JObject Snapshot(bool discharged = false)
        {
            var rows = new JArray();
            for (int i = 0; i < Types.Length; i++) rows.Add(new JObject {
                ["id"] = "probe_" + Types[i], ["type"] = Types[i], ["displayName"] = Names[i],
                ["x"] = (i % 4 - 1.5f) * 7, ["z"] = i < 4 ? -4.2f : 4.2f, ["radius"] = 2.65f,
                ["active"] = !discharged, ["dischargedUntil"] = discharged ? 106000 : 0, ["revision"] = discharged ? 1 : 0
            });
            return new JObject { ["roomId"] = "probe", ["locationId"] = "probe", ["serverNow"] = 100000, ["fields"] = rows };
        }
        private static void Tick()
        {
            if (EditorApplication.timeSinceStartup > _deadline) { Finish("Timed out"); return; }
            if (!EditorApplication.isPlaying || EditorApplication.timeSinceStartup < _next) return;
            try
            {
                if (SessionState.GetString(Key + ".prefix", "") == "location") { TickLocation(); return; }
                if (SessionState.GetString(Key + ".prefix", "") == "hero") { TickHero(); return; }
                if (SessionState.GetString(Key + ".prefix", "") == "layers") { TickLayers(); return; }
                if (_stage == 0) { BuildStage(); Resize(false); _stage++; _next = EditorApplication.timeSinceStartup + 3; return; }
                if (_stage == 1) {
                    ValidatePresentationFrame(false); Capture("desktop-active");
                    ValidateRefractionPixels(); _stage++; _next = EditorApplication.timeSinceStartup + 1; return;
                }
                if (_stage == 2) { _renderer.ApplyAnomalyState(Snapshot(true)); _stage++; _next = EditorApplication.timeSinceStartup + 0.18; return; }
                if (_stage == 3) {
                    _renderer.TryGetField("probe_chime",out var before); _renderer.ApplyAnomalyState(Snapshot(true));
                    _renderer.TryGetField("probe_chime",out var after);
                    Require(before.ReactivatesAt == after.ReactivatesAt, "Delayed duplicate cannot extend the discharge timer");
                    Capture("desktop-discharge"); _stage++; _next = EditorApplication.timeSinceStartup + 1.8; return;
                }
                if (_stage == 4) { Capture("desktop-dormant"); _stage++; _next = EditorApplication.timeSinceStartup + 1; return; }
                if (_stage == 5) {
                    Resize(true); var restored = Snapshot(); restored["serverNow"] = 107000;
                    foreach (var row in (JArray)restored["fields"]) row["revision"] = 2;
                    _renderer.ApplyAnomalyState(restored); _stage++; _next = EditorApplication.timeSinceStartup + 3; return;
                }
                if (_stage == 6) {
                    ValidatePresentationFrame(true);
                    foreach (string type in Types) {
                        Require(_renderer.TryGetField("probe_" + type, out var field) && field.Active, "Mobile capture must show active fields");
                        Require(field.ParticleBudget <= 43, "Capture must use the real mobile budget");
                    }
                    Capture("mobile-active"); _stage++; _next = EditorApplication.timeSinceStartup + 1; return;
                }
                if (_stage == 7) {
                    var timed = Snapshot(); timed["serverNow"]=108000;
                    foreach(var row in (JArray)timed["fields"]) row["revision"]=2;
                    timed["fields"][0]["revision"]=3; timed["fields"][0]["active"]=false;
                    timed["fields"][0]["dischargedUntil"]=108250;
                    _renderer.ApplyAnomalyState(timed); _stage++; _next=EditorApplication.timeSinceStartup+2; return;
                }
                Require(_renderer.TryGetField("probe_pull",out var reactivated) && reactivated.Active,
                    "Server deadline must reactivate the field without another packet");
                Require(_renderer.GetComponentsInChildren<ParticleSystem>().All(ps => ps.isPlaying && ps.particleCount>0),
                    "Persistent particle systems must survive beyond their first duration");
                Finish(null);
            }
            catch (Exception error) { Finish(error.ToString()); }
        }
        private static void Resize(bool mobile)
        {
            _mobile = mobile;
            QualitySettings.SetQualityLevel(mobile ? 1 : Mathf.Min(2, QualitySettings.names.Length-1), false);
            var view = EditorWindow.GetWindow(typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView"));
            view.position = new Rect(0, 0, mobile ? 960 : 1600, mobile ? 560 : 950); view.Show();
            Screen.SetResolution(mobile ? 960 : 1600, mobile ? 540 : 900, false);
            if (_renderer != null) _renderer.ForceLowQuality = mobile;
            if (_camera != null) _camera.GetUniversalAdditionalCameraData().renderPostProcessing = !mobile;
            _camera.aspect = 16f / 9f;
            for (int i=0; i<_labels.Length; i++) {
                if (_labels[i] == null) continue;
                var point = RoaCoords.ToUnity((i%4-1.5f)*7, i<4 ? -4.2f : 4.2f); point.z -= 3.15f;
                Vector3 anchor = _camera.WorldToViewportPoint(point);
                _labels[i].rectTransform.anchorMin = _labels[i].rectTransform.anchorMax = new Vector2(anchor.x, anchor.y);
            }
        }
        private static void TickLocation()
        {
            if (_stage == 0) {
                // Read authored IDs/radii/coordinates, never create gameplay state in data/.
                var catalog = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/locations.json"))));
                var location = catalog["locations"].OfType<JObject>().Single(row => row["id"]?.ToString() == "solarArray");
                _renderer = new GameObject("Authored anomaly integration review").AddComponent<RoaAnomalyFieldRenderer>();
                _renderer.Configure(null); _renderer.ApplyAnomalyState(new JObject {
                    ["roomId"]="location-review", ["locationId"]="solarArray", ["serverNow"]=200000,
                    ["fields"]=location["anomalyFields"].DeepClone()
                });
                Require(_renderer.VisibleFieldCount==2, "Solar Array must use its two authored fields");
                _camera = new GameObject("Gameplay anomaly review camera").AddComponent<Camera>();
                _camera.tag="MainCamera"; _camera.gameObject.AddComponent<AudioListener>();
                _camera.clearFlags=CameraClearFlags.SolidColor; _camera.backgroundColor=new Color(.08f,.1f,.1f);
                _camera.allowHDR=true;
                var rig=_camera.gameObject.AddComponent<RoaCameraRig>(); rig.ZoomPersistenceEnabled=false; rig.SmoothTime=0;
                rig.Distance=RoaCameraRig.DefaultGameplayDistance;
                _locationTarget=new GameObject("Authored field focus").transform; rig.Target=_locationTarget;
                _locationTarget.position=RoaCoords.ToUnity(4,10);
                var light=new GameObject("Review daylight").AddComponent<Light>(); light.type=LightType.Directional;
                light.transform.rotation=Quaternion.Euler(45,-30,0); light.intensity=1.1f;
                var volume=new GameObject("Review bloom").AddComponent<Volume>(); volume.isGlobal=true;
                volume.sharedProfile=ScriptableObject.CreateInstance<VolumeProfile>();
                var bloom=volume.sharedProfile.Add<Bloom>(); bloom.intensity.Override(.48f); bloom.threshold.Override(1.1f);
                Resize(false); _stage++; _next=EditorApplication.timeSinceStartup+4; return;
            }
            if (_stage==1) { Capture("chime-desktop"); _locationTarget.position=RoaCoords.ToUnity(-8,12); _stage++; _next=EditorApplication.timeSinceStartup+2; return; }
            if (_stage==2) { Capture("seam-desktop"); Resize(true); _stage++; _next=EditorApplication.timeSinceStartup+2; return; }
            if (_stage==3) { Capture("seam-mobile"); _locationTarget.position=RoaCoords.ToUnity(4,10); _stage++; _next=EditorApplication.timeSinceStartup+2; return; }
            if (_stage==4) { Capture("chime-mobile"); _stage++; _next=EditorApplication.timeSinceStartup+1; return; }
            Finish(null);
        }
        private static void BuildStage()
        {
            _camera = new GameObject("Anomaly review camera").AddComponent<Camera>();
            _camera.gameObject.AddComponent<AudioListener>();
            _camera.tag = "MainCamera"; _camera.transform.position = new Vector3(0, 24, -21);
            _camera.transform.LookAt(Vector3.zero); _camera.orthographic = true; _camera.orthographicSize = 11;
            _camera.allowHDR = true; _camera.backgroundColor = new Color(0.035f, 0.047f, 0.055f);
            _camera.clearFlags = CameraClearFlags.SolidColor;
            var cameraData = _camera.GetUniversalAdditionalCameraData(); cameraData.renderPostProcessing = true;
            var volume = new GameObject("Review post processing").AddComponent<Volume>(); volume.isGlobal = true;
            volume.sharedProfile = ScriptableObject.CreateInstance<VolumeProfile>();
            var bloom = volume.sharedProfile.Add<Bloom>(); bloom.intensity.Override(0.65f); bloom.threshold.Override(0.9f);
            RenderSettings.ambientMode = AmbientMode.Flat; RenderSettings.ambientLight = new Color(0.2f, 0.23f, 0.27f);
            var light = new GameObject("Evening key").AddComponent<Light>(); light.type = LightType.Directional;
            light.transform.rotation = Quaternion.Euler(35, -30, 0); light.intensity = 0.85f; light.color = new Color(0.9f, 0.82f, 0.69f);
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Cube); ground.name = "Review concrete";
            ground.transform.position = new Vector3(0, -0.18f, 0); ground.transform.localScale = new Vector3(38, 0.3f, 24);
            var mat = new Material(Shader.Find("Universal Render Pipeline/Lit")); mat.color = new Color(0.24f, 0.26f, 0.25f);
            var texture = new Texture2D(256, 256, TextureFormat.RGB24, true); texture.wrapMode = TextureWrapMode.Repeat;
            for (int y = 0; y < 256; y++) for (int x = 0; x < 256; x++) {
                float n = 0.67f + 0.1f * Mathf.PerlinNoise(x * 0.045f, y * 0.045f) + .025f*Mathf.PerlinNoise(x*.7f,y*.7f);
                texture.SetPixel(x, y, new Color(n, n * 0.97f, n * 0.9f));
            }
            texture.Apply(); mat.mainTexture = texture; mat.mainTextureScale = new Vector2(6, 4);
            ground.GetComponent<Renderer>().sharedMaterial = mat;
            // Real opaque geometry provides a scale cue and exercises light spill /
            // foreground rejection in the refraction shader. No authored scene edits.
            for(int i=0;i<8;i++) {
                Vector3 centre=RoaCoords.ToUnity((i%4-1.5f)*7,i<4?-4.2f:4.2f);
                for(int b=0;b<3;b++) {
                    var slab=GameObject.CreatePrimitive(PrimitiveType.Cube); slab.name="Review concrete debris";
                    slab.transform.position=centre+new Vector3(-2.3f+b*.42f,.12f,1.2f+b*.22f);
                    slab.transform.localScale=new Vector3(.7f,.24f,.37f); slab.transform.rotation=Quaternion.Euler(3,b*43,5);
                    slab.GetComponent<Renderer>().sharedMaterial=mat;
                }
            }
            _renderer = new GameObject("Anomaly review").AddComponent<RoaAnomalyFieldRenderer>();
            _renderer.Configure(null); _renderer.ApplyAnomalyState(Snapshot());
            var canvas = new GameObject("Review labels").AddComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = _camera; canvas.planeDistance = 1;
            var scaler = canvas.gameObject.AddComponent<CanvasScaler>(); scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1600, 900);
            TextLabel(canvas.transform, "REALM OF ASHES  /  ANOMALY VFX", new Vector2(0.5f, 0.95f), 24, new Vector2(900, 40));
            TextLabel(canvas.transform, "Восемь типов  ·  серверный радиус 2,65 м  ·  без детектора", new Vector2(0.5f, 0.91f), 14, new Vector2(1000, 30));
            for (int i = 0; i < 8; i++) {
                var point = RoaCoords.ToUnity((i % 4 - 1.5f) * 7, i < 4 ? -4.2f : 4.2f);
                point.z -= 3.15f;
                Vector3 screen = _camera.WorldToViewportPoint(point);
                _labels[i] = TextLabel(canvas.transform, Names[i], new Vector2(screen.x, screen.y), 16, new Vector2(230, 30));
            }
        }
        private static Text TextLabel(Transform parent, string value, Vector2 anchor, int size, Vector2 dimensions)
        {
            var text = new GameObject(value).AddComponent<Text>(); text.transform.SetParent(parent, false);
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); text.text = value; text.fontSize = size;
            text.alignment = TextAnchor.MiddleCenter; text.color = new Color(0.77f, 0.81f, 0.75f);
            text.rectTransform.anchorMin = text.rectTransform.anchorMax = anchor; text.rectTransform.sizeDelta = dimensions;
            return text;
        }
        private static void Capture(string suffix)
        {
            string dir = Path.GetFullPath(Path.Combine(Application.dataPath, "../../docs/art/reviews/anomaly-vfx-volume-2026"));
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, SessionState.GetString(Key + ".prefix", "after") + "-" + suffix + ".png");
            int width = _mobile ? 960 : 1600, height = _mobile ? 540 : 900;
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var previous = RenderTexture.active; var previousTarget = _camera.targetTexture;
            Texture2D pixels = null;
            try {
                target.Create(); _camera.targetTexture = target; Canvas.ForceUpdateCanvases();
                _camera.Render(); _camera.Render(); RenderTexture.active = target;
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0,0,width,height),0,0); pixels.Apply();
                File.WriteAllBytes(file, pixels.EncodeToPNG());
                Require(new FileInfo(file).Length > 10000, "Capture must contain rendered pixels");
            } finally {
                _camera.targetTexture = previousTarget; RenderTexture.active = previous;
                if(pixels != null) UnityEngine.Object.DestroyImmediate(pixels);
                target.Release(); UnityEngine.Object.DestroyImmediate(target);
            }
            Debug.Log("[ANOMALY VFX] capture " + width + "x" + height + " " + file);
        }
        private static void TickHero()
        {
            if(_stage==0) {
                BuildStage(); Resize(false); GameObject.Find("Review labels").SetActive(false);
                _heroIndex=0; PrepareHero(); _stage=1; _next=EditorApplication.timeSinceStartup+3; return;
            }
            if(_stage==1) {
                Capture(Types[_heroIndex]+"-active");
                var hit=Snapshot(); hit["serverNow"]=300100+_heroIndex*10000;
                foreach(var row in (JArray)hit["fields"])row["revision"]=11+_heroIndex*2;
                hit["fields"][_heroIndex]["active"]=false;
                hit["fields"][_heroIndex]["dischargedUntil"]=306100+_heroIndex*10000;
                _renderer.ApplyAnomalyState(hit); _stage=2; _next=EditorApplication.timeSinceStartup+.2; return;
            }
            Capture(Types[_heroIndex]+"-discharge"); _heroIndex++;
            if(_heroIndex>=8) { Finish(null); return; }
            PrepareHero(); _stage=1; _next=EditorApplication.timeSinceStartup+2;
        }
        private static void PrepareHero()
        {
            Vector3 centre=RoaCoords.ToUnity((_heroIndex%4-1.5f)*7,_heroIndex<4?-4.2f:4.2f);
            _camera.orthographic=false; _camera.fieldOfView=52;
            _camera.transform.position=centre+new Vector3(3.4f,5.2f,-6.6f);
            _camera.transform.LookAt(centre+Vector3.up*.85f);
            var state=Snapshot(); state["serverNow"]=300000+_heroIndex*10000;
            foreach(var row in (JArray)state["fields"])row["revision"]=10+_heroIndex*2;
            _renderer.ApplyAnomalyState(state);
        }
        private static void Finish(string error)
        {
            SessionState.SetBool(Key, false); EditorApplication.update -= Tick;
            if (error != null) Debug.LogError("[ANOMALY VFX] FAIL " + error);
            else Debug.Log("[ANOMALY VFX] visual capture PASS");
            EditorApplication.Exit(error == null ? 0 : 1);
        }

        [MenuItem("Realm of Ashes/Проверить VFX и состояния аномалий")]
        public static void Run()
        {
            var host = new GameObject("Anomaly VFX contract");
            try
            {
                host.transform.position = new Vector3(17, 2, -8);
                var renderer = host.AddComponent<RoaAnomalyFieldRenderer>(); renderer.Configure(null);
                Require(renderer.ShaderReady, "VFX shader must compile and ship in Resources");
                var state = Snapshot(); renderer.ApplyAnomalyState(state);
                Require(renderer.VisibleFieldCount == 8, "All eight types exist without a detector");
                for (int i=0;i<8;i++) {
                    Require(renderer.TryGetField("probe_"+Types[i],out var field), "Missing field");
                    Require(Vector3.Distance(field.Position, RoaCoords.ToUnity((i%4-1.5f)*7,.075f,i<4?-4.2f:4.2f)) < .001f,
                        "VFX position must match server collision through RoaCoords, independently of its parent");
                    Require(field.Active && field.Layers >= 4 && field.ParticleBudget <= 110, "Layer/budget contract");
                }
                var discharged=Snapshot(true); renderer.ApplyAnomalyState(discharged);
                int reactions=renderer.ReactionCount; Require(reactions==8,"Each transition reacts once");
                renderer.ApplyAnomalyState(discharged); Require(renderer.ReactionCount==reactions,"Duplicate ack cannot replay burst");
                renderer.ApplyAnomalyState(Snapshot());
                renderer.TryGetField("probe_chime",out var chime); Require(!chime.Active,"Stale revision must not reactivate the hazard");
                var permanent=(JObject)discharged.DeepClone(); permanent["serverNow"]=100100;
                permanent["fields"][0]["permanentlyDischarged"]=true; permanent["fields"][0]["dischargedUntil"]=0;
                renderer.ApplyAnomalyState(permanent); renderer.TryGetField("probe_pull",out var pull);
                Require(pull.Permanent && !pull.Active,"Story discharge remains permanent");
                var resized=Snapshot(); resized["serverNow"]=101000; resized["fields"][1]["radius"]=3.5;
                resized["fields"][1]["revision"]=2; renderer.ApplyAnomalyState(resized);
                renderer.TryGetField("probe_seam",out var seam); Require(Mathf.Abs(seam.Radius-3.5f)<.001f,"Changed authored radius rebuilds VFX");
                var inactive = (JObject)resized.DeepClone(); inactive["serverNow"] = 102000;
                inactive["fields"][1]["revision"] = 3; inactive["fields"][1]["active"] = false;
                inactive["fields"][1]["dischargedUntil"] = 0; renderer.ApplyAnomalyState(inactive);
                renderer.ForceLowQuality=true;
                typeof(RoaAnomalyFieldRenderer).GetMethod("Update", System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).Invoke(renderer,null);
                renderer.TryGetField("probe_seam",out seam);
                Require(seam.ParticleBudget<=43 && !seam.Active,"Mobile budget is bounded; missing deadline cannot reactivate");
                renderer.ApplyAnomalyState(new JObject { ["roomId"]="next",["locationId"]="next",["serverNow"]=200000,["fields"]=new JArray() });
                Require(renderer.VisibleFieldCount==0,"Room transfer removes old VFX and audio");
                renderer.ApplyAnomalyState(Snapshot());
                Require(renderer.VisibleFieldCount==0 && renderer.RoomId=="next", "Late old-room packet cannot restore old hazards");
                Debug.Log("[ANOMALY VFX] contract PASS: coordinates, eight types, duplicate/stale states, permanent discharge, resizing, mobile budget, cleanup");
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }
        public static void RunBatch()
        {
            try {
                Run();
                RunPresentationContracts();
                typeof(RoaBoltThrowProbe).GetMethod("Run", System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static).Invoke(null,null);
                EditorApplication.Exit(0);
            } catch(Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
        }
        private static void Require(bool condition,string message) { if(!condition)throw new InvalidOperationException(message); }
    }
}
#endif
