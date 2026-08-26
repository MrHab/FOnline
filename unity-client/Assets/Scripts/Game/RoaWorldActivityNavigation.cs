using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaWorldActivityCanvas
    {
        private GameObject _navigationRoot;
        private RectTransform _navigationArrow;
        private Text _navigationLabel;
        private Image _navigationStripe;
        private string _navigationText = string.Empty;

        public int ActiveObjectiveMarkerCount
        {
            get { return _markerRoot != null ? _markerRoot.transform.childCount : 0; }
        }

        public string NavigationText { get { return _navigationText; } }

        public static float CalculateNavigationArrowAngle(Vector3 direction, Vector3 cameraRight, Vector3 cameraScreenUp)
        {
            direction.y = 0f;
            cameraRight.y = 0f;
            cameraScreenUp.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) return 0f;
            if (cameraRight.sqrMagnitude < 0.0001f) cameraRight = Vector3.right;
            if (cameraScreenUp.sqrMagnitude < 0.0001f) cameraScreenUp = Vector3.forward;
            direction.Normalize();
            cameraRight.Normalize();
            cameraScreenUp.Normalize();
            float horizontal = Vector3.Dot(direction, cameraRight);
            float vertical = Vector3.Dot(direction, cameraScreenUp);
            return -Mathf.Atan2(horizontal, vertical) * Mathf.Rad2Deg;
        }

        public static string NavigationDistanceLabel(string label, float distance, bool inReach)
        {
            string prefix = string.IsNullOrEmpty(label) ? "ЦЕЛЬ" : label.ToUpperInvariant();
            return inReach ? prefix + " · ДОСТУПНО" : prefix + " · " + Mathf.CeilToInt(Mathf.Max(0f, distance)) + " М";
        }

        private void BuildActivityNavigation(Transform canvasRoot)
        {
            if (_navigationRoot != null || canvasRoot == null) return;
            _navigationRoot = new GameObject("WorldActivityNavigation", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform rect = (RectTransform)_navigationRoot.transform;
            rect.SetParent(canvasRoot, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 1f);
            rect.pivot = new Vector2(0.5f, 1f);
            rect.anchoredPosition = new Vector2(0f, -282f);
            rect.sizeDelta = new Vector2(340f, 36f);
            Image navigationBackground = _navigationRoot.GetComponent<Image>();
            navigationBackground.color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.93f);
            navigationBackground.raycastTarget = false;
            Outline outline = _navigationRoot.GetComponent<Outline>();
            outline.effectColor = Border;
            outline.effectDistance = new Vector2(1f, -1f);

            RectTransform stripe = Child("NavigationStripe", rect);
            stripe.anchorMin = new Vector2(0f, 0f);
            stripe.anchorMax = new Vector2(0f, 1f);
            stripe.pivot = new Vector2(0f, 0.5f);
            stripe.offsetMin = Vector2.zero;
            stripe.offsetMax = new Vector2(4f, 0f);
            _navigationStripe = stripe.gameObject.AddComponent<Image>();
            _navigationStripe.color = Accent;
            _navigationStripe.raycastTarget = false;

            Text arrow = Label("NavigationArrow", rect, 18, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            _navigationArrow = arrow.rectTransform;
            _navigationArrow.anchorMin = _navigationArrow.anchorMax = new Vector2(0f, 0.5f);
            _navigationArrow.pivot = new Vector2(0.5f, 0.5f);
            _navigationArrow.anchoredPosition = new Vector2(23f, 0f);
            _navigationArrow.sizeDelta = new Vector2(30f, 30f);
            arrow.text = "▲";

            _navigationLabel = Label("NavigationLabel", rect, 11, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(_navigationLabel.rectTransform, 45f, -31f, -10f, -5f);
            _navigationRoot.SetActive(false);
        }

        private void HideActivityNavigation()
        {
            _navigationText = string.Empty;
            if (_navigationRoot != null) _navigationRoot.SetActive(false);
        }

        private void RefreshActivityNavigation()
        {
            if (_navigationRoot == null || _root == null || !_root.activeSelf || Bootstrap?.PlayerView == null)
            {
                HideActivityNavigation();
                return;
            }

            if (!TryActivityNavigationTarget(out Vector3 target, out float reach, out string label, out Color color))
            {
                HideActivityNavigation();
                return;
            }

            Vector3 player = Bootstrap.PlayerView.transform.position;
            Vector3 delta = target - player;
            delta.y = 0f;
            float distance = delta.magnitude;
            bool inReach = distance <= Mathf.Max(0.5f, reach);
            _navigationText = NavigationDistanceLabel(label, distance, inReach);
            _navigationLabel.text = _navigationText;
            _navigationLabel.color = inReach ? Safe : Ink;
            _navigationStripe.color = color;
            Text arrowText = _navigationArrow != null ? _navigationArrow.GetComponent<Text>() : null;
            if (arrowText != null) arrowText.color = color;

            Camera camera = Camera.main;
            Vector3 right = camera != null ? Vector3.ProjectOnPlane(camera.transform.right, Vector3.up) : Vector3.right;
            Vector3 screenUp = camera != null ? Vector3.ProjectOnPlane(camera.transform.up, Vector3.up) : Vector3.forward;
            _navigationArrow.localEulerAngles = new Vector3(0f, 0f, CalculateNavigationArrowAngle(delta, right, screenUp));
            _navigationRoot.SetActive(true);
        }

        private bool TryActivityNavigationTarget(out Vector3 target, out float reach, out string label, out Color color)
        {
            target = Vector3.zero;
            reach = 2.8f;
            label = "ЦЕЛЬ";
            color = Accent;
            if (_activity == null || Bootstrap?.PlayerView == null) return false;

            string activityStatus = _activity["status"]?.ToString() ?? string.Empty;
            if (activityStatus != "active" && activityStatus != "extracting") return false;
            string kind = _activity["kind"]?.ToString() ?? string.Empty;
            bool extractionOpen = _activity["extractionOpen"]?.ToObject<bool>() == true;
            if (extractionOpen && kind != "outpost_defense" && kind != "distress_signal"
                && TryActivityExtractionTarget(out target, out reach))
            {
                label = "ЭВАКУАЦИЯ";
                color = Safe;
                return true;
            }

            JObject point = NearestPendingPoint(out _);
            if (point != null)
            {
                float x = point["x"]?.ToObject<float>() ?? 0f;
                float z = point["z"]?.ToObject<float>() ?? 0f;
                target = RoaCoords.ToUnity(x, 0.08f, z);
                reach = 3f;
                label = kind == "distress_signal" ? "МАЯК"
                    : kind == "assault_diversion" ? "ОПЕРАЦИЯ" : "НАБЛЮДЕНИЕ";
                return true;
            }

            if (kind == "resource_expedition" && Bootstrap.Interaction != null
                && Bootstrap.Interaction.TryNearestActivityResource(Bootstrap.PlayerView.transform.position, out target, out _))
            {
                reach = 2.8f;
                label = "РЕСУРС";
                return true;
            }

            return false;
        }

        private bool TryActivityExtractionTarget(out Vector3 target, out float reach)
        {
            target = Vector3.zero;
            reach = 4f;
            LocationDefinition location = Bootstrap?.Loader?.Current;
            if (location == null) return false;

            WorldZone zone = null;
            if (location.WorldZones != null)
            {
                foreach (WorldZone candidate in location.WorldZones)
                {
                    if (candidate == null) continue;
                    if ((candidate.Id ?? string.Empty).IndexOf("world_exit", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        zone = candidate;
                        break;
                    }
                    if (zone == null) zone = candidate;
                }
            }
            if (zone != null)
            {
                target = RoaCoords.TileToWorld(zone.Tx, zone.Tz, location.TileWidth, location.TileDepth);
                reach = Mathf.Max(2f, zone.Radius > 0f ? zone.Radius : 4f);
                return true;
            }

            if (location.EntryFromWorld != null)
            {
                target = RoaCoords.TileToWorld(location.EntryFromWorld.Tx, location.EntryFromWorld.Tz,
                    location.TileWidth, location.TileDepth);
                return true;
            }
            return false;
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null || _activity == null || Bootstrap?.PlayerView == null) return;
            string activityStatus = _activity["status"]?.ToString() ?? string.Empty;
            if (activityStatus != "active" && activityStatus != "extracting") return;
            string kind = _activity["kind"]?.ToString() ?? string.Empty;
            if (_activity["extractionOpen"]?.ToObject<bool>() == true && kind != "outpost_defense" && kind != "distress_signal"
                && TryActivityExtractionTarget(out Vector3 extraction, out _))
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Extraction, extraction));

            if (_activity["interactionPoints"] is JArray points)
            {
                foreach (JToken token in points)
                {
                    JObject point = token as JObject;
                    string status = point?["status"]?.ToString() ?? string.Empty;
                    if (point == null || status == "completed" || status == "disabled") continue;
                    float x = point["x"]?.ToObject<float>() ?? 0f;
                    float z = point["z"]?.ToObject<float>() ?? 0f;
                    markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Objective, RoaCoords.ToUnity(x, 0f, z)));
                }
            }
            if (kind == "resource_expedition") Bootstrap.Interaction?.CollectActivityResourceMarkers(markers);
        }

        private void CreateActivityWorldBeacon(string objectName, Vector3 position, Color color, bool completed)
        {
            if (_markerRoot == null) return;
            var marker = new GameObject(objectName);
            marker.transform.SetParent(_markerRoot.transform, false);
            marker.transform.position = position;
            marker.AddComponent<RoaActivityBeacon>().Configure(color, completed);
        }
    }
}
