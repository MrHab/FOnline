#if UNITY_EDITOR
using System;
using System.Linq;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.EditorTools
{
    public static partial class RoaAnomalyVfxProbe
    {
        private static void UpdateNow(RoaAnomalyFieldRenderer renderer)
        {
            typeof(RoaAnomalyFieldRenderer).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(renderer, null);
        }

        private static void RunPresentationContracts()
        {
            int quality = QualitySettings.GetQualityLevel();
            var host = new GameObject("Volume and fallback contracts");
            var cameraHost = new GameObject("Volume contract camera");
            try {
                QualitySettings.SetQualityLevel(Mathf.Min(2, QualitySettings.names.Length - 1), false);
                var camera = cameraHost.AddComponent<Camera>(); camera.transform.position = new Vector3(0, 12, -14);
                var data = camera.GetUniversalAdditionalCameraData();
                data.requiresColorOption = CameraOverrideOption.Off; data.requiresDepthOption = CameraOverrideOption.UsePipelineSettings;
                var renderer = host.AddComponent<RoaAnomalyFieldRenderer>(); renderer.Configure(null);
                typeof(RoaAnomalyFieldRenderer).GetField("_camera", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(renderer, camera);
                renderer.ApplyAnomalyState(Snapshot()); UpdateNow(renderer);
                Require(renderer.RefractionBuffersRequested && renderer.ActiveVolumeCount == 8, "Desktop must render eight real volumes");
                Require(data.requiresColorOption == CameraOverrideOption.On && data.requiresDepthOption == CameraOverrideOption.On,
                    "High quality explicitly requests both scene buffers");
                Require(renderer.ActiveSpillLights <= 2 && renderer.ActiveSpillLights > 0, "At most two nearby spill lights");
                ValidateFlowMeshes(renderer, 392);
                renderer.ForceLowQuality = true; UpdateNow(renderer);
                Require(!renderer.RefractionBuffersRequested && renderer.ActiveVolumeCount == 0 && renderer.ActiveSpillLights <= 1,
                    "Mobile renders no expensive volume and at most one spill light");
                Require(data.requiresColorOption == CameraOverrideOption.Off && data.requiresDepthOption == CameraOverrideOption.UsePipelineSettings,
                    "Quality switch restores prior camera settings exactly");
                ValidateFlowMeshes(renderer, 100);
                renderer.ForceLowQuality = false; UpdateNow(renderer);
                renderer.SetLocalWorldActive(false); UpdateNow(renderer);
                Require(!renderer.RefractionBuffersRequested && renderer.ActiveVolumeCount == 0 && renderer.ActiveSpillLights == 0
                    && renderer.GetComponentsInChildren<Renderer>().Length == 0, "Global map must hide all local VFX and release their passes");
                renderer.SetLocalWorldActive(true); UpdateNow(renderer);
                Require(renderer.RefractionBuffersRequested && renderer.ActiveVolumeCount == 8, "Local return restores presentation");
                renderer.enabled = false;
                // Ordinary MonoBehaviour callbacks do not run in Edit Mode.
                typeof(RoaAnomalyFieldRenderer).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(renderer, null);
                Require(!renderer.RefractionBuffersRequested && renderer.ActiveSpillLights == 0, "Disable must also release presentation");
                renderer.enabled = true;
                typeof(RoaAnomalyFieldRenderer).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(renderer, null);
                UpdateNow(renderer);
                typeof(RoaAnomalyFieldRenderer).GetMethod("OnDestroy", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(renderer, null);
                UnityEngine.Object.DestroyImmediate(host);
                Require(data.requiresColorOption == CameraOverrideOption.Off && data.requiresDepthOption == CameraOverrideOption.UsePipelineSettings,
                    "Destroy restores the camera settings");
                foreach (string name in new[] { "AnomalyField", "AnomalyVolume" }) {
                    var shader = Resources.Load<Shader>("RealmOfAshes/" + name);
                    Require(shader != null && shader.isSupported, "Supported bundled shader " + name);
                    Require(!ShaderUtil.GetShaderMessages(shader).Any(m => m.severity.ToString() == "Error"), "No shader compiler errors: " + name);
                }
                var mist = Resources.Load<Material>("RealmOfAshes/AnomalyMistTemplate");
                Require(mist != null && mist.GetTexture("_SmokeTex") != null && mist.GetFloat("_UseSmoke") == 1,
                    "Authored smoke is included in the build via its Resources material");
                Debug.Log("[ANOMALY VFX] volume contract PASS: shaders, smoke, 24-step integration, 392/100 vertices, 2/1 lights, camera restoration, map/disable/destroy");
            } finally {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                UnityEngine.Object.DestroyImmediate(cameraHost); QualitySettings.SetQualityLevel(quality, false);
            }
        }

        private static void ValidateFlowMeshes(RoaAnomalyFieldRenderer renderer, int budget)
        {
            foreach (var filter in renderer.GetComponentsInChildren<MeshFilter>()) {
                if (!filter.name.Contains("SpatialFlow")) continue;
                var vertices = filter.sharedMesh.vertices;
                Require(vertices.Length <= budget && vertices.Length > 0, "Flow geometry remains bounded");
                for (int i = 0; i < vertices.Length; i += 2) {
                    Vector3 side = vertices[i + 1] - vertices[i];
                    Require(!float.IsNaN(side.sqrMagnitude) && side.sqrMagnitude < 2f, "Ribbon width stays finite and bounded");
                }
            }
        }

        private static void ValidatePresentationFrame(bool mobile)
        {
            Require(_renderer.ActiveVolumeCount == (mobile ? 0 : 8), "Actual frame uses the selected volume tier");
            Require(_renderer.ActiveSpillLights <= (mobile ? 1 : 2), "Actual frame respects the light budget");
            Require(_renderer.RefractionBuffersRequested != mobile, "No optional scene copies on mobile");
            ValidateFlowMeshes(_renderer, mobile ? 100 : 392);
        }

        private static Color32[] ReadFramePixels()
        {
            const int width = 640, height = 360;
            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var previous = RenderTexture.active; var target = _camera.targetTexture;
            var pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
            try {
                rt.Create(); _camera.targetTexture = rt; _camera.Render(); _camera.Render();
                RenderTexture.active = rt; pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0); pixels.Apply();
                return pixels.GetPixels32();
            } finally {
                _camera.targetTexture = target; RenderTexture.active = previous;
                rt.Release(); UnityEngine.Object.DestroyImmediate(rt); UnityEngine.Object.DestroyImmediate(pixels);
            }
        }

        private static void ValidateRefractionPixels()
        {
            var focus = _renderer.GetComponentsInChildren<MeshRenderer>().Single(r => r.name == "RefractiveDensityVolume" && r.transform.parent.name == "Anomaly_probe_pull");
            var renderers = _renderer.GetComponentsInChildren<Renderer>(); var enabled = renderers.Select(r => r.enabled).ToArray();
            var lights = _renderer.GetComponentsInChildren<Light>(); var lightEnabled = lights.Select(l => l.enabled).ToArray();
            var position = _camera.transform.position; var rotation = _camera.transform.rotation;
            bool ortho = _camera.orthographic, post = _camera.GetUniversalAdditionalCameraData().renderPostProcessing;
            var board = GameObject.CreatePrimitive(PrimitiveType.Cube); var occluder = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var material = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            var texture = new Texture2D(64, 64, TextureFormat.RGB24, false) { filterMode = FilterMode.Point };
            float distortion = focus.sharedMaterial.GetFloat("_Distortion");
            try {
                foreach (var r in renderers) r.enabled = r == focus;
                foreach (var l in lights) l.enabled = false;
                Vector3 centre = focus.transform.parent.position;
                _camera.orthographic = false; _camera.transform.position = centre + new Vector3(0, 1.4f, -7);
                _camera.transform.LookAt(centre + Vector3.up * 1.4f); _camera.GetUniversalAdditionalCameraData().renderPostProcessing = false;
                for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) texture.SetPixel(x, y, (x / 2 + y / 2) % 2 == 0 ? Color.white : Color.black);
                texture.Apply(); material.mainTexture = texture;
                board.GetComponent<Renderer>().sharedMaterial = material;
                board.transform.position = centre + new Vector3(0, 1.5f, 3); board.transform.localScale = new Vector3(9, 6, .1f);
                occluder.GetComponent<Renderer>().sharedMaterial = material;
                occluder.transform.position = centre + new Vector3(-1.1f, 1.4f, -3); occluder.transform.localScale = new Vector3(.5f, 2.5f, .2f);
                focus.sharedMaterial.SetFloat("_Distortion", 0); var plain = ReadFramePixels();
                focus.sharedMaterial.SetFloat("_Distortion", distortion); var bent = ReadFramePixels();
                int changed = 0;
                for (int i = 0; i < plain.Length; i++) if (Mathf.Abs(plain[i].r - bent[i].r) + Mathf.Abs(plain[i].g - bent[i].g) + Mathf.Abs(plain[i].b - bent[i].b) > 9) changed++;
                Require(changed > 100, "Refraction must actually displace rendered background pixels: " + changed);
                focus.enabled = false; var opaque = ReadFramePixels();
                Vector3 screen = _camera.WorldToViewportPoint(occluder.transform.position);
                int cx = Mathf.RoundToInt(screen.x * 640), cy = Mathf.RoundToInt(screen.y * 360), errors = 0;
                for (int y = cy - 30; y <= cy + 30; y++) for (int x = cx - 4; x <= cx + 4; x++) {
                    int i = y * 640 + x;
                    if (Mathf.Abs(opaque[i].r - bent[i].r) + Mathf.Abs(opaque[i].g - bent[i].g) + Mathf.Abs(opaque[i].b - bent[i].b) > 3) errors++;
                }
                Require(errors == 0, "Opaque foreground must not be painted over by the volume: " + errors);
                _renderer.enabled = false;
                Require(!_renderer.RefractionBuffersRequested && _renderer.ActiveVolumeCount == 0,
                    "Actual Play Mode disable callback releases the buffers");
                _renderer.enabled = true; UpdateNow(_renderer);
                _renderer.SetLocalWorldActive(false);
                Require(_renderer.GetComponentsInChildren<Renderer>().Length == 0, "Actual global-map hide removes local renderers");
                _renderer.SetLocalWorldActive(true); UpdateNow(_renderer);
                Require(_renderer.GetComponentsInChildren<ParticleSystem>().All(ps => ps.isPlaying), "Returning from the global map restarts every particle system");
                Debug.Log("[ANOMALY VFX] rendered refraction/occlusion PASS: " + changed + " displaced pixels; foreground errors=" + errors);
            } finally {
                for (int i = 0; i < renderers.Length; i++) renderers[i].enabled = enabled[i];
                for (int i = 0; i < lights.Length; i++) lights[i].enabled = lightEnabled[i];
                focus.sharedMaterial.SetFloat("_Distortion", distortion);
                _camera.transform.SetPositionAndRotation(position, rotation); _camera.orthographic = ortho;
                _camera.GetUniversalAdditionalCameraData().renderPostProcessing = post;
                UnityEngine.Object.DestroyImmediate(board); UnityEngine.Object.DestroyImmediate(occluder);
                UnityEngine.Object.DestroyImmediate(material); UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static void TickLayers()
        {
            if (_stage == 0) {
                BuildStage(); Resize(false); GameObject.Find("Review labels").SetActive(false);
                _heroIndex = 0; PrepareHero(); _stage = 1; _next = EditorApplication.timeSinceStartup + 3; return;
            }
            foreach (string layer in new[] { "SpatialFlowRibbons", "RefractiveDensityVolume", "AdvectedAtmosphere", "EmbersAndDischarge", "PermanentCue_LevitatingShards" }) {
                var renderers = _renderer.GetComponentsInChildren<Renderer>();
                foreach (var r in renderers) r.enabled = r.name == layer;
                Capture(layer);
            }
            Finish(null);
        }
    }
}
#endif
