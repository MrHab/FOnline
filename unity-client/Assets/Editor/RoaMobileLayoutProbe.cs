#if UNITY_EDITOR
using System;
using System.Reflection;
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

                // --- панель счёта осады ---------------------------------------------------
                // Худший случай: фаза передатчиков, три претендента с обрезанными
                // длинными именами, прогноз квалификации, реплика и строка возрождений.
                var siege = JObject.Parse(@"{'status':'active','phase':'relay','phaseEndsAt':1800000300000,
                    'defenderClanId':'def','defenderName':'Нейтральный гарнизон очень длинный',
                    'challengers':[{'clanId':'a','name':'Первый очень длинный клан Кромки','declaredAt':1},
                                   {'clanId':'b','name':'Второй очень длинный клан Кромки','declaredAt':2},
                                   {'clanId':'c','name':'Третий очень длинный клан Кромки','declaredAt':3}],
                    'rosters':{'a':['me']},'relayOwners':{'relay_a':'a','relay_b':'b','relay_c':'c'},
                    'relayScores':{'a':1,'b':1,'c':1},'respawnWaves':{'a':1},'respawnWavesPerSide':3}");
                string siegeText = RoaKromkaSiegePresentation.DescribeSiege(siege, "a", 1800000000000L);
                foreach (bool mobile in new[] { false, true })
                {
                    Vector2 siegePanel = RoaKromkaSiegePresentation.PanelSize(mobile);
                    float pad = RoaKromkaSiegePresentation.PanelPadding;
                    float siegeNeeded = TextHeight(host, siegeText, RoaKromkaSiegePresentation.PanelFontSize(mobile), siegePanel.x - pad * 2f);
                    float siegeRoom = RoaKromkaSiegePresentation.PanelMaxHeight(mobile) - pad * 2f;
                    Debug.Log("[MOBILE LAYOUT] " + (mobile ? "mobile" : "desktop") + " siege score: "
                        + Mathf.CeilToInt(siegeNeeded) + " / " + siegeRoom + " px");
                    Require(siegeNeeded <= siegeRoom,
                        "the siege score does not fit its panel — " + Mathf.CeilToInt(siegeNeeded) + " px in " + siegeRoom + " px: " + siegeText);
                    // Панель растёт вниз от баннера PvP и не должна дойти до кнопки
                    // действия у нижнего края (28 + 46).
                    Vector2 canvasSize = CanvasSize(mobile ? MobileScreen : DesktopScreen, RoaUiScale.ReferenceFor(mobile));
                    float bottom = -RoaKromkaSiegePresentation.PanelTop + RoaKromkaSiegePresentation.PanelMaxHeight(mobile);
                    Require(bottom + 28f + 46f + 12f <= canvasSize.y,
                        "the siege panel reaches the action button: bottom " + bottom + " of " + canvasSize.y);
                }

                // --- строка защиты в окне контейнера -----------------------------------
                // Колонка окна лута шириной 620 × 0,94 минус отступы прокрутки и
                // самой строки: текст защиты обязан уместиться в свою строку.
                var safe = JObject.Parse(@"{'locked':true,'lockDifficultyLabel':'Очень сложный','lockRequiredSkill':90,
                    'terminalLocked':true,'terminalDifficultyLabel':'Очень сложный','terminalRequiredSkill':90,
                    'terminalName':'Пульт аварийной секции','terminalUnlocksLock':true,
                    'lockCooldownUntil':45000,'terminalCooldownUntil':45000}");
                const float SecurityWidth = 620f * 0.94f - 8f - 12f;
                foreach (bool asTerminal in new[] { false, true })
                {
                    string line = RoaInteraction.SecurityLine(safe, asTerminal, 1000L);
                    float needed = TextHeight(host, line, 12, SecurityWidth);
                    Debug.Log("[MOBILE LAYOUT] container security (" + (asTerminal ? "терминал" : "замок") + "): "
                        + Mathf.CeilToInt(needed) + " / " + RoaLootCanvas.SecurityRowHeight + " px");
                    Require(needed <= RoaLootCanvas.SecurityRowHeight,
                        "the security line of a container does not fit its row — " + Mathf.CeilToInt(needed)
                        + " px of text in a " + RoaLootCanvas.SecurityRowHeight + " px row: " + line);
                }

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

                // --- подписи кнопок под панелью ----------------------------------------
                // Самая длинная подпись — оспариваемое вскрытие. У подписи обрезание,
                // и перенос на вторую строку оставлял на кнопке «ВСКРЫТИЕ 100% ·».
                var contested = JObject.Parse(@"{'characterId':'me','channelMs':8000,'progressMs':8000,'contested':true}");
                CheckWorldEventsButtons(RoaWorldEventsPresentation.ChestButtonLabel(contested));

                // --- баннер Сдвига ---------------------------------------------------------
                CheckShiftBanner();

                Finish();
                Debug.Log("[MOBILE LAYOUT] OK: world events panel and its buttons, shift banner, container security row, siege score and item tooltip keep their text on desktop and on a landscape phone.");
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
            text.font = RoaUiFont.Default;
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

        /// <summary>
        /// Подписи кнопок «Искать следы» и вскрытия тайника меряются на настоящих
        /// кнопках панели, вложенным шрифтом (другого в WebGL нет) и на канве
        /// нужного экрана: от её масштаба зависит, где перенесётся строка.
        /// Редактор строит настольную раскладку, мобильные размер и кегль
        /// ставятся из тех же функций, что читает BuildUi.
        /// </summary>
        private static void CheckWorldEventsButtons(string chestLabel)
        {
            foreach (bool mobile in new[] { false, true })
            {
                string screenName = mobile ? "mobile" : "desktop";
                var host = new GameObject("WorldEventsButtonsProbe");
                var trash = new System.Collections.Generic.List<UnityEngine.Object> { host };
                try
                {
                    host.AddComponent<RoaWorldEventsPresentation>().Configure(null);
                    Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                    PutOnScreen(canvas, mobile ? MobileScreen : DesktopScreen, trash);
                    var labels = new System.Collections.Generic.Dictionary<string, string>
                    {
                        ["OpenChest"] = chestLabel,
                        ["SearchTracks"] = "ИСКАТЬ СЛЕДЫ · 120 с"
                    };
                    foreach (var pair in labels)
                    {
                        var button = (RectTransform)canvas.transform.Find(pair.Key);
                        Text label = button.Find("Label").GetComponent<Text>();
                        if (!mobile)
                        {
                            Require(button.sizeDelta == RoaWorldEventsPresentation.ButtonSize(false)
                                && label.fontSize == RoaWorldEventsPresentation.ButtonFontSize(false),
                                "the " + pair.Key + " button is not built from ButtonSize/ButtonFontSize");
                        }
                        button.gameObject.SetActive(true);
                        button.sizeDelta = RoaWorldEventsPresentation.ButtonSize(mobile);
                        label.fontSize = RoaWorldEventsPresentation.ButtonFontSize(mobile);
                        label.font = RoaUiFont.Default;
                        label.text = pair.Value;
                        Canvas.ForceUpdateCanvases();
                        float needed = label.preferredHeight;
                        float box = label.rectTransform.rect.height;
                        Debug.Log("[MOBILE LAYOUT] " + screenName + " button «" + pair.Value + "»: "
                            + needed.ToString("0.#") + " / " + box.ToString("0.#") + " units at canvas scale "
                            + canvas.scaleFactor.ToString("0.###"));
                        Require(needed <= box,
                            screenName + ": the world events button cuts «" + pair.Value + "» — "
                            + needed.ToString("0.#") + " units of text in a " + box.ToString("0.#") + " unit label");
                    }
                }
                finally { DestroyAll(trash); }
            }
        }

        /// <summary>
        /// Баннер Сдвига вверху по центру. Сдвиг или буря с разбуженными полями
        /// дают строку в две строки: баннер обязан показать её целиком и в полном
        /// кегле (у подписи обрезание и подгонка размера — ужатая строка значит,
        /// что баннер не вырос) и не наехать на баннер режима зоны HUD под собой.
        /// Канвы у них разные (баннер — 1600×900, HUD — RoaUiScale), поэтому
        /// сверяются пиксели экрана.
        /// </summary>
        private static void CheckShiftBanner()
        {
            const float MinGapPixels = 6f;
            var shifts = new[]
            {
                JObject.Parse(@"{'phase':'warning','remainingMs':300000,'strength':2,'fieldsExcited':false}"),
                JObject.Parse(@"{'phase':'aftermath','remainingMs':1200000,'strength':2,
                    'fieldsExcited':true,'fieldsExcitedSeconds':1800,'fieldsChanceMultiplier':10}"),
                JObject.Parse(@"{'phase':'active','remainingMs':1200000,'strength':3,'sheltered':false,
                    'fieldsExcited':true,'fieldsExcitedSeconds':1800,'fieldsChanceMultiplier':10}"),
                // Самая длинная строка бури: откуда, сила, км, через сколько, укрытие и поля.
                JObject.Parse(@"{'phase':'warning','remainingMs':600000,'strength':3,'sheltered':true,
                    'fieldsExcited':true,'fieldsExcitedSeconds':1800,'fieldsChanceMultiplier':10,
                    'storm':{'id':'probe','strength':3,'phase':'warning','dirX':0.7071,'dirY':0.7071,
                        'here':{'inside':false,'passed':false,'aheadKm':120,'etaSeconds':2700}}}")
            };
            MethodInfo applyShift = typeof(RoaKromkaShiftAndDetector).GetMethod("ApplyShift",
                BindingFlags.Instance | BindingFlags.NonPublic);
            FieldInfo waveField = typeof(RoaKromkaShiftAndDetector).GetField("_shiftWave",
                BindingFlags.Instance | BindingFlags.NonPublic);
            if (applyShift == null || waveField == null)
                throw new InvalidOperationException("[MOBILE LAYOUT] RoaKromkaShiftAndDetector.ApplyShift/_shiftWave not found");
            foreach (bool mobile in new[] { false, true })
            {
                string screenName = mobile ? "mobile" : "desktop";
                Vector2 screen = mobile ? MobileScreen : DesktopScreen;
                var host = new GameObject("ShiftBannerProbe");
                var trash = new System.Collections.Generic.List<UnityEngine.Object> { host };
                try
                {
                    var view = host.AddComponent<RoaKromkaShiftAndDetector>();
                    view.Configure(null, null);
                    Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                    PutOnScreen(canvas, screen, trash);
                    var panel = (RectTransform)canvas.transform.Find("ShiftWarning");
                    Text text = panel.Find("ShiftText").GetComponent<Text>();
                    text.font = RoaUiFont.Default;
                    // Баннер режима зоны стоит в HUD под безопасной областью; на
                    // альбомном телефоне она начинается у верхнего края экрана.
                    float hudScale = screen.y / CanvasSize(screen, RoaUiScale.ReferenceFor(mobile)).y;
                    float zoneTop = RoaHudCanvas.ZoneBannerTop * hudScale;
                    float tallest = (RoaKromkaShiftAndDetector.ShiftBannerTop + RoaKromkaShiftAndDetector.ShiftBannerMaxHeight)
                        * canvas.scaleFactor;
                    Require(tallest + MinGapPixels <= zoneTop,
                        screenName + ": the shift banner at its full height reaches the HUD zone banner — bottom "
                        + tallest.ToString("0.#") + " px, zone banner top " + zoneTop.ToString("0.#") + " px");
                    foreach (JObject shift in shifts)
                    {
                        applyShift.Invoke(view, new object[] { shift, null });
                        var wave = waveField.GetValue(view) as LineRenderer;
                        if (wave != null && !trash.Contains(wave.gameObject)) { trash.Add(wave.sharedMaterial); trash.Add(wave.gameObject); }
                        Canvas.ForceUpdateCanvases();
                        // С подгонкой размера preferredHeight не годится: сверяются
                        // видимые символы и кегль в рамке против рамки без предела.
                        Vector2 box = text.rectTransform.rect.size;
                        var inBox = new TextGenerator();
                        inBox.Populate(text.text, text.GetGenerationSettings(box));
                        var unbounded = new TextGenerator();
                        unbounded.Populate(text.text, text.GetGenerationSettings(new Vector2(box.x, 4000f)));
                        float bottom = (-panel.anchoredPosition.y + panel.rect.height) * canvas.scaleFactor;
                        Debug.Log("[MOBILE LAYOUT] " + screenName + " shift banner: " + inBox.characterCountVisible + " / "
                            + unbounded.characterCountVisible + " characters at " + inBox.fontSizeUsedForBestFit + " / "
                            + unbounded.fontSizeUsedForBestFit + " px in a " + box.y.ToString("0.#") + " unit box, bottom "
                            + bottom.ToString("0.#") + " px above the zone banner at " + zoneTop.ToString("0.#") + " px: " + text.text);
                        Require(inBox.characterCountVisible == unbounded.characterCountVisible,
                            screenName + ": the shift banner cuts its line — " + inBox.characterCountVisible + " of "
                            + unbounded.characterCountVisible + " characters in a " + box.y.ToString("0.#") + " unit box: " + text.text);
                        Require(inBox.fontSizeUsedForBestFit == unbounded.fontSizeUsedForBestFit,
                            screenName + ": the shift banner shrinks its line to " + inBox.fontSizeUsedForBestFit + " px instead of growing: "
                            + text.text);
                        Require(bottom + MinGapPixels <= zoneTop,
                            screenName + ": the shift banner reaches the HUD zone banner — bottom " + bottom.ToString("0.#")
                            + " px, zone banner top " + zoneTop.ToString("0.#") + " px: " + text.text);
                    }
                }
                finally { DestroyAll(trash); }
            }
        }

        /// <summary>
        /// Переводит канву на выключенную камеру с текстурой размера экрана: в
        /// пакетном режиме ScreenSpaceOverlay экрана не знает, а масштаб канвы
        /// решает, во сколько пикселей ляжет кегль и где перенесётся строка.
        /// </summary>
        private static void PutOnScreen(Canvas canvas, Vector2 screen, System.Collections.Generic.List<UnityEngine.Object> trash)
        {
            // Уборка идёт с конца списка: камера уходит раньше своей текстуры.
            var target = new RenderTexture((int)screen.x, (int)screen.y, 24, RenderTextureFormat.ARGB32);
            target.Create();
            trash.Add(target);
            var cameraObject = new GameObject("MobileLayoutCamera");
            trash.Add(cameraObject);
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.enabled = false;
            camera.targetTexture = target;
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = camera;
            canvas.planeDistance = 1f;
            // Масштаб CanvasScaler пересчитывает в OnEnable.
            CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
            scaler.enabled = false;
            scaler.enabled = true;
            Canvas.ForceUpdateCanvases();
            float expected = Mathf.Pow(2f, Mathf.Lerp(Mathf.Log(screen.x / scaler.referenceResolution.x, 2f),
                Mathf.Log(screen.y / scaler.referenceResolution.y, 2f), scaler.matchWidthOrHeight));
            if (Mathf.Abs(canvas.scaleFactor - expected) > 0.001f)
                throw new InvalidOperationException("[MOBILE LAYOUT] " + canvas.name + " on " + screen.x + "×" + screen.y
                    + " has scale " + canvas.scaleFactor + " instead of " + expected + " — the text would be measured at the wrong scale");
        }

        private static void DestroyAll(System.Collections.Generic.List<UnityEngine.Object> trash)
        {
            for (int i = trash.Count - 1; i >= 0; i--)
            {
                if (trash[i] is RenderTexture texture) texture.Release();
                if (trash[i] != null) UnityEngine.Object.DestroyImmediate(trash[i]);
            }
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
