using System;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseEquipmentProbe
    {
        private const string RequestName = "../Library/roa-apocalypse-equipment-probe.request";
        private static bool _enteredPlayMode;

        [InitializeOnLoadMethod]
        private static void RunIfRequested()
        {
            string request = Path.Combine(Application.dataPath, RequestName);
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request)) return;
                File.Delete(request);
                if (EditorApplication.isPlaying) { Run(); return; }
                _enteredPlayMode = true;
                EditorApplication.playModeStateChanged += OnPlayModeChanged;
                EditorApplication.EnterPlaymode();
            };
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            Run();
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Capture equipped character")]
        public static async void Run()
        {
            GameObject host = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                if (!Application.isPlaying)
                    throw new InvalidOperationException("Equipment probe requires Play Mode.");
                host = new GameObject("ApocalypseEquipmentProbe");
                var preview = host.AddComponent<RoaCharacterPreview>();
                preview.Show("http://127.0.0.1:3000", new CharacterAppearance
                    { Sex = "male", HairId = "short_crop", HairColorId = "hair_08" }, 480, 540);
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (!preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!preview.IsReady) throw new TimeoutException("Character preview did not load.");
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                if (character == null || !character.Ready)
                    throw new InvalidOperationException("Character body did not load.");
                await character.EquipItems("http://127.0.0.1:3000", new JObject
                {
                    ["armor"] = "combatArmor",
                    ["helmet"] = "tacticalHelmet",
                    ["backpack"] = "backpack",
                    ["boots"] = "scoutBoots"
                });
                if (!character.HasLoadedEquipment("backpack", "backpack")
                    || !character.HasLoadedEquipment("armor", "combatArmor"))
                    throw new InvalidOperationException("The runtime outfit did not equip.");
                // Sample the gameplay idle before photographing attached equipment.
                Animation idle = character.GetComponentInChildren<Animation>(true);
                if (idle != null && idle["idle"] != null)
                {
                    idle.Play("idle");
                    idle.Sample();
                }
                character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                await Task.Delay(150);
                character.GetComponent<RoaApocalypseCharacterSkin>()?.SyncPose();
                readback = new Texture2D(preview.Texture.width, preview.Texture.height,
                    TextureFormat.RGBA32, false);
                Capture(preview, readback, "ApocalypseEquipmentFront.png");
                bool attached = false;
                foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    if (node.name == "PolygonApocalypse_Spine_03_Accessory") attached = true;
                if (!attached) throw new InvalidOperationException("Pack backpack attachment is missing.");
                character.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
                Capture(preview, readback, "ApocalypseEquipmentBack.png");
                Debug.Log("[ROA APOCALYPSE] Equipment probe PASS: armor and backpack visible.");
            }
            catch (Exception error) { Debug.LogError("[ROA APOCALYPSE] Equipment probe FAIL " + error); }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.Destroy(readback);
                if (host != null) UnityEngine.Object.Destroy(host);
                if (_enteredPlayMode)
                {
                    _enteredPlayMode = false;
                    EditorApplication.ExitPlaymode();
                }
            }
        }

        private static void Capture(RoaCharacterPreview preview, Texture2D readback, string name)
        {
            if (!preview.RenderNow()) throw new InvalidOperationException("Preview render failed: " + name);
            RenderTexture.active = preview.Texture;
            readback.ReadPixels(new Rect(0, 0, preview.Texture.width, preview.Texture.height), 0, 0);
            readback.Apply();
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../Temp/", name));
            File.WriteAllBytes(path, readback.EncodeToPNG());
        }
    }
}
