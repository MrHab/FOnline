using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Adds the authored Noto Sans font to TMP's general fallback list.</summary>
    public static class RoaApocalypseTmpFonts
    {
        private const string CyrillicFontPath = "RealmUi/Fonts/NotoSansCyrillicTMP";
        private static TMP_FontAsset _cyrillic;
        private static bool _fontUnavailable;

        public static void Apply(GameObject root)
        {
            if (root == null || _fontUnavailable || TMP_Settings.instance == null) return;
            if (_cyrillic == null)
            {
                _cyrillic = Resources.Load<TMP_FontAsset>(CyrillicFontPath);
                if (_cyrillic == null)
                {
                    _fontUnavailable = true;
                    Debug.LogWarning("Cyrillic TMP fallback asset is missing: " + CyrillicFontPath);
                    return;
                }
            }

            // TMP searches this list after the label's own font and its fallbacks.
            // Reuse the saved asset; cloning a font shares its atlas and material,
            // which TMP then tries to destroy when the clone is released.
            List<TMP_FontAsset> fallbacks = TMP_Settings.fallbackFontAssets;
            if (fallbacks == null)
            {
                fallbacks = new List<TMP_FontAsset>();
                TMP_Settings.fallbackFontAssets = fallbacks;
            }
            if (!fallbacks.Contains(_cyrillic)) fallbacks.Add(_cyrillic);

            foreach (TMP_Text label in root.GetComponentsInChildren<TMP_Text>(true))
            {
                if (label == null) continue;
                if (label.font == null) label.font = _cyrillic;
                else label.SetVerticesDirty();
            }
        }
    }
}
