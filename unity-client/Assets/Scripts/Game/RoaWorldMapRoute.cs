using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Путь по миру зон для карты мира: кратчайшая цепочка зон через открытые
    /// ворота (поиск в ширину по сторонам «nesw» из /api/world-map) и подсказка,
    /// в какие ворота идти из текущей зоны. Сервер путь не ведёт — игрок идёт сам,
    /// карта только показывает дорогу. Чистые функции: карта и пробы зовут их напрямую.
    /// </summary>
    public static class RoaWorldMapRoute
    {
        public const string Sides = "nesw";

        /// <summary>Индекс зон по клетке сетки: ключ — col * 1000 + row.</summary>
        public static Dictionary<int, JObject> CellIndex(IEnumerable<JObject> zones)
        {
            var index = new Dictionary<int, JObject>();
            foreach (JObject zone in zones)
            {
                if (zone == null) continue;
                index[Key(Col(zone), Row(zone))] = zone;
            }
            return index;
        }

        public static int Col(JObject zone) { return zone?["col"]?.ToObject<int>() ?? -1; }
        public static int Row(JObject zone) { return zone?["row"]?.ToObject<int>() ?? -1; }
        public static string Id(JObject zone) { return zone?["id"]?.ToString() ?? string.Empty; }

        /// <summary>Открыта ли сторона зоны: в ней ворота к соседу.</summary>
        public static bool IsOpen(JObject zone, char side)
        {
            return (zone?["gates"]?.ToString() ?? string.Empty).IndexOf(side) >= 0;
        }

        /// <summary>Соседняя клетка по стороне: север — ряд выше (ряды идут с севера на юг).</summary>
        public static void Step(int col, int row, char side, out int nextCol, out int nextRow)
        {
            nextCol = col + (side == 'e' ? 1 : side == 'w' ? -1 : 0);
            nextRow = row + (side == 's' ? 1 : side == 'n' ? -1 : 0);
        }

        /// <summary>
        /// Кратчайший путь от зоны from до зоны to через открытые ворота — список зон
        /// от первой до последней включительно; пустой, если пути нет.
        /// </summary>
        public static List<JObject> Find(IReadOnlyDictionary<string, JObject> zones, string from, string to)
        {
            var path = new List<JObject>();
            if (zones == null || string.IsNullOrEmpty(from) || string.IsNullOrEmpty(to)) return path;
            if (!zones.TryGetValue(from, out JObject start) || !zones.ContainsKey(to)) return path;
            Dictionary<int, JObject> cells = CellIndex(zones.Values);
            var previous = new Dictionary<string, string>(StringComparer.Ordinal) { [from] = null };
            var queue = new Queue<JObject>();
            queue.Enqueue(start);
            while (queue.Count > 0)
            {
                JObject zone = queue.Dequeue();
                if (Id(zone) == to) break;
                foreach (char side in Sides)
                {
                    if (!IsOpen(zone, side)) continue;
                    Step(Col(zone), Row(zone), side, out int col, out int row);
                    if (!cells.TryGetValue(Key(col, row), out JObject next)) continue;
                    string nextId = Id(next);
                    if (previous.ContainsKey(nextId)) continue;
                    previous[nextId] = Id(zone);
                    queue.Enqueue(next);
                }
            }
            if (!previous.ContainsKey(to)) return path;
            for (string at = to; at != null; at = previous[at]) path.Add(zones[at]);
            path.Reverse();
            return path;
        }

        /// <summary>Сторона, через которую из зоны a попадают в соседнюю зону b; '\0' — не соседи.</summary>
        public static char SideTo(JObject a, JObject b)
        {
            foreach (char side in Sides)
            {
                Step(Col(a), Row(a), side, out int col, out int row);
                if (col == Col(b) && row == Row(b)) return side;
            }
            return '\0';
        }

        public static string GateName(char side)
        {
            switch (side)
            {
                case 'n': return "северные";
                case 'e': return "восточные";
                case 's': return "южные";
                case 'w': return "западные";
                default: return string.Empty;
            }
        }

        /// <summary>«1 зона», «3 зоны», «5 зон».</summary>
        public static string ZonesWord(int count)
        {
            int tens = count % 100;
            int ones = count % 10;
            if (tens >= 11 && tens <= 14) return count + " зон";
            if (ones == 1) return count + " зона";
            if (ones >= 2 && ones <= 4) return count + " зоны";
            return count + " зон";
        }

        /// <summary>Подсказка пути из первой зоны: в какие ворота идти и сколько зон ещё.</summary>
        public static string Hint(IReadOnlyList<JObject> path, string targetName)
        {
            if (path == null || path.Count == 0) return string.Empty;
            string target = string.IsNullOrEmpty(targetName) ? "цели" : "«" + targetName + "»";
            if (path.Count == 1) return "Путь к " + target + ": вы уже в этой зоне.";
            char side = SideTo(path[0], path[1]);
            string next = path[1]?["title"]?.ToString() ?? Id(path[1]);
            return "Путь к " + target + ": " + GateName(side) + " ворота → " + next
                + " · ещё " + ZonesWord(path.Count - 1);
        }

        private static int Key(int col, int row) { return col * 1000 + row; }
    }
}
