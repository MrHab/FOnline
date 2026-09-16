#if UNITY_EDITOR
using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Вкладка «Клан» ПУТНИКА обязана показывать ответ сервера. Раньше все
    /// клановые и осадные действия отбрасывали отказ, и кнопка просто «не
    /// срабатывала». Проба строит настоящую канву со снятым сокетом: без связи
    /// EmitWithAck отвечает синхронно, так что видно и отказ, и незалипший
    /// флаг ожидания, и сам текст на странице.
    /// </summary>
    public static class RoaPipboyClanStatusProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string Offline = "Нет соединения с сервером. Действие можно повторить после восстановления связи.";

        [MenuItem("Realm of Ashes/Probe/Clan tab status")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                RoaPipboyCanvas canvas = CreateFixture(out host);
                canvas.Open(RoaPipboyCanvas.Page.Clan);

                Text status = Field<Text>(canvas, "_clanStatus");
                Require(status != null, "The clan page owns a status line");
                RectTransform rect = status.rectTransform;
                Require(rect.anchorMin.y == 0f && rect.anchorMax.y == 0f && rect.offsetMax.y - rect.offsetMin.y >= 20f,
                    "The status line sits at the bottom of the page and fits one line");

                // Сводка без связи не приходит: карточка «Сводка запрашивается»
                // больше не висит молча, причина названа.
                Refresh(canvas);
                Require(status.text == Offline, "A failed summary request names the reason: " + status.text);

                // Отказ сервера на клановое действие.
                Call(canvas, "FinishKromkaClanRequest",
                    new JObject { ["ok"] = false, ["error"] = "Нет права выдачи со склада." }, "ok", "fallback");
                Refresh(canvas);
                Require(status.text == "Нет права выдачи со склада.", "A clan refusal reaches the page: " + status.text);

                // Настоящий отправитель: без связи ответ синхронный, флаг не залипает.
                Call(canvas, "SendKromkaClanItemAction", "withdraw", "scrap");
                Refresh(canvas);
                Require(status.text == Offline, "A withdraw without a connection says why: " + status.text);
                Require(!Field<bool>(canvas, "_kromkaClanPending"), "The pending flag is released after the answer");

                Call(canvas, "SendKromkaSiegeAction", "registerSelf", "siege-1", "", 0L);
                Refresh(canvas);
                Require(status.text == Offline, "A siege action without a connection says why: " + status.text);
                Require(!Field<bool>(canvas, "_kromkaClanPending"), "The siege action releases the pending flag");

                // Пока запрос в пути, повторное нажатие не отправляет второй.
                SetField(canvas, "_kromkaClanPending", true);
                SetField(canvas, "_kromkaClanStatus", "Клановый узел проверяет запрос…");
                Call(canvas, "SendKromkaClanItemAction", "withdraw", "scrap");
                Require(Field<string>(canvas, "_kromkaClanStatus") == "Клановый узел проверяет запрос…",
                    "A second press while waiting is ignored");
                SetField(canvas, "_kromkaClanPending", false);

                // Успех называет сделанное.
                Call(canvas, "FinishKromkaClanRequest", new JObject { ["ok"] = true }, "Содержание базы оплачено.", "fallback");
                Refresh(canvas);
                Require(status.text == "Содержание базы оплачено.", "A success is named: " + status.text);
                Require(RoaPipboyCanvas.KromkaSiegeSuccessText("registerSelf") == "Вы записаны в состав осады.",
                    "Siege successes have their own words");

                // Социальные действия вкладки ведёт общая строка ПУТНИКА: новее
                // побеждает, старый клановый текст уступает ответу на выход.
                Call(canvas, "SubmitClanSocial", "leaveClan", null, null);
                Refresh(canvas);
                Require(status.text == canvas.Pipboy.ProgressionStatus && !string.IsNullOrEmpty(status.text),
                    "Social clan actions show the shared terminal line: " + status.text);

                // Пока ПУТНИК ждёт прошлый ответ, он молча откажет — об этом сказано.
                typeof(RoaPipboy).GetField("_pending", Private).SetValue(canvas.Pipboy, true);
                Call(canvas, "SubmitClanSocial", "leaveClan", null, null);
                Require(status.text == "Дождитесь ответа на предыдущее действие.",
                    "A social press while the terminal waits says so: " + status.text);
                typeof(RoaPipboy).GetField("_pending", Private).SetValue(canvas.Pipboy, false);

                // Самая длинная причина помещается в строку настоящим шрифтом страницы.
                Call(canvas, "SetKromkaClanStatus", Offline);
                Canvas.ForceUpdateCanvases();
                Require(status.preferredHeight <= status.rectTransform.rect.height + 1f,
                    "The longest refusal fits the status line: " + status.preferredHeight + " > " + status.rectTransform.rect.height);

                Debug.Log("[CLAN TAB STATUS] OK: refusals, offline answers and successes reach the clan page, the pending flag never sticks.");
            }
            finally
            {
                // Канва строится дочерней к стенду и уходит вместе с ним.
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static RoaPipboyCanvas CreateFixture(out GameObject host)
        {
            host = new GameObject("ClanStatusProbe");
            var socket = host.AddComponent<RoaSocketClient>();
            socket.enabled = false;
            var self = new JObject
            {
                ["name"] = "Проба",
                ["level"] = 5,
                ["socialState"] = new JObject
                {
                    ["clan"] = new JObject { ["id"] = "zavet", ["name"] = "Завет", ["role"] = "Участник" }
                }
            };
            typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, new JoinAck { Self = self });
            var pipboy = host.AddComponent<RoaPipboy>();
            pipboy.enabled = false;
            pipboy.Socket = socket;
            pipboy.CanvasDriven = true;
            typeof(RoaPipboy).GetMethod("ApplySelf", Private).Invoke(pipboy, new object[] { self });
            var canvas = host.AddComponent<RoaPipboyCanvas>();
            canvas.enabled = false;
            canvas.Socket = socket;
            canvas.Pipboy = pipboy;
            return canvas;
        }

        private static void Refresh(RoaPipboyCanvas canvas)
        {
            Call(canvas, "RefreshKromkaClanStatus");
        }

        private static void Call(RoaPipboyCanvas canvas, string method, params object[] args)
        {
            MethodInfo info = typeof(RoaPipboyCanvas).GetMethod(method, Private);
            if (info == null) throw new Exception("[CLAN TAB STATUS] RoaPipboyCanvas has no " + method);
            info.Invoke(canvas, args);
        }

        private static T Field<T>(RoaPipboyCanvas canvas, string name)
        {
            FieldInfo info = typeof(RoaPipboyCanvas).GetField(name, Private);
            if (info == null) throw new Exception("[CLAN TAB STATUS] RoaPipboyCanvas has no field " + name);
            return (T)info.GetValue(canvas);
        }

        private static void SetField(RoaPipboyCanvas canvas, string name, object value)
        {
            FieldInfo info = typeof(RoaPipboyCanvas).GetField(name, Private);
            if (info == null) throw new Exception("[CLAN TAB STATUS] RoaPipboyCanvas has no field " + name);
            info.SetValue(canvas, value);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[CLAN TAB STATUS] " + message);
        }
    }
}
#endif
