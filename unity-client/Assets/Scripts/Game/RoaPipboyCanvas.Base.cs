using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaPipboyCanvas
    {
        private Text _personalBaseSummary;

        private void BuildPersonalBasePage(RectTransform pageArea)
        {
            RectTransform page = Page_(Page.Base, pageArea);
            Text title = Label("Title", page, 22, TextAnchor.UpperLeft, ScreenInk, FontStyle.Bold);
            title.rectTransform.anchorMin = new Vector2(0f, 1f); title.rectTransform.anchorMax = new Vector2(1f, 1f);
            title.rectTransform.offsetMin = new Vector2(12f, -50f); title.rectTransform.offsetMax = new Vector2(-12f, -8f);
            title.text = "ЛИЧНОЕ УБЕЖИЩЕ";

            _personalBaseSummary = Label("BaseSummary", page, 17, TextAnchor.UpperLeft, ScreenInk);
            _personalBaseSummary.rectTransform.anchorMin = new Vector2(0f, 0.25f); _personalBaseSummary.rectTransform.anchorMax = new Vector2(1f, 1f);
            _personalBaseSummary.rectTransform.offsetMin = new Vector2(20f, 0f); _personalBaseSummary.rectTransform.offsetMax = new Vector2(-20f, -72f);
            _personalBaseSummary.text = "Получаем запись участка…";

            Button manage = TextButton("ManageBase", page, "ОТКРЫТЬ УПРАВЛЕНИЕ УБЕЖИЩЕМ", 15, out Text manageLabel);
            manageLabel.color = AccentWarm;
            RectTransform rect = (RectTransform)manage.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.12f); rect.pivot = new Vector2(0.5f, 0.5f);
            rect.sizeDelta = new Vector2(430f, 54f);
            manage.onClick.AddListener(() => { Close(); PersonalBaseCanvas?.Open(); });
        }

        private void RefreshPersonalBasePage()
        {
            if (_personalBaseSummary == null) return;
            _personalBaseSummary.text = (PersonalBaseCanvas != null ? PersonalBaseCanvas.Summary : "Модуль убежища недоступен.")
                + "\n\nЛичная база существует только для вашего аккаунта. Её нет на глобальной карте, её нельзя захватить или ограбить в PvP."
                + "\n\nСтроительство подтверждает сервер: сетка, границы, материалы, коллизии, энергия, вода и лимиты площадки."
                + "\n\nЖители работают здесь и никогда не становятся управляемым отрядом.";
        }
    }
}
