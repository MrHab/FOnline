using System;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCameraProbe
    {
        [MenuItem("Realm of Ashes/Проверить камеру")]
        public static void Run()
        {
            GameObject cameraObject = null;
            GameObject targetObject = null;
            try
            {
                cameraObject = new GameObject("RoaCameraProbe");
                targetObject = new GameObject("RoaCameraTargetProbe");
                targetObject.transform.position = new Vector3(3f, 1f, -2f);
                Camera viewCamera = cameraObject.AddComponent<Camera>();
                RoaCameraRig rig = cameraObject.AddComponent<RoaCameraRig>();
                rig.Target = targetObject.transform;
                rig.MinDistance = RoaCameraRig.MinimumGameplayDistance;
                rig.MaxDistance = RoaCameraRig.MaximumGameplayDistance;
                rig.SmoothTime = 0f;
                rig.SetFieldOfView(RoaCameraRig.GameplayFieldOfView);

                rig.SetDistance(1f, false);
                Check(Mathf.Approximately(rig.Distance, 8f), "минимум zoom не соблюдён");
                rig.SetDistance(100f, false);
                Check(Mathf.Approximately(rig.Distance, 21.5f), "максимум zoom не соблюдён");
                rig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                rig.SnapToTarget();
                Check(Mathf.Abs(Vector3.Distance(rig.transform.position, targetObject.transform.position)
                    - RoaCameraRig.DefaultGameplayDistance) < 0.001f,
                    "камера не держит заданную дистанцию");
                Check(Mathf.Abs(viewCamera.fieldOfView - RoaCameraRig.GameplayFieldOfView) < 0.001f,
                    "тактический объектив не применён");
                float defaultActorFraction = RoaCameraRig.ProjectedActorScreenFraction(
                    1.75f, RoaCameraRig.DefaultGameplayDistance, RoaCameraRig.GameplayFieldOfView, rig.PitchDeg);
                float farActorFraction = RoaCameraRig.ProjectedActorScreenFraction(
                    1.75f, RoaCameraRig.MaximumGameplayDistance, RoaCameraRig.GameplayFieldOfView, rig.PitchDeg);
                Check(defaultActorFraction > 0.085f && farActorFraction > 0.045f
                      && farActorFraction < defaultActorFraction,
                    "персонаж снова стал слишком мелким в локальном кадре");
                CaptureIfRequested(rig, targetObject.transform);

                Vector3 right = rig.PlanarRight();
                Vector3 forward = rig.PlanarForward();
                Check(Mathf.Abs(Vector3.Dot(right, forward)) < 0.001f,
                    "горизонтальные оси камеры не ортогональны");

                Debug.Log("[CAMERA] готово: zoom=8–21.5, distance=11.5, fov=52, actor>=4.5%, planar axes orthogonal");
            }
            finally
            {
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (targetObject != null) UnityEngine.Object.DestroyImmediate(targetObject);
            }
        }

        private static void CaptureIfRequested(RoaCameraRig rig, Transform target)
        {
            string path = Environment.GetEnvironmentVariable("ROA_CAMERA_CAPTURE");
            if (string.IsNullOrWhiteSpace(path) || rig == null || target == null) return;

            Camera camera = rig.GetComponent<Camera>();
            if (camera == null) throw new InvalidOperationException("У probe-камеры нет Camera");
            GameObject sceneRoot = null;
            GameObject lightObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            Material groundMaterial = null;
            Material roadMaterial = null;
            Material actorMaterial = null;
            Material accentMaterial = null;
            Material propMaterial = null;
            RenderTexture previousActive = RenderTexture.active;
            RenderTexture previousTarget = camera.targetTexture;
            CameraClearFlags previousClear = camera.clearFlags;
            Color previousBackground = camera.backgroundColor;
            float previousDistance = rig.Distance;
            AmbientMode previousAmbient = RenderSettings.ambientMode;
            Color previousSky = RenderSettings.ambientSkyColor;
            Color previousEquator = RenderSettings.ambientEquatorColor;
            Color previousGround = RenderSettings.ambientGroundColor;
            float previousAmbientIntensity = RenderSettings.ambientIntensity;
            bool previousFog = RenderSettings.fog;
            Color previousFogColor = RenderSettings.fogColor;
            FogMode previousFogMode = RenderSettings.fogMode;
            float previousFogDensity = RenderSettings.fogDensity;
            try
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                if (shader == null) throw new InvalidOperationException("Lit shader не найден");
                groundMaterial = Material(shader, "Probe ground", new Color(0.50f, 0.37f, 0.22f));
                roadMaterial = Material(shader, "Probe road", new Color(0.64f, 0.49f, 0.29f));
                actorMaterial = Material(shader, "Probe actor", new Color(0.075f, 0.085f, 0.075f));
                accentMaterial = Material(shader, "Probe accent", new Color(0.72f, 0.30f, 0.09f));
                propMaterial = Material(shader, "Probe props", new Color(0.24f, 0.21f, 0.17f));

                sceneRoot = new GameObject("Camera readability scene");
                Vector3 center = target.position;
                Primitive(PrimitiveType.Cube, sceneRoot.transform,
                    new Vector3(center.x, -0.12f, center.z), new Vector3(26f, 0.2f, 26f),
                    Quaternion.identity, groundMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform,
                    new Vector3(center.x, 0.015f, center.z), new Vector3(2.6f, 0.05f, 24f),
                    Quaternion.Euler(0f, 32f, 0f), roadMaterial);
                Primitive(PrimitiveType.Capsule, sceneRoot.transform,
                    center, new Vector3(0.62f, 0.92f, 0.62f), Quaternion.identity, actorMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform,
                    center + new Vector3(0.32f, 0.08f, 0.22f), new Vector3(0.42f, 0.76f, 0.28f),
                    Quaternion.Euler(0f, 28f, 0f), accentMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform,
                    center + new Vector3(-0.42f, -0.12f, 0.16f), new Vector3(0.09f, 0.09f, 1.35f),
                    Quaternion.Euler(0f, 48f, -8f), actorMaterial);

                Vector3[] props =
                {
                    new Vector3(-5.6f, 0.18f, -3.4f), new Vector3(4.8f, 0.22f, -5.1f),
                    new Vector3(-3.7f, 0.14f, 5.2f), new Vector3(6.2f, 0.20f, 3.7f)
                };
                for (int i = 0; i < props.Length; i++)
                {
                    Vector3 scale = new Vector3(0.72f + i * 0.08f, 0.42f + i * 0.04f, 0.58f);
                    Primitive(PrimitiveType.Sphere, sceneRoot.transform,
                        new Vector3(center.x + props[i].x, props[i].y, center.z + props[i].z),
                        scale, Quaternion.Euler(0f, i * 31f, 0f), propMaterial);
                }

                lightObject = new GameObject("Camera readability sun");
                Light sun = lightObject.AddComponent<Light>();
                sun.type = LightType.Directional;
                sun.color = new Color(1f, 0.82f, 0.62f);
                sun.intensity = 1.15f;
                sun.shadows = LightShadows.Soft;
                lightObject.transform.rotation = Quaternion.Euler(52f, -38f, 0f);

                RenderSettings.ambientMode = AmbientMode.Trilight;
                RenderSettings.ambientSkyColor = new Color(0.58f, 0.55f, 0.48f);
                RenderSettings.ambientEquatorColor = new Color(0.40f, 0.36f, 0.29f);
                RenderSettings.ambientGroundColor = new Color(0.18f, 0.16f, 0.14f);
                RenderSettings.ambientIntensity = 0.72f;
                RenderSettings.fog = true;
                RenderSettings.fogMode = FogMode.ExponentialSquared;
                RenderSettings.fogColor = new Color(0.29f, 0.25f, 0.20f);
                RenderSettings.fogDensity = 0.0025f;

                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.20f, 0.18f, 0.16f);
                rig.SetFieldOfView(RoaCameraRig.GameplayFieldOfView);
                rig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                rig.SnapToTarget();

                renderTarget = new RenderTexture(960, 540, 24, RenderTextureFormat.ARGB32)
                {
                    name = "CameraReadabilityCapture"
                };
                renderTarget.Create();
                camera.targetTexture = renderTarget;
                camera.Render();
                RenderTexture.active = renderTarget;
                readback = new Texture2D(960, 540, TextureFormat.RGB24, false);
                readback.ReadPixels(new Rect(0f, 0f, 960f, 540f), 0, 0);
                readback.Apply(false, false);
                string directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllBytes(path, readback.EncodeToPNG());
                Debug.Log("[КАМЕРА] кадр: " + path);
            }
            finally
            {
                camera.targetTexture = previousTarget;
                camera.clearFlags = previousClear;
                camera.backgroundColor = previousBackground;
                rig.SetDistance(previousDistance, false);
                rig.SnapToTarget();
                RenderTexture.active = previousActive;
                RenderSettings.ambientMode = previousAmbient;
                RenderSettings.ambientSkyColor = previousSky;
                RenderSettings.ambientEquatorColor = previousEquator;
                RenderSettings.ambientGroundColor = previousGround;
                RenderSettings.ambientIntensity = previousAmbientIntensity;
                RenderSettings.fog = previousFog;
                RenderSettings.fogColor = previousFogColor;
                RenderSettings.fogMode = previousFogMode;
                RenderSettings.fogDensity = previousFogDensity;
                if (sceneRoot != null) UnityEngine.Object.DestroyImmediate(sceneRoot);
                if (lightObject != null) UnityEngine.Object.DestroyImmediate(lightObject);
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (renderTarget != null)
                {
                    renderTarget.Release();
                    UnityEngine.Object.DestroyImmediate(renderTarget);
                }
                if (groundMaterial != null) UnityEngine.Object.DestroyImmediate(groundMaterial);
                if (roadMaterial != null) UnityEngine.Object.DestroyImmediate(roadMaterial);
                if (actorMaterial != null) UnityEngine.Object.DestroyImmediate(actorMaterial);
                if (accentMaterial != null) UnityEngine.Object.DestroyImmediate(accentMaterial);
                if (propMaterial != null) UnityEngine.Object.DestroyImmediate(propMaterial);
            }
        }

        private static Material Material(Shader shader, string name, Color color)
        {
            var material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.04f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.04f);
            return material;
        }

        private static GameObject Primitive(PrimitiveType type, Transform parent, Vector3 position,
                                            Vector3 scale, Quaternion rotation, Material material)
        {
            GameObject value = GameObject.CreatePrimitive(type);
            value.name = "Camera readability " + type;
            value.transform.SetParent(parent, false);
            value.transform.position = position;
            value.transform.localScale = scale;
            value.transform.rotation = rotation;
            Renderer renderer = value.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = material;
            return value;
        }
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
