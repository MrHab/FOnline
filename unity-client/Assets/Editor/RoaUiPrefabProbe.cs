#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaUiPrefabProbe
    {
        private const string Directory = RoaUiPrefabGenerator.PrefabDirectory;

        private static readonly Dictionary<string, RoaUiPrefabKind> Expected =
            new Dictionary<string, RoaUiPrefabKind>
            {
                { "RoaLoadingScreen", RoaUiPrefabKind.LoadingScreen },
                { "RoaAuthScreen", RoaUiPrefabKind.AuthScreen },
                { "RoaCharacterCreator", RoaUiPrefabKind.CharacterCreator },
                { "RoaHud", RoaUiPrefabKind.Hud },
                { "RoaMinimap", RoaUiPrefabKind.Minimap },
                { "RoaSystemLog", RoaUiPrefabKind.SystemLog },
                { "RoaQuickbar", RoaUiPrefabKind.Quickbar },
                { "RoaPipboy", RoaUiPrefabKind.Pipboy },
                { "RoaProgressionWindow", RoaUiPrefabKind.Progression },
                { "RoaCraftWindow", RoaUiPrefabKind.Crafting },
                { "RoaLocalMapWindow", RoaUiPrefabKind.LocalMap },
                { "RoaModalWindow", RoaUiPrefabKind.ModalWindow },
                { "RoaSettingsMenu", RoaUiPrefabKind.Settings },
                { "RoaTutorialWindow", RoaUiPrefabKind.Tutorial },
                { "RoaQuantityDialog", RoaUiPrefabKind.QuantityDialog },
                { "RoaLootWindow", RoaUiPrefabKind.LootWindow },
                { "RoaBarterWindow", RoaUiPrefabKind.BarterWindow },
                { "RoaStorageWindow", RoaUiPrefabKind.StorageWindow },
                { "RoaGraphicsWindow", RoaUiPrefabKind.GraphicsWindow },
                { "RoaPauseScreen", RoaUiPrefabKind.PauseScreen },
                { "RoaContextMenu", RoaUiPrefabKind.ContextMenu },
                { "RoaGlobalMapHud", RoaUiPrefabKind.GlobalMap },
                { "RoaMobileControls", RoaUiPrefabKind.MobileControls }
            };

        [MenuItem("Realm of Ashes/Probe/UI Prefab Library")]
        public static void Run()
        {
            RoaUiPrefabGenerator.Build();
            GameObject root = Load("RoaUiRoot");
            if (root.GetComponent<RoaUiTheme>() == null)
                throw new Exception("RoaUiRoot has no shared RoaUiTheme component.");

            RoaUiPrefabTemplate rootMarker = root.GetComponent<RoaUiPrefabTemplate>();
            if (rootMarker == null || rootMarker.Kind != RoaUiPrefabKind.Root)
                throw new Exception("RoaUiRoot marker is missing or has the wrong kind.");
            if (root.transform.childCount != Expected.Count)
                throw new Exception("RoaUiRoot template count differs from the web UI contract.");

            foreach (KeyValuePair<string, RoaUiPrefabKind> pair in Expected)
            {
                GameObject asset = Load(pair.Key);
                RoaUiPrefabTemplate marker = asset.GetComponent<RoaUiPrefabTemplate>();
                if (marker == null || marker.Kind != pair.Value)
                    throw new Exception(pair.Key + " marker is missing or has the wrong kind.");
                if (string.IsNullOrWhiteSpace(marker.WebSelector) || asset.transform.childCount == 0)
                    throw new Exception(pair.Key + " does not describe its web counterpart.");
                if (pair.Value == RoaUiPrefabKind.Hud && asset.GetComponent<RoaHudCanvas>() == null)
                    throw new Exception("RoaHud prefab has no adaptive Canvas owner.");
            }

            Texture2D frame = AssetDatabase.LoadAssetAtPath<Texture2D>(
                "Assets/Resources/RealmUi/player-name-panel-transparent.png");
            if (frame == null) throw new Exception("Canonical web HUD frame was not imported.");
            Texture2D mobileAttack = AssetDatabase.LoadAssetAtPath<Texture2D>(
                "Assets/Resources/RealmUi/mobile/right/attack.png");
            if (mobileAttack == null) throw new Exception("Canonical mobile UI art was not imported.");

            Debug.Log("[ROA PROBE] UI Prefab library OK: 24 prefabs, shared theme and canonical UI art.");
        }

        private static GameObject Load(string name)
        {
            string path = Directory + "/" + name + ".prefab";
            GameObject asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (asset == null) throw new Exception("UI prefab not found: " + path);
            return asset;
        }
    }
}
#endif
