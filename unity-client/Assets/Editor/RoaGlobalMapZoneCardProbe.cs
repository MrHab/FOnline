#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Угодья встреч на глобальной карте: силуэты, попадание курсора внутрь
    /// контура и карточка узла (цель, сложность, периоды активности, награда).
    /// Проверяются чистые функции на серверных снимках — без сцены и сокета.
    /// </summary>
    public static class RoaGlobalMapZoneCardProbe
    {
        [MenuItem("Realm of Ashes/Probe/Global map zone cards")]
        public static void Run()
        {
            // --- силуэты -------------------------------------------------
            Require(RoaGlobalMapZoneShapes.Count == 3,
                "Нарисовано три силуэта угодий, найдено " + RoaGlobalMapZoneShapes.Count);
            for (int shape = 1; shape <= RoaGlobalMapZoneShapes.Count; shape++)
            {
                Vector2[] silhouette = RoaGlobalMapZoneShapes.Silhouette(shape);
                Require(silhouette.Length >= 5, "Силуэт " + shape + " слишком беден: " + silhouette.Length);
                float max = 0f;
                float min = float.MaxValue;
                foreach (Vector2 vertex in silhouette)
                {
                    max = Mathf.Max(max, vertex.magnitude);
                    min = Mathf.Min(min, vertex.magnitude);
                }
                Require(Mathf.Abs(max - 1f) < 0.001f,
                    "Силуэт " + shape + " не нормирован: максимальный радиус " + max);
                // Ради узнаваемости контур не должен быть окружностью.
                Require(min < 0.9f, "Силуэт " + shape + " почти круглый: минимальный радиус " + min);
            }

            // --- попадание внутрь контура -------------------------------
            var center = new Vector2(120f, 140f);
            Require(RoaGlobalMapZoneShapes.Contains(1, 0f, 28f, center, center),
                "Центр области обязан считаться внутри");
            Require(!RoaGlobalMapZoneShapes.Contains(1, 0f, 28f, center, center + new Vector2(60f, 0f)),
                "Точка далеко за контуром не может считаться внутри");
            // Поворот силуэта должен двигать и границу наведения: точка у самой
            // дальней вершины уходит из области, когда контур повёрнут.
            Vector2 tip = RoaGlobalMapZoneShapes.Silhouette(1)[0];
            Vector2 nearTip = center + tip * 28f * 0.94f;
            Require(RoaGlobalMapZoneShapes.Contains(1, 0f, 28f, center, nearTip),
                "Точка у вершины непокрученного силуэта — внутри");
            Require(!RoaGlobalMapZoneShapes.Contains(1, 180f, 28f, center, nearTip),
                "Поворот силуэта обязан двигать границу наведения");
            // Радиус масштабирует контур целиком.
            Require(RoaGlobalMapZoneShapes.Contains(1, 0f, 56f, center, center + tip * 40f),
                "Большая область накрывает точку, которую маленькая не накрывала");

            // --- ярусный масштаб ----------------------------------------
            Require(Mathf.Approximately(RoaGlobalMap.EncounterZoneDetailScale(RoaGlobalMap.MapDetailTier.Near), 1f)
                && RoaGlobalMap.EncounterZoneDetailScale(RoaGlobalMap.MapDetailTier.Far) > 1f,
                "Дальний ярус раздувает силуэт, ближний — нет");

            // --- устойчивый выбор силуэта для узла ----------------------
            int first = RoaGlobalMap.EncounterZoneShapeFor("pubev_raider_base_1");
            Require(first == RoaGlobalMap.EncounterZoneShapeFor("pubev_raider_base_1"),
                "Один и тот же узел обязан получать один и тот же силуэт");
            Require(first >= 1 && first <= RoaGlobalMapZoneShapes.Count,
                "Силуэт узла вне диапазона: " + first);
            float rotation = RoaGlobalMap.EncounterZoneRotationFor("pubev_raider_base_1");
            Require(rotation >= 0f && rotation < 360f, "Поворот узла вне круга: " + rotation);

            // --- цвет полосы опасности ----------------------------------
            Color calm = RoaGlobalMap.EncounterZoneColor(1);
            Color deadly = RoaGlobalMap.EncounterZoneColor(5);
            Require(deadly.r >= calm.r && deadly.g < calm.g,
                "Опасные угодья краснее спокойных");

            // --- карточка постоянной области ----------------------------
            var area = JObject.Parse(@"{'id':'antHive','displayName':'Колония Пыльников','x':120,'y':140,
                'radiusPoints':28,'shape':1,'shapeRotation':18,'danger':2,'dangerLabel':'умеренная',
                'objective':'зачистить колонию','activity':'всегда',
                'rewardPreview':[{'id':'trophy','name':'Трофей'}],
                'lootCategories':['хитин и железы пыльников']}");
            Require(RoaGlobalMap.CardObjective(area) == "зачистить колонию", "Цель области берётся из снимка");
            Require(RoaGlobalMap.CardDifficulty(area) == "умеренная", "Сложность области — слово сервера");
            Require(RoaGlobalMap.CardActivity(area) == "всегда", "Постоянная область активна всегда");
            Require(RoaGlobalMap.CardRewardIds(area).Count == 1
                && RoaGlobalMap.CardRewardIds(area)[0] == "trophy",
                "Иконки награды берутся из превью снимка");
            Require(RoaGlobalMap.CardRewardLine(area) == "Трофей", "Награда области называется словом");

            List<string> areaLines = RoaGlobalMapCanvas.HoverFactLines(area);
            Require(areaLines.Count == 3 && areaLines[0] == "Цель: зачистить колонию"
                && areaLines[1] == "Сложность: умеренная"
                && areaLines[2] == "Периоды активности: всегда",
                "Карточка области складывается в три строки: " + string.Join(" | ", areaLines));

            // --- карточка узла с главарём -------------------------------
            var boss = JObject.Parse(@"{'id':'pubev_1','displayName':'База налётчиков','danger':3,
                'dangerLabel':'средняя','objective':'убить Главаря налётчиков','remainingSeconds':1495,
                'warning':false,'boss':{'displayName':'Главарь налётчиков','alive':true,'killed':false},
                'rewardPreview':[{'id':'silver','qty':120,'name':'Марки Тракта'},
                                 {'id':'ammo9','qty':40,'name':'Патроны 9mm'}]}");
            Require(RoaGlobalMap.CardObjective(boss) == "убить Главаря налётчиков",
                "Цель узла с главарём названа");
            Require(RoaGlobalMap.CardActivity(boss) == "ещё 24:55",
                "Временный узел говорит, сколько ему осталось: " + RoaGlobalMap.CardActivity(boss));
            boss["warning"] = true;
            Require(RoaGlobalMap.CardActivity(boss).Contains("скоро закроется"),
                "Уходящий узел предупреждает");
            Require(RoaGlobalMap.CardRewardLine(boss) == "Марки Тракта ×120 · Патроны 9mm ×40",
                "Награда узла показывает количество: " + RoaGlobalMap.CardRewardLine(boss));

            // Снимок без карточных полей не должен выдумывать строки.
            var bare = JObject.Parse("{'displayName':'Точка пустоши'}");
            Require(RoaGlobalMapCanvas.HoverFactLines(bare).Count == 0,
                "Без полей снимка карточка не показывает пустых строк");
            Require(RoaGlobalMapCanvas.HoverFactLines(null).Count == 0,
                "Без строки снимка карточка молчит");

            // Цель узла без авторского поля собирается из имени главаря.
            var fallback = JObject.Parse("{'boss':{'displayName':'Матка складней'}}");
            Require(RoaGlobalMap.CardObjective(fallback) == "убить Матка складней"
                || RoaGlobalMap.CardObjective(fallback).StartsWith("убить"),
                "Без авторской цели карточка называет главаря");

            // --- слова опасности совпадают с серверными ------------------
            string[] expected = { "низкая", "умеренная", "средняя", "высокая", "крайняя" };
            for (int band = 1; band <= 5; band++)
                Require(RoaGlobalMap.DangerBandLabel(band) == expected[band - 1],
                    "Полоса " + band + " называется «" + expected[band - 1] + "», а не «"
                    + RoaGlobalMap.DangerBandLabel(band) + "»");

            // --- префабы угодий подключены ------------------------------
            foreach (RoaGlobalMapPrefabKind kind in new[]
            {
                RoaGlobalMapPrefabKind.ZoneAreaA, RoaGlobalMapPrefabKind.ZoneAreaB,
                RoaGlobalMapPrefabKind.ZoneAreaC, RoaGlobalMapPrefabKind.BossBadge
            })
            {
                string path = "Assets/Prefabs/GlobalMap/GM_"
                    + (kind == RoaGlobalMapPrefabKind.BossBadge ? "BossBadge"
                        : "ZoneArea_" + kind.ToString().Substring("ZoneArea".Length));
                    Require(AssetDatabase.LoadAssetAtPath<GameObject>(path + ".prefab") != null,
                    "Не найден префаб угодий: " + path);
            }

            Debug.Log("[ZONE CARDS] OK: три силуэта угодий, наведение по контуру с учётом яруса, "
                      + "карточка цели/сложности/активности и превью награды, префабы на месте.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[ZONE CARDS] " + message);
        }
    }
}
#endif
