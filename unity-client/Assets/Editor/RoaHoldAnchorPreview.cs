using System;
using System.Collections.Generic;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Ортографические снимки моделей оружия с точками хвата: сбоку (ось Z
    /// вправо, Y вверх) и сверху (Z вправо, X вверх), сетка — через 5 см,
    /// белые линии — оси префаба. Точки: красные — рукоять, жёлтая — спуск,
    /// синяя — затыльник, зелёные — низ цевья, оранжевые — древко, пурпурная —
    /// боёк. Папка — ROA_HOLD_PREVIEW_OUT.
    /// </summary>
    public static class RoaHoldAnchorPreview
    {
        private const int Width = 900, Height = 420;
        private const int Layer = 30;

        [MenuItem("Realm of Ashes/Animation/Preview hold anchors")]
        public static void Run()
        {
            string outDir = Environment.GetEnvironmentVariable("ROA_HOLD_PREVIEW_OUT")
                ?? Path.GetFullPath(Path.Combine(Application.dataPath, "../Temp/HoldAnchors"));
            Directory.CreateDirectory(outDir);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var light = new GameObject("Light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.transform.rotation = Quaternion.Euler(40f, 60f, 0f);
            RenderSettings.ambientLight = new Color(0.55f, 0.55f, 0.55f);
            var palette = AssetDatabase.LoadAssetAtPath<RoaApocalypseModels>("Assets/Resources/RealmOfAshes/PolygonApocalypseModels.asset");
            var anchors = AssetDatabase.LoadAssetAtPath<RoaHoldAnchors>("Assets/Resources/RealmOfAshes/HoldAnchors.asset");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var cameraObject = new GameObject("Camera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.3f, 0.32f, 0.33f);
            camera.cullingMask = 1 << Layer;
            var target = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32);
            camera.targetTexture = target;
            var sheet = new Texture2D(Width, Height * 2, TextureFormat.RGBA32, false);
            string only = Environment.GetEnvironmentVariable("ROA_HOLD_PREVIEW_ONLY");
            foreach (RoaApocalypseModels.WeaponEntry weapon in palette.EditorWeapons)
            {
                if (weapon?.prefab == null || !seen.Add(weapon.prefab.name)) continue;
                if (!string.IsNullOrEmpty(only) && only.IndexOf(weapon.prefab.name, StringComparison.Ordinal) < 0) continue;
                RoaHoldAnchors.Entry entry = anchors.Entries.Find(row => row.prefab == weapon.prefab.name);
                if (entry == null) continue;
                var instance = (GameObject)UnityEngine.Object.Instantiate(weapon.prefab);
                instance.transform.position = Vector3.zero;
                instance.transform.rotation = Quaternion.identity;
                foreach (Transform node in instance.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = Layer;
                Vector3 centre = (entry.min + entry.max) * 0.5f;
                Vector3 size = entry.max - entry.min;
                Vector3 scale = instance.transform.lossyScale;
                // Кадр сбоку: камера справа от модели (+X), дуло на снимке справа.
                float half = Mathf.Max(size.z * 0.5f * Height / Width, size.y * 0.5f, size.x * 0.5f) * 1.15f + 0.02f;
                camera.orthographicSize = half;
                Shot(camera, target, sheet, 1, instance.transform.TransformPoint(centre) + Vector3.right * 3f, Quaternion.LookRotation(Vector3.left, Vector3.up));
                Shot(camera, target, sheet, 0, instance.transform.TransformPoint(centre) + Vector3.up * 3f, Quaternion.LookRotation(Vector3.down, Vector3.left));
                Overlay(sheet, entry, instance.transform, camera, instance.transform.TransformPoint(centre), half);
                sheet.Apply();
                File.WriteAllBytes(Path.Combine(outDir, weapon.prefab.name + ".png"), sheet.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(instance);
            }
            Debug.Log("[HOLD PREVIEW] PASS " + outDir);
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }

        private static void Shot(Camera camera, RenderTexture target, Texture2D sheet, int row, Vector3 eye, Quaternion rotation)
        {
            camera.transform.SetPositionAndRotation(eye, rotation);
            camera.Render();
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = target;
            var pixels = new Texture2D(Width, Height, TextureFormat.RGBA32, false);
            pixels.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
            pixels.Apply();
            RenderTexture.active = previous;
            sheet.SetPixels32(0, row * Height, Width, Height, pixels.GetPixels32());
            UnityEngine.Object.DestroyImmediate(pixels);
        }

        // Верхний кадр (row 1) — вид сбоку, нижний (row 0) — вид сверху.
        private static Vector2Int Side(Vector3 p, Vector3 centre, float half)
        {
            float ppm = Height / (2f * half);
            // На снимке дуло справа: экранное «вправо» — это +Z.
            int x = Mathf.RoundToInt(Width * 0.5f + (p.z - centre.z) * ppm);
            int y = Mathf.RoundToInt(Height * 1.5f + (p.y - centre.y) * ppm);
            return new Vector2Int(x, y);
        }

        private static Vector2Int Top(Vector3 p, Vector3 centre, float half)
        {
            float ppm = Height / (2f * half);
            // Сверху: «вправо» — +Z, как у бокового кадра, «вверх» — −X.
            int x = Mathf.RoundToInt(Width * 0.5f + (p.z - centre.z) * ppm);
            int y = Mathf.RoundToInt(Height * 0.5f - (p.x - centre.x) * ppm);
            return new Vector2Int(x, y);
        }

        private static void Overlay(Texture2D sheet, RoaHoldAnchors.Entry e, Transform root, Camera camera, Vector3 centre, float half)
        {
            float ppm = Height / (2f * half);
            // Сетка через 5 см.
            for (float z = Mathf.Floor((centre.z - half * Width / Height) / 0.05f) * 0.05f; z < centre.z + half * Width / Height; z += 0.05f)
            {
                int x = Side(new Vector3(0f, 0f, z), centre, half).x;
                bool axis = Mathf.Abs(z) < 0.001f;
                Color c = axis ? Color.white : (Mathf.Abs(Mathf.Round(z / 0.1f) * 0.1f - z) < 0.001f ? new Color(1f, 1f, 1f, 0.35f) : new Color(1f, 1f, 1f, 0.15f));
                for (int y = 0; y < Height * 2; y++) Blend(sheet, x, y, c);
            }
            for (float v = Mathf.Floor((centre.y - half) / 0.05f) * 0.05f; v < centre.y + half; v += 0.05f)
            {
                int y = Side(new Vector3(0f, v, 0f), centre, half).y;
                bool axis = Mathf.Abs(v) < 0.001f;
                Color c = axis ? Color.white : new Color(1f, 1f, 1f, 0.2f);
                for (int x = 0; x < Width; x++) Blend(sheet, x, y, c);
            }
            for (float v = Mathf.Floor((centre.x - half) / 0.05f) * 0.05f; v < centre.x + half; v += 0.05f)
            {
                int y = Top(new Vector3(v, 0f, 0f), centre, half).y;
                bool axis = Mathf.Abs(v) < 0.001f;
                Color c = axis ? Color.white : new Color(1f, 1f, 1f, 0.2f);
                for (int x = 0; x < Width; x++) Blend(sheet, x, y, c);
            }
            void Dot(Vector3 local, Color c, int r = 4)
            {
                Vector3 p = root.TransformPoint(local);
                foreach (Vector2Int q in new[] { Side(p, centre, half), Top(p, centre, half) })
                    for (int dx = -r; dx <= r; dx++)
                        for (int dy = -r; dy <= r; dy++)
                            if (dx * dx + dy * dy <= r * r) Blend(sheet, q.x + dx, q.y + dy, c);
            }
            if (e.firearm)
            {
                Dot(e.trigger, Color.yellow);
                Dot(e.gripTop, Color.red);
                Dot(e.gripBottom, new Color(0.6f, 0f, 0f));
                Dot(e.butt, Color.blue, 5);
                Dot(e.muzzle, Color.cyan);
                foreach (Vector4 u in e.underside) Dot(new Vector3(u.x, u.y, u.z), Color.green, 2);
                if (e.hasHandle) Dot(e.handleCentre, new Color(0f, 0.6f, 0f), 5);
                if (e.hasMagazine) Dot(e.magazineCentre, Color.grey, 5);
            }
            else
            {
                Dot(e.haftBottom, new Color(1f, 0.5f, 0f), 5);
                Dot(e.haftTop, new Color(1f, 0.8f, 0.3f), 5);
                Dot(e.headCentre, Color.magenta, 5);
            }
        }

        private static void Blend(Texture2D sheet, int x, int y, Color c)
        {
            if (x < 0 || y < 0 || x >= sheet.width || y >= sheet.height) return;
            Color under = sheet.GetPixel(x, y);
            sheet.SetPixel(x, y, Color.Lerp(under, new Color(c.r, c.g, c.b, 1f), c.a));
        }
    }
}
