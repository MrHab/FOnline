using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaHudCanvas
    {
        private sealed class EconomyToast
        {
            public RoaEconomyNotice Notice;
            public float StartedAt = -1f;
        }

        private sealed class EconomyToastRow
        {
            public GameObject Root;
            public RectTransform Rect;
            public CanvasGroup Group;
            public Text Kicker;
            public Text Value;
            public Image Accent;
            public Vector2 BasePosition;
        }

        private RoaSocketClient _economySocket;
        private RoaEconomySnapshot _economyBaseline;
        private readonly List<EconomyToast> _economyToasts = new List<EconomyToast>();
        private GameObject _economyRoot;
        private RectTransform _economyRect;
        private readonly EconomyToastRow[] _economyRows = new EconomyToastRow[RoaEconomyFeedback.MaxVisible];

        public int EconomyToastCount { get { return _economyToasts.Count; } }

        private void ConfigureEconomyFeedback(RoaSocketClient socket)
        {
            if (_economySocket == socket) return;
            ReleaseEconomyFeedback();
            _economySocket = socket;
            if (_economySocket == null) return;
            _economySocket.OnJoined += HandleEconomyJoined;
            _economySocket.OnAuthoritativeSelf += HandleEconomySelf;
            _economySocket.OnDisconnected += HandleEconomyDisconnected;
            _economyBaseline = RoaEconomyFeedback.Read(_economySocket.Session?.Self);
        }

        private void ReleaseEconomyFeedback()
        {
            if (_economySocket != null)
            {
                _economySocket.OnJoined -= HandleEconomyJoined;
                _economySocket.OnAuthoritativeSelf -= HandleEconomySelf;
                _economySocket.OnDisconnected -= HandleEconomyDisconnected;
            }
            _economySocket = null;
            _economyBaseline = null;
            ClearEconomyToasts();
        }

        private void HandleEconomyJoined(JoinAck ack)
        {
            _economyBaseline = RoaEconomyFeedback.Read(ack?.Self);
            ClearEconomyToasts();
        }

        private void HandleEconomyDisconnected(string reason)
        {
            _economyBaseline = null;
            ClearEconomyToasts();
        }

        private void HandleEconomySelf(JObject payload)
        {
            RoaEconomySnapshot next = RoaEconomyFeedback.Read(payload, _economyBaseline);
            if (_economyBaseline == null)
            {
                _economyBaseline = next;
                return;
            }
            List<RoaEconomyNotice> notices = RoaEconomyFeedback.Diff(_economyBaseline, next);
            _economyBaseline = next;
            bool levelUp = false;
            bool positive = false;
            foreach (RoaEconomyNotice notice in notices)
            {
                QueueEconomyNotice(notice);
                levelUp |= notice.Kind == RoaEconomyNoticeKind.LevelUp;
                positive |= notice.Kind != RoaEconomyNoticeKind.Spend;
            }
            if (levelUp) RoaAudio.Active?.PlayEconomyCue(RoaEconomyNoticeKind.LevelUp);
            else if (positive) RoaAudio.Active?.PlayEconomyCue(RoaEconomyNoticeKind.Gain);
        }

        private void QueueEconomyNotice(RoaEconomyNotice notice)
        {
            for (int i = _economyToasts.Count - 1; i >= 0; i--)
            {
                EconomyToast queued = _economyToasts[i];
                if (queued.Notice.Key != notice.Key) continue;
                if (queued.StartedAt >= 0f && Time.unscaledTime - queued.StartedAt > 0.45f) break;
                queued.Notice = new RoaEconomyNotice(notice.Kind, notice.ItemId,
                    notice.Kind == RoaEconomyNoticeKind.LevelUp
                        ? notice.Amount : queued.Notice.Amount + notice.Amount);
                if (queued.StartedAt >= 0f) queued.StartedAt = Time.unscaledTime;
                return;
            }
            if (_economyToasts.Count >= RoaEconomyFeedback.MaxQueued) return;
            _economyToasts.Add(new EconomyToast { Notice = notice });
        }

        private void BuildEconomyFeedback()
        {
            _economyRect = Rect("EconomyFeedback", _safeRoot, new Vector2(0f, 1f),
                new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(12f, -94f),
                new Vector2(322f, 126f));
            _economyRoot = _economyRect.gameObject;
            for (int i = 0; i < _economyRows.Length; i++)
            {
                RectTransform row = Rect("EconomyToast:" + i, _economyRect,
                    new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 1f),
                    new Vector2(0f, -i * 42f), new Vector2(310f, 38f));
                Image background = row.gameObject.AddComponent<Image>();
                background.color = new Color(0.035f, 0.045f, 0.034f, 0.96f);
                background.raycastTarget = false;
                Outline outline = row.gameObject.AddComponent<Outline>();
                outline.effectColor = new Color(Border.r, Border.g, Border.b, 0.74f);
                outline.effectDistance = new Vector2(1f, -1f);
                RectTransform accentRect = Rect("Accent", row, new Vector2(0f, 0f),
                    new Vector2(0f, 1f), new Vector2(0f, 0.5f), Vector2.zero,
                    new Vector2(4f, 0f));
                Image accent = accentRect.gameObject.AddComponent<Image>();
                accent.raycastTarget = false;
                Text kicker = Label("Kicker", row, new Vector2(13f, -5f),
                    new Vector2(82f, 28f), 9, TextAnchor.MiddleLeft, MutedInk, FontStyle.Bold);
                Text value = Label("Value", row, new Vector2(92f, -5f),
                    new Vector2(204f, 28f), 12, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
                value.horizontalOverflow = HorizontalWrapMode.Wrap;
                value.verticalOverflow = VerticalWrapMode.Truncate;
                CanvasGroup group = row.gameObject.AddComponent<CanvasGroup>();
                group.blocksRaycasts = false;
                group.interactable = false;
                _economyRows[i] = new EconomyToastRow
                {
                    Root = row.gameObject,
                    Rect = row,
                    Group = group,
                    Kicker = kicker,
                    Value = value,
                    Accent = accent,
                    BasePosition = row.anchoredPosition
                };
                row.gameObject.SetActive(false);
            }
            _economyRoot.SetActive(false);
        }

        private void RefreshEconomyFeedback(bool visible)
        {
            if (_economyRoot == null) return;
            if (!visible)
            {
                if (_economyRoot.activeSelf) _economyRoot.SetActive(false);
                return;
            }

            for (int i = Mathf.Min(RoaEconomyFeedback.MaxVisible, _economyToasts.Count) - 1; i >= 0; i--)
            {
                EconomyToast toast = _economyToasts[i];
                if (toast.StartedAt >= 0f && Time.unscaledTime - toast.StartedAt
                    >= RoaEconomyFeedback.Lifetime(toast.Notice.Kind))
                    _economyToasts.RemoveAt(i);
            }
            int count = Mathf.Min(RoaEconomyFeedback.MaxVisible, _economyToasts.Count);
            if (_economyRoot.activeSelf != (count > 0)) _economyRoot.SetActive(count > 0);
            bool mobile = _mobile != null && _mobile.ControlsEnabled;
            _economyRect.anchoredPosition = new Vector2(12f, mobile ? -82f : -94f);
            _economyRect.localScale = Vector3.one * (mobile ? 0.88f : 1f);

            for (int i = 0; i < _economyRows.Length; i++)
            {
                EconomyToastRow row = _economyRows[i];
                bool show = i < count;
                if (row.Root.activeSelf != show) row.Root.SetActive(show);
                if (!show) continue;
                EconomyToast toast = _economyToasts[i];
                if (toast.StartedAt < 0f) toast.StartedAt = Time.unscaledTime;
                float lifetime = RoaEconomyFeedback.Lifetime(toast.Notice.Kind);
                RoaEconomyFeedback.ToastSample sample = RoaEconomyFeedback.SampleToast(
                    Time.unscaledTime - toast.StartedAt, lifetime);
                row.Group.alpha = sample.Alpha;
                row.Rect.anchoredPosition = row.BasePosition + Vector2.right * sample.OffsetX;
                row.Rect.localScale = Vector3.one * sample.Scale;
                row.Kicker.text = RoaEconomyFeedback.Kicker(toast.Notice.Kind);
                row.Value.text = RoaEconomyFeedback.Text(toast.Notice);
                Color color = EconomyColor(toast.Notice.Kind);
                row.Kicker.color = color;
                row.Accent.color = color;
            }
        }

        private static Color EconomyColor(RoaEconomyNoticeKind kind)
        {
            return kind == RoaEconomyNoticeKind.LevelUp ? new Color(1f, 0.78f, 0.28f, 1f)
                : kind == RoaEconomyNoticeKind.Experience ? new Color(0.45f, 0.78f, 0.86f, 1f)
                : kind == RoaEconomyNoticeKind.Spend ? new Color(0.86f, 0.55f, 0.28f, 1f)
                : new Color(0.52f, 0.82f, 0.38f, 1f);
        }

        private void ClearEconomyToasts()
        {
            _economyToasts.Clear();
            if (_economyRoot != null) _economyRoot.SetActive(false);
        }
    }
}
