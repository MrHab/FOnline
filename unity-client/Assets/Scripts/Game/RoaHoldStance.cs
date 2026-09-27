using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Как предмет держат в руках.</summary>
    public enum RoaHoldKind
    {
        /// <summary>Приклад в плечо: винтовки, автоматы, дробовики, арбалеты.</summary>
        LongGun,
        /// <summary>Пистолет двумя руками.</summary>
        Pistol,
        /// <summary>Обрез: без приклада, у пояса двумя руками.</summary>
        SawedOff,
        /// <summary>Миниган у бедра: задняя рукоять и верхняя ручка.</summary>
        HipGun,
        /// <summary>Труба гранатомёта на плече.</summary>
        Launcher,
        /// <summary>Граната, бутылка, бомба — в правой ладони.</summary>
        Throwable,
        /// <summary>Двуручное древко: топор, бита, труба, лопата.</summary>
        TwoHand,
        /// <summary>Двуручный клинок: катана.</summary>
        Sword,
        /// <summary>Бита и клюшка: горизонтальный замах через заднее плечо.</summary>
        Bat,
        /// <summary>Одноручное: мачете, тесак, молоток, дубинка.</summary>
        OneHand,
        /// <summary>Нож.</summary>
        Knife,
        /// <summary>Копьё: обе руки на древке, укол.</summary>
        Spear,
        /// <summary>Тонфа: боковая ручка, древко вдоль предплечья.</summary>
        Tonfa,
        /// <summary>Бензопила и кусторез: две ручки у бедра.</summary>
        PowerTool,
        /// <summary>Щит на левой руке.</summary>
        Shield
    }

    /// <summary>Место кисти на модели в пространстве корня префаба.</summary>
    public struct RoaHandSpec
    {
        public bool Active;
        public Vector3 Centre;
        public Vector3 Axis;
        public Vector3 Back;
        public float Radius;
    }

    /// <summary>
    /// Хват конкретной модели: класс, опорная точка, оси модели и места обеих
    /// кистей. Строится из RoaHoldAnchors один раз при взятии предмета в руки.
    /// </summary>
    public sealed class RoaHold
    {
        public RoaHoldKind Kind;
        public string Prefab;
        /// <summary>Точка модели, которая ставится в точку стойки.</summary>
        public Vector3 Anchor;
        /// <summary>Главная ось модели: ствол или древко (от рукояти к бойку).</summary>
        public Vector3 Forward;
        /// <summary>«Верх» модели: над стволом, или куда смотрит лезвие/боёк.</summary>
        public Vector3 Up;
        public RoaHandSpec Right;
        public RoaHandSpec Left;
        /// <summary>Длина модели вдоль главной оси, м.</summary>
        public float Length;
        /// <summary>Расстояние между кистями по древку (у топора верхняя рука скользит при ударе).</summary>
        public float Spacing;
        /// <summary>У огнестрела: левая кисть ищется по низу цевья на этой дальности от плеча.</summary>
        public RoaHoldAnchors.Entry Entry;
        /// <summary>Насколько опущен ствол в готовности, градусы (у длинных — чтобы сошки не цепляли пол).</summary>
        public float ReadyPitch = 30f;
        /// <summary>Сдвиг вскинутой позы (громоздкий инструмент не должен закрывать лицо).</summary>
        public Vector3 AimOffset;
        /// <summary>Сдвиг готовности (громоздкий инструмент ниже, у пояса).</summary>
        public Vector3 ReadyOffset;
        /// <summary>Доля отдачи: у огнемёта её почти нет, у минигана малая.</summary>
        public float RecoilScale = 1f;
        /// <summary>Наклон вскинутого предмета вниз, градусы (инструмент носиком к поверхности).</summary>
        public float AimPitch;

        public bool TwoHanded => Left.Active;
        public bool Firearm => Kind == RoaHoldKind.LongGun || Kind == RoaHoldKind.Pistol || Kind == RoaHoldKind.SawedOff
            || Kind == RoaHoldKind.HipGun || Kind == RoaHoldKind.Launcher;
    }

    /// <summary>Поза предмета в пространстве персонажа: куда встаёт опорная точка и куда смотрят оси.</summary>
    public struct RoaHoldPose
    {
        public Vector3 Point;
        public Vector3 Forward;
        public Vector3 Up;
        /// <summary>Наклон и поворот головы к прицелу, градусы (вниз, к плечу).</summary>
        public float HeadPitch;
        public float HeadRoll;
        /// <summary>Доворот позвоночника при замахе (радианы, как у RoaMeleeGrip).</summary>
        public Vector3 Spine;
    }

    /// <summary>
    /// Стойки по классам хвата — как держит оружие живой человек. Точки заданы в
    /// пространстве персонажа (стопы в нуле, +Z вперёд, +X вправо) по меркам
    /// видимого тела: плечевой сустав (±0.19, 1.39, −0.05), глаза на 1.66,
    /// рука от плеча до запястья 0.61 м.
    ///
    /// Огнестрел: «низкая готовность» — приклад в плече, ствол опущен на 30°,
    /// палец вдоль рамки; «вскинуто» — ствол горизонтально, голова к прикладу,
    /// палец на спуске. Ближний бой: готовность, замах, удар по фазе.
    /// </summary>
    public static class RoaHoldStance
    {
        // Модели, которые держат не по умолчанию своего rigId.
        private static readonly Dictionary<string, RoaHoldKind> KindByPrefab = new Dictionary<string, RoaHoldKind>(StringComparer.Ordinal)
        {
            { "SM_Wep_Minigun_01", RoaHoldKind.HipGun },
            { "SM_Wep_Minigun_Clean_01", RoaHoldKind.HipGun },
            { "SM_Wep_Veh_MiniGun_01", RoaHoldKind.HipGun },
            { "SM_Wep_AAGun_01", RoaHoldKind.HipGun },
            { "SM_Wep_Veh_AA_01", RoaHoldKind.HipGun },
            { "SM_Wep_RocketLauncher_01", RoaHoldKind.Launcher },
            // Гвоздомёт — инструмент с пистолетной рукоятью, без приклада.
            { "SM_Wep_Nailgun_01", RoaHoldKind.Pistol },
            { "SM_Wep_Nailgun_Clean_01", RoaHoldKind.Pistol },
            // «Лазерный пистолет» на деле длинный, с прикладом и барабаном — как винтовка.
            { "SM_Wep_Hybrid_01", RoaHoldKind.LongGun },
            { "SM_Wep_Veh_Rocket_Launcher_01", RoaHoldKind.Launcher },
            { "SM_Wep_Veh_Saw_Launcher_01", RoaHoldKind.Launcher },
            { "sawedOffShotgun", RoaHoldKind.SawedOff },
            { "SM_Wep_Bomb_GasCan_01", RoaHoldKind.Throwable },
            { "SM_Wep_Bomb_Propane_01", RoaHoldKind.Throwable },
            { "SM_Wep_Flashbang_01", RoaHoldKind.Throwable },
            { "SM_Wep_Grenade_01", RoaHoldKind.Throwable },
            { "SM_Wep_Molotov_01", RoaHoldKind.Throwable },
            { "SM_Wep_NailBomb_01", RoaHoldKind.Throwable },
            { "SM_Wep_PipeBomb_01", RoaHoldKind.Throwable },
            { "SM_Wep_Katana_01", RoaHoldKind.Sword },
            { "SM_Wep_Bat_Metal_01", RoaHoldKind.Bat },
            { "SM_Wep_Bat_Wood_01", RoaHoldKind.Bat },
            { "SM_Wep_Bat_Wood_02", RoaHoldKind.Bat },
            { "SM_Wep_Melee_GolfClub_01", RoaHoldKind.Bat },
            { "SM_Wep_Melee_HuntingKnife_01", RoaHoldKind.Knife },
            { "SM_Wep_Melee_Machete_01", RoaHoldKind.OneHand },
            { "SM_Wep_Butcher_01", RoaHoldKind.OneHand },
            { "SM_Wep_Hammer_01", RoaHoldKind.OneHand },
            { "SM_Wep_Wrench_01", RoaHoldKind.OneHand },
            { "SM_Wep_Cross_01", RoaHoldKind.OneHand },
            { "SM_Wep_Baton_01", RoaHoldKind.Tonfa },
            { "SM_Wep_Baton_02", RoaHoldKind.Tonfa },
            { "SM_Wep_Melee_Spear_Wood_01", RoaHoldKind.Spear },
            { "SM_Wep_ChainSaw_01", RoaHoldKind.PowerTool },
            { "SM_Wep_Trimmer_01", RoaHoldKind.PowerTool },
            { "SM_Wep_Trimmer_Clean_01", RoaHoldKind.PowerTool },
            { "SM_Wep_Sign_Shield_01", RoaHoldKind.Shield }
        };

        private struct MeleeShape
        {
            public Vector3 Bottom;     // торец рукояти
            public Vector3 Top;        // конец хватаемой части
            public Vector3 Edge;       // куда смотрит лезвие/боёк
            public float Radius;
            public bool Explicit;
        }

        // Рукояти, снятые вручную с ортоснимков (Preview hold anchors): там, где
        // автоматический замер путает клинок с рукоятью.
        private static readonly Dictionary<string, MeleeShape> ShapeByPrefab = new Dictionary<string, MeleeShape>(StringComparer.Ordinal)
        {
            { "SM_Wep_Katana_01", new MeleeShape { Bottom = new Vector3(0f, 0f, -0.135f), Top = new Vector3(0f, 0f, 0.135f), Edge = Vector3.down, Radius = 0.015f, Explicit = true } },
            { "SM_Wep_Melee_HuntingKnife_01", new MeleeShape { Bottom = new Vector3(0f, 0f, -0.068f), Top = new Vector3(0f, 0f, 0.038f), Edge = Vector3.down, Radius = 0.014f, Explicit = true } },
            { "SM_Wep_Melee_Machete_01", new MeleeShape { Bottom = new Vector3(0f, -0.01f, -0.115f), Top = new Vector3(0f, -0.01f, 0.1f), Edge = Vector3.down, Radius = 0.017f, Explicit = true } },
            { "SM_Wep_PipeWrench_01", new MeleeShape { Bottom = new Vector3(-0.01f, 0f, -0.23f), Top = new Vector3(-0.01f, 0f, 0.11f), Edge = Vector3.up, Radius = 0.018f, Explicit = true } },
            { "SM_Wep_Wrench_01", new MeleeShape { Bottom = new Vector3(0f, 0f, -0.2f), Top = new Vector3(0f, 0f, -0.05f), Edge = Vector3.down, Radius = 0.017f, Explicit = true } },
            { "SM_Wep_Butcher_01", new MeleeShape { Bottom = new Vector3(0f, 0f, -0.089f), Top = new Vector3(0f, 0f, 0.07f), Edge = Vector3.down, Radius = 0.016f, Explicit = true } },
            { "SM_Wep_Hammer_01", new MeleeShape { Bottom = new Vector3(0f, -0.004f, -0.148f), Top = new Vector3(0f, -0.002f, 0.16f), Edge = Vector3.down, Radius = 0.02f, Explicit = true } },
            { "SM_Wep_FireAxe_01", new MeleeShape { Bottom = new Vector3(0f, 0.025f, -0.391f), Top = new Vector3(0f, 0.018f, 0.36f), Edge = Vector3.down, Radius = 0.022f, Explicit = true } },
            { "SM_Wep_WoodAxe_01", new MeleeShape { Bottom = new Vector3(0f, 0.025f, -0.381f), Top = new Vector3(0f, 0.017f, 0.36f), Edge = Vector3.down, Radius = 0.022f, Explicit = true } }
        };

        // Ручки особых предметов в пространстве префаба.
        private static readonly Dictionary<string, (RoaHandSpec right, RoaHandSpec left)> HandsByPrefab =
            new Dictionary<string, (RoaHandSpec, RoaHandSpec)>(StringComparer.Ordinal)
            {
                { "SM_Wep_ChainSaw_01", (
                    new RoaHandSpec { Active = true, Centre = new Vector3(0f, 0.015f, 0.02f), Axis = Vector3.forward, Back = Vector3.up, Radius = 0.016f },
                    new RoaHandSpec { Active = true, Centre = new Vector3(0.1f, 0.155f, 0.259f), Axis = Vector3.right, Back = (Vector3.up + Vector3.forward * 0.4f).normalized, Radius = 0.015f }) },
                { "SM_Wep_Trimmer_01", (
                    // Правая — на штанге у мотора (рукоять с газом), левая — на петле в 35 см впереди.
                    new RoaHandSpec { Active = true, Centre = new Vector3(0.03f, -0.135f, 0.3f), Axis = Vector3.forward, Back = Vector3.up, Radius = 0.017f },
                    new RoaHandSpec { Active = true, Centre = new Vector3(-0.08f, -0.03f, 0.654f), Axis = Vector3.right, Back = Vector3.up, Radius = 0.015f }) },
                { "SM_Wep_Trimmer_Clean_01", (
                    new RoaHandSpec { Active = true, Centre = new Vector3(0.03f, -0.135f, 0.3f), Axis = Vector3.forward, Back = Vector3.up, Radius = 0.017f },
                    new RoaHandSpec { Active = true, Centre = new Vector3(-0.08f, -0.03f, 0.654f), Axis = Vector3.right, Back = Vector3.up, Radius = 0.015f }) },
                { "SM_Wep_Baton_01", (
                    new RoaHandSpec { Active = true, Centre = new Vector3(-0.1f, 0f, 0.135f), Axis = Vector3.left, Back = Vector3.down, Radius = 0.016f },
                    default) },
                { "SM_Wep_Baton_02", (
                    new RoaHandSpec { Active = true, Centre = new Vector3(-0.1f, 0f, 0.135f), Axis = Vector3.left, Back = Vector3.down, Radius = 0.016f },
                    default) },
                { "SM_Wep_Sign_Shield_01", (
                    default,
                    new RoaHandSpec { Active = true, Centre = new Vector3(0f, -0.005f, -0.059f), Axis = Vector3.up, Back = Vector3.left, Radius = 0.014f }) },
                { "SM_Wep_Minigun_01", (
                    default,
                    new RoaHandSpec { Active = true, Centre = new Vector3(0.05f, 0.1f, 0.51f), Axis = Vector3.back, Back = Vector3.up, Radius = 0.016f }) },
                // Гранатомёт: левая кисть на второй рукояти под трубой — ближе к плечу,
                // рука согнута и локоть внизу.
                { "SM_Wep_RocketLauncher_01", (
                    default,
                    new RoaHandSpec { Active = true, Centre = new Vector3(0f, -0.05f, -0.21f), Axis = new Vector3(0f, 1f, 0.2f).normalized, Back = Vector3.left, Radius = 0.017f }) },
                { "SM_Wep_Minigun_Clean_01", (
                    default,
                    new RoaHandSpec { Active = true, Centre = new Vector3(0.05f, 0.1f, 0.51f), Axis = Vector3.back, Back = Vector3.up, Radius = 0.016f }) }
            };

        // Расстояние между кистями по древку (левая у торца, правая выше), м.
        private static readonly Dictionary<string, float> HandSpacing = new Dictionary<string, float>(StringComparer.Ordinal)
        {
            { "SM_Wep_Bat_Metal_01", 0.1f }, { "SM_Wep_Bat_Wood_01", 0.1f }, { "SM_Wep_Bat_Wood_02", 0.1f },
            { "SM_Wep_Melee_GolfClub_01", 0.09f }, { "SM_Wep_Katana_01", 0.2f },
            { "SM_Wep_FireAxe_01", 0.34f }, { "SM_Wep_WoodAxe_01", 0.34f }, { "SM_Wep_Spade_01", 0.55f },
            { "SM_Wep_Pipe_01", 0.22f }, { "SM_Wep_Plank_01", 0.22f }, { "SM_Wep_RebarClub_01", 0.2f },
            { "SM_Wep_Crowbar_01", 0.28f }, { "SM_Wep_PipeWrench_01", 0.2f }, { "SM_Wep_Crutch_01", 0.2f },
            { "SM_Wep_Melee_Spear_Wood_01", 0.42f }
        };

        // Левая кисть сдвинута по стволу, м (+ к дулу): не на дульный срез, ленту или батарею.
        private static readonly Dictionary<string, float> SupportShift = new Dictionary<string, float>(StringComparer.Ordinal)
        {
            { "SM_Wep_SubMGun_01", -0.1f }, { "SM_Wep_SubMGun_02", -0.04f }, { "SM_Wep_SubMGun_03", -0.04f },
            { "SM_Wep_SubMGun_Clean_03", -0.04f }, { "SM_Wep_SniperRifle_01", 0.15f },
            { "SM_Wep_Hybrid_02", 0.2f }, { "SM_Wep_Hybrid_01", 0.13f }, { "sawedOffShotgun", -0.03f },
            { "SM_Wep_FlameThrower_01", 0.21f }, { "SM_Wep_MachineGun_01", 0.03f }
        };

        // Толстые рукояти (ракетница): радиус кисти по ширине самой рукояти.
        private static readonly Dictionary<string, float> GripRadiusByPrefab = new Dictionary<string, float>(StringComparer.Ordinal)
        {
            { "SM_Wep_FlareGun_01", 0.034f }
        };

        private static readonly Dictionary<string, float> RecoilScaleByPrefab = new Dictionary<string, float>(StringComparer.Ordinal)
        {
            { "SM_Wep_FlameThrower_01", 0.12f }, { "SM_Wep_Minigun_01", 0.3f }, { "SM_Wep_Minigun_Clean_01", 0.3f },
            { "SM_Wep_RocketLauncher_01", 0.6f }
        };

        // Ствол в готовности опущен меньше, если иначе он (или сошки) достаёт до пола.
        private static readonly Dictionary<string, float> ReadyPitchByPrefab = new Dictionary<string, float>(StringComparer.Ordinal)
        {
            { "SM_Wep_MachineGun_01", 20f }, { "SM_Wep_MachineGun_02", 20f },
            // Гвоздомёт: корпус наклонён в модели — в готовности носом вниз сильнее.
            { "SM_Wep_Nailgun_01", 55f }, { "SM_Wep_Nailgun_Clean_01", 45f },
            { "SM_Wep_FlameThrower_01", 20f }, { "SM_Wep_SniperRifle_Pneumatic_01", 22f },
            { "SM_Wep_SubMGun_01", 32f }, { "SM_Wep_SubMGun_02", 32f }, { "SM_Wep_SubMGun_03", 32f },
            { "SM_Wep_Veh_Harpoon_01", 22f }
        };

        public static RoaHold Build(string prefabName, string rigId, RoaHoldAnchors.Entry entry, bool firearm)
        {
            if (entry == null) return null;
            var hold = new RoaHold { Prefab = prefabName, Entry = entry };
            if (!KindByPrefab.TryGetValue(prefabName, out hold.Kind))
            {
                if (firearm)
                    hold.Kind = rigId == "pistol" || rigId == "revolver" || rigId == "laserPistol" ? RoaHoldKind.Pistol
                        : rigId == "sawedOffShotgun" ? RoaHoldKind.SawedOff : RoaHoldKind.LongGun;
                else
                    hold.Kind = rigId == "knife" ? RoaHoldKind.Knife : RoaHoldKind.TwoHand;
            }
            switch (hold.Kind)
            {
                case RoaHoldKind.LongGun:
                case RoaHoldKind.Pistol:
                case RoaHoldKind.SawedOff:
                case RoaHoldKind.HipGun:
                case RoaHoldKind.Launcher:
                    BuildFirearm(hold, entry);
                    break;
                case RoaHoldKind.Throwable:
                    BuildThrowable(hold, entry);
                    break;
                default:
                    BuildMelee(hold, entry);
                    break;
            }
            if (HandsByPrefab.TryGetValue(prefabName, out var hands))
            {
                if (hands.right.Active) hold.Right = hands.right;
                if (hands.left.Active) hold.Left = hands.left;
            }
            switch (hold.Kind)
            {
                case RoaHoldKind.PowerTool:
                    // Полотно или штанга вперёд, корпус вверх; держат за две ручки.
                    hold.Forward = Vector3.forward;
                    hold.Up = Vector3.up;
                    hold.Anchor = hold.Right.Centre;
                    // Кусторез длинный: мотор у правого бедра, а не за спиной.
                    if (hold.Prefab.StartsWith("SM_Wep_Trimmer")) hold.AimOffset = new Vector3(0.06f, -0.03f, -0.03f);
                    break;
                case RoaHoldKind.Tonfa:
                    // Ось позы — боковая ручка (древко у мизинца), «верх» — длинное древко
                    // (вдоль предплечья назад, снизу, по локтевой кости).
                    hold.Forward = Vector3.left;
                    hold.Up = Vector3.forward;
                    hold.Anchor = hold.Right.Centre;
                    hold.Left = default;
                    break;
                case RoaHoldKind.Shield:
                    // Ручка вертикально, лицевая сторона знака (+Z) — от себя.
                    hold.Forward = Vector3.up;
                    hold.Up = Vector3.back;
                    hold.Anchor = hold.Left.Centre;
                    hold.Right = default;
                    break;
            }
            return hold;
        }

        private static void BuildFirearm(RoaHold hold, RoaHoldAnchors.Entry e)
        {
            hold.Forward = Vector3.forward;
            hold.Up = Vector3.up;
            hold.Length = e.max.z - e.min.z;
            Vector3 gripAxis = e.gripTop - e.gripBottom;
            if (gripAxis.sqrMagnitude < 1e-5f) gripAxis = new Vector3(0f, 1f, 0.25f);
            // Кисть ложится на середину рукояти, чуть выше: указательный достаёт до спуска.
            Vector3 grip = Vector3.Lerp(e.gripBottom, e.gripTop, e.prefab == "SM_Wep_FlareGun_01" ? 0.25f : 0.55f);
            // Длинное без приклада (дробовик-обрез): прижать к плечу нечем — держат как обрез.
            if (hold.Kind == RoaHoldKind.LongGun && e.butt.z > grip.z - 0.16f) hold.Kind = RoaHoldKind.SawedOff;
            if (ReadyPitchByPrefab.TryGetValue(hold.Prefab, out float pitch)) hold.ReadyPitch = pitch;
            if (hold.Prefab.StartsWith("SM_Wep_Nailgun"))
            {
                // Инструмент далеко от лица, магазин всегда наклонён ~20° от вертикали.
                hold.AimOffset = new Vector3(0.05f, -0.14f, 0.07f);
                hold.ReadyOffset = new Vector3(0.03f, -0.1f, 0.04f);
                hold.ReadyPitch = 30f;
                hold.AimPitch = 20f;
            }
            if (hold.Prefab == "SM_Wep_Hybrid_01") hold.AimOffset = new Vector3(0f, -0.02f, 0f);
            if (hold.Prefab == "SM_Wep_FlareGun_01") { hold.AimOffset = new Vector3(0f, 0f, 0.02f); hold.AimPitch = 10f; }
            if (hold.Prefab.StartsWith("SM_Wep_CrossBow")) hold.AimOffset = new Vector3(0f, -0.015f, 0f);
            if (RecoilScaleByPrefab.TryGetValue(hold.Prefab, out float recoil)) hold.RecoilScale = recoil;
            if (GripRadiusByPrefab.TryGetValue(hold.Prefab, out float gripRadius)) hold.Right.Radius = gripRadius;
            hold.Right = new RoaHandSpec
            {
                Active = true, Centre = grip, Axis = gripAxis.normalized, Back = Vector3.right,
                Radius = Mathf.Clamp(e.gripRadius, 0.012f, 0.022f)
            };
            switch (hold.Kind)
            {
                case RoaHoldKind.LongGun:
                    // Затыльник — в плечо.
                    hold.Anchor = e.butt;
                    break;
                case RoaHoldKind.Launcher:
                    // Ось трубы над рукоятью: она ложится на плечо.
                    hold.Anchor = new Vector3(e.bore.x, e.bore.y, grip.z);
                    break;
                default:
                    hold.Anchor = grip;
                    break;
            }
            if (hold.Kind == RoaHoldKind.Pistol)
            {
                // Левая ладонь обнимает правую кисть слева, большой палец вдоль рамки.
                hold.Left = new RoaHandSpec
                {
                    Active = true,
                    Centre = grip + Vector3.left * (hold.Right.Radius + 0.024f)
                        + Vector3.down * 0.018f + Vector3.forward * 0.004f,
                    Axis = gripAxis.normalized, Back = (Vector3.left + Vector3.back * 0.15f).normalized,
                    Radius = hold.Right.Radius + 0.012f
                };
            }
            else
            {
                hold.Left = SupportUnderside(e, grip, hold.Kind);
            }
        }

        /// <summary>
        /// Левая кисть под цевьём: как можно дальше вперёд, но так, чтобы локоть
        /// не выпрямлялся (по технике стрельбы). Помпа или передняя рукоять — сразу на них.
        /// </summary>
        private static RoaHandSpec SupportUnderside(RoaHoldAnchors.Entry e, Vector3 grip, RoaHoldKind kind)
        {
            var spec = new RoaHandSpec
            {
                Active = true, Axis = Vector3.forward,
                Back = (Vector3.down * 0.8f + Vector3.left * 0.6f).normalized
            };
            // Помпа или передняя рукоять — если до неё дотягивается рука (у пулемёта
            // «ручка» — это переносная скоба над стволом, до неё не достать).
            float reachLimit = e.butt.z < grip.z ? e.butt.z + 0.64f : grip.z + 0.45f;
            if (e.hasHandle && e.prefab != "SM_Wep_FlameThrower_01" && e.handleCentre.z > grip.z + 0.06f
                && e.handleCentre.z < reachLimit && e.handleCentre.y < e.bore.y + 0.02f)
            {
                spec.Centre = e.handleCentre;
                spec.Radius = Mathf.Clamp(Mathf.Min(e.handleSize.x, e.handleSize.y) * 0.5f, 0.014f, 0.03f);
                return spec;
            }
            // Дальность от рукояти по стволу: винтовке — 0.30–0.36 м, обрезу и трубе — ближе.
            // Кисть под цевьём с согнутым локтем, опущенным вниз (не вытянутая рука крылом).
            float reach = kind == RoaHoldKind.SawedOff ? 0.2f : kind == RoaHoldKind.Launcher ? 0.12f : 0.25f;
            float want = grip.z + reach + (SupportShift.TryGetValue(e.prefab, out float shift) ? shift : 0f);
            // Не ближе 9 см к дульному срезу.
            want = Mathf.Min(want, e.max.z - 0.09f);
            // Приклад в плече: от затыльника до левой кисти рука дотягивается на ~0.62 м
            // с согнутым локтем (длинная коробка пулемёта иначе уводит кисть дальше руки).
            if (kind == RoaHoldKind.LongGun && e.butt.z < grip.z) want = Mathf.Min(want, e.butt.z + 0.51f);
            Vector4 best = Vector4.zero;
            float bestScore = float.MaxValue;
            foreach (Vector4 u in e.underside)
            {
                // Не на магазин: низ сечения ниже ствола больше чем на 9 см — это магазин или сошка.
                if (u.y < e.bore.y - 0.09f) continue;
                float score = Mathf.Abs(u.z - want);
                if (score < bestScore) { bestScore = score; best = u; }
            }
            if (bestScore == float.MaxValue)
            {
                spec.Centre = new Vector3(e.bore.x, e.bore.y - 0.03f, want);
                spec.Radius = 0.02f;
                return spec;
            }
            float radius = Mathf.Clamp(best.w, 0.014f, 0.028f);
            spec.Centre = new Vector3(best.x, best.y + radius, best.z);
            spec.Radius = radius;
            return spec;
        }

        private static void BuildThrowable(RoaHold hold, RoaHoldAnchors.Entry e)
        {
            Vector3 size = e.max - e.min;
            hold.Forward = Vector3.up;
            hold.Up = Vector3.back;
            hold.Length = size.y;
            Vector3 centre = (e.min + e.max) * 0.5f;
            // Бутылку держат за горлышко, остальное — в кулаке по центру.
            if (hold.Prefab == "SM_Wep_Molotov_01") centre.y = e.min.y + size.y * 0.72f;
            hold.Anchor = centre;
            hold.Right = new RoaHandSpec
            {
                Active = true, Centre = centre, Axis = Vector3.up, Back = Vector3.right,
                Radius = hold.Prefab == "SM_Wep_Molotov_01" ? 0.016f : Mathf.Clamp(Mathf.Min(size.x, size.z) * 0.5f, 0.02f, 0.045f)
            };
        }

        private static void BuildMelee(RoaHold hold, RoaHoldAnchors.Entry e)
        {
            MeleeShape shape;
            if (!ShapeByPrefab.TryGetValue(hold.Prefab, out shape))
            {
                shape.Bottom = e.haftBottom;
                shape.Top = e.haftTop;
                shape.Radius = e.haftRadius;
                shape.Edge = e.headSide.sqrMagnitude > 0.5f ? e.headSide : Vector3.up;
            }
            Vector3 axis = shape.Top - shape.Bottom;
            if (axis.sqrMagnitude < 1e-4f) axis = Vector3.forward;
            axis.Normalize();
            hold.Forward = axis;
            Vector3 edge = Vector3.ProjectOnPlane(shape.Edge, axis);
            hold.Up = edge.sqrMagnitude > 1e-4f ? edge.normalized : Vector3.ProjectOnPlane(Vector3.up, axis).normalized;
            hold.Length = Vector3.Dot(new Vector3(e.max.x - e.min.x, e.max.y - e.min.y, e.max.z - e.min.z), new Vector3(Mathf.Abs(axis.x), Mathf.Abs(axis.y), Mathf.Abs(axis.z)));
            float radius = Mathf.Clamp(shape.Radius, 0.012f, 0.024f);
            float spacing = HandSpacing.TryGetValue(hold.Prefab, out float s) ? s : 0.18f;
            hold.Spacing = spacing;
            float end = 0.045f;
            bool twoHands = hold.Kind == RoaHoldKind.TwoHand || hold.Kind == RoaHoldKind.Sword
                || hold.Kind == RoaHoldKind.Spear || hold.Kind == RoaHoldKind.Bat;
            // Правая кисть: у одноручного — у торца, у двуручного — выше левой.
            Vector3 right = shape.Bottom + axis * (twoHands ? end + spacing : end + 0.02f);
            if (hold.Kind == RoaHoldKind.Spear) right = shape.Bottom + axis * 0.35f;
            hold.Anchor = right;
            // Тыльная сторона правой кисти — наружу вправо (ось X модели выбирается позой).
            hold.Right = new RoaHandSpec { Active = true, Centre = right, Axis = axis, Back = Vector3.Cross(axis, hold.Up).normalized, Radius = radius };
            if (twoHands)
            {
                Vector3 left = hold.Kind == RoaHoldKind.Spear ? right + axis * spacing : shape.Bottom + axis * end;
                hold.Left = new RoaHandSpec { Active = true, Centre = left, Axis = axis, Back = -Vector3.Cross(axis, hold.Up).normalized, Radius = radius };
            }
        }

        private static RoaHoldPose P(Vector3 point, Vector3 forward, Vector3 up, float headPitch = 0f, float headRoll = 0f) =>
            new RoaHoldPose { Point = point, Forward = forward.normalized, Up = up.normalized, HeadPitch = headPitch, HeadRoll = headRoll };

        private static RoaHoldPose Lerp(RoaHoldPose a, RoaHoldPose b, float t)
        {
            return new RoaHoldPose
            {
                Point = Vector3.Lerp(a.Point, b.Point, t),
                Forward = Vector3.Slerp(a.Forward, b.Forward, t).normalized,
                Up = Vector3.Slerp(a.Up, b.Up, t).normalized,
                HeadPitch = Mathf.Lerp(a.HeadPitch, b.HeadPitch, t),
                HeadRoll = Mathf.Lerp(a.HeadRoll, b.HeadRoll, t),
                Spine = Vector3.Lerp(a.Spine, b.Spine, t)
            };
        }

        private static Vector3 Dir(float yawDeg, float pitchDownDeg)
        {
            return Quaternion.Euler(pitchDownDeg, -yawDeg, 0f) * Vector3.forward;
        }

        private static float Smooth(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3f - 2f * t);
        }

        /// <summary>
        /// Поза предмета: raise — 0 готовность, 1 вскинуто к стрельбе; swing —
        /// фаза удара или броска 0..1 (−1 — нет).
        /// </summary>
        public static RoaHoldPose Sample(RoaHold hold, float raise, float swing)
        {
            float r = Smooth(raise);
            switch (hold.Kind)
            {
                case RoaHoldKind.LongGun:
                    // Приклад всё время в плечевом кармане: в готовности ствол опущен,
                    // вскинуто — горизонтально, щека на прикладе.
                    return Lerp(
                        P(new Vector3(0.13f, 1.42f, 0.07f), Dir(10f, hold.ReadyPitch), Vector3.up),
                        P(new Vector3(0.12f, 1.455f, 0.07f) + hold.AimOffset, Dir(4f, 0f), Vector3.up, 11f, 8f), r);
                case RoaHoldKind.Pistol:
                    // Готовность — пистолет у груди стволом вниз; вскинуто — руки почти
                    // выпрямлены, мушка на линии глаз.
                    return Lerp(
                        P(new Vector3(0.05f, 1.15f, 0.31f) + hold.ReadyOffset, Dir(6f, hold.ReadyPitch + 10f), Vector3.up),
                        P(new Vector3(0.035f, 1.42f, 0.58f) + hold.AimOffset, Dir(3f, hold.AimPitch), Vector3.up, 10f, 0f), r);
                case RoaHoldKind.SawedOff:
                    // Без приклада: у пояса стволом вниз; вскинуто — перед подбородком,
                    // руки вытянуты, как пистолет двумя руками.
                    return Lerp(
                        P(new Vector3(0.12f, 1.08f, 0.28f), Dir(10f, 40f), Vector3.up),
                        P(new Vector3(0.08f, 1.32f, 0.52f), Dir(4f, 0f), Vector3.up, 8f, 0f), r);
                case RoaHoldKind.HipGun:
                    return Lerp(
                        P(new Vector3(0.2f, 1.08f, 0.06f), Dir(6f, 10f), Vector3.up),
                        P(new Vector3(0.2f, 1.1f, 0.08f), Dir(4f, 0f), Vector3.up), r);
                case RoaHoldKind.Launcher:
                    // Труба на правом плече, рукоять ~30 см перед плечом: в готовности дульным концом вверх, к стрельбе —
                    // горизонтально, голова к прицелу.
                    return Lerp(
                        P(new Vector3(0.2f, 1.54f, 0.32f), Dir(2f, -3f), Vector3.up, 4f, 4f),
                        P(new Vector3(0.2f, 1.53f, 0.32f), Dir(2f, 0f), Vector3.up, 12f, 12f), r);
                case RoaHoldKind.Throwable:
                    return Throw(swing);
                default:
                    RoaHoldPose melee = Melee(hold, swing);
                    if (hold.Kind == RoaHoldKind.PowerTool) melee.Point += hold.AimOffset;
                    return melee;
            }
        }

        /// <summary>
        /// Пистолет в каждой руке: в готовности стволы опущены вперёд у пояса,
        /// вскинуто — обе руки вытянуты, стволы рядом, чуть сведены к центру.
        /// Левая поза — зеркало правой.
        /// </summary>
        public static RoaHoldPose SampleDual(float raise, bool left)
        {
            RoaHoldPose pose = Lerp(
                P(new Vector3(0.2f, 1.06f, 0.28f), Dir(4f, 42f), Vector3.up),
                P(new Vector3(0.2f, 1.35f, 0.54f), Dir(0f, 0f), Vector3.up, 8f, 0f), Smooth(raise));
            if (!left) return pose;
            pose.Point.x = -pose.Point.x;
            pose.Forward.x = -pose.Forward.x;
            pose.Up.x = -pose.Up.x;
            return pose;
        }

        private static RoaHoldPose Throw(float phase)
        {
            RoaHoldPose ready = P(new Vector3(0.22f, 1.02f, 0.24f), Vector3.up, Vector3.back);
            if (phase < 0f) return ready;
            // Замах: кисть далеко за головой, плечо горизонтально, корпус скручен; выпуск —
            // впереди плеча выше головы, рука почти прямая.
            RoaHoldPose back = P(new Vector3(0.32f, 1.6f, -0.44f), new Vector3(0f, 0.6f, 0.8f), Vector3.back);
            back.Spine = new Vector3(0.1f, -0.55f, -0.08f);
            RoaHoldPose release = P(new Vector3(0.24f, 1.56f, 0.46f), new Vector3(0f, 0.1f, 1f), Vector3.up);
            release.Spine = new Vector3(-0.2f, 0.5f, 0.06f);
            // Выпуск — к моменту контакта (0.58): кисть впереди головы на уровне глаз.
            if (phase < 0.36f) return Lerp(ready, back, Smooth(phase / 0.36f));
            if (phase < 0.56f) return Lerp(back, release, Smooth((phase - 0.36f) / 0.2f));
            if (phase < 0.66f) return release;
            return Lerp(release, ready, Smooth((phase - 0.66f) / 0.34f));
        }

        /// <summary>
        /// Левая рука при броске: вытянута к цели на уровне плеча для равновесия.
        /// Возвращает вес 0..1 и точку кисти в пространстве персонажа.
        /// </summary>
        public static float ThrowBalance(float phase, out Vector3 point)
        {
            // Рука-противовес впереди на замахе, к выпуску тянется назад на уровне груди.
            point = Vector3.Lerp(new Vector3(-0.3f, 1.3f, 0.4f), new Vector3(-0.32f, 1.25f, 0.02f), Smooth((phase - 0.4f) / 0.2f));
            if (phase < 0f) return 0f;
            if (phase < 0.28f) return Smooth(phase / 0.28f);
            if (phase < 0.7f) return 1f;
            return 1f - Smooth((phase - 0.7f) / 0.25f);
        }

        // «Верх» у стоек удара — направление движения лезвия по дуге: так соседние
        // позы поворачиваются в одну сторону, и лезвие не переворачивается на полпути.
        private static RoaHoldPose Melee(RoaHold hold, float phase)
        {
            RoaHoldKind kind = hold.Kind;
            RoaHoldPose ready, windup, strike;
            // Удар сверху: замах над правым плечом, контакт — вперёд-вниз, боёк на уровне
            // пояса, древко наклонено вниз на 30°.
            RoaHoldPose chopWindup = P(new Vector3(0.18f, 1.62f, -0.02f), new Vector3(-0.08f, 0.55f, -0.83f), new Vector3(0f, 0.83f, 0.56f));
            // Наклон древка на контакте — чтобы боёк пришёл на уровень пояса (~0.95 м)
            // при любой длине: у лома и лопаты меньше, у короткого топора больше.
            // Кисти на контакте сошлись у торца: до бойка — почти вся длина древка.
            bool slides = hold.Kind == RoaHoldKind.TwoHand && hold.Spacing >= 0.15f;
            float reachToHead = Mathf.Max(0.2f, hold.Length - 0.045f - (slides ? 0.08f : hold.Spacing)) * 0.85f;
            // Боёк — на ~0.9 м (пояс) при почти прямых руках: наклон задаёт высоту бойка,
            // руки не подтягиваются к животу. Не меньше 10°, чтобы читался с камеры.
            float pitch = Mathf.Asin(Mathf.Clamp((0.98f - 0.9f) / reachToHead, 0.17f, 0.55f));
            Vector3 chopDir = new Vector3(0f, -Mathf.Sin(pitch), Mathf.Cos(pitch));
            // Руки на контакте сходятся у торца (верхняя соскальзывает) и почти выпрямлены.
            RoaHoldPose chopStrike = P(new Vector3(0.04f, 0.97f, 0.62f), chopDir, new Vector3(0f, -chopDir.z, chopDir.y));
            switch (kind)
            {
                case RoaHoldKind.Sword:
                    // Средняя стойка: кисти у пояса, клинок вперёд-вверх, лезвие вниз.
                    ready = P(new Vector3(0.04f, 1.1f, 0.34f), new Vector3(-0.08f, 0.62f, 0.78f), new Vector3(0f, -0.78f, 0.62f));
                    windup = P(new Vector3(0.08f, 1.66f, 0.1f), new Vector3(0f, 0.55f, -0.83f), new Vector3(0f, 0.83f, 0.55f));
                    strike = P(new Vector3(0.02f, 1.06f, 0.5f), new Vector3(0f, -0.4f, 0.92f), new Vector3(0f, -0.92f, -0.4f));
                    break;
                case RoaHoldKind.Bat:
                    // Бита на правом плече; замах — назад за плечо; удар — горизонтально,
                    // бита поперёк корпуса, дальше влево-вперёд.
                    ready = P(new Vector3(0.14f, 1.2f, 0.16f), new Vector3(0.22f, 0.72f, -0.66f), Vector3.forward);
                    windup = P(new Vector3(0.23f, 1.5f, -0.05f), new Vector3(0.12f, 0.7f, -0.7f), Vector3.forward);
                    // Контакт: бита поперёк линии удара, руки у пупка, рукоять ведёт.
                    strike = P(new Vector3(0.06f, 1.08f, 0.52f), new Vector3(-0.72f, 0.05f, 0.69f), Vector3.forward);
                    break;
                case RoaHoldKind.OneHand:
                    // Опущено у бедра, боёк вперёд; удар наискось сверху справа.
                    // Опущено у бедра остриём вниз-вперёд на 40°; удар наискось, контакт на уровне пояса.
                    ready = P(new Vector3(0.25f, 0.9f, 0.14f), new Vector3(0.05f, -0.5f, 0.86f), new Vector3(0f, -0.86f, -0.5f));
                    windup = P(new Vector3(0.3f, 1.58f, -0.04f), new Vector3(-0.1f, 0.6f, -0.8f), new Vector3(0f, 0.8f, 0.6f));
                    strike = P(new Vector3(0.06f, 1.16f, 0.48f), new Vector3(-0.3f, -0.22f, 0.93f), new Vector3(-0.07f, -0.97f, -0.23f));
                    break;
                case RoaHoldKind.Knife:
                    // Нож у пояса остриём вперёд, лезвие вниз; удар — укол вперёд на всю руку.
                    ready = P(new Vector3(0.22f, 1.04f, 0.26f), new Vector3(0f, 0.22f, 0.97f), Vector3.down);
                    windup = P(new Vector3(0.3f, 1.18f, 0.0f), new Vector3(0f, 0.18f, 0.98f), Vector3.down);
                    strike = P(new Vector3(0.08f, 1.26f, 0.72f), new Vector3(-0.05f, 0.05f, 1f), Vector3.down);
                    break;
                case RoaHoldKind.Spear:
                    ready = P(new Vector3(0.22f, 1.02f, 0.1f), new Vector3(0.06f, 0.22f, 0.97f), Vector3.up);
                    windup = P(new Vector3(0.26f, 1.08f, -0.12f), new Vector3(0.03f, 0.2f, 0.98f), Vector3.up);
                    strike = P(new Vector3(0.1f, 1.2f, 0.38f), new Vector3(-0.06f, 0.1f, 0.99f), Vector3.up);
                    break;
                case RoaHoldKind.Tonfa:
                    // Кулак у бедра, ручка вертикально, древко вдоль предплечья к локтю;
                    // удар — кулаком вперёд, древко прикрывает предплечье.
                    // Рука висит: ручка вперёд, древко вверх вдоль предплечья к локтю.
                    ready = P(new Vector3(0.25f, 0.72f, 0.02f), new Vector3(0f, 0.12f, 0.99f), new Vector3(0f, 0.99f, -0.12f));
                    // Замах: предплечье поперёк груди, древко прикрывает его к правому локтю.
                    // Замах: кулак отведён к бедру, древко вдоль предплечья назад к локтю.
                    windup = P(new Vector3(0.25f, 1.05f, -0.02f), new Vector3(0f, 0.95f, 0.3f), new Vector3(0f, 0.05f, -1f));
                    strike = P(new Vector3(0.08f, 1.3f, 0.72f), new Vector3(0f, 0.95f, 0.3f), new Vector3(0f, 0.05f, -1f));
                    break;
                case RoaHoldKind.PowerTool:
                    // Задняя ручка у правого бедра, полотно вперёд и чуть к центру.
                    if (hold.Prefab.StartsWith("SM_Wep_Trimmer"))
                    {
                        // Кусторез: головка у земли, удар — взмах в сторону справа налево.
                        ready = P(new Vector3(0.18f, 0.98f, 0.24f), new Vector3(0.05f, -0.42f, 0.91f), Vector3.up);
                        windup = P(new Vector3(0.2f, 0.98f, 0.2f), new Vector3(0.58f, -0.4f, 0.71f), Vector3.up);
                        strike = P(new Vector3(0.14f, 0.98f, 0.26f), new Vector3(-0.36f, -0.4f, 0.84f), Vector3.up);
                    }
                    else
                    {
                        // Бензопила: полотно вперёд и чуть наружу; замах — назад и вверх, удар — вперёд-вниз.
                        // Полотно по линии реза, не больше 15° вправо от направления вперёд.
                        ready = P(new Vector3(0.21f, 1.0f, 0.24f), new Vector3(0.22f, -0.08f, 0.97f), Vector3.up);
                        windup = P(new Vector3(0.22f, 1.12f, 0.02f), new Vector3(0.05f, 0.35f, 0.94f), Vector3.up);
                        strike = P(new Vector3(0.2f, 1.02f, 0.46f), new Vector3(0.05f, -0.32f, 0.95f), Vector3.up);
                    }
                    break;
                case RoaHoldKind.Shield:
                    // Щит перед грудью на левой руке, лицом вперёд; удар — толчок вперёд.
                    ready = P(new Vector3(-0.1f, 1.15f, 0.34f), Vector3.up, Vector3.back);
                    // Замах: щит прижат к груди, локоть отведён — толчку есть куда идти.
                    windup = P(new Vector3(-0.14f, 1.2f, 0.18f), Vector3.up, Vector3.back);
                    strike = P(new Vector3(-0.04f, 1.26f, 0.56f), Vector3.up, Vector3.back);
                    break;
                default:
                    // Двуручное древко: наискось вперёд, боёк впереди справа на уровне груди, лезвие вперёд.
                    ready = P(new Vector3(0.12f, 1.04f, 0.3f + Mathf.Max(0f, hold.Spacing - 0.3f) * 0.7f),
                        hold.Spacing > 0.4f ? new Vector3(0.42f, 0.3f, 0.86f) : new Vector3(0.42f, 0.55f, 0.72f), Vector3.forward);
                    windup = chopWindup;
                    strike = chopStrike;
                    break;
            }
            windup.Spine = new Vector3(0.14f, -0.32f, -0.1f);
            strike.Spine = new Vector3(-0.26f, 0.28f, 0.08f);
            if (phase < 0f) return ready;
            if (phase < 0.34f) return Lerp(ready, windup, Smooth(phase / 0.34f));
            if (phase < RoaMeleeGrip.StrikeContactPhase)
                return Lerp(windup, strike, Smooth((phase - 0.34f) / (RoaMeleeGrip.StrikeContactPhase - 0.34f)));
            return Lerp(strike, ready, Smooth((phase - RoaMeleeGrip.StrikeContactPhase) / (1f - RoaMeleeGrip.StrikeContactPhase)));
        }

        /// <summary>
        /// Скольжение верхней руки по древку, м (+ к бойку): на замахе рука уходит к
        /// бойку, к удару съезжает вниз к нижней. Бита и клинок держатся без скольжения.
        /// </summary>
        public static float TopHandSlide(RoaHold hold, float phase)
        {
            if (hold.Kind != RoaHoldKind.TwoHand || hold.Spacing < 0.15f || phase < 0f) return 0f;
            float close = hold.Spacing - 0.08f;
            if (phase < 0.34f) return 0.06f * Smooth(phase / 0.34f);
            if (phase < RoaMeleeGrip.StrikeContactPhase)
                return Mathf.Lerp(0.06f, -close, Smooth((phase - 0.34f) / (RoaMeleeGrip.StrikeContactPhase - 0.34f)));
            return Mathf.Lerp(-close, 0f, Smooth((phase - RoaMeleeGrip.StrikeContactPhase) / (1f - RoaMeleeGrip.StrikeContactPhase)));
        }

        /// <summary>Какими пальцами держит кисть в этой позе.</summary>
        public static RoaFingerPose FingersFor(RoaHold hold, bool right, float raise, bool firing = false)
        {
            if (hold.Firearm)
            {
                // Палец ложится на спуск только на выстреле, в остальное время — вдоль рамки.
                if (right) return firing ? RoaFingerPose.Trigger : RoaFingerPose.TriggerOff;
                if (hold.Kind == RoaHoldKind.Pistol) return RoaFingerPose.Support;
                return hold.Kind == RoaHoldKind.HipGun || hold.Kind == RoaHoldKind.Launcher ? RoaFingerPose.Wrap : RoaFingerPose.Cradle;
            }
            return RoaFingerPose.Wrap;
        }
    }
}
