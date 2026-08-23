using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Общий шрифт uGUI. В Standalone LegacyRuntime.ttf дополняется системными
    /// шрифтами и кириллица есть; в WebGL системных шрифтов нет, поэтому в сборку
    /// вложен Noto Sans (OFL, Resources/RealmUi/Fonts) с полной кириллицей.
    /// </summary>
    public static class RoaUiFont
    {
        private static Font _font;

        public static Font Default
        {
            get
            {
                if (_font != null) return _font;
                _font = Resources.Load<Font>("RealmUi/Fonts/NotoSans");
                if (_font == null) _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                return _font;
            }
        }
    }
}
