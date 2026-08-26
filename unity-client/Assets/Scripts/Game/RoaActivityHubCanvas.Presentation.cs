using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public static class RoaActivityHubPresentation
    {
        public const float TransitionSeconds = 0.22f;

        public readonly struct TransitionSample
        {
            public readonly float PanelAlpha;
            public readonly float LauncherAlpha;
            public readonly float PanelOffsetX;

            public TransitionSample(float panelAlpha, float launcherAlpha, float panelOffsetX)
            {
                PanelAlpha = panelAlpha;
                LauncherAlpha = launcherAlpha;
                PanelOffsetX = panelOffsetX;
            }
        }

        public readonly struct CardRefreshSample
        {
            public readonly float Alpha;
            public readonly float OffsetY;

            public CardRefreshSample(float alpha, float offsetY)
            {
                Alpha = alpha;
                OffsetY = offsetY;
            }
        }

        public static TransitionSample Sample(bool expanded, float age)
        {
            float t = Mathf.Clamp01(age / TransitionSeconds);
            t = t * t * (3f - 2f * t);
            float open = expanded ? t : 1f - t;
            return new TransitionSample(open, 1f - open, Mathf.Lerp(-16f, 0f, open));
        }

        public static CardRefreshSample SampleCardRefresh(float age)
        {
            float t = Mathf.Clamp01(age / 0.18f);
            t = t * t * (3f - 2f * t);
            return new CardRefreshSample(Mathf.Lerp(0.52f, 1f, t), Mathf.Lerp(5f, 0f, t));
        }

        public static string BuildSignature(IList<JObject> tasks, bool travelActive, bool actionPending,
                                            Func<string, bool> accepted, Func<string, bool> tracked,
                                            Func<string, bool> atSite, Func<JObject, float> distance,
                                            double worldHour)
        {
            var value = new StringBuilder(384);
            value.Append(travelActive ? '1' : '0').Append(actionPending ? '1' : '0').Append('|');
            if (tasks == null) return value.ToString();
            foreach (JObject task in tasks)
            {
                string id = task?["id"]?.ToString() ?? string.Empty;
                JObject reward = task?["reward"] as JObject;
                Append(value, id);
                Append(value, task?["type"]?.ToString());
                Append(value, task?["title"]?.ToString());
                Append(value, task?["targetSiteName"]?.ToString());
                Append(value, task?["siteId"]?.ToString());
                Append(value, task?["issuerSiteId"]?.ToString());
                Append(value, task?["priority"]?.ToString());
                Append(value, reward?["xp"]?.ToString());
                Append(value, reward?["caps"]?.ToString());
                value.Append(accepted?.Invoke(id) == true ? '1' : '0');
                value.Append(tracked?.Invoke(id) == true ? '1' : '0');
                value.Append(atSite?.Invoke(task?["siteId"]?.ToString() ?? string.Empty) == true ? '1' : '0');
                value.Append(atSite?.Invoke(task?["issuerSiteId"]?.ToString() ?? string.Empty) == true ? '1' : '0');
                float km = distance != null ? distance(task) : 9999f;
                value.Append('|').Append(Mathf.RoundToInt(Mathf.Clamp(km, 0f, 9999f) * 10f));
                Append(value, DeadlineLabel(task, worldHour));
                value.Append(';');
            }
            return value.ToString();
        }

        public static string DeadlineLabel(JObject task, double worldHour)
        {
            double expires = task?["expiresHour"]?.ToObject<double>() ?? double.NaN;
            if (double.IsNaN(worldHour) || double.IsNaN(expires)) return string.Empty;
            double hours = Math.Max(0d, expires - worldHour);
            if (hours < 0.05d) return "истекает";
            if (hours < 1d) return "меньше часа";
            return "ещё " + Math.Ceiling(hours) + " ч";
        }

        public static string LauncherText(bool travelActive, float secondsLeft, int taskCount)
        {
            if (travelActive) return "В ПУТИ · " + Mathf.CeilToInt(Mathf.Max(0f, secondsLeft)) + " С";
            return taskCount > 0 ? "СИГНАЛЫ ПУСТОШИ · " + taskCount : "СИГНАЛЫ ПУСТОШИ";
        }

        private static void Append(StringBuilder target, string part)
        {
            part = part ?? string.Empty;
            target.Append(part.Length).Append(':').Append(part).Append('|');
        }
    }

    public sealed partial class RoaActivityHubCanvas
    {
        private CanvasGroup _hubGroup;
        private CanvasGroup _launcherGroup;
        private RectTransform _hubRect;
        private RectTransform _launcherProgressRect;
        private Text _launcherLabel;
        private CanvasGroup _gridGroup;
        private RectTransform _gridRect;
        private Vector2 _hubBasePosition;
        private Vector2 _gridBasePosition;
        private float _cardsChangedAt = -100f;
        private float _hubTransitionAt = -100f;
        private string _cardSignature = string.Empty;
        private int _visibleTaskCount;
        private bool _presentedOnce;

        public int CardRebuildCount { get; private set; }

        private void ConfigureHubPresentation(RectTransform hub, RectTransform launcher,
                                              RectTransform grid, Text launcherLabel)
        {
            _hubRect = hub;
            _hubBasePosition = hub.anchoredPosition;
            _launcherLabel = launcherLabel;
            _gridRect = grid;
            _gridBasePosition = grid.anchoredPosition;
            _hubGroup = hub.gameObject.AddComponent<CanvasGroup>();
            _launcherGroup = launcher.gameObject.AddComponent<CanvasGroup>();
            _gridGroup = grid.gameObject.AddComponent<CanvasGroup>();

            var fill = new GameObject("TravelProgress", typeof(RectTransform), typeof(Image));
            _launcherProgressRect = (RectTransform)fill.transform;
            _launcherProgressRect.SetParent(launcher, false);
            _launcherProgressRect.SetAsFirstSibling();
            _launcherProgressRect.anchorMin = Vector2.zero;
            _launcherProgressRect.anchorMax = new Vector2(0f, 1f);
            _launcherProgressRect.offsetMin = new Vector2(2f, 2f);
            _launcherProgressRect.offsetMax = new Vector2(-2f, -2f);
            Image image = fill.GetComponent<Image>();
            image.color = new Color(Safe.r, Safe.g, Safe.b, 0.24f);
            image.raycastTarget = false;
            fill.SetActive(false);
            SetExpanded(_expanded, true);
        }

        private void PrepareHubForMap()
        {
            if (!_presentedOnce)
            {
                _presentedOnce = true;
                _expanded = true;
            }
            SetExpanded(_expanded, true);
            InvalidateActivityCards();
        }

        private void SetExpanded(bool expanded, bool immediate = false)
        {
            if (_expanded == expanded && !immediate) return;
            _expanded = expanded;
            _hubTransitionAt = Time.unscaledTime
                - (immediate ? RoaActivityHubPresentation.TransitionSeconds : 0f);
            if (expanded) _refreshAt = 0f;
            UpdateHubPresentation();
        }

        private void UpdateHubPresentation()
        {
            if (_hubGroup == null || _launcherGroup == null) return;
            RoaActivityHubPresentation.TransitionSample sample = RoaActivityHubPresentation.Sample(
                _expanded, Time.unscaledTime - _hubTransitionAt);
            bool panelVisible = _expanded || sample.PanelAlpha > 0.001f;
            bool launcherVisible = !_expanded || sample.LauncherAlpha > 0.001f;
            if (_root.activeSelf != panelVisible) _root.SetActive(panelVisible);
            if (_shade.activeSelf != panelVisible) _shade.SetActive(panelVisible);
            if (_launcher.activeSelf != launcherVisible) _launcher.SetActive(launcherVisible);
            _hubGroup.alpha = sample.PanelAlpha;
            _hubGroup.interactable = _expanded && sample.PanelAlpha > 0.98f;
            _hubGroup.blocksRaycasts = _hubGroup.interactable;
            _launcherGroup.alpha = sample.LauncherAlpha;
            _launcherGroup.interactable = !_expanded && sample.LauncherAlpha > 0.98f;
            _launcherGroup.blocksRaycasts = _launcherGroup.interactable;
            _hubRect.anchoredPosition = _hubBasePosition + Vector2.right * sample.PanelOffsetX;
            UpdateCardRefreshPresentation();
        }

        private void UpdateCardRefreshPresentation()
        {
            if (_gridGroup == null || _gridRect == null) return;
            RoaActivityHubPresentation.CardRefreshSample sample =
                RoaActivityHubPresentation.SampleCardRefresh(Time.unscaledTime - _cardsChangedAt);
            _gridGroup.alpha = sample.Alpha;
            _gridRect.anchoredPosition = _gridBasePosition + Vector2.down * sample.OffsetY;
        }

        private void MarkActivityCardsRebuilt()
        {
            _cardsChangedAt = Time.unscaledTime;
            UpdateCardRefreshPresentation();
        }

        private void UpdateLauncherPresentation()
        {
            if (_launcherLabel == null || Map == null) return;
            bool traveling = Map.TravelActive;
            _launcherLabel.text = RoaActivityHubPresentation.LauncherText(
                traveling, Map.TravelSecondsLeft, _visibleTaskCount);
            if (_launcherProgressRect == null) return;
            if (_launcherProgressRect.gameObject.activeSelf != traveling)
                _launcherProgressRect.gameObject.SetActive(traveling);
            if (!traveling) return;
            _launcherProgressRect.anchorMax = new Vector2(
                Mathf.Max(0.025f, Mathf.Clamp01(Map.TravelProgress)), 1f);
        }

        private string BuildVisibleCardSignature(List<JObject> tasks)
        {
            double worldHour = Map?.WastelandState?["sim"]?["worldHour"]?.ToObject<double>() ?? double.NaN;
            return RoaActivityHubPresentation.BuildSignature(tasks, Map != null && Map.TravelActive,
                Interaction != null && Interaction.WorldTaskActionPending,
                id => Interaction != null && Interaction.IsWorldTaskAccepted(id),
                id => Interaction != null && Interaction.IsWorldTaskTracked(id),
                id => Map != null && Map.PlayerAtWorldSite(id),
                task => _expanded ? TaskDistance(task) : 9999f, worldHour);
        }

        private void InvalidateActivityCards()
        {
            _cardSignature = string.Empty;
            _refreshAt = 0f;
        }
    }
}
