using System;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Облегчённые модели: tools/optimize-glb.js кладёт копии GLB с JPEG-текстурами
    /// в public/assets/models-lite/, сервер отдаёт их по /assets/models-lite/* с
    /// фолбэком на оригинал (server.js). Оригиналы и их утверждённые хэши не трогаются.
    /// </summary>
    public static class RoaModelUrl
    {
        public static bool UseLite = true;
        public const string WeaponCatalogVersion = "3-e5d409ce";

        public static string Lite(string url)
        {
            if (string.IsNullOrEmpty(url)) return url;

            string resolved = UseLite
                ? url.Replace("/assets/models/", "/assets/models-lite/")
                : url;

            // Weapon GLB filenames remain stable between catalog rebuilds. Give the
            // browser a catalog revision so an older cached model cannot survive a
            // deployment while a newly requested weapon already shows the new art.
            if (resolved.IndexOf("/assets/models-lite/weapons/", StringComparison.OrdinalIgnoreCase) >= 0
                || resolved.IndexOf("/assets/models/weapons/", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                if (resolved.IndexOf("?v=", StringComparison.OrdinalIgnoreCase) < 0
                    && resolved.IndexOf("&v=", StringComparison.OrdinalIgnoreCase) < 0)
                    resolved += (resolved.IndexOf('?') >= 0 ? "&" : "?")
                        + "v=weapon-catalog-" + WeaponCatalogVersion;
            }

            return resolved;
        }
    }
}
