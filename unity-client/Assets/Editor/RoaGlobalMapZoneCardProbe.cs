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

            // --- путь сквозь угодья --------------------------------------
            // Отряд встречают там, где он вошёл в контур, а не в описанной
            // окружности: иначе встреча приходила бы за километры от границы.
            var route = JObject.Parse(@"{'id':'antHive','locationId':'antHive','x':120,'y':140,
                'radiusPoints':28,'shape':1,'shapeRotation':0,'danger':2}");
            var inside = new GlobalMapPoint { X = 120f, Y = 140f };
            var far = new GlobalMapPoint { X = 320f, Y = 260f };
            var aside = new GlobalMapPoint { X = 320f, Y = 140f };
            Require(RoaGlobalMap.RouteEntersArea(route, far, inside),
                "Маршрут, упирающийся в центр угодий, входит в контур");
            Require(!RoaGlobalMap.RouteEntersArea(route, far, aside),
                "Маршрут мимо угодий контур не задевает");
            Require(!RoaGlobalMap.RouteEntersArea(
                    JObject.Parse("{'x':120,'y':140,'radiusPoints':28,'shape':0}"), far, inside),
                "Без силуэта путь не может войти в контур");
            Require(!RoaGlobalMap.RouteEntersArea(null, far, inside) && !RoaGlobalMap.RouteEntersArea(route, null, inside),
                "Пустая область или пустой отрезок не ломают проверку");
            // Доля пути нужна, чтобы из нескольких встреч на шаге выбралась
            // ближняя: контакт обязан случиться там, где маршрут вошёл.
            float entry = RoaGlobalMap.RouteEntryFraction(route, far, inside);
            Require(entry > 0f && entry <= 1f, "Вход в угодья приходится на сам отрезок: " + entry);
            Require(RoaGlobalMap.RouteEntryFraction(route, far, aside) < 0f,
                "Маршрут мимо угодий доли входа не имеет");
            // Отряд, уже стоящий внутри контура, не получает предложение снова:
            // иначе карта звала бы войти туда, где отряд уже идёт.
            Require(RoaGlobalMap.PointInsideArea(route, inside)
                && !RoaGlobalMap.PointInsideArea(route, aside),
                "Проверка «уже внутри» обязана различать центр угодий и точку мимо них");
            // Путь и рисунок обязаны совпадать на каждом ярусе: презентация
            // раздувает силуэт, и встреча должна ждать на видимой кромке.
            Vector2 rim = RoaGlobalMapZoneShapes.Silhouette(1)[0] * 28f * 1.1f;
            var beyondRim = new GlobalMapPoint { X = 120f + rim.x, Y = 140f + rim.y };
            Require(!RoaGlobalMap.PointInsideArea(route, beyondRim, 1f),
                "За кромкой ближнего яруса точка вне угодий");
            Require(RoaGlobalMap.PointInsideArea(route, beyondRim,
                    RoaGlobalMap.EncounterZoneDetailScale(RoaGlobalMap.MapDetailTier.Far)),
                "На дальнем ярусе раздутая кромка накрывает ту же точку — путь считает по ней же");

            // --- встреча в угодьях — шанс, а не гарантия ----------------
            // Путь копится: на каждые 8 точек один бросок. Меньше шага — ни
            // одного броска, сколько бы кадров ни прошло.
            float after;
            Require(RoaGlobalMap.GroundsChanceFraction(0f, 7.9f, 8f, 1f, () => 0f, out after) < 0f
                && Mathf.Approximately(after, 7.9f),
                "Меньше шага пути — броска нет, путь копится: " + after);
            // Покадровые шаги дают тот же итог, что и один длинный: частота не
            // зависит от FPS.
            float walked = 0f;
            int fired = 0;
            for (int frame = 0; frame < 400; frame++)
            {
                if (RoaGlobalMap.GroundsChanceFraction(walked, 0.1f, 8f, 1f, () => 0f, out walked) >= 0f) fired++;
            }
            Require(fired == 5, "40 точек мелкими шагами — ровно пять бросков по 8, выпало " + fired);
            // Неудачный бросок встречи не даёт, но путь не теряется.
            Require(RoaGlobalMap.GroundsChanceFraction(6f, 4f, 8f, 0.2f, () => 0.9f, out after) < 0f
                && Mathf.Approximately(after, 2f),
                "Промах сохраняет остаток пути: " + after);
            // Удачный бросок срабатывает там, где набран шаг, и обнуляет путь.
            float hit = RoaGlobalMap.GroundsChanceFraction(6f, 4f, 8f, 0.2f, () => 0.1f, out after);
            Require(Mathf.Approximately(hit, 0.5f) && after == 0f,
                "Встреча выпадает на набранном шаге (доля 0.5) и обнуляет путь: " + hit + " / " + after);
            // Нулевой шанс не даёт встреч никогда, скачок снимка — не лавину бросков.
            Require(RoaGlobalMap.GroundsChanceFraction(0f, 1000f, 8f, 0f, () => 0f, out after) < 0f,
                "Нулевой шанс — никогда");
            int rolls = 0;
            RoaGlobalMap.GroundsChanceFraction(0f, 1000f, 8f, 0.2f, () => { rolls++; return 0.99f; }, out after);
            Require(rolls <= 16, "Скачок на 1000 точек не выкатывает больше 16 бросков: " + rolls);

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
            Require(areaLines.Count == 4 && areaLines[0] == "Цель: зачистить колонию"
                && areaLines[1] == "Сложность: умеренная"
                && areaLines[2] == "Периоды активности: всегда"
                && areaLines[3].StartsWith("Добыча: "),
                "Карточка области складывается в четыре строки: " + string.Join(" | ", areaLines));

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

            // Обычная точка мира носит своё `danger` для симуляции — карточка
            // не смеет печатать ей «Сложность».
            var site = JObject.Parse("{'id':'klimAmmoWorks','displayName':'Патронный двор','danger':2,'type':'outpost'}");
            Require(RoaGlobalMap.CardRow(site) == null,
                "Строка обычной точки не наполняет карточку узла");
            Require(RoaGlobalMap.CardRow(area) != null && RoaGlobalMap.CardRow(boss) != null,
                "Строки угодий и узла с главарём карточку наполняют");

            // Категории добычи объясняют, ради чего идти в угодья, когда в
            // таблице дропа стоят одни трофеи.
            Require(RoaGlobalMap.CardLootCategories(area) == "хитин и железы пыльников",
                "Категории добычи области попадают в карточку: " + RoaGlobalMap.CardLootCategories(area));
            Require(RoaGlobalMapCanvas.HoverFactLines(area).Count == 4,
                "У области четыре строки: цель, сложность, активность и добыча");

            // Длинная строка обрезается, а не выезжает за правый край карточки.
            string longLine = RoaGlobalMapCanvas.HoverFactLine("Цель",
                "зачистить очень длинное название угодий, которое не влезает в карточку");
            Require(longLine.Length <= RoaGlobalMapCanvas.HoverFactMaxChars && longLine.EndsWith("…"),
                "Длинный факт обрезан многоточием: " + longLine);
            Require(RoaGlobalMapCanvas.HoverFactLine("Цель", "зачистить колонию") == "Цель: зачистить колонию",
                "Короткий факт не трогается");

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

            Debug.Log("[ZONE CARDS] OK: три силуэта угодий, наведение и путь по контуру, шанс встречи за пройденный путь, "
                      + "карточка цели/сложности/активности/добычи и превью награды, префабы на месте.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[ZONE CARDS] " + message);
        }
    }
}
#endif
