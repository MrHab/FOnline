#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Читаемость интерфейса на настольном и мобильном альбомном экране.
    ///
    /// Остальные пробы проверяют только текст строк, а здесь меряется сама
    /// раскладка: панель мировых событий обрезает всё, что не поместилось
    /// (VerticalWrapMode.Truncate), поэтому длинная строка про аванпосты или
    /// зал лаборатории просто исчезает с экрана, и ни один строковый тест
    /// этого не заметит. Текст рисуется тем же шрифтом и кеглем, что и в игре,
    /// в коробке того же размера, и сравнивается с её высотой.
    ///
    /// Экраны берутся настоящие: 1920×1080 (настольный) и 960×540 (телефон в
    /// альбомной ориентации, 16:9). Размер канвы считается по формуле
    /// CanvasScaler.ScaleWithScreenSize, как в рантайме.
    /// </summary>
    public static class RoaMobileLayoutProbe
    {
        private static readonly Vector2 DesktopScreen = new Vector2(1920f, 1080f);
        private static readonly Vector2 MobileScreen = new Vector2(960f, 540f);

        [MenuItem("Realm of Ashes/Probe/Mobile layout")]
        public static void Run()
        {
            GameObject host = new GameObject("MobileLayoutProbe");
            try
            {
                // --- панель мировых событий ------------------------------------------
                // Панель показывает блок той комнаты, где стоит игрок: аванпосты
                // только в Сердцевине, событие — в своей комнате, босс — в
                // установке, зал — в лаборатории. Поэтому меряется каждый блок
                // отдельно, а не их невозможная сумма.
                foreach (var block in WorldEventsBlocks())
                {
                    foreach (bool mobile in new[] { false, true })
                    {
                        Vector2 panel = RoaWorldEventsPresentation.PanelSize(mobile);
                        float width = panel.x - RoaWorldEventsPresentation.PanelPadding * 2f;
                        // Панель растёт под текст до своего предела; за ним текст
                        // обрезается, и игрок хвоста не увидит.
                        float height = RoaWorldEventsPresentation.PanelMaxHeight(mobile)
                            - RoaWorldEventsPresentation.PanelPadding * 2f;
                        float needed = TextHeight(host, block.Value, RoaWorldEventsPresentation.PanelFontSize(mobile), width);
                        Debug.Log("[MOBILE LAYOUT] " + (mobile ? "mobile" : "desktop") + " «" + block.Key + "»: "
                            + Mathf.CeilToInt(needed) + " / " + Mathf.FloorToInt(height) + " px");
                        Require(needed <= height,
                            (mobile ? "mobile" : "desktop") + ": the world events panel cuts «" + block.Key + "» — "
                            + Mathf.CeilToInt(needed) + " px of text in a " + Mathf.FloorToInt(height) + " px box");
                    }
                }

                // --- модал правил зоны -------------------------------------------------
                var rules = JObject.Parse(@"{'mode':'pvpFullDrop','label':'Сердцевина: PvP между фракциями',
                    'lossLabel':'Выпадает рюкзак; экипировка и установленные артефакты остаются.',
                    'pvpLabel':'PvP разрешено между разными фракциями.',
                    'accessLabel':'Вход только для членов фракций Сердцевины.','confirmBeforeEntry':true}");
                float zoneNeeded = TextHeight(host, RoaGlobalMapCanvas.ZoneRulesDescription(rules), 12, 416f);
                Debug.Log("[MOBILE LAYOUT] zone rules modal: " + Mathf.CeilToInt(zoneNeeded) + " / 142 px");
                Require(zoneNeeded <= 142f,
                    "the zone rules modal cuts its own text — " + Mathf.CeilToInt(zoneNeeded) + " px of text in a 142 px box");

                // --- окно контракта фракции --------------------------------------------
                // Панель 540×380: вступление, четыре строки фракций и подсказка.
                var contract = JObject.Parse(@"{'displayName':'Сердцевина','characters':128,'signedCharacters':96,'canSign':true,
                    'changeLocked':true,'changeAllowedInHours':71,'changeCooldownMs':259200000}");
                // Коробкам с жёсткой высотой нужен запас: текст меняется по числу
                // подписавших и по длине названий фракций.
                const float Headroom = 6f;
                float introNeeded = TextHeight(host, RoaGlobalMapCanvas.ContractIntroText(contract), 12, 500f);
                Debug.Log("[MOBILE LAYOUT] contract intro: " + Mathf.CeilToInt(introNeeded) + " / 70 px");
                Require(introNeeded + Headroom <= 70f,
                    "the contract window leaves no room for its intro — " + Mathf.CeilToInt(introNeeded) + " px of text in a 70 px box");
                var contractRow = JObject.Parse(@"{'factionId':'free_artels','displayName':'Вольные артели','sharePct':37,
                    'characters':47,'baseDisplayName':'Артельный узел','canSign':false,'reason':'Смена фракции будет доступна через 71 ч.'}");
                float rowNeeded = TextHeight(host, RoaGlobalMapCanvas.ContractRowText(contractRow, false), 12, 480f);
                Debug.Log("[MOBILE LAYOUT] contract row: " + Mathf.CeilToInt(rowNeeded) + " / 34 px");
                Require(rowNeeded <= 34f,
                    "a faction row in the contract window does not fit its button — " + Mathf.CeilToInt(rowNeeded) + " px in a 34 px box");
                // Четыре строки фракций не должны налезть на подсказку внизу окна.
                float lastRowBottom = 158f + 3f * 38f;
                float hintTop = 380f - 98f;
                Debug.Log("[MOBILE LAYOUT] contract rows end at " + lastRowBottom + " px, hint starts at " + hintTop + " px");
                Require(lastRowBottom <= hintTop,
                    "the faction rows of the contract window overlap its hint");

                // --- подсказка предмета (ПУТНИК) ---------------------------------------
                // Ширина 280 с отступами 10, шрифт 11, высота растёт под текст —
                // но не должна вылезти за экран телефона.
                var record = JObject.Parse(@"{'id':'r1','typeId':'spring','itemId':'artifactSpring','tier':4,'tierShort':'Т4','tierName':'Чистый',
                    'stabilized':true,'hot':false,'revealed':true,'benefit':'Скорость +8%','cost':'Электрический урон +20%',
                    'properties':{'benefitMul':1.79,'drawbackMul':0.87,'primary':{'key':'speedPct','value':0.1432},
                    'secondary':[{'key':'apRegenPct','value':0.179}],'drawback':[{'key':'resistances.electric','value':-0.174}]},
                    'salvageYields':[{'id':'stabilizerCatalyst','qty':1}]}");
                var beltEffects = JObject.Parse(@"{'artifactTypeIds':['spring','vein','node'],'speedPct':0.18,'carryKg':12,
                    'regenHpPerSecond':0.4,'meleeDamagePct':0.06,
                    'caps':{'speedPct':0.18,'carryKg':30,'regenHpPerSecond':1,'resistancePct':0.6,'secondarySimilarEffectMultiplier':0.5}}");
                string tip = RoaPipboyCanvas.ArtifactCardSummary(record, 2) + " · " + RoaPipboyCanvas.BeltTotalsLine(beltEffects);
                float tipNeeded = TextHeight(host, tip, 11, 260f) + 40f;
                Vector2 phone = CanvasSize(MobileScreen, RoaUiScale.ReferenceFor(true));
                Debug.Log("[MOBILE LAYOUT] item tooltip: " + Mathf.CeilToInt(tipNeeded) + " / " + Mathf.FloorToInt(phone.y - 40f) + " px");
                Require(tipNeeded <= phone.y - 40f,
                    "the item tooltip runs off a landscape phone — " + Mathf.CeilToInt(tipNeeded) + " px on a "
                    + Mathf.FloorToInt(phone.y) + " px canvas");

                // --- панель на экране --------------------------------------------------
                // Панель прижата к правому верхнему углу; на альбомном телефоне
                // канва шире опорной, но панель обязана остаться внутри неё.
                foreach (bool mobile in new[] { false, true })
                {
                    Vector2 canvas = CanvasSize(mobile ? MobileScreen : DesktopScreen, RoaUiScale.ReferenceFor(mobile));
                    Vector2 panel = RoaWorldEventsPresentation.PanelSize(mobile);
                    Vector2 button = RoaWorldEventsPresentation.ButtonSize(mobile);
                    float margin = mobile ? 12f : 16f;
                    float top = mobile ? 58f : 84f;
                    float gap = mobile ? 8f : 10f;
                    // Разросшаяся панель и обе кнопки под ней обязаны остаться на экране.
                    float stack = top + RoaWorldEventsPresentation.PanelMaxHeight(mobile) + gap * 2f + button.y * 2f + margin;
                    Require(panel.x + margin * 2f <= canvas.x,
                        (mobile ? "mobile" : "desktop") + ": the world events panel is wider than the screen");
                    Require(stack <= canvas.y,
                        (mobile ? "mobile" : "desktop") + ": the grown panel and its buttons run off the screen — "
                        + Mathf.CeilToInt(stack) + " px on a " + Mathf.FloorToInt(canvas.y) + " px canvas");
                }

                Finish();
                Debug.Log("[MOBILE LAYOUT] OK: world events panel, zone rules modal, contract window and item tooltip keep their text on desktop and on a landscape phone.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        /// <summary>
        /// Размер канвы в её единицах для данного экрана: так же, как это делает
        /// CanvasScaler в режиме ScaleWithScreenSize с match 0.5.
        /// </summary>
        public static Vector2 CanvasSize(Vector2 screen, Vector2 reference)
        {
            float scale = Mathf.Pow(screen.x / reference.x, 0.5f) * Mathf.Pow(screen.y / reference.y, 0.5f);
            if (scale <= 0f) return reference;
            return new Vector2(screen.x / scale, screen.y / scale);
        }

        /// <summary>
        /// Высота текста тем же шрифтом и кеглем, что в игре, при заданной ширине
        /// строки. Меряется настоящим uGUI-компонентом, а не оценкой по символам.
        /// </summary>
        private static float TextHeight(GameObject host, string content, int fontSize, float width)
        {
            var go = new GameObject("Measure", typeof(RectTransform));
            go.transform.SetParent(host.transform, false);
            var text = go.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = fontSize;
            text.supportRichText = true;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            text.alignment = TextAnchor.UpperLeft;
            text.text = content;
            var rect = (RectTransform)go.transform;
            rect.sizeDelta = new Vector2(width, 4000f);
            float height = text.preferredHeight;
            UnityEngine.Object.DestroyImmediate(go);
            return height;
        }

        /// <summary>
        /// Блоки панели в их худшем виде. Одновременно показывается один блок —
        /// тот, что относится к комнате игрока.
        /// </summary>
        private static System.Collections.Generic.Dictionary<string, string> WorldEventsBlocks()
        {
            var territory = JObject.Parse(@"{'zoneLocationId':'coreZone','factionNames':{'uprava':'Управа','free_artels':'Артели'},'outposts':[
                {'id':'north','displayName':'Северный','ownerFactionId':'uprava','eventStatus':'closed','eventOpensInMs':754000,'capture':{'progress':{},'leadingFactionId':'','contested':false},'garrison':{'state':'arrived'}},
                {'id':'east','displayName':'Восточный','ownerFactionId':'','eventStatus':'open','eventOpensInMs':0,'capture':{'progress':{'free_artels':0.42},'leadingFactionId':'free_artels','contested':true},'garrison':{'state':'enroute'},'retiring':[{'factionId':'free_artels','progress':0.4}]}],
                'rules':{'captureHoldMs':180000,'captureDecayRate':0.5,'contestPausesProgress':true}}");
            var publicEvent = JObject.Parse(@"{'roomId':'randomAshGrove#pubev_1','displayName':'База налётчиков','remainingSeconds':1500,'warning':true,'cleared':false,
                'danger':4,'boss':{'displayName':'Главарь налётчиков','alive':true,'killed':false},
                'scenario':{'supports':[{'id':'a','displayName':'Защитный генератор','alive':true,'side':'северо-восток'},{'id':'b','displayName':'Радиостанция','alive':true,'side':'юго-запад'}],
                'shielded':true,'strike':{'kind':'grenade','displayName':'Гранатный удар','telegraph':false,'inSeconds':7},'hazards':[{'id':'ground_0'},{'id':'ground_1'}]}}");
            var boss = JObject.Parse(@"{'roomId':'coreLabCenterReactor','displayName':'Хранитель Нуля','phase':'shielded','phaseLabel':'Щит активен','nodesAlive':3,'nodesTotal':4,
                'pulseInSeconds':12,'pulseTelegraph':false,'bossHp':1800,'bossMaxHp':1800,'pulseRadius':9,'hazards':[{'id':'h0','x':9,'z':0,'radius':5},{'id':'h1','x':-4,'z':7,'radius':5}]}");
            var lab = JObject.Parse(@"{'roomId':'coreLabCircuit','meterLabel':'Перегрузка','meter':0.62,'hazardName':'Разряд по залу','telegraph':true,'telegraphInSeconds':3,
                'guardShielded':true,'nodes':[{'id':'node_a','displayName':'Распределительный щит','readyInSeconds':0},{'id':'node_b','displayName':'Распределительный щит','readyInSeconds':12}]}");
            return new System.Collections.Generic.Dictionary<string, string>
            {
                ["аванпосты"] = RoaWorldEventsPresentation.DescribeOutposts(territory, "coreZone"),
                ["публичное событие"] = RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 0),
                ["мировой босс"] = RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 0),
                ["зал лаборатории"] = RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabCircuit")
            };
        }

        private static readonly System.Collections.Generic.List<string> Problems = new System.Collections.Generic.List<string>();

        private static void Require(bool condition, string message)
        {
            if (condition) return;
            Debug.LogError("[MOBILE LAYOUT] FAIL: " + message);
            Problems.Add(message);
        }

        private static void Finish()
        {
            if (Problems.Count == 0) return;
            string all = string.Join("; ", Problems);
            Problems.Clear();
            throw new Exception(all);
        }
    }
}
#endif
