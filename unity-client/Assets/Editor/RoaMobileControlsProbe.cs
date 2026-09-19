#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaMobileControlsProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить мобильное управление";

        [MenuItem(MenuPath)]
        public static void Run()
        {
            try
            {
                Require(RoaMobileControls.NormalizeJoystick(new Vector2(3f, 2f), 54f) == Vector2.zero,
                        "joystick deadzone is too small");
                Vector2 right = RoaMobileControls.NormalizeJoystick(new Vector2(40f, 0f), 54f);
                Vector2 forward = RoaMobileControls.NormalizeJoystick(new Vector2(0f, -40f), 54f);
                Vector2 diagonal = RoaMobileControls.NormalizeJoystick(new Vector2(40f, -40f), 54f);
                Require(Near(right.x, 1f) && Near(right.y, 0f), "right direction is incorrect");
                Require(Near(forward.x, 0f) && Near(forward.y, 1f), "forward direction lost GUI Y inversion");
                Require(Near(diagonal.magnitude, 1f), "joystick incorrectly changes movement speed");

                Require(RoaMobileControls.IsJoystickStart(new Vector2(200f, 800f), 1920, 1080),
                        "landscape left play area does not start the joystick");
                Require(!RoaMobileControls.IsJoystickStart(new Vector2(1200f, 800f), 1920, 1080),
                        "right action area starts the joystick");
                Require(!RoaMobileControls.IsJoystickStart(new Vector2(100f, 40f), 1920, 1080),
                        "top panel shortcut starts the joystick");

                Rect fire = RoaMobileControls.FireRect(1920, 1080);
                Require(fire.xMax <= 1920f && fire.yMax <= 1080f && fire.width >= 76f,
                        "fire button is outside the landscape safe area");
                Rect compactFire = RoaMobileControls.FireRect(896, 414);
                Require(compactFire.x >= 0f && compactFire.y >= 0f && compactFire.width == 76f,
                        "compact landscape fire button is not touch-sized");

                VerifyIndependentTouchZones(1920, 1080);
                VerifyIndependentTouchZones(896, 414);
                string labels = VerifyCanvasLayoutAndInput();
                VerifyRemotePlayerTargets();

                Debug.Log("[МОБИЛЬНОЕ УПРАВЛЕНИЕ] готово: stick="
                    + diagonal.x.ToString("0.00") + ":" + diagonal.y.ToString("0.00")
                    + ", fire=" + fire.width.ToString("0") + "px, compact="
                    + compactFire.width.ToString("0") + "px, multitouch-zones=independent, canvas=safe/held/states, labels="
                    + labels + ", pvp-targets=filtered");
            }
            catch (Exception error)
            {
                Debug.LogError("[МОБИЛЬНОЕ УПРАВЛЕНИЕ] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static bool Near(float a, float b)
        {
            return Mathf.Abs(a - b) < 0.0001f;
        }

        /// <summary>
        /// Игроки в мобильной автоцели: только в PvP-зоне, не союзники, не друзья и
        /// не соклановцы, не лежачие и не дальше дальности цикла. Ракетница не
        /// должна подрывать стрелка тапом у своих ног.
        /// </summary>
        private static void VerifyRemotePlayerTargets()
        {
            Require(!RoaCombat.ZoneModeAllowsPvp("") && !RoaCombat.ZoneModeAllowsPvp("pve")
                    && !RoaCombat.ZoneModeAllowsPvp("safezone") && RoaCombat.ZoneModeAllowsPvp("pvpFullDrop"),
                    "mobile target cycle trusts an unknown zone mode");
            JObject self = JObject.Parse(@"{'worldFactionId':'uprava','zoneRules':{'pvp':true,'safe':false},'pvpMode':'pvp'}");
            JObject social = JObject.Parse(@"{'friends':[{'id':'char-friend'}],'clan':{'id':'c1','members':[{'id':'char-clan'}]}}");
            Require(RoaCombat.PvpTargetAllowed(self, social, Player("s1", "char-enemy", "free_artels"), "pvp"),
                    "mobile target cycle skips a legal PvP target");
            Require(!RoaCombat.PvpTargetAllowed(self, social, Player("s1", "char-enemy", "free_artels"), "peaceful"),
                    "mobile target cycle trusts a stale zone after transfer");
            JObject peaceful = JObject.Parse(@"{'worldFactionId':'uprava','zoneRules':{'pvp':false},'pvpMode':'pvp'}");
            JObject pve = JObject.Parse(@"{'worldFactionId':'uprava','pvpMode':'pve'}");
            Require(!RoaCombat.PvpTargetAllowed(peaceful, social, Player("s1", "char-enemy", "free_artels"), null)
                    && !RoaCombat.PvpTargetAllowed(pve, social, Player("s1", "char-enemy", "free_artels"), null),
                    "mobile target cycle offers a player in a peaceful or PvE zone");
            Require(!RoaCombat.PvpTargetAllowed(self, social, Player("s2", "char-x", "tract_league"), "pvp")
                    && !RoaCombat.PvpTargetAllowed(self, social, Player("s3", "char-y", "uprava"), "pvp")
                    && !RoaCombat.PvpTargetAllowed(self, social, Player("s4", "char-friend", "free_artels"), "pvp")
                    && !RoaCombat.PvpTargetAllowed(self, social, Player("s5", "char-clan", "free_artels"), "pvp"),
                    "mobile target cycle offers an ally (faction, friend or clan)");
            PublicPlayer downed = Player("s6", "char-down", "free_artels");
            downed.Downed = true;
            Require(!RoaCombat.PvpTargetAllowed(self, social, downed, "pvp"), "mobile target cycle offers a downed player");

            // Спутник по отряду каравана — союзник, посторонний — цель.
            JObject escort = JObject.Parse(@"{'worldFactionId':'uprava','zoneRules':{'pvp':true},'pvpMode':'pvp',
                'uiSnapshots':{'world':{'globalMap':{'attachedPartyId':'party-7'}}}}");
            PublicPlayer partyMate = Player("s7", "char-party", "free_artels");
            partyMate.WorldPartyId = "party-7";
            Require(!RoaCombat.PvpTargetAllowed(escort, social, partyMate, "pvp")
                    && RoaCombat.PvpTargetAllowed(escort, social, Player("s8", "char-stranger", "free_artels"), "pvp"),
                    "mobile target cycle offers a caravan party mate");

            // Сердцевина на настоящей локации: свой контракт, стрельба с платформы и
            // цель на своей платформе сервер не пропускает; чужак на платформе — цель.
            LocationDefinition core = JObject.Parse(File.ReadAllText(
                Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/locations/coreZone.json")))).ToObject<LocationDefinition>();
            WorldZone upravaPlatform = core.WorldZones.Find(zone => zone != null && zone.Id == "platform_uprava");
            Require(upravaPlatform != null && upravaPlatform.Type == "factionPlatform" && upravaPlatform.FactionId == "uprava",
                    "core faction platforms are not read from the location");
            RoaCoords.ToServer(RoaCoords.TileToWorld(upravaPlatform.Tx, upravaPlatform.Tz, core.TileWidth, core.TileDepth),
                out float platformX, out float platformZ);
            Require(RoaCombat.TerritoryPlatformAt(core, 0f, 0f) == null, "the core centre is not a platform");
            JObject contract = JObject.Parse(@"{'worldFactionId':'free_artels','zoneRules':{'pvp':true,'territoryId':'core'},
                'pvpMode':'pvpFullDrop','territoryFaction':{'factionId':'contour'}}");
            PublicPlayer rival = Player("c1", "char-c1", "contour");
            rival.TerritoryFactionId = "uprava";
            PublicPlayer sameContract = Player("c2", "char-c2", "contour");
            sameContract.TerritoryFactionId = "contour";
            Require(RoaCombat.PvpTargetAllowed(contract, social, rival, "pvpFullDrop", core, 0f, 0f),
                    "mobile target cycle skips a legal rival in the core");
            Require(!RoaCombat.PvpTargetAllowed(contract, social, sameContract, "pvpFullDrop", core, 0f, 0f),
                    "mobile target cycle offers a same-contract ally in the core");
            Require(!RoaCombat.PvpTargetAllowed(contract, social, rival, "pvpFullDrop", core, platformX, platformZ),
                    "mobile target cycle offers targets from a faction platform");
            rival.X = platformX;
            rival.Z = platformZ;
            Require(!RoaCombat.PvpTargetAllowed(contract, social, rival, "pvpFullDrop", core, 0f, 0f),
                    "mobile target cycle offers a player protected on their own platform");
            PublicPlayer intruder = Player("c3", "char-c3", "contour");
            intruder.TerritoryFactionId = "free_artels";
            intruder.X = platformX;
            intruder.Z = platformZ;
            Require(RoaCombat.PvpTargetAllowed(contract, social, intruder, "pvpFullDrop", core, 0f, 0f),
                    "an intruder on a foreign platform must stay a target");

            var host = new GameObject("MobileRemoteTargetsProbe");
            try
            {
                RoaRemotePlayers players = host.AddComponent<RoaRemotePlayers>();
                Type remoteType = typeof(RoaRemotePlayers).GetNestedType("Remote", BindingFlags.NonPublic);
                Require(remoteType != null, "runtime remote state type is missing");
                IDictionary remotes = typeof(RoaRemotePlayers).GetField("_remotes", BindingFlags.NonPublic | BindingFlags.Instance)
                    ?.GetValue(players) as IDictionary;
                Require(remotes != null, "remote dictionary is missing");
                remotes.Add("s1", Remote(remoteType, host, "s1", new Vector3(0f, 0f, 10f), Player("s1", "char-enemy", "free_artels")));
                remotes.Add("far", Remote(remoteType, host, "far", new Vector3(0f, 0f, 40f), Player("far", "char-far", "free_artels")));
                remotes.Add("friend", Remote(remoteType, host, "friend", new Vector3(0f, 0f, 5f), Player("friend", "char-friend", "free_artels")));
                remotes.Add("down", Remote(remoteType, host, "down", new Vector3(0f, 0f, 6f), downed));
                remotes.Add("empty", Remote(remoteType, host, "empty", new Vector3(0f, 0f, 3f), null));
                var targets = new List<RoaEnemies.MobileTarget>();
                players.CollectMobileTargets(Vector3.zero, 28f, targets, remote => RoaCombat.PvpTargetAllowed(self, social, remote, "pvp"));
                Require(targets.Count == 1, "mobile target cycle offers a downed, distant, allied or empty player: " + targets.Count);
                Require(targets[0].Id == RoaRemotePlayers.MobileTargetPrefix + "s1", "mobile player target id is not prefixed");
                Require(players.TryGetTargetable("s1", out PublicPlayer found, out Vector3 at) && found.Id == "s1" && Mathf.Approximately(at.z, 10f),
                        "a selected player cannot be resolved for aiming");
                Require(!players.TryGetTargetable("down", out _, out _), "a downed player stays aimable");
                var unfiltered = new List<RoaEnemies.MobileTarget>();
                players.CollectMobileTargets(Vector3.zero, 28f, unfiltered, null);
                Require(unfiltered.Count == 0, "without a PvP rule the mobile cycle offers players");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }

            Require(RoaCombat.RocketSelfSafeDistance >= 6f, "a rocket tap can land inside the shooter's own blast");
            Require(RoaMobileControls.WorldTapMaxSeconds < 0.40f, "a world tap is not shorter than the activity ping hold");
        }

        private static PublicPlayer Player(string id, string characterId, string faction)
        {
            return new PublicPlayer { Id = id, CharacterId = characterId, WorldFactionId = faction, Hp = 100, MaxHp = 100 };
        }

        private static object Remote(Type remoteType, GameObject host, string id, Vector3 position, PublicPlayer player)
        {
            var root = new GameObject("Remote:" + id);
            root.transform.SetParent(host.transform, false);
            root.transform.position = position;
            object remote = Activator.CreateInstance(remoteType, true);
            remoteType.GetField("Root", BindingFlags.Public | BindingFlags.Instance)?.SetValue(remote, root);
            remoteType.GetField("Player", BindingFlags.Public | BindingFlags.Instance)?.SetValue(remote, player);
            return remote;
        }

        private static string VerifyCanvasLayoutAndInput()
        {
            const int width = 896;
            const int height = 414;
            Rect safe = new Rect(24f, 12f, 848f, 390f);
            RoaMobileControlsCanvas.Layout layout =
                RoaMobileControlsCanvas.CalculateLayout(width, height, safe);
            Vector2 railGui = new Vector2(layout.Map.center.x, height - layout.Map.center.y);
            Require(!RoaMobileControls.IsJoystickStart(railGui, width, height, safe),
                    "left shortcut rail can no longer steal the floating joystick finger");
            var rects = new[]
            {
                layout.Inventory, layout.Map, layout.Pipboy, layout.Menu,
                layout.Fire, layout.Interact, layout.Target, layout.Crouch,
                layout.Reload, layout.Mode, layout.Player, layout.Bolt
            };
            for (int i = 0; i < rects.Length; i++)
            {
                Require(Contains(layout.SafeArea, rects[i]),
                        "mobile Canvas control leaves the device safe area");
                for (int j = 0; j < i; j++)
                    Require(!rects[i].Overlaps(rects[j]),
                            "mobile Canvas controls overlap on compact landscape");
            }

            var root = new GameObject("Mobile Canvas probe");
            try
            {
                RoaMobileControls controls = root.AddComponent<RoaMobileControls>();
                controls.ForceVisible = true;
                controls.CanvasDriven = true;
                int menuRequests = 0;
                int pingRequests = 0;
                controls.MenuRequested = () => menuRequests++;
                controls.PingRequested = () => pingRequests++;
                controls.PingAvailable = true;
                RoaMobileControlsCanvas canvas = root.AddComponent<RoaMobileControlsCanvas>();
                canvas.Configure(controls);
                // Кнопки видны только на телефоне, а редактор дал бы канве десктопный референс.
                RoaUiScale.Apply(root.GetComponentInChildren<CanvasScaler>(true), true);
                var state = new RoaMobileControlsCanvas.Presentation
                {
                    Visible = true,
                    TargetSelected = true,
                    Crouching = true,
                    PingAvailable = true,
                    BoltAiming = true,
                    FireMode = "single",
                    JoystickActive = true,
                    JoystickBase = new Vector2(220f, 108f),
                    JoystickPoint = new Vector2(258f, 132f),
                    JoystickRadius = 54f
                };
                canvas.PresentNow(state, width, height, safe);
                Require(canvas.CanvasReady && canvas.InputReady
                        && canvas.ButtonCount == 12 && canvas.ActiveButtonCount == 12
                        && canvas.GameplayButtonsVisible && canvas.JoystickVisible,
                        "mobile uGUI Canvas, touch targets or joystick visual is incomplete");
                Require(canvas.ButtonLabel("Target") == "ЦЕЛЬ •"
                        && canvas.ButtonLabel("Crouch") == "ВСТАТЬ"
                        && canvas.ButtonLabel("Mode") == "ОДИН."
                        && canvas.ButtonLabel("Player") == "МЕТКА"
                        && canvas.ButtonLabel("Bolt") == "ОТМЕНА",
                        "mobile Canvas does not reflect live target, stance, ping or fire mode");
                VerifyFireModeLabels();
                Require(canvas.TryGetButtonScreenRect("Fire", out Rect fireRect)
                        && RectNear(fireRect, layout.Fire),
                        "mobile Canvas fire visual differs from its touch layout");
                Require(canvas.SimulatePressForProbe("Fire", true)
                        && controls.FireHeldForCanvas,
                        "mobile Canvas pointer-down does not start held fire");
                Require(canvas.SimulatePressForProbe("Fire", false)
                        && !controls.FireHeldForCanvas,
                        "mobile Canvas pointer-up does not stop held fire");
                Require(canvas.SimulateClickForProbe("Menu") && menuRequests == 1,
                        "mobile Canvas menu button is not connected to gameplay control");
                Require(canvas.SimulateClickForProbe("Player") && pingRequests == 1,
                        "mobile contextual player button does not open activity pings");
                string labels = VerifyLabelsFit(canvas, root, state);
                canvas.PresentNow(state, width, height, safe);
                foreach (Text label in root.GetComponentsInChildren<Text>(true))
                    Require(label.fontSize == BaseLabelSize(label),
                            "«" + label.text + "» stays shrunk on a roomier layout");

                state.InputSuppressed = true;
                state.JoystickActive = true;
                canvas.PresentNow(state, width, height, safe);
                Require(canvas.ActiveButtonCount == 1 && !canvas.GameplayButtonsVisible
                        && !canvas.JoystickVisible && canvas.ButtonLabel("Menu") == "ЗАКРЫТЬ",
                        "suppressed mobile input does not collapse to one clear close action");

                state.InputSuppressed = false;
                state.PanelOpen = true;
                canvas.PresentNow(state, width, height, safe);
                Require(canvas.ActiveButtonCount == 4 && !canvas.GameplayButtonsVisible,
                        "mobile panel state does not hide conflicting gameplay controls");

                controls.SetFireHeld(true);
                state.Visible = false;
                canvas.PresentNow(state, width, height, safe);
                Require(!canvas.Visible && !controls.FireHeldForCanvas,
                        "hidden mobile Canvas leaves held fire latched");
                return labels;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// Кнопка режима получает id режима RoaCombat и раньше показывала его как
        /// есть: SINGLE, AIMED, AUTO. У каждого режима своя русская подпись, которую
        /// может нарисовать вложенный шрифт.
        /// </summary>
        private static void VerifyFireModeLabels()
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string mode in new[] { "single", "aimed", "auto", "dual", "melee" })
            {
                string label = RoaMobileControlsCanvas.FireModeLabel(mode);
                Require(label != "РЕЖИМ" && seen.Add(label), "fire mode " + mode + " has no label of its own");
                foreach (char c in label)
                    Require((c < 'A' || c > 'Z') && (c < 'a' || c > 'z'),
                            "fire mode " + mode + " is shown in Latin: " + label);
            }
            RequireDrawable(seen);
            Require(RoaMobileControlsCanvas.FireModeLabel(null) == "РЕЖИМ"
                    && RoaMobileControlsCanvas.FireModeLabel("burst") == "РЕЖИМ",
                    "an unknown fire mode leaks its id onto the button");
        }

        /// <summary>
        /// Кнопки ограничены в пикселях экрана (рейка 46–58, действия 54–76), а
        /// шрифт подписи растёт вместе с канвой: на телефоне «ДЕЙСТВИЕ» и
        /// «ПРИСЕСТЬ» залезали в соседний столбец, на планшете вылезали все подписи.
        /// Телефон — iPhone 844×390 pt при DPR 1,5 (выше шаблон WebGL не пускает)
        /// с вырезом, планшет — iPad Pro 12,9″, где кнопки мельче всего.
        /// </summary>
        private static string VerifyLabelsFit(RoaMobileControlsCanvas canvas, GameObject root,
                                              RoaMobileControlsCanvas.Presentation busy)
        {
            Rect phoneSafe = new Rect(70f, 31f, 1126f, 554f);
            Rect tabletSafe = new Rect(0f, 0f, 2048f, 1536f);
            var closing = new RoaMobileControlsCanvas.Presentation { Visible = true, InputSuppressed = true };
            var idle = new RoaMobileControlsCanvas.Presentation { Visible = true, FireMode = "melee" };
            var shown = new HashSet<string>(StringComparer.Ordinal);
            int phone = int.MaxValue;
            int tablet = int.MaxValue;
            foreach (RoaMobileControlsCanvas.Presentation state in new[] { busy, closing, idle })
            {
                tablet = Mathf.Min(tablet, LabelsFit(canvas, root, state, 2048, 1536, tabletSafe, "tablet", shown));
                phone = Mathf.Min(phone, LabelsFit(canvas, root, state, 1266, 585, phoneSafe, "phone", shown));
            }
            Require(Label(root, "Interact").fontSize < 14 && Label(root, "Crouch").fontSize < 14,
                    "phone layout no longer shrinks «ДЕЙСТВИЕ» and «ПРИСЕСТЬ»");
            Require(Label(root, "Menu").fontSize == 14 && Label(root, "Target").fontSize == 14
                    && Label(root, "Fire").fontSize == 17,
                    "labels that fit their phone button lost their size");
            RequireDrawable(shown);
            return "phone>=" + phone + "pt/tablet>=" + tablet + "pt";
        }

        /// <summary>
        /// Каждая видимая подпись влезает в свою кнопку или стоит на пределе
        /// читаемости (MinLabelPixels на экране, мельче буквы теряют форму), и
        /// уменьшена не больше, чем нужно: на пункт крупнее она бы уже не влезла.
        /// </summary>
        private static int LabelsFit(RoaMobileControlsCanvas canvas, GameObject root,
                                     RoaMobileControlsCanvas.Presentation state,
                                     int width, int height, Rect safe, string device,
                                     HashSet<string> shown)
        {
            canvas.PresentNow(state, width, height, safe);
            CanvasScaler scaler = root.GetComponentInChildren<CanvasScaler>(true);
            Vector2 reference = scaler.referenceResolution;
            float scale = Mathf.Pow(2f, Mathf.Lerp(Mathf.Log(width / reference.x, 2f),
                Mathf.Log(height / reference.y, 2f), scaler.matchWidthOrHeight));
            int floor = Mathf.CeilToInt(RoaMobileControlsCanvas.MinLabelPixels / scale);
            int smallest = int.MaxValue;
            foreach (Text label in root.GetComponentsInChildren<Text>(true))
            {
                GameObject button = label.transform.parent.gameObject;
                if (!button.activeSelf) continue;
                Require(canvas.TryGetButtonScreenRect(button.name, out Rect rect),
                        device + ": label outside a known button");
                RectTransform box = label.rectTransform;
                float available = rect.width * (box.anchorMax.x - box.anchorMin.x) / scale;
                int size = label.fontSize;
                int baseSize = BaseLabelSize(label);
                string name = device + " «" + label.text + "» " + size + "pt ";
                shown.Add(label.text);
                Require(size <= baseSize && (size == baseSize || size >= floor),
                        name + "is above its base size or shrank below the readable " + floor + "pt");
                Require(size <= floor || label.preferredWidth <= available + 0.01f,
                        name + label.preferredWidth.ToString("0.0") + " > "
                        + available.ToString("0.0") + " units overflows its button");
                if (size < baseSize)
                {
                    label.fontSize = size + 1;
                    bool largerFits = label.preferredWidth <= available;
                    label.fontSize = size;
                    Require(!largerFits, name + "is smaller than its button needs");
                }
                smallest = Mathf.Min(smallest, size);
            }
            return smallest;
        }

        private static int BaseLabelSize(Text label)
        {
            return label.transform.parent.name == "Fire" ? 17 : 14;
        }

        private static Text Label(GameObject root, string id)
        {
            foreach (Text label in root.GetComponentsInChildren<Text>(true))
                if (label.transform.parent.name == id) return label;
            throw new InvalidOperationException("mobile button has no label: " + id);
        }

        /// <summary>
        /// В WebGL нет системных шрифтов: символ, которого нет во вложенном
        /// Noto Sans (так было с «✓»), просто не рисуется. Font.HasCharacter в
        /// редакторе находит его в шрифтах Windows, поэтому глиф ищется в таблице
        /// самого файла шрифта.
        /// </summary>
        private static void RequireDrawable(IEnumerable<string> labels)
        {
            Require(FontEngine.LoadFontFace(RoaUiFont.Default) == FontEngineError.Success,
                    "the bundled UI font does not load");
            try
            {
                foreach (string label in labels)
                    foreach (char c in label)
                        Require(FontEngine.TryGetGlyphIndex(c, out uint glyph) && glyph != 0,
                                "the bundled font has no glyph for «" + c + "» in «" + label + "»");
            }
            finally
            {
                FontEngine.UnloadFontFace();
            }
        }

        private static bool Contains(Rect outer, Rect inner)
        {
            const float epsilon = 0.01f;
            return inner.xMin >= outer.xMin - epsilon && inner.yMin >= outer.yMin - epsilon
                && inner.xMax <= outer.xMax + epsilon && inner.yMax <= outer.yMax + epsilon;
        }

        private static bool RectNear(Rect a, Rect b)
        {
            return Near(a.x, b.x) && Near(a.y, b.y)
                && Near(a.width, b.width) && Near(a.height, b.height);
        }

        private static void VerifyIndependentTouchZones(int width, int height)
        {
            MethodInfo actionRect = typeof(RoaMobileControls).GetMethod(
                "ActionRect", BindingFlags.NonPublic | BindingFlags.Static);
            Require(actionRect != null, "mobile action layout helper is missing");
            Rect fire = RoaMobileControls.FireRect(width, height);
            var actions = new Rect[6];
            for (int i = 0; i < actions.Length; i++)
            {
                actions[i] = (Rect)actionRect.Invoke(null, new object[] { width, height, i + 1 });
                Require(actions[i].xMin >= 0f && actions[i].yMin >= 0f
                        && actions[i].xMax <= width && actions[i].yMax <= height,
                        "mobile action button leaves the landscape viewport");
                Require(actions[i].width >= 54f && actions[i].height >= 54f,
                        "mobile action button is smaller than the touch target");
                Require(!actions[i].Overlaps(fire),
                        "mobile action button overlaps held fire");
                for (int j = 0; j < i; j++)
                    Require(!actions[i].Overlaps(actions[j]),
                            "mobile action buttons overlap each other");
            }

            Vector2 joystickFinger = new Vector2(Mathf.Min(220f, width * 0.25f), height * 0.72f);
            Vector2 fireFinger = fire.center;
            Require(RoaMobileControls.IsJoystickStart(joystickFinger, width, height),
                    "first simultaneous finger cannot own the joystick");
            Require(fire.Contains(fireFinger),
                    "second simultaneous finger cannot hold fire");
            Require(joystickFinger.x < actions[1].xMin && joystickFinger.x < fire.xMin,
                    "joystick and action fingers do not have independent screen zones");
        }
    }
}
#endif
