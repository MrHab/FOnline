using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Баннер у края локации: «выход на глобальную карту» с остатком метров до
    /// золотой полосы либо «граница локации», пока задание держит выход закрытым.
    /// Когда показывать и что писать, решает RoaWorldExitBoundary.
    /// </summary>
    public sealed partial class RoaHudCanvas
    {
        private static readonly Color ExitBannerGold = new Color(1f, 0.69f, 0.18f, 1f);
        private static readonly Color ExitBannerLocked = new Color(1f, 0.37f, 0.11f, 1f);

        private GameObject _exitBanner;
        private Outline _exitBannerOutline;
        private Text _exitBannerTitle;
        private Text _exitBannerDetail;

        public bool ExitBannerVisible { get { return _exitBanner != null && _exitBanner.activeSelf; } }

        private void BuildExitBanner()
        {
            // Под строкой режима зоны (top 78, высота 32): верх по центру уже занят.
            RectTransform panel = PanelRect("ExitBanner", _safeRoot, new Vector2(0.5f, 1f),
                                            new Vector2(0.5f, 1f), new Vector2(0f, -118f),
                                            new Vector2(430f, 54f));
            _exitBanner = panel.gameObject;
            _exitBannerOutline = panel.GetComponent<Outline>();
            _exitBannerTitle = Label("Title", panel, new Vector2(12f, -5f), new Vector2(406f, 24f), 15,
                                     TextAnchor.MiddleCenter, ExitBannerGold, FontStyle.Bold);
            _exitBannerDetail = Label("Detail", panel, new Vector2(12f, -29f), new Vector2(406f, 20f), 12,
                                      TextAnchor.MiddleCenter, new Color(0.92f, 0.88f, 0.75f, 0.92f));
            _exitBanner.SetActive(false);
        }

        private void RefreshExitBanner(bool worldHud)
        {
            if (_exitBanner == null) return;
            RoaWorldExitBoundary boundary = RoaWorldExitBoundary.Current;
            string title = string.Empty, detail = string.Empty;
            bool locked = false;
            bool show = worldHud && boundary != null && boundary.TryGetBanner(out title, out detail, out locked);
            if (_exitBanner.activeSelf != show) _exitBanner.SetActive(show);
            if (!show) return;

            Color accent = locked ? ExitBannerLocked : ExitBannerGold;
            _exitBannerTitle.text = title;
            _exitBannerTitle.color = accent;
            _exitBannerDetail.text = detail;
            _exitBannerOutline.effectColor = new Color(accent.r, accent.g, accent.b, 0.9f);
        }
    }
}
