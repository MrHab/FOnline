namespace RealmOfAshes.Game
{
    /// <summary>
    /// Русские числительные в интерфейсе: «1 марка», «2 марки», «5 марок».
    /// Форма выбирается по последним цифрам, как в языке: 11–14 всегда берут
    /// последнюю форму, дальше решает последняя цифра.
    /// </summary>
    public static class RoaPlural
    {
        /// <summary>Форма слова при числе: one — 1, few — 2–4, many — 0, 5–20.</summary>
        public static string Form(long count, string one, string few, string many)
        {
            long value = count < 0 ? -count : count;
            long hundred = value % 100;
            if (hundred >= 11 && hundred <= 14) return many;
            switch (value % 10)
            {
                case 1: return one;
                case 2:
                case 3:
                case 4: return few;
                default: return many;
            }
        }

        /// <summary>«12 марок» — число со склонённым словом.</summary>
        public static string Counted(long count, string one, string few, string many)
        {
            return count + " " + Form(count, one, few, many);
        }

        public static string Marks(long count) { return Counted(count, "марка", "марки", "марок"); }
        public static string Days(long count) { return Counted(count, "день", "дня", "дней"); }
        public static string Hours(long count) { return Counted(count, "час", "часа", "часов"); }
        public static string Minutes(long count) { return Counted(count, "минута", "минуты", "минут"); }
        public static string Pieces(long count) { return Counted(count, "штука", "штуки", "штук"); }
    }
}
