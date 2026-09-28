using System.Collections.Generic;
using System;
using TMPro;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Adds the game's Cyrillic face to Synty's Latin display fonts.</summary>
    public static class RoaApocalypseTmpFonts
    {
        private static TMP_FontAsset _cyrillic;
        private static bool _fontUnavailable;
        private static readonly Dictionary<TMP_FontAsset, TMP_FontAsset> Clones =
            new Dictionary<TMP_FontAsset, TMP_FontAsset>();

        public static void Apply(GameObject root)
        {
            if (root == null || _fontUnavailable) return;
            if (_cyrillic == null)
            {
                // TMP Essentials can be absent in a clean checkout until Unity
                // imports them; keep the original Synty face usable meanwhile.
                if (TMP_Settings.instance == null) return;
                Font font = RoaUiFont.Default;
                if (font == null) return;
                try { _cyrillic = TMP_FontAsset.CreateFontAsset(font); }
                catch (Exception error)
                {
                    _fontUnavailable = true;
                    Debug.LogWarning("Cyrillic TMP fallback unavailable: " + error.Message);
                    return;
                }
                if (_cyrillic == null) return;
                _cyrillic.name = "Realm Cyrillic TMP Fallback";
            }
            foreach (TMP_Text label in root.GetComponentsInChildren<TMP_Text>(true))
            {
                if (label == null) continue;
                TMP_FontAsset source = label.font;
                if (source == null)
                {
                    label.font = _cyrillic;
                    continue;
                }
                if (source == _cyrillic || Clones.ContainsValue(source)) continue;
                if (!Clones.TryGetValue(source, out TMP_FontAsset face) || face == null)
                {
                    face = UnityEngine.Object.Instantiate(source);
                    face.name = source.name + " + Cyrillic";
                    if (face.fallbackFontAssetTable == null)
                        face.fallbackFontAssetTable = new List<TMP_FontAsset>();
                    if (!face.fallbackFontAssetTable.Contains(_cyrillic))
                        face.fallbackFontAssetTable.Add(_cyrillic);
                    Clones[source] = face;
                }
                label.font = face;
            }
        }
    }
}
