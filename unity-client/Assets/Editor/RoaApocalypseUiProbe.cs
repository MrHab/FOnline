#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseUiProbe
    {
        [MenuItem("Realm of Ashes/Probe/Apocalypse HUD Layouts")]
        public static void RunLayouts()
        {
            VerifyMobileControls();
            RoaMobileControlsProbe.Run();
            RoaHudCanvasProbe.Run();
            RoaHudReadabilityProbe.Run();
            RoaAuthStepsLayoutProbe.Run();
            RoaMobileLayoutProbe.Run();
        }

        [MenuItem("Realm of Ashes/Probe/Apocalypse HUD Screenshots")]
        public static void Capture()
        {
            string output = Path.Combine("Library", "AgentCaptures");
            Directory.CreateDirectory(output);
            var sizes = new[]
            {
                new RoaCreatorCardLayoutProbe.ScreenCase
                    { Name = "desktop-1920x1080", Width = 1920, Height = 1080 },
                new RoaCreatorCardLayoutProbe.ScreenCase
                    { Name = "mobile-896x414", Mobile = true, Width = 896, Height = 414 }
            };
            foreach (var size in sizes)
            {
                GameObject host = null;
                GameObject cameraObject = null;
                RenderTexture target = null;
                try
                {
                    Canvas canvas = RoaCreatorCardLayoutProbe.BuildHost(size,
                        out RoaAuthCanvas auth, out host, out cameraObject, out target);
                    RoaCreatorCardLayoutProbe.Invoke(auth, "RebuildBody", "login");
                    RoaCreatorCardLayoutProbe.Invoke(auth, "RefreshTexts", "login");
                    host.AddComponent<RoaApocalypseUiSkin>().ApplyTo(canvas);
                    RoaCreatorCardLayoutProbe.ToCaptureLayer(canvas);
                    Canvas.ForceUpdateCanvases();
                    string path = Path.Combine(output, "apocalypse-auth-" + size.Name + ".png");
                    RoaCreatorCardLayoutProbe.Render(cameraObject.GetComponent<Camera>(), target, path);
                    Debug.Log("[ROA PROBE] Apocalypse HUD screenshot: " + path);
                }
                finally
                {
                    if (target != null)
                    {
                        target.Release();
                        UnityEngine.Object.DestroyImmediate(target);
                    }
                    if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                    if (host != null) UnityEngine.Object.DestroyImmediate(host);
                }
            }
            CaptureMobileControls(output);
        }

        private static void VerifyMobileControls()
        {
            const int width = 896;
            const int height = 414;
            Rect safe = new Rect(24f, 12f, 848f, 390f);
            GameObject root = BuildMobileControls(width, height, safe,
                out RoaMobileControlsCanvas view, out Canvas _);
            try
            {
                if (!view.CanvasReady || !view.InputReady ||
                    view.ActiveButtonCount != RoaMobileControlsCanvas.TotalButtons)
                    throw new Exception("The Apocalypse mobile controls lost a touch target.");
                foreach (string id in new[] { "Inventory", "Map", "Pipboy", "Menu", "Fire",
                    "Interact", "Target", "Crouch", "Reload", "Mode", "Player", "Bolt", "Vehicle" })
                {
                    if (!view.ButtonHasIcon(id) || !view.ButtonUsesSyntyPrefab(id) ||
                        !view.TryGetButtonScreenRect(id, out Rect button) ||
                        button.xMin < safe.xMin - 0.01f || button.yMin < safe.yMin - 0.01f ||
                        button.xMax > safe.xMax + 0.01f || button.yMax > safe.yMax + 0.01f)
                        throw new Exception("Missing Synty icon or unsafe touch target: " + id);
                }
                Debug.Log("[ROA PROBE] Apocalypse mobile controls OK: 13 prefab icons and safe touch targets.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static GameObject BuildMobileControls(int width, int height, Rect safe,
            out RoaMobileControlsCanvas view, out Canvas canvas)
        {
            var root = new GameObject("ApocalypseMobileProbe");
            RoaMobileControls controls = root.AddComponent<RoaMobileControls>();
            controls.ForceVisible = true;
            controls.CanvasDriven = true;
            view = root.AddComponent<RoaMobileControlsCanvas>();
            view.Configure(controls);
            canvas = root.GetComponentInChildren<Canvas>(true);
            RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), true);
            view.PresentNow(new RoaMobileControlsCanvas.Presentation
            {
                Visible = true,
                TargetSelected = true,
                Crouching = true,
                PingAvailable = true,
                BoltAiming = true,
                VehicleAvailable = true,
                Mounted = true,
                FireMode = "single",
                JoystickActive = true,
                JoystickBase = new Vector2(220f, 108f),
                JoystickPoint = new Vector2(258f, 132f),
                JoystickRadius = 54f
            }, width, height, safe);
            return root;
        }

        private static void CaptureMobileControls(string output)
        {
            const int width = 896;
            const int height = 414;
            GameObject root = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            try
            {
                root = BuildMobileControls(width, height, new Rect(24f, 12f, 848f, 390f),
                    out RoaMobileControlsCanvas _, out Canvas canvas);
                cameraObject = new GameObject("MobileControlsCamera", typeof(Camera));
                Camera camera = cameraObject.GetComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << 31;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.15f, 0.14f, 0.12f, 1f);
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
                target.Create();
                camera.targetTexture = target;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                RoaCreatorCardLayoutProbe.ToCaptureLayer(canvas);
                Canvas.ForceUpdateCanvases();
                string path = Path.Combine(output, "apocalypse-mobile-controls-896x414.png");
                RoaCreatorCardLayoutProbe.Render(camera, target, path);
                Debug.Log("[ROA PROBE] Apocalypse HUD screenshot: " + path);
            }
            finally
            {
                if (target != null)
                {
                    target.Release();
                    UnityEngine.Object.DestroyImmediate(target);
                }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [MenuItem("Realm of Ashes/Probe/Apocalypse HUD Skin")]
        public static void Run()
        {
            // A public checkout does not contain the licensed Synty source files.
            // The complete visual probe runs after the owner imports the pack.
            if (RoaApocalypseUiSkin.Background == null)
            {
                Debug.Log("[ROA PROBE] Apocalypse HUD assets are not installed locally; visual probe skipped.");
                return;
            }
            GameObject root = new GameObject("ApocalypseProbe", typeof(Canvas),
                typeof(RoaApocalypseUiSkin));
            try
            {
                var canvas = root.GetComponent<Canvas>();
                var skin = root.GetComponent<RoaApocalypseUiSkin>();
                Sprite background = RoaApocalypseUiSkin.Background;
                Sprite metal = Resources.Load<Sprite>(
                    "ApocalypseHud/SPR_Apocalypse_Box_Metal_04");
                if (background == null || metal == null || RoaApocalypseUiSkin.Bar == null)
                    throw new Exception("Apocalypse HUD sprites were not imported as UI sprites.");
                if (Resources.Load<GameObject>("ApocalypseHud/Button_Apocalypse_HotBar_Item_01") == null ||
                    Resources.Load<GameObject>("ApocalypseHud/HUD_Apocalypse_HealthBar_01") == null)
                    throw new Exception("The ready-made Synty HUD prefabs were not installed.");

                var panel = new GameObject("CharacterCard", typeof(RectTransform), typeof(Image));
                panel.transform.SetParent(root.transform, false);
                var panelRect = panel.GetComponent<RectTransform>();
                panelRect.sizeDelta = new Vector2(700f, 500f);
                var panelImage = panel.GetComponent<Image>();
                panelImage.color = new Color(0.03f, 0.07f, 0.04f, 0.9f);

                var action = new GameObject("Action", typeof(RectTransform), typeof(Image),
                    typeof(Button));
                action.transform.SetParent(panel.transform, false);
                action.GetComponent<RectTransform>().sizeDelta = new Vector2(130f, 36f);
                Image actionImage = action.GetComponent<Image>();
                action.GetComponent<Button>().targetGraphic = actionImage;

                Text russian = Label(panel.transform, "Продолжить");
                Text number = Label(panel.transform, "125 / 200");
                skin.ApplyTo(canvas);
                skin.ApplyTo(canvas);

                if (panelImage.sprite != background || panelImage.type != Image.Type.Sliced ||
                    panel.transform.Find("ApocalypseHudFrame") == null)
                    throw new Exception("The inventory panel did not receive the Synty background and frame.");
                if (actionImage.sprite != metal || !actionImage.raycastTarget ||
                    action.GetComponent<Button>().targetGraphic != actionImage)
                    throw new Exception("The Synty button lost its click target.");
                if (russian.font != RoaUiFont.Default ||
                    number.font != Resources.Load<Font>("ApocalypseHud/SairaCondensed-Regular"))
                    throw new Exception("The Synty font fallback does not preserve Cyrillic text.");

                panelRect.sizeDelta = new Vector2(300f, 140f);
                if (panel.transform.childCount != 4)
                    throw new Exception("Repeated skinning duplicated panel decoration.");
                Debug.Log("[ROA PROBE] Apocalypse HUD skin OK: panel, button, fonts and interaction.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static Text Label(Transform parent, string value)
        {
            var node = new GameObject("Label", typeof(RectTransform), typeof(Text));
            node.transform.SetParent(parent, false);
            Text label = node.GetComponent<Text>();
            label.font = RoaUiFont.Default;
            label.text = value;
            return label;
        }
    }
}
#endif
