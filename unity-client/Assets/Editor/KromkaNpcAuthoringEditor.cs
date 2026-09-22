#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Инспектор НПС: сведения из данных — только для чтения, облик и наряд —
    /// выпадающими списками. В списках наряда только вещи, которые есть и в
    /// каталоге сервера (data/kromka/items.json), и в моделях клиента: другое
    /// сервер не наденет или клиент не покажет. Правки идут через
    /// SerializedObject — с отменой и переопределением экземпляра префаба.
    /// </summary>
    [CustomEditor(typeof(KromkaNpcAuthoring))]
    internal sealed class KromkaNpcAuthoringEditor : UnityEditor.Editor
    {
        private static readonly string[] HairIds =
            { "shaved", "short_crop", "side_swept", "mohawk", "braids", "tied_back", "long", "buns" };
        private static readonly string[] WearableSlots = { "armor", "helmet", "boots", "backpack" };
        private static readonly Dictionary<string, string> SlotTitles = new Dictionary<string, string>
        {
            { "weapon", "Оружие" }, { "armor", "Броня" }, { "helmet", "Шлем" }, { "boots", "Ботинки" }, { "backpack", "Рюкзак" }
        };

        private static Dictionary<string, (string Id, string Name)[]> _options;

        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            EditorGUILayout.HelpBox("Живого НПС ставит сервер. Здесь правят, где он стоит, куда смотрит, как выглядит "
                + "и во что одет; экспорт сцены пишет это в его строку. Торговля, диалог и квесты — в данных.",
                MessageType.None);

            EditorGUILayout.LabelField("Кто это — из data", EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.PropertyField(serializedObject.FindProperty("_displayName"), new GUIContent("Имя"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("_role"), new GUIContent("Роль"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("_service"), new GUIContent("Служба"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("_faction"), new GUIContent("Фракция"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("_quests"), new GUIContent("Квесты"), true);
            }

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Облик", EditorStyles.boldLabel);
            EditorGUILayout.PropertyField(serializedObject.FindProperty("_sex"), new GUIContent("Пол"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("_build"), new GUIContent("Сложение"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("_face"), new GUIContent("Лицо"));
            Popup(serializedObject.FindProperty("_hairId"), "Причёска", HairIds.Select(id => (id, id)).ToArray());
            EditorGUILayout.PropertyField(serializedObject.FindProperty("_hairColor"), new GUIContent("Цвет волос"));

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Наряд", EditorStyles.boldLabel);
            Popup(serializedObject.FindProperty("_weapon"), SlotTitles["weapon"], Options("weapon"));
            foreach (string slot in WearableSlots)
                Popup(serializedObject.FindProperty("_" + slot), SlotTitles[slot], Options(slot));

            serializedObject.ApplyModifiedProperties();
        }

        private static void Popup(SerializedProperty property, string label, (string Id, string Name)[] options)
        {
            if (property == null) return;
            string current = property.stringValue ?? string.Empty;
            var list = options.ToList();
            // Значение не из каталога не прячем: его видно, и его можно заменить.
            if (!list.Any(option => option.Id == current))
                list.Insert(0, (current, "⚠ нет в каталоге: " + (current.Length > 0 ? current : "(пусто)")));
            int index = list.FindIndex(option => option.Id == current);
            int chosen = EditorGUILayout.Popup(label, index, list.Select(option => option.Name).ToArray());
            if (chosen != index && chosen >= 0) property.stringValue = list[chosen].Id;
        }

        /// <summary>Вещи слота: есть в каталоге сервера и есть модель у клиента.</summary>
        internal static (string Id, string Name)[] Options(string slot)
        {
            if (_options == null) _options = BuildOptions();
            return _options.TryGetValue(slot, out var rows) ? rows : Array.Empty<(string, string)>();
        }

        private static Dictionary<string, (string Id, string Name)[]> BuildOptions()
        {
            var result = new Dictionary<string, (string Id, string Name)[]>();
            string file = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "data", "kromka", "items.json"));
            JArray items = File.Exists(file) ? JObject.Parse(File.ReadAllText(file))["items"] as JArray : null;
            var bySlot = (items ?? new JArray()).OfType<JObject>()
                .Where(item => item["slot"] != null)
                .GroupBy(item => item["slot"].ToString())
                .ToDictionary(group => group.Key,
                    group => group.ToDictionary(item => item["id"].ToString(), item => item["name"]?.ToString() ?? string.Empty));

            var weaponModels = new HashSet<string>(AssetDatabase.FindAssets("t:Prefab weapon_", new[] { "Assets/Prefabs/Models/weapons" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(Path.GetFileNameWithoutExtension)
                .Where(name => name.StartsWith("weapon_", StringComparison.Ordinal))
                .Select(name => name.Substring("weapon_".Length)), StringComparer.Ordinal);
            var weapons = new List<(string, string)> { ("fists", "Кулаки (без оружия)") };
            if (bySlot.TryGetValue("weapon", out var weaponNames))
                weapons.AddRange(weaponNames.Where(pair => weaponModels.Contains(pair.Key))
                    .OrderBy(pair => pair.Value, StringComparer.CurrentCulture)
                    .Select(pair => (pair.Key, pair.Value + " (" + pair.Key + ")")));
            result["weapon"] = weapons.ToArray();

            foreach (string slot in WearableSlots)
            {
                var rows = new List<(string, string)> { (string.Empty, "— ничего —") };
                if (bySlot.TryGetValue(slot, out var names))
                    rows.AddRange(RoaEquipmentView.ItemIds(slot).Where(names.ContainsKey)
                        .OrderBy(id => names[id], StringComparer.CurrentCulture)
                        .Select(id => (id, names[id] + " (" + id + ")")));
                result[slot] = rows.ToArray();
            }
            return result;
        }
    }
}
#endif
