#if UNITY_EDITOR
using System;
using System.IO;
using Kromka;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Same authored relief as the interactive scene, ready on the first UI frame.</summary>
    public static class RoaWorldMapOverviewBaker
    {
        [MenuItem("Realm of Ashes/Zones/Bake instant world overview")]
        public static void Run()
        {
            var world = Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText("Assets/Resources/RealmOfAshes/WorldMapOverview.json"));
            float width = world["cols"].ToObject<float>() * world["zoneKm"].ToObject<float>();
            float depth = world["rows"].ToObject<float>() * world["zoneKm"].ToObject<float>();
            Scene scene = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
            RoaUnityGlobalMapScene authored = null;
            foreach (var root in scene.GetRootGameObjects())
                if ((authored = root.GetComponentInChildren<RoaUnityGlobalMapScene>(true)) != null) break;
            if (authored == null) throw new Exception("Missing authored world map");
            var map = new GameObject("OverviewBaker").AddComponent<RoaWorldMap3D>();
            map.SetWorldSize(width, depth);
            map.AttachForProbe(scene, authored, true);
            Camera camera = map.MapCamera;
            float scale = authored.transform.lossyScale.x;
            camera.orthographic = true;
            camera.orthographicSize = depth * RoaWorldMap3D.WorldScale * scale / 2;
            camera.transform.SetPositionAndRotation(authored.transform.TransformPoint(new Vector3(0, 60, 0)),
                authored.transform.rotation * Quaternion.Euler(90, 0, 0));
            camera.farClipPlane = 150 * scale;
            int height = 1536, pixels = Mathf.RoundToInt(height * width / depth);
            var target = new RenderTexture(pixels, height, 24);
            camera.targetTexture = target;
            RenderSettings.fog = false;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.5f, .49f, .45f);
            camera.Render();
            RenderTexture.active = target;
            var image = new Texture2D(pixels, height, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, pixels, height), 0, 0); image.Apply();
            const string file = "Assets/Resources/RealmOfAshes/WorldMapOverviewTerrain.png";
            File.WriteAllBytes(file, image.EncodeToPNG());
            RenderTexture.active = null; camera.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(image); UnityEngine.Object.DestroyImmediate(target);
            AssetDatabase.ImportAsset(file, ImportAssetOptions.ForceSynchronousImport);
            var importer = (TextureImporter)AssetImporter.GetAtPath(file);
            importer.mipmapEnabled = false; importer.isReadable = false; importer.maxTextureSize = 2048;
            importer.textureCompression = TextureImporterCompression.Compressed; importer.wrapMode = TextureWrapMode.Clamp;
            importer.SaveAndReimport();
            Debug.Log("[WorldOverviewBaker] Baked " + pixels + "x" + height);
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
    }
}
#endif
