#if UNITY_EDITOR
using System;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaWeaponAudioProbe
    {
        private const int ExpectedClips = 17;
        private const string ResourceRoot = "Audio/Weapons/";

        private static readonly string[] ResourceNames =
        {
            "ballistic_pistol", "ballistic_rifle", "ballistic_shotgun",
            "ballistic_machinegun", "energy_sidearm", "energy_longgun",
            "launcher_fire", "flamethrower_fire", "projectile_impact",
            "melee_light_swing", "melee_light_impact", "melee_heavy_swing",
            "melee_heavy_impact", "reload_pistol", "reload_rifle",
            "reload_shotgun", "dry_fire"
        };

        [MenuItem("Realm of Ashes/Проверить звуки оружия")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                Require(ResourceNames.Length == ExpectedClips,
                    "weapon audio resource catalog has the wrong size");
                foreach (string resourceName in ResourceNames)
                {
                    AudioClip clip = Resources.Load<AudioClip>(ResourceRoot + resourceName);
                    Require(clip != null, "missing weapon audio: " + resourceName);
                    Require(clip.channels == 1, "weapon audio must be mono: " + resourceName);
                    Require(clip.frequency == 44100, "weapon audio must use 44.1 kHz: " + resourceName);
                    Require(clip.length >= 0.18f && clip.length <= 1.7f,
                        "weapon audio length is outside the one-shot budget: " + resourceName);
                }

                host = new GameObject("RoaWeaponAudioProbe");
                RoaAudio audio = host.AddComponent<RoaAudio>();
                if (audio.GeneratedClipCount == 0)
                {
                    MethodInfo awake = typeof(RoaAudio).GetMethod("Awake",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    awake?.Invoke(audio, null);
                }
                Require(audio.GeneratedClipCount == 32,
                    "generated fallback catalog changed unexpectedly");
                Require(audio.WeaponPilotAudioReady
                    && audio.ExternalWeaponClipCount == ExpectedClips,
                    "RoaAudio did not replace every weapon fallback");

                Debug.Log("[ЗВУКИ ОРУЖИЯ] готово: 17 моно-клипов загружены, процедурные резервы сохранены.");
            }
            catch (Exception error)
            {
                Debug.LogError("[ЗВУКИ ОРУЖИЯ] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
