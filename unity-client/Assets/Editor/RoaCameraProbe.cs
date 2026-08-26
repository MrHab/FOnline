using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCameraProbe
    {
        [MenuItem("Realm of Ashes/Проверить камеру и панорамирование карты")]
        public static void Run()
        {
            GameObject cameraObject = null;
            GameObject targetObject = null;
            GameObject canvasObject = null;
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
                Check(defaultActorFraction > 0.07f && farActorFraction > 0.045f
                      && farActorFraction < defaultActorFraction,
                    "персонаж снова стал слишком мелким в локальном кадре");
                CaptureIfRequested(rig, targetObject.transform);

                Vector3 right = rig.PlanarRight();
                Vector3 forward = rig.PlanarForward();
                Check(Mathf.Abs(Vector3.Dot(right, forward)) < 0.001f,
                    "горизонтальные оси камеры не ортогональны");

                Vector3 movement = RoaGlobalMap.CameraPanMovement(
                    new Vector2(100f, -50f), 100f, 720f, Vector3.right, Vector3.forward);
                Check(movement.x < 0f && movement.z < 0f,
                    "drag карты не движет anchor против движения указателя");
                Vector3 clamped = RoaGlobalMap.ClampCameraPan(
                    new Vector3(80f, 3f, -90f), 100f, 120f);
                Check(Mathf.Approximately(clamped.x, 50f)
                      && Mathf.Approximately(clamped.z, -60f)
                      && Mathf.Approximately(clamped.y, 3f),
                    "anchor карты вышел за границы или потерял высоту");

                Vector2 touchStart = new Vector2(100f, 100f);
                Check(!RoaGlobalMap.TouchDragReached(touchStart, new Vector2(108f, 106f), 14f),
                    "небольшое касание ошибочно стало drag карты");
                Check(RoaGlobalMap.TouchDragReached(touchStart, new Vector2(118f, 100f), 14f),
                    "явный drag карты не достиг порога");
                Check(RoaGlobalMap.TouchTapEligible(0.25f, touchStart, new Vector2(106f, 105f), false),
                    "короткое касание не выбирает маршрут");
                Check(!RoaGlobalMap.TouchTapEligible(0.8f, touchStart, touchStart, false)
                      && !RoaGlobalMap.TouchTapEligible(0.2f, touchStart, new Vector2(120f, 100f), false)
                      && !RoaGlobalMap.TouchTapEligible(0.2f, touchStart, touchStart, true),
                    "долгое, сдвинутое или отменённое касание ошибочно выбирает маршрут");

                float pinchIn = RoaGlobalMap.PinchZoomDistance(100f, 100f, 200f, 8f, 220f);
                float pinchOut = RoaGlobalMap.PinchZoomDistance(100f, 100f, 50f, 8f, 220f);
                Check(Mathf.Approximately(pinchIn, 50f) && Mathf.Approximately(pinchOut, 200f),
                    "pinch карты меняет масштаб в неверном направлении");
                Check(Mathf.Approximately(RoaGlobalMap.PinchZoomDistance(100f, 100f, 10000f, 8f, 220f), 8f)
                      && Mathf.Approximately(RoaGlobalMap.PinchZoomDistance(100f, 100f, 1f, 8f, 220f), 220f),
                    "pinch карты вышел за границы камеры");

                Check(RoaGlobalMap.MapScreenPointCanGesture(new Vector2(420f, 250f), 840, 500, true)
                      && !RoaGlobalMap.MapScreenPointCanGesture(new Vector2(-1f, 250f), 840, 500, true),
                    "Canvas-карта неверно определяет доступную область касания");
                Check(RoaGlobalMap.MapScreenPointCanGesture(new Vector2(200f, 250f), 840, 500, false)
                      && !RoaGlobalMap.MapScreenPointCanGesture(new Vector2(640f, 250f), 840, 500, false),
                    "legacy-панель карты не блокирует касание по интерфейсу");

                Rect sidebar = RoaGlobalMap.InformationPanelRect(840, 500);
                var occupied = new[] { new Rect(216f, 228f, 220f, 44f) };
                Check(RoaGlobalMap.TryResolveOverlayLabelRect(new Vector2(326f, 250f), sidebar,
                    occupied, 840, 500, 220f, 44f, out Rect activityLabel)
                      && Mathf.Approximately(activityLabel.width, 220f)
                      && Mathf.Approximately(activityLabel.height, 44f)
                      && !activityLabel.Overlaps(sidebar)
                      && !activityLabel.Overlaps(occupied[0]),
                    "Canvas-подпись активности перекрывает панель или соседнюю метку");
                Check(!RoaGlobalMap.TryResolveOverlayLabelRect(sidebar.center, sidebar, null,
                    840, 500, 220f, 44f, out _),
                    "Canvas-подпись активности появилась поверх панели маршрута");

                Rect projectedRect = new Rect(320f, 180f, 200f, 40f);
                Vector2 canvasPosition = RoaGlobalMapCanvas.CanvasPositionForScreenRect(
                    projectedRect, 840, 500, 2f);
                Vector2 canvasSize = RoaGlobalMapCanvas.CanvasSizeForScreenRect(projectedRect, 2f);
                Check(Vector2.Distance(canvasPosition, new Vector2(0f, 25f)) < 0.001f
                      && Vector2.Distance(canvasSize, new Vector2(100f, 20f)) < 0.001f,
                    "экранная подпись неверно переводится в масштабируемый Canvas");

                canvasObject = new GameObject("Global map label Canvas probe");
                RoaGlobalMapCanvas mapCanvas = canvasObject.AddComponent<RoaGlobalMapCanvas>();
                MethodInfo ensureBuilt = typeof(RoaGlobalMapCanvas).GetMethod("EnsureBuilt",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Check(ensureBuilt != null, "Canvas глобальной карты не имеет детерминированной сборки");
                ensureBuilt.Invoke(mapCanvas, null);
                Canvas.ForceUpdateCanvases();
                Image[] mapLabelBackgrounds = canvasObject.GetComponentsInChildren<Image>(true)
                    .Where(image => image.gameObject.name == "MapOverlayLabel").ToArray();
                Text[] mapLabelTexts = canvasObject.GetComponentsInChildren<Text>(true)
                    .Where(text => text.transform.parent != null
                        && text.transform.parent.gameObject.name == "MapOverlayLabel").ToArray();
                Check(mapCanvas.MapLabelPoolSize == 8
                      && mapLabelBackgrounds.Length == 8
                      && mapLabelTexts.Length == 8
                      && mapLabelBackgrounds.All(image => !image.raycastTarget)
                      && mapLabelTexts.All(text => !text.raycastTarget && text.supportRichText),
                    "пул Canvas-подписей карты не ограничен, перехватывает ввод или теряет rich text");

                MethodInfo setRouteProgress = typeof(RoaGlobalMapCanvas).GetMethod("SetRouteProgress",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Check(setRouteProgress != null
                      && Mathf.Approximately(RoaGlobalMapCanvas.RouteProgressFillAmount(-1f), 0.025f)
                      && Mathf.Approximately(RoaGlobalMapCanvas.RouteProgressFillAmount(2f), 1f),
                    "полоса маршрута не ограничивает начало и завершение пути");
                setRouteProgress.Invoke(mapCanvas, new object[] { true, 0.42f, false });
                Image progressFill = canvasObject.GetComponentsInChildren<Image>(true)
                    .FirstOrDefault(image => image.gameObject.name == "RouteProgressFill");
                Color safeRouteColor = RoaGlobalMapCanvas.RouteProgressColor(false);
                Color contactRouteColor = RoaGlobalMapCanvas.RouteProgressColor(true);
                Check(mapCanvas.RouteProgressVisible
                      && Mathf.Abs(mapCanvas.RouteProgressFill - 0.42f) < 0.001f
                      && progressFill != null && !progressFill.raycastTarget
                      && contactRouteColor.r > safeRouteColor.r
                      && contactRouteColor.g < safeRouteColor.g,
                    "маршрут не показывает прогресс или тревожный контакт");
                setRouteProgress.Invoke(mapCanvas, new object[] { false, 0f, false });
                Check(!mapCanvas.RouteProgressVisible,
                    "полоса маршрута остаётся без активного пути");

                var taskCards = new List<RoaInteraction.WorldTaskCard>
                {
                    new RoaInteraction.WorldTaskCard
                    {
                        Id = "task-1", Label = "Работа", Title = "Разведка",
                        Reward = "100 XP", AcceptLabel = "Взять работу", CanAccept = true
                    }
                };
                string workA = RoaGlobalMapCanvas.BuildWorkSignature("site-a|Станция", taskCards);
                string workSame = RoaGlobalMapCanvas.BuildWorkSignature("site-a|Станция", taskCards);
                taskCards[0].TrackLabel = "Отслеживать";
                string workChanged = RoaGlobalMapCanvas.BuildWorkSignature("site-a|Станция", taskCards);
                string cachedSignature = null;
                Check(workA == workSame && workA != workChanged
                      && RoaGlobalMapCanvas.ListSignatureChanged(ref cachedSignature, workA)
                      && !RoaGlobalMapCanvas.ListSignatureChanged(ref cachedSignature, workSame)
                      && RoaGlobalMapCanvas.ListSignatureChanged(ref cachedSignature, workChanged)
                      && RoaGlobalMapCanvas.BuildPartySignature(string.Empty)
                         != RoaGlobalMapCanvas.BuildPartySignature("caravan-1"),
                    "неизменная доска работ пересобирается или обновление списка теряется");

                Debug.Log("[КАМЕРА] готово: zoom=8–21.5, distance=13.5, fov=52, actor>=4.5%, map drag="
                    + movement.x.ToString("0.00") + ":" + movement.z.ToString("0.00")
                    + ", clamp=50:-60, touch=tap/drag/pinch, labels=canvas/activities, route=progress/contact, lists=stable");
            }
            finally
            {
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (targetObject != null) UnityEngine.Object.DestroyImmediate(targetObject);
                if (canvasObject != null) UnityEngine.Object.DestroyImmediate(canvasObject);
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
