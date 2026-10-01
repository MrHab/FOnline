using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Полоса сбора над подсказкой взаимодействия: что добывается, сколько
    /// осталось в узле и сколько прошло от текущего цикла (как полоса сбора
    /// в Albion Online). Видна, только пока идёт сбор.
    /// </summary>
    public sealed partial class RoaHudCanvas
    {
        private const float GatherBarDesktopY = 262f;
        private const float GatherBarMobileY = 348f;
        private GameObject _gatherBar;
        private CanvasGroup _gatherBarGroup;
        private Text _gatherBarTitle;
        private Text _gatherBarCharges;
        private RectTransform _gatherBarFill;

        public bool GatherBarVisible
        {
            get { return _gatherBar != null && _gatherBar.activeSelf && _gatherBarGroup != null && _gatherBarGroup.alpha > 0.01f; }
        }

        public string GatherBarText
        {
            get { return _gatherBarTitle != null ? _gatherBarTitle.text + " · " + _gatherBarCharges.text : string.Empty; }
        }

        private void BuildGatherBar()
        {
            RectTransform panel = PanelRect("GatherBar", _safeRoot, new Vector2(0.5f, 0f),
                new Vector2(0.5f, 0f), new Vector2(0f, GatherBarDesktopY), new Vector2(360f, 46f));
            _gatherBar = panel.gameObject;
            Color text = new Color(0.92f, 0.86f, 0.70f, 1f);
            _gatherBarTitle = Label("Title", panel, new Vector2(10f, -4f), new Vector2(230f, 20f), 13,
                TextAnchor.MiddleLeft, text, FontStyle.Bold);
            _gatherBarCharges = Label("Charges", panel, new Vector2(240f, -4f), new Vector2(110f, 20f), 12,
                TextAnchor.MiddleRight, text);
            Image fill = Bar("Progress", panel, new Vector2(10f, -27f), new Vector2(340f, 12f),
                new Color(0.91f, 0.66f, 0.20f, 0.95f));
            _gatherBarFill = fill.rectTransform;
            _gatherBarGroup = panel.gameObject.AddComponent<CanvasGroup>();
            _gatherBarGroup.alpha = 0f;
            _gatherBarGroup.blocksRaycasts = false;
            _gatherBarGroup.interactable = false;
            _gatherBar.SetActive(false);
        }

        private void RefreshGatherBar(bool worldHud)
        {
            if (_gatherBar == null || _gatherBarGroup == null) return;
            bool show = worldHud && _interaction != null && _interaction.GatherActive;
            if (show)
            {
                if (!_gatherBar.activeSelf)
                {
                    _gatherBar.SetActive(true);
                    _gatherBarGroup.alpha = 0f;
                }
                bool mobile = _mobile != null && _mobile.ControlsEnabled;
                RectTransform rect = (RectTransform)_gatherBar.transform;
                rect.anchoredPosition = new Vector2(0f, mobile ? GatherBarMobileY : GatherBarDesktopY);
                _gatherBarTitle.text = _interaction.GatherTitle;
                _gatherBarCharges.text = RoaInteraction.FormatCharges(_interaction.GatherCharges, _interaction.GatherMaxCharges);
                _gatherBarFill.anchorMax = new Vector2(Mathf.Clamp01(_interaction.GatherProgress), 1f);
            }
            if (!_gatherBar.activeSelf) return;
            _gatherBarGroup.alpha = Mathf.MoveTowards(_gatherBarGroup.alpha, show ? 1f : 0f, Time.unscaledDeltaTime * 8f);
            if (!show && _gatherBarGroup.alpha <= 0.001f) _gatherBar.SetActive(false);
        }
    }
}
