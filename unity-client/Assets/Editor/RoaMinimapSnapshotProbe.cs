#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Снимок локации под миникартой: сходится ли картинка с маркерами.
    ///
    /// Проба строит крошечный мир с четырьмя цветными столбами у известных тайлов,
    /// снимает его камерой миникарты и проверяет, что каждый столб лежит на снимке
    /// ровно там, куда миникарта кладёт его маркер (WorldToMapNormalized). Потом
    /// сверяет направление: значок игрока должен смотреть на тот столб, на который
    /// повёрнут сам игрок. Кадры и отчёт — в ROA_MINIMAP_PROBE_OUT.
    /// </summary>
    public static class RoaMinimapSnapshotProbe
    {
        private const int Tiles = 38;
        private const float Metres = Tiles * 2f;

        private sealed class Post
        {
            public string Name;
            public int Tx;
            public int Tz;
            public Color Colour;
        }

        [MenuItem("Realm of Ashes/Zones/Check minimap snapshot")]
        public static void Run()
        {
            string outDir = Environment.GetEnvironmentVariable("ROA_MINIMAP_PROBE_OUT");
            if (string.IsNullOrEmpty(outDir)) outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Temp", "MinimapProbe"));
            Directory.CreateDirectory(outDir);
            var report = new StringBuilder();
            try
            {
                Check(outDir, report);
                report.AppendLine("RESULT OK");
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                Debug.Log("[MinimapProbe] OK\n" + report);
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                report.AppendLine("RESULT FAIL " + error.Message);
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                Debug.LogError("[MinimapProbe] FAIL " + error + "\n" + report);
                if (Application.isBatchMode) EditorApplication.Exit(1);
            }
        }

        private static void Check(string outDir, StringBuilder report)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var light = new GameObject("ProbeLight").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            light.transform.rotation = Quaternion.Euler(60f, 25f, 0f);

            // Земля и четыре столба у краёв: каждый — свой цвет и свой тайл.
            Ground();
            var posts = new List<Post>
            {
                new Post { Name = "юг (tz 3, −Z Unity)", Tx = Tiles / 2, Tz = 3, Colour = new Color(0.95f, 0.15f, 0.15f) },
                new Post { Name = "север (tz max, +Z Unity)", Tx = Tiles / 2, Tz = Tiles - 4, Colour = new Color(0.15f, 0.45f, 0.95f) },
                new Post { Name = "tx0 (запад, −X Unity)", Tx = 3, Tz = Tiles / 2, Colour = new Color(0.95f, 0.85f, 0.15f) },
                new Post { Name = "txMax (восток, +X Unity)", Tx = Tiles - 4, Tz = Tiles / 2, Colour = new Color(0.15f, 0.85f, 0.35f) }
            };
            foreach (Post post in posts) Pillar(post);

            LocationDefinition location = JsonConvert.DeserializeObject<LocationDefinition>(
                "{\"schema\":\"realm.location.v1\",\"id\":\"minimap_probe\",\"name\":\"Проба миникарты\"," +
                "\"map\":{\"width\":" + Metres + ",\"depth\":" + Metres + ",\"origin\":\"center\"}}");
            Require(location != null && location.TileWidth == Tiles && location.TileDepth == Tiles,
                $"the probe location is {location?.TileWidth}×{location?.TileDepth} tiles, expected {Tiles}×{Tiles}");

            var host = new GameObject("MinimapProbeHost");
            var minimap = host.AddComponent<RoaMinimap>();
            minimap.SetLocation(location);
            var snapshot = host.AddComponent<RoaMinimapSnapshot>();
            Require(snapshot.Capture(location, new Color(0.18f, 0.20f, 0.16f)), "the snapshot camera rendered nothing");
            Texture2D image = ReadBack(snapshot.Texture);
            File.WriteAllBytes(Path.Combine(outDir, "snapshot.png"), image.EncodeToPNG());

            // --- положение: каждый столб лежит там, куда миникарта кладёт его маркер ---
            foreach (Post post in posts)
            {
                Vector3 world = RoaCoords.TileToWorld(post.Tx, post.Tz, Tiles, Tiles);
                Vector2 normalized = minimap.WorldToMapNormalized(world);
                int px = Mathf.Clamp(Mathf.RoundToInt(normalized.x * image.width), 0, image.width - 1);
                int py = Mathf.Clamp(Mathf.RoundToInt(normalized.y * image.height), 0, image.height - 1);
                Color sampled = image.GetPixel(px, py);
                float distance = Mathf.Abs(sampled.r - post.Colour.r) + Mathf.Abs(sampled.g - post.Colour.g) + Mathf.Abs(sampled.b - post.Colour.b);
                report.AppendLine($"{post.Name}: tile {post.Tx},{post.Tz} → map {normalized.x:0.00},{normalized.y:0.00} → pixel {px},{py} = {sampled.r:0.00},{sampled.g:0.00},{sampled.b:0.00}");
                Require(distance < 0.45f,
                    $"{post.Name}: the snapshot shows {sampled.r:0.00},{sampled.g:0.00},{sampled.b:0.00} where the minimap draws the marker, expected {post.Colour.r:0.00},{post.Colour.g:0.00},{post.Colour.b:0.00}");
            }

            // --- направление: значок смотрит туда же, куда игрок ---
            Vector2 centre = minimap.WorldToMapNormalized(Vector3.zero);
            foreach (Post post in posts)
            {
                Vector3 world = RoaCoords.TileToWorld(post.Tx, post.Tz, Tiles, Tiles);
                // Игрок в центре смотрит на столб: yaw из направления взгляда.
                Vector3 look = (world - Vector3.zero).normalized;
                float heading = Quaternion.LookRotation(look, Vector3.up).eulerAngles.y;
                float rotation = RoaMinimap.PlayerIconRotation(heading);
                // Значок нарисован остриём вверх; поворот φ уводит остриё в (−sin φ, cos φ).
                Vector2 icon = new Vector2(-Mathf.Sin(rotation * Mathf.Deg2Rad), Mathf.Cos(rotation * Mathf.Deg2Rad));
                Vector2 toPost = (minimap.WorldToMapNormalized(world) - centre).normalized;
                float cosine = Vector2.Dot(icon.normalized, toPost);
                report.AppendLine($"heading {heading:0}° → icon {rotation:0}°: точка {icon.x:0.00},{icon.y:0.00} vs столб {toPost.x:0.00},{toPost.y:0.00} (cos {cosine:0.00})");
                Require(cosine > 0.97f,
                    $"{post.Name}: the icon points {icon.x:0.00},{icon.y:0.00} while the player looks at {toPost.x:0.00},{toPost.y:0.00} on the map");
            }

            // Кадр с маркерами поверх снимка — чтобы совпадение было видно глазами.
            Texture2D overlay = Overlay(image, minimap, posts);
            File.WriteAllBytes(Path.Combine(outDir, "snapshot-with-markers.png"), overlay.EncodeToPNG());
            report.AppendLine($"snapshot {image.width}×{image.height}, captures {snapshot.CaptureCount}");
        }

        private static void Ground()
        {
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "ProbeGround";
            ground.transform.localScale = new Vector3(Metres / 10f, 1f, Metres / 10f);
            ground.GetComponent<Renderer>().sharedMaterial = Material(new Color(0.30f, 0.33f, 0.24f));
        }

        private static void Pillar(Post post)
        {
            GameObject pillar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            pillar.name = "Post_" + post.Tx + "_" + post.Tz;
            Vector3 world = RoaCoords.TileToWorld(post.Tx, post.Tz, Tiles, Tiles);
            pillar.transform.position = new Vector3(world.x, 2f, world.z);
            pillar.transform.localScale = new Vector3(6f, 4f, 6f);
            pillar.GetComponent<Renderer>().sharedMaterial = Material(post.Colour);
        }

        private static Material Material(Color colour)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            var material = new Material(shader) { hideFlags = HideFlags.DontSave };
            material.color = colour;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            return material;
        }

        private static Texture2D ReadBack(RenderTexture source)
        {
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = source;
            var texture = new Texture2D(source.width, source.height, TextureFormat.RGBA32, false);
            texture.ReadPixels(new Rect(0f, 0f, source.width, source.height), 0, 0);
            texture.Apply();
            RenderTexture.active = previous;
            return texture;
        }

        private static Texture2D Overlay(Texture2D image, RoaMinimap minimap, List<Post> posts)
        {
            var overlay = new Texture2D(image.width, image.height, TextureFormat.RGBA32, false);
            overlay.SetPixels(image.GetPixels());
            foreach (Post post in posts)
            {
                Vector2 normalized = minimap.WorldToMapNormalized(RoaCoords.TileToWorld(post.Tx, post.Tz, Tiles, Tiles));
                Cross(overlay, Mathf.RoundToInt(normalized.x * image.width), Mathf.RoundToInt(normalized.y * image.height), Color.white);
            }
            overlay.Apply();
            return overlay;
        }

        private static void Cross(Texture2D texture, int x, int y, Color colour)
        {
            for (int d = -6; d <= 6; d++)
            {
                if (x + d >= 0 && x + d < texture.width) texture.SetPixel(x + d, y, colour);
                if (y + d >= 0 && y + d < texture.height) texture.SetPixel(x, y + d, colour);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
