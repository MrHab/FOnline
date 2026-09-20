using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно таблички участка: торги за место в городе и постройка станка.
    ///
    /// Город станков не ставит — участок выигрывают на торгах, и только его
    /// владелец ставит на нём один станок. Дальше владелец назначает плату за
    /// работу у своего станка, а сам работает бесплатно.
    /// </summary>
    public sealed class RoaPlotCanvas : MonoBehaviour
    {
        public RoaInteraction Interaction;

        private static readonly string[] Stations = { "weapon_bench", "ammo_bench", "tool_bench", "repair_bench", "energy_bench", "chem_station" };
        private static readonly string[] StationNames = { "Оружейный", "Патронный", "Инструментальный", "Ремонтный", "Энергетический", "Химический" };

        private static readonly Color Veil = new Color(0f, 0f, 0f, 0.38f);
        private static readonly Color PanelBg = new Color(0.051f, 0.063f, 0.063f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color TitleInk = new Color(0.941f, 0.824f, 0.541f, 1f);
        private static readonly Color SubInk = new Color(0.557f, 0.627f, 0.49f, 1f);
        private static readonly Color BodyInk = new Color(0.898f, 0.867f, 0.788f, 1f);
        private static readonly Color BtnBg = new Color(0.165f, 0.141f, 0.098f, 1f);
        private static readonly Color BtnBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color BtnInk = new Color(0.898f, 0.78f, 0.486f, 1f);

        private GameObject _root;
        private Text _title, _state, _auction, _bidValue, _hint;
        private RectTransform _buildRow;
        private Button _bidButton;
        private readonly Button[] _buildButtons = new Button[6];
        private int _bid;
        private int _minBid = 100;

        private void Update()
        {
            bool open = Interaction != null && Interaction.PlotBoardOpen;
            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) _root.SetActive(true);
            if (Input.GetKeyDown(KeyCode.Escape)) { Interaction.PlotBoardClose(); return; }
            Refresh();
        }

        private void Refresh()
        {
            JObject plot = Interaction.PlotBoardPlot;
            if (plot == null)
            {
                _title.text = "Участок под застройку";
                _state.text = "Смотрю, что говорит город…";
                _auction.text = string.Empty;
                _hint.text = string.Empty;
                SetBuildVisible(false);
                _bidButton.interactable = false;
                return;
            }
            bool leased = plot["leased"]?.ToObject<bool>() == true;
            bool mine = plot["mine"]?.ToObject<bool>() == true;
            string station = plot["station"]?.ToString() ?? string.Empty;
            JObject auction = plot["auction"] as JObject;
            bool auctionOpen = auction?["open"]?.ToObject<bool>() == true;
            int highest = auction?["highestBid"]?.ToObject<int>() ?? 0;
            _minBid = Mathf.Max(1, auction?["minBid"]?.ToObject<int>() ?? 100);
            if (_bid < _minBid) _bid = _minBid;

            _title.text = string.IsNullOrEmpty(station) ? "Участок под застройку" : "Участок: " + StationName(station);
            var state = new StringBuilder();
            if (leased) state.Append(mine ? "Участок ваш" : "Держит: " + (plot["lesseeName"]?.ToString() ?? "другой игрок"));
            else state.Append("Участок свободен");
            state.Append(" · строить можно только станок");
            if (!string.IsNullOrEmpty(station)) state.Append(" · стоит ").Append(StationName(station));
            _state.text = state.ToString();

            _auction.text = auctionOpen
                ? (highest > 0
                    ? "Торги идут: ставка " + highest + " марок, следующая от " + _minBid
                    : "Торги открыты: первая ставка от " + _minBid + " марок, торги длятся сутки")
                : "Торги закроются до конца срока участка";
            _bidValue.text = _bid.ToString();
            _bidButton.interactable = auctionOpen && !Interaction.PlotBoardBusy;

            bool canBuild = mine && string.IsNullOrEmpty(station);
            SetBuildVisible(canBuild);
            for (int i = 0; i < _buildButtons.Length; i++)
                if (_buildButtons[i] != null) _buildButtons[i].interactable = canBuild && !Interaction.PlotBoardBusy;

            _hint.text = canBuild
                ? "Участок ваш: выберите станок — он встанет на этом месте."
                : mine ? "Плата за работу у вашего станка назначается в окне самого станка."
                : "Ставка сгорает как плата за место; перебитую ставку город вернёт.";
        }

        private static string StationName(string station)
        {
            for (int i = 0; i < Stations.Length; i++) if (Stations[i] == station) return StationNames[i] + " станок";
            return "станок";
        }

        private void SetBuildVisible(bool visible)
        {
            if (_buildRow != null && _buildRow.gameObject.activeSelf != visible) _buildRow.gameObject.SetActive(visible);
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("PlotCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 46; // над HUD, под окном количества
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            _root = new GameObject("PlotWindow", typeof(RectTransform));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            Stretch(root, 0f);
            var veil = _root.AddComponent<Image>();
            veil.color = Veil;
            var veilButton = _root.AddComponent<Button>();
            veilButton.transition = Selectable.Transition.None;
            veilButton.onClick.AddListener(() => Interaction.PlotBoardClose());

            RectTransform panel = Child("Panel", root);
            panel.anchorMin = panel.anchorMax = panel.pivot = new Vector2(0.5f, 0.5f);
            panel.sizeDelta = new Vector2(420f, 300f);
            var bg = panel.gameObject.AddComponent<Image>();
            bg.color = PanelBg;
            var border = panel.gameObject.AddComponent<Outline>();
            border.effectColor = PanelBorder;
            border.effectDistance = new Vector2(1f, -1f);

            float y = -14f;
            _title = Label("Title", panel, 15, TitleInk, FontStyle.Bold);
            Place(_title.rectTransform, 14f, y - 20f, -44f, y);
            UiButton(panel, "×", -38f, y - 22f, -14f, y, () => Interaction.PlotBoardClose());
            y -= 28f;
            _state = Label("State", panel, 12, BodyInk);
            _state.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_state.rectTransform, 14f, y - 34f, -14f, y);
            y -= 40f;
            _auction = Label("Auction", panel, 12, SubInk);
            _auction.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_auction.rectTransform, 14f, y - 34f, -14f, y);
            y -= 42f;

            // Ставка: − [марки] + и кнопка торгов.
            UiButton(panel, "−", 14f, y - 30f, 52f, y, () => { _bid = Mathf.Max(_minBid, _bid - Step()); });
            RectTransform value = Child("Bid", panel);
            Place(value, 58f, y - 30f, 150f, y);
            var valueBg = value.gameObject.AddComponent<Image>();
            valueBg.color = new Color(0.051f, 0.063f, 0.063f, 1f);
            _bidValue = Label("Text", value, 14, BtnInk, FontStyle.Bold);
            _bidValue.alignment = TextAnchor.MiddleCenter;
            Stretch(_bidValue.rectTransform, 2f);
            UiButton(panel, "+", 156f, y - 30f, 194f, y, () => { _bid += Step(); });
            _bidButton = UiButton(panel, "Сделать ставку", 202f, y - 30f, -14f, y, () => Interaction.PlotBoardBid(_bid));
            y -= 40f;

            _buildRow = Child("Build", panel);
            Place(_buildRow, 14f, y - 70f, -14f, y);
            for (int i = 0; i < Stations.Length; i++)
            {
                int index = i;
                float left = (i % 3) * 132f;
                float top = (i / 3) * -36f;
                _buildButtons[i] = UiButton(_buildRow, StationNames[i], left, top - 32f, left + 126f, top,
                    () => Interaction.PlotBoardBuild(Stations[index]));
            }
            y -= 78f;

            _hint = Label("Hint", panel, 11, SubInk);
            _hint.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_hint.rectTransform, 14f, y - 34f, -14f, y);
        }

        private int Step() { return Mathf.Max(10, Mathf.RoundToInt(_minBid * 0.2f)); }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            return rect;
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
        }

        /// <summary>
        /// Прямоугольник от верхнего края панели: left/right в пикселях, отрицательные —
        /// от правого края. Без этого правая кнопка тянулась через всю панель и
        /// накрывала заголовок.
        /// </summary>
        private static void Place(RectTransform rect, float left, float bottom, float right, float top)
        {
            rect.anchorMin = new Vector2(left < 0f ? 1f : 0f, 1f);
            rect.anchorMax = new Vector2(right < 0f ? 1f : 0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.offsetMin = new Vector2(left, bottom);
            rect.offsetMax = new Vector2(right, top);
        }

        private static Text Label(string name, RectTransform parent, int size, Color color, FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = Child(name, parent);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.color = color;
            text.fontStyle = style;
            text.alignment = TextAnchor.UpperLeft;
            text.raycastTarget = false;
            return text;
        }

        private static Button UiButton(RectTransform parent, string caption, float left, float bottom, float right, float top,
                                       UnityEngine.Events.UnityAction action)
        {
            RectTransform rect = Child("Btn" + caption, parent);
            Place(rect, left, bottom, right, top);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = BtnBg;
            var border = rect.gameObject.AddComponent<Outline>();
            border.effectColor = BtnBorder;
            border.effectDistance = new Vector2(1f, -1f);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(action);
            Text label = Label("Text", rect, 12, BtnInk);
            label.alignment = TextAnchor.MiddleCenter;
            label.horizontalOverflow = HorizontalWrapMode.Overflow;
            label.verticalOverflow = VerticalWrapMode.Overflow;
            label.text = caption;
            Stretch(label.rectTransform, 2f);
            return button;
        }
    }
}
