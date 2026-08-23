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

        public static string Lite(string url)
        {
            if (!UseLite || string.IsNullOrEmpty(url)) return url;
            return url.Replace("/assets/models/", "/assets/models-lite/");
        }
    }
}
