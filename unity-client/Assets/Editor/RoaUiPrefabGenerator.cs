#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Собирает редактируемую Prefab-библиотеку из канонической
    /// структуры web UI. Сама игровая логика остаётся в презентерах,
    /// а вид и композицию можно развивать через обычные Unity Prefabs.
    /// </summary>
    public static class RoaUiPrefabGenerator
    {
        public const string PrefabDirectory = "Assets/Resources/RealmUi/Prefabs";
        private const string RootPrefabPath = PrefabDirectory + "/RoaUiRoot.prefab";

        private sealed class Spec
        {
            public readonly string Name;
            public readonly RoaUiPrefabKind Kind;
            public readonly string Selector;
            public readonly string Purpose;
            public readonly string[] Nodes;

            public Spec(string name, RoaUiPrefabKind kind, string selector, string purpose,
                        params string[] nodes)
            {
                Name = name;
                Kind = kind;
                Selector = selector;
                Purpose = purpose;
                Nodes = nodes;
            }
        }

        private static readonly Spec[] Specs =
        {
            new Spec("RoaLoadingScreen", RoaUiPrefabKind.LoadingScreen, "#location-loading-screen",
                "Переход между локациями: заголовок, прогресс, текущий шаг и подсказка.",
                "Kicker", "Title", "Subtitle", "Progress", "Step", "Hint"),
            new Spec("RoaAuthScreen", RoaUiPrefabKind.AuthScreen, "#character-screen",
                "Вход, регистрация, восстановление, выбор и создание персонажа.",
                "Backdrop", "CharacterCard", "Header", "AuthForm", "Actions", "Status", "CharacterPreview"),
            new Spec("RoaCharacterCreator", RoaUiPrefabKind.CharacterCreator, "#character-creator-panel",
                "Внешность, SPECIAL, навыки, перки, производные параметры и 3D-предпросмотр.",
                "ModelPreview", "Appearance", "Special", "TagSkills", "Traits", "DerivedStats", "Actions", "Error"),
            new Spec("RoaHud", RoaUiPrefabKind.Hud, "#ui-overlay",
                "Кадр игрока, HP/AP, мини-карта, системный журнал и оружейная сводка.",
                "PlayerFrame", "Vitals", "Minimap", "SystemLog", "WeaponReadout", "InteractionPrompt"),
            new Spec("RoaMinimap", RoaUiPrefabKind.Minimap, "#desktop-minimap-hud",
                "Локальная мини-карта, компас, игрок, NPC, объекты и маркеры задания.",
                "Viewport", "Compass", "PlayerMarker", "ActorMarkers", "ObjectMarkers", "QuestMarkers"),
            new Spec("RoaSystemLog", RoaUiPrefabKind.SystemLog, "#system-log-panel",
                "Сворачиваемый системный канал и сетевые уведомления.",
                "Header", "Toggle", "MessageList"),
            new Spec("RoaQuickbar", RoaUiPrefabKind.Quickbar, "#quickbar",
                "Восемь слотов, количество, выбор и кольцо быстрого доступа.",
                "Slot1", "Slot2", "Slot3", "Slot4", "Slot5", "Slot6", "Slot7", "Slot8", "RadialWheel"),
            new Spec("RoaPipboy", RoaUiPrefabKind.Pipboy, ".pipboy-window",
                "PIP-ASH: статус, предметы, навыки, перки, крафт, задания, мир и социальные вкладки.",
                "Title", "Topline", "Tabs", "StatusPage", "ItemsPage", "SkillsPage", "PerksPage",
                "CraftPage", "QuestsPage", "WorldPage", "FactionsPage", "FriendsPage", "ClanPage", "RadioPage"),
            new Spec("RoaProgressionWindow", RoaUiPrefabKind.Progression, "#talents-window",
                "SPECIAL, навыки, очки навыков и круговое древо перков.",
                "SpecialSummary", "SkillGrid", "PerkGrid", "PerkWheel", "PerkInfo", "Actions"),
            new Spec("RoaCraftWindow", RoaUiPrefabKind.Crafting, "#craft-window",
                "Список рецептов, ингредиенты, результат и запуск создания предмета.",
                "Header", "CategoryTabs", "RecipeGrid", "Ingredients", "Result", "CraftAction"),
            new Spec("RoaLocalMapWindow", RoaUiPrefabKind.LocalMap, "#map-window",
                "Карта текущей локации с авторскими объектами, игроком и NPC.",
                "Header", "MapViewport", "Compass", "Legend", "Close"),
            new Spec("RoaModalWindow", RoaUiPrefabKind.ModalWindow, ".modal-panel",
                "Общий каркас диалогов, торговли, хранилища, лута, крафта и меню.",
                "Dimmer", "Panel", "Header", "ScrollContent", "PrimaryActions", "Close"),
            new Spec("RoaSettingsMenu", RoaUiPrefabKind.Settings, "#game-settings-panel",
                "Смена персонажа, выход, HUD, графика и переходы системного меню.",
                "Header", "SwitchCharacter", "Logout", "EditHud", "ResetHud", "Graphics", "Close"),
            new Spec("RoaTutorialWindow", RoaUiPrefabKind.Tutorial, "#tutorial-window",
                "Обучение и контекстные подсказки для управления и игровых систем.",
                "Header", "TopicList", "Article", "Close"),
            new Spec("RoaQuantityDialog", RoaUiPrefabKind.QuantityDialog, "#quantity-side-panel",
                "Выбор количества для переноса, торговли и разделения стопки.",
                "Title", "Value", "Slider", "Confirm", "Cancel"),
            new Spec("RoaLootWindow", RoaUiPrefabKind.LootWindow, "#loot-window",
                "Обыск контейнера или тела, сетка предметов и действие «Забрать всё».",
                "Header", "LootGrid", "TakeAll", "Close"),
            new Spec("RoaBarterWindow", RoaUiPrefabKind.BarterWindow, "#trader-window",
                "Двухсторонний бартер: рюкзак, товары торговца, корзины и итог.",
                "Header", "PlayerCategories", "PlayerItems", "PlayerOffer", "Summary",
                "VendorOffer", "VendorCategories", "VendorItems", "Confirm", "Close"),
            new Spec("RoaStorageWindow", RoaUiPrefabKind.StorageWindow, "#storage-window",
                "Рюкзак и хранилище с категориями, сортировкой и массовым переносом.",
                "Header", "InventoryCategories", "InventoryGrid", "StorageCategories", "StorageGrid",
                "PutAll", "TakeAll", "Close"),
            new Spec("RoaGraphicsWindow", RoaUiPrefabKind.GraphicsWindow, "#graphics-window",
                "Пресеты качества, текущий режим и применение настроек графики.",
                "Header", "CurrentMode", "Low", "Medium", "High", "Ultra", "Close"),
            new Spec("RoaPauseScreen", RoaUiPrefabKind.PauseScreen, "#pause-screen",
                "Полноэкранная пауза и возврат в игру.",
                "Backdrop", "Brand", "Continue", "Settings", "Logout"),
            new Spec("RoaContextMenu", RoaUiPrefabKind.ContextMenu, "#item-context-menu",
                "Контекстные действия предмета и общая всплывающая подсказка.",
                "Tooltip", "ActionList", "PrimaryAction", "SecondaryActions"),
            new Spec("RoaGlobalMapHud", RoaUiPrefabKind.GlobalMap, "#global-map-window",
                "Полноэкранная глобальная карта, панель точки, маршрут и встречи.",
                "MapViewport", "TerritoryOverlay", "Cursor", "LocationPanel", "RoutePanel", "EncounterPanel"),
            new Spec("RoaMobileControls", RoaUiPrefabKind.MobileControls, ".touch-buttons",
                "Landscape HUD: джойстик, область прицела, огонь, действие, перезарядка и панели.",
                "MoveZone", "Joystick", "AimZone", "Fire", "Interact", "Reload", "Mode", "Menu", "LeftRail", "RightRail")
        };

        [InitializeOnLoadMethod]
        private static void ScheduleInitialBuild()
        {
            EditorApplication.delayCall += BuildIfMissing;
        }

        private static void BuildIfMissing()
        {
            if (EditorApplication.isCompiling || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                EditorApplication.delayCall += BuildIfMissing;
                return;
            }
            if (AssetDatabase.LoadAssetAtPath<GameObject>(RootPrefabPath) == null) Build();
        }

        [MenuItem("Realm of Ashes/Собрать UI Prefabs")]
        public static void Build()
        {
            EnsureDirectory(PrefabDirectory);
            var paths = new List<string>();
            foreach (Spec spec in Specs) paths.Add(CreateTemplate(spec));

            var root = new GameObject("RoaUiRoot");
            try
            {
                root.AddComponent<RoaUiTheme>();
                RoaUiPrefabTemplate marker = root.AddComponent<RoaUiPrefabTemplate>();
                marker.Kind = RoaUiPrefabKind.Root;
                marker.WebSelector = "#game-container";
                marker.Purpose = "Runtime-корень темы и всех редактируемых UI-шаблонов.";

                foreach (string path in paths)
                {
                    GameObject asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                    if (asset == null) throw new InvalidOperationException("Prefab not found: " + path);
                    GameObject child = PrefabUtility.InstantiatePrefab(asset) as GameObject;
                    if (child == null) throw new InvalidOperationException("Cannot instantiate: " + path);
                    child.transform.SetParent(root.transform, false);
                    child.SetActive(false);
                }

                PrefabUtility.SaveAsPrefabAsset(root, RootPrefabPath);
                Debug.Log("[ROA UI PREFABS] готово: " + RootPrefabPath + " + " + paths.Count + " шаблонов");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }

        private static string CreateTemplate(Spec spec)
        {
            var root = new GameObject(spec.Name);
            try
            {
                RoaUiPrefabTemplate marker = root.AddComponent<RoaUiPrefabTemplate>();
                marker.Kind = spec.Kind;
                marker.WebSelector = spec.Selector;
                marker.Purpose = spec.Purpose;
                if (spec.Kind == RoaUiPrefabKind.Hud) root.AddComponent<RoaHudCanvas>();
                foreach (string nodeName in spec.Nodes)
                {
                    var node = new GameObject(nodeName);
                    node.transform.SetParent(root.transform, false);
                }

                string path = PrefabDirectory + "/" + spec.Name + ".prefab";
                PrefabUtility.SaveAsPrefabAsset(root, path);
                return path;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void EnsureDirectory(string assetPath)
        {
            string[] parts = assetPath.Split('/');
            string current = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[i]);
                current = next;
            }
        }
    }
}
#endif
