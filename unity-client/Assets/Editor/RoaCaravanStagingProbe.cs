#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Isolated preview scene: never saves or replaces the developer's open scenes.</summary>
    [InitializeOnLoad]
    public static class RoaCaravanStagingProbe
    {
        private static bool _running;
        private static readonly string Project = Directory.GetParent(Application.dataPath).FullName;
        private static readonly string Request = Path.Combine(Project,"Library/RoaCaravanStagingProbe.request");
        private static readonly string Result = Path.Combine(Project,"Library/RoaCaravanStagingProbe.result.json");
        private static readonly string BuildRequest = Path.Combine(Project,"Library/RoaCaravanWebGlBuild.request");
        private static readonly string StopPlayRequest = Path.Combine(Project,"Library/RoaCaravanStopPlay.request");
        static RoaCaravanStagingProbe() { EditorApplication.update += Poll; }
        private static void Poll()
        {
            if (_running || EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            if (File.Exists(StopPlayRequest))
            { File.Delete(StopPlayRequest); EditorApplication.isPlaying = false; return; }
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (File.Exists(BuildRequest))
            { File.Delete(BuildRequest); BuildWebGl(); return; }
            if (!File.Exists(Request)) return;
            File.Delete(Request);
            Run();
        }

        private static void BuildWebGl()
        {
            string result = Path.Combine(Project,"Library/RoaCaravanWebGlBuild.result.json");
            try
            {
                File.WriteAllText(result,new JObject { ["status"]="building",["started"]=DateTime.UtcNow }.ToString());
                RoaWebGlBuild.Build();
                BuildReport report = BuildReport.GetLatestReport();
                File.WriteAllText(result,new JObject {
                    ["status"]=report != null && report.summary.result == BuildResult.Succeeded ? "pass" : "fail",
                    ["errors"]=report != null ? report.summary.totalErrors : -1,
                    ["seconds"]=report != null ? report.summary.totalTime.TotalSeconds : 0,
                    ["output"]=RoaWebGlBuild.OutputDirectory
                }.ToString());
            }
            catch (Exception error)
            { File.WriteAllText(result,new JObject { ["status"]="fail",["error"]=error.ToString() }.ToString()); }
        }

        [MenuItem("Realm of Ashes/Проверить постановку засады каравана")]
        public static async void Run()
        {
            if (_running) return;
            _running = true;
            PreviewRenderUtility preview = null;
            UninterruptedDeferAgent deferAgent = null;
            Scene source = default;
            try
            {
                File.WriteAllText(Result,new JObject { ["status"]="loading" }.ToString());
                if (!Application.isPlaying)
                { deferAgent = new UninterruptedDeferAgent(); GltfImport.SetDefaultDeferAgent(deferAgent); }
                Require(RoaCaravanAmbushStage.Cast.Select(r => r.Id).Distinct().Count() == 9,"cast ids not unique");
                Require(RoaCaravanAmbushStage.Cast.Count(r => !r.Raider && r.FallsAt > 0) == 3,"allied casualties");
                Require(RoaCaravanAmbushStage.Cast.Count(r => r.Raider && r.FallsAt > 0) == 3,"enemy casualties");
                Require(RoaCaravanAmbushStage.Crossed(5,6,5.3f)
                    && !RoaCaravanAmbushStage.Crossed(6,7,5.3f),"explosions must trigger once across dropped frames");
                preview = new PreviewRenderUtility();
                preview.camera.fieldOfView = 51f;
                preview.camera.nearClipPlane = 0.1f;
                preview.camera.farClipPlane = 150f;
                preview.camera.clearFlags = CameraClearFlags.SolidColor;
                preview.camera.backgroundColor = new Color(0.22f,0.23f,0.19f);
                preview.ambientColor = new Color(0.6f,0.59f,0.55f);
                preview.lights[0].intensity = 1.5f;
                preview.lights[0].transform.rotation = Quaternion.Euler(48,-32,0);
                preview.lights[1].intensity = 0.45f;
                source = EditorSceneManager.OpenPreviewScene("Assets/Scenes/Kromka/Locations/randomRuinedRoad.unity");
                File.WriteAllText(Path.Combine(Project,"Library/RoaCaravanStageGeometry.txt"),string.Join("\n",
                    source.GetRootGameObjects().SelectMany(r => r.GetComponentsInChildren<Renderer>())
                    .Select(r => r.name + " center=" + r.bounds.center + " size=" + r.bounds.size)));
                foreach (GameObject root in source.GetRootGameObjects())
                    preview.AddSingleGO(UnityEngine.Object.Instantiate(root));
                EditorSceneManager.ClosePreviewScene(source);
                source = default;
                var host = new GameObject("CaravanStageProbe");
                preview.AddSingleGO(host);
                host.SetActive(false); // Match production's hidden cast prewarm.
                RoaCaravanAmbushStage stage = host.AddComponent<RoaCaravanAmbushStage>();
                stage.BeginLoad("http://127.0.0.1:3000", null, null);
                Task completed = await Task.WhenAny(stage.Loading, Task.Delay(90000));
                Require(completed == stage.Loading && stage.Ready,"cast load: " + stage.LoadError);
                Require(stage.LoadedPeople == 9 && stage.LoadedBrahmins == 2,"all actors must be visible before fade-in");
                host.SetActive(true);
                // Runtime destroys glTF equipment staging roots at end-of-frame.
                // Edit-mode previews have no such frame; don't capture these
                // temporary unbound source mannequins alongside the real actors.
                foreach (Transform temporary in host.GetComponentsInChildren<Transform>(true))
                    if (temporary != null && temporary.name.StartsWith("EquipmentSource:",StringComparison.Ordinal))
                        UnityEngine.Object.DestroyImmediate(temporary.gameObject);
                File.WriteAllText(Path.Combine(Project,"Library/RoaCaravanStageAnimations.txt"),string.Join("\n",
                    host.GetComponentsInChildren<Animation>().Select(a => a.transform.parent.name + ": "
                        + string.Join(",",a.Cast<AnimationState>().Select(s => s.name+" enabled="+s.enabled+" weight="+s.weight)))));
                string output = Path.Combine(Directory.GetParent(Project).FullName,"Build/KromkaSceneCaptures/caravan-ambush");
                Directory.CreateDirectory(output);
                stage.Sample(3f,true);
                SampleAnimations(host,0.4f);
                Capture(preview,output,"01-column-desktop",1440,900,new Vector3(0,0.9f,13),17,43,32);
                stage.Sample(7.8f,true);
                SampleAnimations(host,0.25f);
                Capture(preview,output,"02-attack-desktop",1440,900,new Vector3(2,0.9f,9),21,47,65);
                stage.Sample(14.5f,true);
                SampleAnimations(host,0.2f);
                Capture(preview,output,"03-crossfire-mobile",844,390,new Vector3(2,0.9f,10),18,45,65);
                stage.CompleteAftermath();
                Require(stage.FallenCount == 6,"normal completion must retain six bodies");
                Capture(preview,output,"04-aftermath-desktop",1440,900,new Vector3(1,0.9f,10),22,67,0);
                stage.Sample(0,true);
                Require(stage.FallenCount == 0,"timeline reset must clear dead presentation");
                stage.CompleteAftermath();
                Require(stage.FallenCount == 6 && stage.Aftermath,"skip must produce the same aftermath");
                Capture(preview,output,"05-aftermath-mobile",844,390,new Vector3(1,0.9f,10),22,67,0);
                RoaCaravanDepartureCinematicProbe.Run();
                File.WriteAllText(Result,new JObject { ["status"]="pass",["people"]=stage.LoadedPeople,
                    ["brahmins"]=stage.LoadedBrahmins,["bodies"]=stage.FallenCount,["captures"]=output }.ToString());
                Debug.Log("[ПОСТАНОВКА ЗАСАДЫ] PASS: 9 people, 2 brahmins, 6 bodies; desktop/mobile, skip and replay.");
            }
            catch (Exception error)
            {
                File.WriteAllText(Result,new JObject { ["status"]="fail",["error"]=error.ToString() }.ToString());
                Debug.LogException(error);
            }
            finally
            {
                if (source.IsValid()) EditorSceneManager.ClosePreviewScene(source);
                preview?.Cleanup();
                if (deferAgent != null) GltfImport.UnsetDefaultDeferAgent(deferAgent);
                _running = false;
            }
        }

        private static void SampleAnimations(GameObject host,float offset)
        {
            foreach (Animation animation in host.GetComponentsInChildren<Animation>())
            {
                animation.cullingType = AnimationCullingType.AlwaysAnimate;
                RoaCharacterView view = animation.GetComponentInParent<RoaCharacterView>();
                if (view != null && animation.GetClip(view.CurrentClip) != null)
                    animation.Play(view.CurrentClip,PlayMode.StopAll);
                foreach (AnimationState state in animation)
                    if (animation.IsPlaying(state.name))
                    { state.enabled = true; state.weight = 1f; state.time = state.name == "death"
                        ? RoaCharacterView.FinalDeathPoseTime(state) : offset; }
                animation.Sample();
            }
        }

        private static void Capture(PreviewRenderUtility preview,string output,string name,int width,int height,
            Vector3 focus,float distance,float pitch,float yaw)
        {
            var rotation = Quaternion.Euler(pitch,yaw,0);
            focus += RoaCaravanAmbushStage.AmbushOffset;
            preview.camera.transform.SetPositionAndRotation(focus - rotation * Vector3.forward * distance,rotation);
            preview.BeginPreview(new Rect(0,0,width,height),GUIStyle.none);
            preview.Render(true);
            Texture texture = preview.EndPreview();
            RenderTexture previous = RenderTexture.active;
            var readback = new Texture2D(width,height,TextureFormat.RGB24,false);
            try
            {
                RenderTexture.active = texture as RenderTexture;
                readback.ReadPixels(new Rect(0,0,width,height),0,0);
                readback.Apply();
                File.WriteAllBytes(Path.Combine(output,name+".png"),readback.EncodeToPNG());
            }
            finally { RenderTexture.active = previous; UnityEngine.Object.DestroyImmediate(readback); }
        }
        private static void Require(bool condition,string message)
        { if (!condition) throw new InvalidOperationException(message); }
    }
}
#endif
