using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно контракта с фракцией на входе в Сердцевину. Портал Сердцевины в её
    /// зоне без подписанного контракта отказывает с предложением
    /// (`contractRequired`): доли фракций среди персонажей, база каждой и
    /// причина отказа. Здесь игрок выбирает сторону и подписывает; после подписи
    /// переход повторяется — уже на базу фракции.
    /// </summary>
    public sealed class RoaTerritoryContractCanvas : MonoBehaviour
    {
        private const int RowCount = 4;
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color MutedInk = new Color(0.62f, 0.62f, 0.58f, 1f);
        private static readonly Color RowBg = new Color(0.13f, 0.12f, 0.09f, 0.95f);
        private static readonly Color RowSelected = new Color(0.20f, 0.26f, 0.16f, 1f);

        public RoaSocketClient Socket;

        private GameObject _modal;
        private Text _intro;
        private Text _hint;
        private Text _signLabel;
        private readonly List<Button> _rows = new List<Button>();
        private readonly List<Text> _rowLabels = new List<Text>();
        private JObject _contract;
        private string _factionId = string.Empty;
        private string _error = string.Empty;
        private bool _signing;
        private Action _afterSign;

        public bool IsOpen { get { return _modal != null && _modal.activeSelf; } }

        /// <summary>Окно контракта на этом объекте (создаётся по первому отказу портала).</summary>
        public static RoaTerritoryContractCanvas Ensure(GameObject host, RoaSocketClient socket)
        {
            var canvas = host.GetComponent<RoaTerritoryContractCanvas>();
            if (canvas == null) canvas = host.AddComponent<RoaTerritoryContractCanvas>();
            canvas.Socket = socket;
            return canvas;
        }

        public void Open(JObject contract, string reason, Action afterSign)
        {
            EnsureBuilt();
            _contract = contract != null ? (JObject)contract.DeepClone() : null;
            _afterSign = afterSign;
            _signing = false;
            _error = reason ?? string.Empty;
            if (FindFaction(_factionId) == null) _factionId = FirstSignableFactionId();
            _modal.SetActive(true);
            Refresh();
        }

        public void Close()
        {
            if (_modal != null) _modal.SetActive(false);
            _afterSign = null;
        }

        private void Sign()
        {
            if (_signing || Socket == null) return;
            if (string.IsNullOrEmpty(_factionId))
            {
                _error = "Выберите фракцию.";
                Refresh();
                return;
            }
            _signing = true;
            _error = string.Empty;
            Refresh();
            bool sent = RoaTerritoryNet.JoinFaction(Socket, _factionId, ack =>
            {
                _signing = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    _error = ack?["error"]?.ToString() ?? "Сервер отклонил контракт.";
                    if (ack?["contract"] is JObject refreshed) _contract = (JObject)refreshed.DeepClone();
                    Refresh();
                    return;
                }
                Action next = _afterSign;
                Close();
                next?.Invoke();
            });
            if (!sent)
            {
                _signing = false;
                _error = "Нет связи с сервером.";
                Refresh();
            }
        }

        private JArray Factions { get { return _contract?["factions"] as JArray; } }

        private JObject FindFaction(string factionId)
        {
            if (string.IsNullOrEmpty(factionId) || Factions == null) return null;
            foreach (JToken token in Factions)
            {
                if (token is JObject row && string.Equals(row["factionId"]?.ToString(), factionId, StringComparison.Ordinal)) return row;
            }
            return null;
        }

        private string FirstSignableFactionId()
        {
            if (Factions == null) return string.Empty;
            foreach (JToken token in Factions)
            {
                if (token is JObject row && row["canSign"]?.ToObject<bool>() == true) return row["factionId"]?.ToString() ?? string.Empty;
            }
            return string.Empty;
        }

        private void SelectRow(int index)
        {
            if (Factions == null || index < 0 || index >= Factions.Count) return;
            if (!(Factions[index] is JObject row)) return;
            _factionId = row["factionId"]?.ToString() ?? string.Empty;
            _error = string.Empty;
            Refresh();
        }

        /// <summary>Пояснение к окну: сколько персонажей уже подписали контракт и на какой срок связывает подпись.</summary>
        public static string ContractIntroText(JObject contract)
        {
            int signed = contract?["signedCharacters"]?.ToObject<int>() ?? 0;
            string territory = contract?["displayName"]?.ToString();
            if (string.IsNullOrWhiteSpace(territory)) territory = "Сердцевина";
            string head = territory + " пускает только по контракту. Выберите сторону — вы появитесь на её базе.";
            long cooldownMs = contract?["changeCooldownMs"]?.ToObject<long>() ?? 0L;
            string bind = cooldownMs > 0
                ? "\nВыбор связывает: сменить фракцию можно будет только через "
                  + Math.Max(1L, cooldownMs / 3600000L) + " ч."
                : string.Empty;
            if (signed <= 0) return head + "\nКонтракт пока не подписал никто: доли откроются с первыми наёмниками." + bind;
            return head + "\nКонтракт подписали персонажей: " + signed + ". Доли ниже — от этого числа." + bind;
        }

        /// <summary>Строка фракции в окне контракта: доля, люди и база.</summary>
        public static string ContractRowText(JObject faction, bool selected)
        {
            if (faction == null) return string.Empty;
            string name = faction["displayName"]?.ToString();
            if (string.IsNullOrWhiteSpace(name)) name = faction["factionId"]?.ToString() ?? "фракция";
            float share = faction["sharePct"]?.ToObject<float>() ?? 0f;
            int characters = faction["characters"]?.ToObject<int>() ?? 0;
            string baseName = faction["baseDisplayName"]?.ToString() ?? string.Empty;
            string row = (selected ? "> " : "  ") + name + " — " + share.ToString("0.#", CultureInfo.InvariantCulture) + "% ("
                + characters + " чел.)";
            if (!string.IsNullOrWhiteSpace(baseName)) row += " · " + baseName;
            string reason = faction["reason"]?.ToString();
            if (faction["canSign"]?.ToObject<bool>() != true && !string.IsNullOrWhiteSpace(reason)) row += " · " + reason;
            return row;
        }

        private void Refresh()
        {
            if (_modal == null) return;
            _intro.text = ContractIntroText(_contract);
            for (int index = 0; index < _rows.Count; index++)
            {
                JObject row = Factions != null && index < Factions.Count ? Factions[index] as JObject : null;
                _rows[index].gameObject.SetActive(row != null);
                if (row == null) continue;
                bool selected = string.Equals(row["factionId"]?.ToString(), _factionId, StringComparison.Ordinal);
                _rowLabels[index].text = ContractRowText(row, selected);
                _rowLabels[index].color = row["canSign"]?.ToObject<bool>() == true ? Ink : MutedInk;
                if (_rows[index].targetGraphic is Image background) background.color = selected ? RowSelected : RowBg;
            }
            _signLabel.text = _signing ? "ПОДПИСЬ…" : "ПОДПИСАТЬ КОНТРАКТ";
            _hint.text = string.IsNullOrEmpty(_error)
                ? "Контракт подписывают у ворот; сменить фракцию потом можно у регистратора на её базе."
                : _error;
        }

        private void EnsureBuilt()
        {
            if (_modal != null) return;
            var canvasGo = new GameObject("TerritoryContractCanvas", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 46;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            RectTransform modal = Child("TerritoryContract", (RectTransform)canvasGo.transform);
            Place(modal, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            var blocker = modal.gameObject.AddComponent<Image>();
            blocker.color = new Color(0f, 0f, 0f, 0.78f);

            RectTransform panel = Child("Panel", modal);
            Place(panel, 0.5f, 0.5f, 0.5f, 0.5f, new Vector2(-270f, -190f), new Vector2(270f, 190f));
            panel.gameObject.AddComponent<Image>().color = new Color(0.07f, 0.09f, 0.08f, 0.98f);
            var outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.937f, 0.816f, 0.471f, 0.92f);
            outline.effectDistance = new Vector2(2f, -2f);

            Text title = Label("Title", panel, 18, TextAnchor.MiddleCenter, FontStyle.Bold);
            title.text = "КОНТРАКТ С ФРАКЦИЕЙ";
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(18f, -50f), new Vector2(-18f, -12f));

            _intro = Label("Intro", panel, 12, TextAnchor.UpperCenter);
            _intro.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_intro.rectTransform, 0f, 1f, 1f, 1f, new Vector2(20f, -120f), new Vector2(-20f, -50f));

            for (int index = 0; index < RowCount; index++)
            {
                int rowIndex = index;
                Button row = RowButton(panel, out Text rowLabel, () => SelectRow(rowIndex));
                Place((RectTransform)row.transform, 0f, 1f, 1f, 1f,
                    new Vector2(20f, -158f - index * 38f), new Vector2(-20f, -124f - index * 38f));
                _rows.Add(row);
                _rowLabels.Add(rowLabel);
            }

            _hint = Label("Hint", panel, 11, TextAnchor.UpperCenter);
            _hint.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_hint.rectTransform, 0f, 0f, 1f, 0f, new Vector2(20f, 58f), new Vector2(-20f, 98f));

            Button stay = RowButton(panel, out Text stayLabel, Close);
            stayLabel.text = "ОСТАТЬСЯ В ЗОНЕ";
            stayLabel.alignment = TextAnchor.MiddleCenter;
            Place((RectTransform)stay.transform, 0f, 0f, 0.5f, 0f, new Vector2(20f, 16f), new Vector2(-5f, 50f));
            Button sign = RowButton(panel, out _signLabel, Sign);
            _signLabel.alignment = TextAnchor.MiddleCenter;
            Place((RectTransform)sign.transform, 0.5f, 0f, 1f, 0f, new Vector2(5f, 16f), new Vector2(-20f, 50f));

            _modal = modal.gameObject;
            _modal.SetActive(false);
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
        }

        private static void Place(RectTransform rect, float minX, float minY, float maxX, float maxY, Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor, FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = Child(name, parent);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.alignment = anchor;
            text.color = Ink;
            text.fontStyle = style;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            return text;
        }

        private static Button RowButton(RectTransform parent, out Text label, Action onClick)
        {
            RectTransform rect = Child("Button", parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = RowBg;
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => onClick());
            label = Label("Label", rect, 12, TextAnchor.MiddleLeft);
            Place(label.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 0f), new Vector2(-10f, 0f));
            return button;
        }
    }
}
