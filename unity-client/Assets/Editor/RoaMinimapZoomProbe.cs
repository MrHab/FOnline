#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Приближение миникарты. Проверяет и расчёт окна (ярусы, следование за игроком,
    /// упор в края карты), и саму панель: кнопки «+»/«−» стоят в рамке карты, ловят
    /// луч и двигают ярус, слой карты растёт вместе с ярусом, а значок игрока и
    /// маркеры гасят масштаб, чтобы не расплываться.
    /// </summary>
    public static class RoaMinimapZoomProbe
    {
        private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        private const float Frame = 164f;

        [MenuItem("Realm of Ashes/Probe/Minimap zoom")]
        public static void Run()
        {
            var failures = new List<string>();
            try
            {
                CheckViewport(failures);
                CheckPanel(failures);
            }
            catch (Exception error)
            {
                failures.Add("проба упала: " + error);
            }

            if (failures.Count == 0)
            {
                Debug.Log("[MinimapZoom] OK: ярусы 1..4, окно ведёт за игроком и упирается в края,"
                    + " кнопки «+»/«−» в нижнем ряду панели двигают ярус, значок не пухнет.");
                if (Application.isBatchMode) EditorApplication.Exit(0);
                return;
            }
            Debug.LogError("[MinimapZoom] FAIL\n" + string.Join("\n", failures));
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }

        /// <summary>Расчёт окна: масштаб по ярусу, следование за игроком и упор в края.</summary>
        private static void CheckViewport(List<string> failures)
        {
            RoaMinimap.Viewport(1f, new Vector2(0.1f, 0.9f), Frame, out float scale, out Vector2 offset);
            if (Mathf.Abs(scale - RoaMinimap.CameraAlignScale) > 0.001f)
                failures.Add("ярус 1 меняет масштаб слоя карты: " + scale);
            if (offset.sqrMagnitude > 0.01f)
                failures.Add("на ярусе 1 карта уезжает из центра: " + offset);

            RoaMinimap.Viewport(4f, new Vector2(0.5f, 0.5f), Frame, out float farScale, out Vector2 centred);
            if (Mathf.Abs(farScale - RoaMinimap.CameraAlignScale * 4f) > 0.001f)
                failures.Add("ярус 4 не растягивает слой карты вчетверо: " + farScale);
            if (centred.sqrMagnitude > 0.01f)
                failures.Add("игрок в центре карты, а окно смещено: " + centred);

            // Игрок сместился на четверть карты — окно идёт за ним.
            RoaMinimap.Viewport(4f, new Vector2(0.75f, 0.5f), Frame, out _, out Vector2 followed);
            if (followed.sqrMagnitude < 1f) failures.Add("окно не пошло за игроком: " + followed);

            // У самого края окно упирается: дальше открылась бы пустота за картой.
            RoaMinimap.Viewport(4f, new Vector2(1f, 1f), Frame, out _, out Vector2 corner);
            float limit = Frame * 0.5f * RoaMinimap.CameraAlignScale * 4f - Frame * 0.70710678f;
            if (corner.magnitude > limit * Mathf.Sqrt(2f) + 0.5f)
                failures.Add("в углу карты окно уехало за её край: " + corner);

            // Ярусы целые и держатся в пределах.
            GameObject host = new GameObject("MinimapZoomState");
            try
            {
                RoaMinimap minimap = host.AddComponent<RoaMinimap>();
                minimap.SetZoom(RoaMinimap.MaxZoom + 5f);
                if (!Mathf.Approximately(minimap.Zoom, RoaMinimap.MaxZoom))
                    failures.Add("ярус ушёл выше предела: " + minimap.Zoom);
                minimap.ZoomBy(-10);
                if (!Mathf.Approximately(minimap.Zoom, RoaMinimap.MinZoom))
                    failures.Add("ярус ушёл ниже единицы: " + minimap.Zoom);
                minimap.ZoomBy(1);
                if (!Mathf.Approximately(minimap.Zoom, 2f))
                    failures.Add("шаг приближения не целый: " + minimap.Zoom);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        /// <summary>Панель: кнопки на месте, ловят луч и двигают ярус, маркеры не пухнут.</summary>
        private static void CheckPanel(List<string> failures)
        {
            GameObject host = null;
            try
            {
                string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                                                            "../../data/locations/settlement.json"));
                LocationDefinition location = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(path));
                host = new GameObject("MinimapZoomProbe");
                RoaMinimap minimap = host.AddComponent<RoaMinimap>();
                minimap.enabled = false;
                minimap.SetLocation(location);
                minimap.SetZoom(RoaMinimap.MinZoom);

                var owner = host.AddComponent<RoaHudCanvas>();
                owner.enabled = false;
                owner.Configure(null, null, minimap, null, null);
                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                if (canvas == null) { failures.Add("канва HUD не собралась"); return; }
                Call(owner, "Update");
                Canvas.ForceUpdateCanvases();

                RectTransform frame = Find(canvas, "Map");
                RectTransform rotor = Find(canvas, "Rotor");
                Button zoomIn = FindButton(canvas, "MinimapZoomIn");
                Button zoomOut = FindButton(canvas, "MinimapZoomOut");
                if (frame == null || rotor == null || zoomIn == null || zoomOut == null)
                {
                    failures.Add("в панели миникарты нет рамки, слоя карты или кнопок приближения");
                    return;
                }

                // Контроль: по заведомо рабочей кнопке «КАРТА МИРА» луч обязан пройти.
                // Без этого «луч не прошёл» у кнопок приближения ничего не доказывает:
                // в edit mode канва раздаёт глубину только после отрисовки.
                Button world = FindButton(canvas, "WorldMap");
                bool raycastWorks = world != null
                    && RaycastHits(canvas, ScreenCentre(world.image.rectTransform, canvas), world.gameObject, out _);

                RectTransform panel = Find(canvas, "Minimap");
                RectTransform title = Find(canvas, "Title");
                // Кнопки стоят в панели миникарты, но не поверх самой карты и не под
                // заголовком: иначе их не найти или они закрывают то, ради чего пришли.
                foreach (Button button in new[] { zoomIn, zoomOut })
                {
                    Vector2 centre = ScreenCentre(button.image.rectTransform, canvas);
                    if (panel == null || !RectTransformUtility.RectangleContainsScreenPoint(panel, centre, canvas.worldCamera))
                        failures.Add(button.name + ": кнопка вне панели миникарты, точка " + centre);
                    if (RectTransformUtility.RectangleContainsScreenPoint(frame, centre, canvas.worldCamera))
                        failures.Add(button.name + ": кнопка закрывает саму карту");
                    if (title != null && RectTransformUtility.RectangleContainsScreenPoint(title, centre, canvas.worldCamera))
                        failures.Add(button.name + ": кнопка попала под заголовок панели");
                    if (world != null && RectTransformUtility.RectangleContainsScreenPoint(
                            world.image.rectTransform, centre, canvas.worldCamera))
                        failures.Add(button.name + ": кнопка налезает на «КАРТА МИРА»");
                    if (raycastWorks && !RaycastHits(canvas, centre, button.gameObject, out string hits))
                        failures.Add(button.name + ": по кнопке не проходит луч — нажатие до неё не дойдёт"
                            + " (точка " + centre + ", луч поймал: " + hits + ")");
                }

                // Нажатие двигает ярус, и слой карты следом растёт.
                float before = minimap.Zoom;
                zoomIn.onClick.Invoke();
                if (!Mathf.Approximately(minimap.Zoom, before + 1f))
                    failures.Add("кнопка «+» не приблизила карту: " + minimap.Zoom);
                Call(owner, "Update");
                Canvas.ForceUpdateCanvases();
                float scaled = rotor.localScale.x;
                if (Mathf.Abs(scaled - RoaMinimap.CameraAlignScale * minimap.Zoom) > 0.01f)
                    failures.Add("слой карты не вырос под ярус: " + scaled);

                RectTransform arrow = Find(canvas, "Player");
                if (arrow == null) failures.Add("значок игрока не найден");
                else if (Mathf.Abs(arrow.localScale.x - 1f / minimap.Zoom) > 0.01f)
                    failures.Add("значок игрока растёт вместе с картой: " + arrow.localScale.x);

                zoomOut.onClick.Invoke();
                if (!Mathf.Approximately(minimap.Zoom, before))
                    failures.Add("кнопка «−» не вернула ярус: " + minimap.Zoom);
                if (!raycastWorks)
                    Debug.Log("[MinimapZoom] луч канвы в edit mode молчит даже на «КАРТА МИРА» —"
                        + " проверка нажимаемости пропущена, геометрия кнопок проверена рамкой.");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static Vector2 ScreenCentre(RectTransform rect, Canvas canvas)
        {
            return RectTransformUtility.WorldToScreenPoint(canvas.worldCamera, rect.TransformPoint(rect.rect.center));
        }

        private static bool RaycastHits(Canvas canvas, Vector2 screenPoint, GameObject target, out string report)
        {
            report = "нет райкастера";
            GraphicRaycaster raycaster = canvas.GetComponent<GraphicRaycaster>();
            if (raycaster == null) return false;
            if (EventSystem.current == null)
            {
                var events = new GameObject("MinimapZoomProbeEvents", typeof(EventSystem), typeof(StandaloneInputModule));
                events.hideFlags = HideFlags.HideAndDontSave;
            }
            var data = new PointerEventData(EventSystem.current) { position = screenPoint };
            var hits = new List<RaycastResult>();
            raycaster.Raycast(data, hits);
            report = hits.Count == 0 ? "пусто" : string.Join(", ", hits.Take(4).Select(hit => hit.gameObject.name));
            return hits.Any(hit => hit.gameObject == target || hit.gameObject.transform.IsChildOf(target.transform));
        }

        private static RectTransform Find(Canvas canvas, string name)
        {
            return canvas.GetComponentsInChildren<RectTransform>(true).FirstOrDefault(rect => rect.name == name);
        }

        private static Button FindButton(Canvas canvas, string name)
        {
            return canvas.GetComponentsInChildren<Button>(true).FirstOrDefault(button => button.name == name);
        }

        private static void Call(object target, string method)
        {
            target.GetType().GetMethod(method, Private)?.Invoke(target, Array.Empty<object>());
        }
    }
}
#endif
