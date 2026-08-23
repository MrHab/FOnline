using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Локально сохраняемая раскладка основных HUD-панелей.</summary>
    public static class RoaHudLayout
    {
        private const string Prefix = "roa.hud.";
        private static readonly string[] KnownIds = { "status", "minimap", "combatLog", "quickbar" };
        private static string _dragId = string.Empty;
        private static Vector2 _dragOffset;

        public static bool Editing { get; private set; }

        /// <summary>Растёт при Reset — канва-панели переприменяют смещения.</summary>
        public static int ResetVersion { get; private set; }

        private static readonly string[] CanvasIds = { "status", "minimap", "console", "quickbar", "combatLog" };

        /// <summary>Смещение канва-панели относительно авторской позиции (единицы канвы).</summary>
        public static Vector2 CanvasOffset(string id)
        {
            return new Vector2(PlayerPrefs.GetFloat(Prefix + "canvas." + id + ".dx", 0f),
                               PlayerPrefs.GetFloat(Prefix + "canvas." + id + ".dy", 0f));
        }

        public static void SetCanvasOffset(string id, Vector2 offset, bool save)
        {
            PlayerPrefs.SetFloat(Prefix + "canvas." + id + ".dx", offset.x);
            PlayerPrefs.SetFloat(Prefix + "canvas." + id + ".dy", offset.y);
            if (save) PlayerPrefs.Save();
        }

        public static void SetEditing(bool enabled)
        {
            Editing = enabled;
            if (!enabled) _dragId = string.Empty;
        }

        public static Rect Resolve(string id, Rect fallback)
        {
            string xKey = Prefix + id + ".x";
            string yKey = Prefix + id + ".y";
            if (PlayerPrefs.HasKey(xKey) && PlayerPrefs.HasKey(yKey))
                fallback.position = new Vector2(PlayerPrefs.GetFloat(xKey), PlayerPrefs.GetFloat(yKey));
            return Clamp(fallback);
        }

        public static void HandleDrag(string id, ref Rect rect, string label)
        {
            if (!Editing) return;
            Event current = Event.current;
            if (current == null) return;

            if (current.type == EventType.MouseDown && current.button == 0 && rect.Contains(current.mousePosition))
            {
                _dragId = id;
                _dragOffset = current.mousePosition - rect.position;
                current.Use();
            }
            else if (current.type == EventType.MouseDrag && current.button == 0 && _dragId == id)
            {
                rect.position = current.mousePosition - _dragOffset;
                rect = Clamp(rect);
                PlayerPrefs.SetFloat(Prefix + id + ".x", rect.x);
                PlayerPrefs.SetFloat(Prefix + id + ".y", rect.y);
                current.Use();
            }
            else if (current.type == EventType.MouseUp && current.button == 0 && _dragId == id)
            {
                _dragId = string.Empty;
                PlayerPrefs.Save();
                current.Use();
            }

            DrawFrame(rect, label);
        }

        public static void Reset()
        {
            foreach (string id in KnownIds)
            {
                PlayerPrefs.DeleteKey(Prefix + id + ".x");
                PlayerPrefs.DeleteKey(Prefix + id + ".y");
            }
            foreach (string id in CanvasIds)
            {
                PlayerPrefs.DeleteKey(Prefix + "canvas." + id + ".dx");
                PlayerPrefs.DeleteKey(Prefix + "canvas." + id + ".dy");
            }
            PlayerPrefs.Save();
            ResetVersion++;
        }

        private static Rect Clamp(Rect rect)
        {
            float maxX = Mathf.Max(6f, Screen.width - rect.width - 6f);
            float maxY = Mathf.Max(6f, Screen.height - rect.height - 6f);
            rect.x = Mathf.Clamp(rect.x, 6f, maxX);
            rect.y = Mathf.Clamp(rect.y, 6f, maxY);
            return rect;
        }

        private static void DrawFrame(Rect rect, string label)
        {
            Color previous = GUI.color;
            GUI.color = new Color(1f, 0.74f, 0.20f, 0.95f);
            GUI.DrawTexture(new Rect(rect.x, rect.y, rect.width, 2f), Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(rect.x, rect.yMax - 2f, rect.width, 2f), Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(rect.x, rect.y, 2f, rect.height), Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(rect.xMax - 2f, rect.y, 2f, rect.height), Texture2D.whiteTexture);
            GUI.Label(new Rect(rect.x + 5f, rect.y + 3f, rect.width - 10f, 20f), "↕ " + label);
            GUI.color = previous;
        }
    }
}
