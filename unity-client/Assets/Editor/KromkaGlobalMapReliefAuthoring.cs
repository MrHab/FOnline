using System.Collections.Generic;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Canonical 380 x 300 km relief field for the Kromka strategic map.
    /// Iteration 20/20 adds restrained region-specific ground grain and performs
    /// the final full-field relief acceptance; materials, MEP dressing and
    /// atmospheric effects remain separate passes.
    /// </summary>
    public static class KromkaGlobalMapReliefAuthoring
    {
        internal const int ReliefIteration = 20;
        internal const int ReliefIterationCount = 20;

        private const float WidthPoints = 380f;
        private const float HeightPoints = 300f;
        private const float WorldScale = 0.1f;
        private const int FieldSamplesX = 191;
        private const int FieldSamplesY = 151;
        private const int AngularSegments = 320;
        private const int RadialSegments = 72;
        private const string MeshPath = "Assets/Art/Kromka/Meshes/Kromka_GlobalRelief.asset";
        private const string ReliefAssetPath =
            "Assets/Resources/RealmOfAshes/GlobalMapRelief.asset";

        private static readonly Vector2[] TesmaPath =
        {
            // Mountain headwaters begin inside the northern rim. The final two
            // points below the terminal basin describe only its dry overflow
            // saddle; the visible water surface ends at the basin floor.
            new Vector2(183f, 292f), new Vector2(194f, 282f),
            new Vector2(205f, 267f), new Vector2(197f, 253f),
            new Vector2(191f, 240f), new Vector2(196f, 223f),
            new Vector2(205f, 205f), new Vector2(202f, 189f),
            new Vector2(194f, 173f), new Vector2(199f, 154f),
            new Vector2(209f, 135f), new Vector2(207f, 116f),
            new Vector2(202f, 98f), new Vector2(204f, 79f),
            new Vector2(205f, 57f), new Vector2(209f, 34f),
            new Vector2(212f, 7f)
        };

        private static readonly Vector2[] NorthernDamFront =
        {
            new Vector2(126f, 242f), new Vector2(153f, 239f),
            new Vector2(181f, 243f), new Vector2(209f, 239f),
            new Vector2(237f, 244f), new Vector2(264f, 241f)
        };

        private static readonly Vector2[] NorthernServiceBench =
        {
            new Vector2(121f, 229f), new Vector2(151f, 226f),
            new Vector2(181f, 229f), new Vector2(211f, 226f),
            new Vector2(241f, 231f), new Vector2(271f, 228f)
        };

        private static readonly Vector2[] SluiceSpillway =
        {
            new Vector2(209f, 286f), new Vector2(207f, 270f),
            new Vector2(199f, 255f), new Vector2(191f, 240f),
            new Vector2(193f, 224f), new Vector2(201f, 209f)
        };

        private static readonly Vector2[] GlassFractureNorth =
        {
            new Vector2(269f, 248f), new Vector2(297f, 230f),
            new Vector2(326f, 223f), new Vector2(351f, 204f)
        };

        private static readonly Vector2[] GlassFractureSouth =
        {
            new Vector2(267f, 184f), new Vector2(294f, 171f),
            new Vector2(326f, 169f), new Vector2(355f, 145f)
        };

        private static readonly Vector2[] GlassFaultCentral =
        {
            new Vector2(266f, 246f), new Vector2(279f, 225f),
            new Vector2(273f, 205f), new Vector2(288f, 184f),
            new Vector2(283f, 161f), new Vector2(296f, 139f)
        };

        private static readonly Vector2[] GlassFaultEast =
        {
            new Vector2(342f, 246f), new Vector2(332f, 225f),
            new Vector2(347f, 204f), new Vector2(339f, 184f),
            new Vector2(354f, 163f), new Vector2(349f, 139f)
        };

        private static readonly Vector2[] OreSpillFan =
        {
            new Vector2(118f, 207f), new Vector2(142f, 199f),
            new Vector2(165f, 190f), new Vector2(191f, 181f)
        };

        private static readonly Vector2[] OreHaulRampNorth =
        {
            new Vector2(65f, 221f), new Vector2(78f, 211f),
            new Vector2(94f, 211f), new Vector2(105f, 222f),
            new Vector2(119f, 229f), new Vector2(136f, 225f),
            new Vector2(151f, 212f)
        };

        private static readonly Vector2[] OreHaulRampSouth =
        {
            new Vector2(64f, 220f), new Vector2(60f, 204f),
            new Vector2(68f, 191f), new Vector2(84f, 183f),
            new Vector2(103f, 184f), new Vector2(119f, 194f),
            new Vector2(132f, 204f)
        };

        private static readonly Vector2[] OreTailingsNorth =
        {
            new Vector2(105f, 258f), new Vector2(126f, 254f),
            new Vector2(145f, 247f), new Vector2(162f, 238f)
        };

        private static readonly Vector2[] OreTailingsSouth =
        {
            new Vector2(91f, 172f), new Vector2(111f, 174f),
            new Vector2(130f, 181f), new Vector2(146f, 190f)
        };

        private static readonly Vector2[] WestDrainage =
        {
            new Vector2(92f, 151f), new Vector2(119f, 158f),
            new Vector2(145f, 166f), new Vector2(171f, 169f),
            new Vector2(194f, 173f)
        };

        private static readonly Vector2[] EastDrainage =
        {
            new Vector2(355f, 151f), new Vector2(327f, 157f),
            new Vector2(297f, 156f), new Vector2(269f, 148f),
            new Vector2(239f, 141f), new Vector2(209f, 135f)
        };

        private static readonly Vector2[] SouthDrainage =
        {
            new Vector2(116f, 52f), new Vector2(141f, 63f),
            new Vector2(166f, 76f), new Vector2(184f, 87f),
            new Vector2(202f, 98f)
        };

        private static readonly Vector2[] ZeroWetlandSpine =
        {
            new Vector2(119f, 52f), new Vector2(144f, 54f),
            new Vector2(169f, 59f), new Vector2(193f, 55f),
            new Vector2(216f, 45f), new Vector2(239f, 54f),
            new Vector2(260f, 68f)
        };

        private static readonly Vector2[] ZeroEastDrain =
        {
            new Vector2(278f, 63f), new Vector2(259f, 72f),
            new Vector2(240f, 79f), new Vector2(221f, 89f),
            new Vector2(202f, 98f)
        };

        private static readonly Vector2[] TractMainEarthwork =
        {
            new Vector2(0f, 155f), new Vector2(54f, 155f),
            new Vector2(101f, 154f), new Vector2(125f, 155f),
            new Vector2(154f, 177f), new Vector2(195f, 205f),
            new Vector2(222f, 184f), new Vector2(245f, 165f),
            new Vector2(270f, 138f), new Vector2(295f, 110f),
            new Vector2(337f, 96f), new Vector2(380f, 85f)
        };

        private static readonly Vector2[] TractSouthBypass =
        {
            new Vector2(119f, 154f), new Vector2(145f, 157f),
            new Vector2(170f, 161f), new Vector2(190f, 153f),
            new Vector2(210f, 145f), new Vector2(230f, 153f),
            new Vector2(245f, 165f)
        };

        private static readonly Vector2[] MiddleCanalWest =
        {
            new Vector2(187f, 227f), new Vector2(174f, 212f),
            new Vector2(161f, 198f), new Vector2(154f, 182f),
            new Vector2(158f, 166f), new Vector2(174f, 151f)
        };

        private static readonly Vector2[] MiddleCanalEast =
        {
            new Vector2(214f, 226f), new Vector2(222f, 210f),
            new Vector2(232f, 194f), new Vector2(235f, 178f),
            new Vector2(230f, 162f), new Vector2(216f, 148f)
        };

        private static readonly Vector2[] SilentRidgeNorthWest =
        {
            new Vector2(29f, 221f), new Vector2(55f, 247f),
            new Vector2(90f, 269f), new Vector2(125f, 284f),
            new Vector2(160f, 292f)
        };

        private static readonly Vector2[] SilentRidgeNorthEast =
        {
            new Vector2(221f, 291f), new Vector2(255f, 284f),
            new Vector2(290f, 269f), new Vector2(325f, 247f),
            new Vector2(350f, 220f)
        };

        private static readonly Vector2[] SilentRidgeEast =
        {
            new Vector2(350f, 220f), new Vector2(365f, 190f),
            new Vector2(372f, 155f), new Vector2(368f, 120f),
            new Vector2(355f, 85f)
        };

        private static readonly Vector2[] SilentRidgeSouthEast =
        {
            new Vector2(355f, 85f), new Vector2(337f, 60f),
            new Vector2(310f, 38f), new Vector2(275f, 20f),
            new Vector2(235f, 10f)
        };

        private static readonly Vector2[] SilentRidgeSouthWest =
        {
            new Vector2(151f, 8f), new Vector2(115f, 17f),
            new Vector2(80f, 34f), new Vector2(50f, 58f),
            new Vector2(30f, 88f)
        };

        private static readonly Vector2[] SilentRidgeWest =
        {
            new Vector2(30f, 88f), new Vector2(14f, 120f),
            new Vector2(8f, 150f), new Vector2(14f, 185f),
            new Vector2(29f, 221f)
        };

        private static readonly Vector2[] SilentPassNorth =
        {
            new Vector2(207f, 300f), new Vector2(207f, 292f),
            new Vector2(204f, 282f), new Vector2(199f, 272f),
            new Vector2(194f, 262f)
        };

        private static readonly Vector2[] SilentPassSouth =
        {
            new Vector2(212f, 0f), new Vector2(212f, 8f),
            new Vector2(210f, 20f), new Vector2(209f, 34f),
            new Vector2(205f, 50f)
        };

        private static readonly Vector2[] SilentPassWest =
        {
            new Vector2(0f, 155f), new Vector2(9f, 155f),
            new Vector2(23f, 155f), new Vector2(40f, 155f),
            new Vector2(57f, 155f)
        };

        private static readonly Vector2[] SilentPassEast =
        {
            new Vector2(380f, 85f), new Vector2(366f, 84f),
            new Vector2(353f, 83f), new Vector2(340f, 85f),
            new Vector2(326f, 93f), new Vector2(317f, 100f)
        };

        private static readonly Vector2[] SluiceMiddleApronWest =
        {
            new Vector2(142f, 242f), new Vector2(150f, 232f),
            new Vector2(160f, 222f), new Vector2(170f, 214f)
        };

        private static readonly Vector2[] SluiceMiddleApronEast =
        {
            new Vector2(250f, 243f), new Vector2(244f, 233f),
            new Vector2(238f, 223f), new Vector2(229f, 214f)
        };

        private static readonly Vector2[] OreMiddleApronNorth =
        {
            new Vector2(126f, 229f), new Vector2(145f, 220f),
            new Vector2(164f, 210f), new Vector2(184f, 201f)
        };

        private static readonly Vector2[] OreMiddleApronSouth =
        {
            new Vector2(111f, 177f), new Vector2(133f, 176f),
            new Vector2(155f, 181f), new Vector2(176f, 190f)
        };

        private static readonly Vector2[] GlassMiddleBrokenFront =
        {
            new Vector2(244f, 235f), new Vector2(250f, 217f),
            new Vector2(247f, 198f), new Vector2(253f, 180f),
            new Vector2(246f, 163f), new Vector2(248f, 145f),
            new Vector2(244f, 127f)
        };

        private static readonly Vector2[] ChalkZeroBrokenApron =
        {
            new Vector2(244f, 126f), new Vector2(249f, 109f),
            new Vector2(249f, 92f), new Vector2(258f, 78f),
            new Vector2(271f, 66f)
        };

        private static readonly Vector2[] ChalkGullyNorth =
        {
            new Vector2(367f, 119f), new Vector2(344f, 111f),
            new Vector2(322f, 103f), new Vector2(300f, 94f),
            new Vector2(278f, 88f), new Vector2(254f, 91f)
        };

        private static readonly Vector2[] ChalkGullySouth =
        {
            new Vector2(349f, 72f), new Vector2(329f, 68f),
            new Vector2(307f, 72f), new Vector2(286f, 80f),
            new Vector2(267f, 88f)
        };

        private static readonly Vector2[] ChalkRidgeWest =
        {
            new Vector2(247f, 132f), new Vector2(269f, 121f),
            new Vector2(292f, 111f), new Vector2(316f, 104f),
            new Vector2(339f, 101f)
        };

        private static readonly Vector2[] ChalkRidgeCentre =
        {
            new Vector2(260f, 105f), new Vector2(283f, 94f),
            new Vector2(307f, 84f), new Vector2(333f, 79f),
            new Vector2(358f, 82f)
        };

        private static readonly Vector2[] ChalkRidgeSouth =
        {
            new Vector2(250f, 76f), new Vector2(276f, 63f),
            new Vector2(304f, 55f), new Vector2(333f, 56f),
            new Vector2(359f, 65f)
        };

        private static readonly Vector2[] CentralOxbowWest =
        {
            new Vector2(197f, 151f), new Vector2(181f, 145f),
            new Vector2(166f, 135f), new Vector2(163f, 122f),
            new Vector2(173f, 111f), new Vector2(190f, 107f),
            new Vector2(202f, 113f)
        };

        private static readonly Vector2[] NinthQuarryAccess =
        {
            new Vector2(128f, 244f), new Vector2(121f, 246f),
            new Vector2(116f, 248f), new Vector2(112f, 250f)
        };

        private static readonly Vector2[] IronMineAccess =
        {
            new Vector2(84f, 265f), new Vector2(73f, 260f),
            new Vector2(60f, 261f), new Vector2(51f, 264f),
            new Vector2(43f, 267f)
        };

        private static readonly Vector2[] SortingFieldsAccess =
        {
            new Vector2(76f, 210f), new Vector2(82f, 218f),
            new Vector2(89f, 227f), new Vector2(95f, 237f)
        };

        private static readonly Vector2[] CeramicLedgeAccess =
        {
            new Vector2(295f, 155f), new Vector2(287f, 149f),
            new Vector2(280f, 144f), new Vector2(274f, 139f)
        };

        private static readonly Vector2[] StorehouseCraterAccess =
        {
            new Vector2(295f, 155f), new Vector2(302f, 152f),
            new Vector2(309f, 148f), new Vector2(315f, 143f)
        };

        private static readonly Vector2[] VectorResearchAccess =
        {
            new Vector2(330f, 196f), new Vector2(332f, 206f),
            new Vector2(335f, 216f), new Vector2(338f, 225f)
        };

        private static readonly Vector2[] SolarFieldAccess =
        {
            new Vector2(330f, 166f), new Vector2(336f, 162f),
            new Vector2(341f, 158f), new Vector2(345f, 154f)
        };

        private static readonly Vector2[] OreStrataWashNorth =
        {
            new Vector2(31f, 245f), new Vector2(50f, 238f),
            new Vector2(68f, 230f)
        };

        private static readonly Vector2[] OreStrataWashSouth =
        {
            new Vector2(35f, 205f), new Vector2(52f, 213f),
            new Vector2(70f, 220f)
        };

        private static readonly Vector2[] GlassSplinterNorth =
        {
            new Vector2(285f, 244f), new Vector2(301f, 232f),
            new Vector2(316f, 220f)
        };

        private static readonly Vector2[] GlassSplinterEast =
        {
            new Vector2(319f, 208f), new Vector2(332f, 196f),
            new Vector2(346f, 187f)
        };

        private static readonly Vector2[] ChalkRunnelNorth =
        {
            new Vector2(282f, 128f), new Vector2(300f, 115f),
            new Vector2(318f, 103f)
        };

        private static readonly Vector2[] ChalkRunnelSouth =
        {
            new Vector2(310f, 86f), new Vector2(327f, 78f),
            new Vector2(344f, 70f)
        };

        private static readonly Vector2[] ZeroSubsidenceWest =
        {
            new Vector2(115f, 91f), new Vector2(129f, 78f),
            new Vector2(145f, 67f)
        };

        private static readonly Vector2[] ZeroSubsidenceEast =
        {
            new Vector2(273f, 83f), new Vector2(260f, 71f),
            new Vector2(249f, 60f)
        };

        private static readonly Vector2[] SilentNorthEastRill =
        {
            new Vector2(309f, 281f), new Vector2(303f, 268f),
            new Vector2(294f, 255f)
        };

        private static readonly Vector2[] SilentSouthWestRill =
        {
            new Vector2(110f, 8f), new Vector2(108f, 25f),
            new Vector2(103f, 42f)
        };

        private static readonly Vector2[] SilentWestRill =
        {
            new Vector2(8f, 210f), new Vector2(22f, 207f),
            new Vector2(37f, 201f)
        };

        private static readonly Vector2[] SluiceCascadeWest =
        {
            new Vector2(157f, 273f), new Vector2(166f, 265f),
            new Vector2(179f, 255f), new Vector2(191f, 240f)
        };

        private static readonly Vector2[] SluiceCascadeEast =
        {
            new Vector2(249f, 258f), new Vector2(234f, 253f),
            new Vector2(216f, 249f), new Vector2(199f, 243f),
            new Vector2(191f, 240f)
        };

        private static readonly Vector2[] ZeroPoolConnectorWest =
        {
            new Vector2(137f, 82f), new Vector2(145f, 75f),
            new Vector2(154f, 67f), new Vector2(169f, 59f)
        };

        private static readonly Vector2[] ZeroPoolConnectorCentre =
        {
            new Vector2(169f, 59f), new Vector2(190f, 55f),
            new Vector2(214f, 43f)
        };

        private static readonly Vector2[] ZeroPoolConnectorEast =
        {
            new Vector2(257f, 68f), new Vector2(246f, 61f),
            new Vector2(231f, 52f), new Vector2(214f, 43f)
        };

        private static readonly Vector2[] ZeroTerminalBraidWest =
        {
            new Vector2(214f, 43f), new Vector2(202f, 34f),
            new Vector2(196f, 22f), new Vector2(208f, 8f)
        };

        private static readonly Vector2[] ZeroTerminalBraidEast =
        {
            new Vector2(214f, 43f), new Vector2(232f, 37f),
            new Vector2(244f, 24f), new Vector2(226f, 10f),
            new Vector2(212f, 7f)
        };

        [MenuItem("Kromka/Checks/Validate relief iteration 20")]
        public static void ValidateIteration20()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(MeshPath);
            RoaGlobalMapRelief asset =
                AssetDatabase.LoadAssetAtPath<RoaGlobalMapRelief>(ReliefAssetPath);
            Require(mesh != null, "The Kromka relief mesh asset is missing.");
            Require(mesh.vertexCount == 23681,
                "Unexpected relief vertex count: " + mesh.vertexCount);
            Require(mesh.triangles.Length == 139200,
                "Unexpected relief index count: " + mesh.triangles.Length);
            Require(asset != null && asset.Ready, "Runtime relief field is missing.");
            Require(asset.SamplesX == FieldSamplesX && asset.SamplesY == FieldSamplesY,
                "Runtime relief sampling does not match iteration 20.");
            Require(Mathf.Approximately(asset.WidthPoints, WidthPoints)
                && Mathf.Approximately(asset.HeightPoints, HeightPoints),
                "Runtime relief still uses the retired map dimensions.");

            float middle = asset.HeightAt(190f, 190f);
            float oreFloor = asset.HeightAt(70f, 220f);
            float oreRim = asset.HeightAt(135f, 220f);
            float north = asset.HeightAt(190f, 270f);
            float chalk = asset.HeightAt(313f, 91f);
            float zero = asset.HeightAt(203f, 56f);
            float silentRing = asset.HeightAt(150f, 8f);
            float northReservoir = asset.HeightAt(157f, 273f);
            float northDam = asset.HeightAt(240f, 243f);
            float tesmaChannel = asset.HeightAt(205f, 205f);
            float tesmaBank = asset.HeightAt(224f, 205f);
            float glassShelf = asset.HeightAt(320f, 190f);
            float glassApproach = asset.HeightAt(236f, 190f);
            float westDrain = asset.HeightAt(145f, 166f);
            float westDrainBank = asset.HeightAt(145f, 184f);
            float eastDrain = asset.HeightAt(297f, 156f);
            float eastDrainBank = asset.HeightAt(297f, 176f);
            float southDrain = asset.HeightAt(166f, 76f);
            float southDrainBank = asset.HeightAt(166f, 92f);
            float chalkGully = asset.HeightAt(322f, 103f);
            float chalkShoulder = asset.HeightAt(322f, 83f);
            float oreFan = asset.HeightAt(154f, 194f);
            float oreFanSide = asset.HeightAt(154f, 168f);
            float southRiverPass = asset.HeightAt(212f, 3f);
            float ringInterior = asset.HeightAt(150f, 35f);
            float zeroPool = asset.HeightAt(214f, 43f);
            float zeroIsland = asset.HeightAt(181f, 69f);
            float zeroPoolWest = asset.HeightAt(151f, 54f);
            float zeroPoolEast = asset.HeightAt(257f, 68f);
            float zeroPoolNorthWest = asset.HeightAt(137f, 82f);
            float zeroEastIsland = asset.HeightAt(233f, 76f);
            float zeroNorthWestBank = asset.HeightAt(137f, 100f);
            float zeroWetlandSpine = asset.HeightAt(169f, 59f);
            // Drain 4-B intentionally recesses the old 169,78 bank sample, so the
            // wetland continuity check uses the adjacent undisturbed dry levee.
            float zeroWetlandBank = asset.HeightAt(180f, 78f);
            float zeroEastDrain = asset.HeightAt(240f, 79f);
            float zeroEastDrainBank = asset.HeightAt(240f, 94f);
            float zeroSouthRim = asset.HeightAt(203f, 10f);
            float centralChannel = asset.HeightAt(202f, 160f);
            float outerFloodBank = asset.HeightAt(230f, 160f);
            float centreReservoir = asset.HeightAt(211f, 276f);
            float eastReservoir = asset.HeightAt(249f, 258f);
            float westReservoirRim = asset.HeightAt(191f, 273f);
            float centreReservoirRim = asset.HeightAt(244f, 276f);
            float eastReservoirRim = asset.HeightAt(279f, 258f);
            float spillwayFloor = asset.HeightAt(191f, 240f);
            float spillwayBank = asset.HeightAt(175f, 240f);
            float northRampStart = asset.HeightAt(65f, 221f);
            float northRampMidA = asset.HeightAt(94f, 211f);
            float northRampMidB = asset.HeightAt(119f, 229f);
            float northRampExit = asset.HeightAt(151f, 212f);
            float southRampStart = asset.HeightAt(64f, 220f);
            float southRampMidA = asset.HeightAt(68f, 191f);
            float southRampMidB = asset.HeightAt(103f, 184f);
            float southRampExit = asset.HeightAt(132f, 204f);
            float northTailings = asset.HeightAt(126f, 254f);
            float northTailingsSide = asset.HeightAt(126f, 235f);
            float southTailings = asset.HeightAt(111f, 174f);
            float southTailingsSide = asset.HeightAt(111f, 155f);
            float glassPlateNorthEast = asset.HeightAt(329f, 222f);
            float glassGapNorth = asset.HeightAt(314f, 235f);
            float glassPlateCentre = asset.HeightAt(300f, 185f);
            float glassGapWest = asset.HeightAt(280f, 185f);
            float glassFaultCentre = asset.HeightAt(279f, 225f);
            float glassFaultCentreSide = asset.HeightAt(291f, 225f);
            float glassFaultEastFloor = asset.HeightAt(339f, 184f);
            float glassFaultEastSide = asset.HeightAt(350f, 185f);
            float glassSinkNorth = asset.HeightAt(313f, 210f);
            float glassSinkNorthSide = asset.HeightAt(323f, 210f);
            float glassSinkSouth = asset.HeightAt(289f, 166f);
            float glassSinkSouthSide = asset.HeightAt(300f, 166f);
            float chalkFrontHigh = asset.HeightAt(275f, 110f);
            float chalkFrontLow = asset.HeightAt(238f, 110f);
            float chalkRidgeWestPoint = asset.HeightAt(280f, 116f);
            float chalkRidgeWestValley = asset.HeightAt(280f, 131f);
            float chalkRidgeCentrePoint = asset.HeightAt(307f, 84f);
            float chalkRidgeCentreValley = asset.HeightAt(307f, 69f);
            float chalkRidgeSouthPoint = asset.HeightAt(333f, 56f);
            float chalkRidgeSouthValley = asset.HeightAt(333f, 44f);
            float karstWest = asset.HeightAt(291f, 108f);
            float karstWestRim = asset.HeightAt(305f, 108f);
            float karstCentre = asset.HeightAt(329f, 96f);
            float karstCentreRim = asset.HeightAt(342f, 96f);
            float karstSouth = asset.HeightAt(308f, 66f);
            float karstSouthRim = asset.HeightAt(323f, 66f);
            float karstEast = asset.HeightAt(350f, 72f);
            float karstEastRim = asset.HeightAt(339f, 72f);
            float middleKeysBank = asset.HeightAt(180f, 205f);
            float middleOuterWest = asset.HeightAt(160f, 205f);
            float middleOuterEast = asset.HeightAt(246f, 205f);
            float middleFarmTerrace = asset.HeightAt(151f, 190f);
            float middleFarmTerraceEdge = asset.HeightAt(160f, 190f);
            float middleCanalWestFloor = asset.HeightAt(161f, 198f);
            float middleCanalWestBank = asset.HeightAt(149f, 198f);
            float middleCanalEastFloor = asset.HeightAt(232f, 194f);
            float middleCanalEastBank = asset.HeightAt(244f, 194f);
            float tractWestCrown = asset.HeightAt(82f, 155f);
            float tractWestLow = asset.HeightAt(82f, 135f);
            float tractCrossroads = asset.HeightAt(125f, 155f);
            float tractCrossroadsLow = asset.HeightAt(125f, 135f);
            float tractBypass = asset.HeightAt(210f, 145f);
            float tractBypassLow = asset.HeightAt(210f, 125f);
            float tractEastCrown = asset.HeightAt(245f, 165f);
            float tractEastLow = asset.HeightAt(245f, 145f);
            float tractChalkCut = asset.HeightAt(295f, 110f);
            float tractChalkShoulder = asset.HeightAt(315f, 110f);
            float silentNorthPass = asset.HeightAt(207f, 292f);
            float silentNorthPassWest = asset.HeightAt(183f, 291f);
            float silentNorthPassEast = asset.HeightAt(232f, 289f);
            float silentSouthPass = asset.HeightAt(212f, 7f);
            float silentSouthPassWest = asset.HeightAt(190f, 9f);
            float silentSouthPassEast = asset.HeightAt(235f, 10f);
            float silentWestPass = asset.HeightAt(8f, 155f);
            float silentWestPassNorth = asset.HeightAt(12f, 180f);
            float silentWestPassSouth = asset.HeightAt(12f, 130f);
            float silentEastPass = asset.HeightAt(355f, 85f);
            float silentEastPassNorth = asset.HeightAt(360f, 112f);
            float silentEastPassSouth = asset.HeightAt(348f, 64f);
            float silentFormerEastGap = asset.HeightAt(371f, 155f);
            float silentNorthWestRidge = asset.HeightAt(90f, 269f);
            float silentNorthWestInner = asset.HeightAt(105f, 245f);
            float silentNorthEastRidge = asset.HeightAt(290f, 269f);
            float silentNorthEastInner = asset.HeightAt(285f, 240f);
            float silentWestRidge = asset.HeightAt(14f, 185f);
            float silentWestInner = asset.HeightAt(40f, 185f);
            float silentEastRidge = asset.HeightAt(365f, 190f);
            float silentEastInner = asset.HeightAt(340f, 190f);
            float silentSouthWestRidge = asset.HeightAt(80f, 34f);
            float silentSouthWestInner = asset.HeightAt(95f, 58f);
            float silentSouthEastRidge = asset.HeightAt(310f, 38f);
            float silentSouthEastInner = asset.HeightAt(300f, 65f);
            float tesma267 = asset.HeightAt(205f, 267f);
            float tesma253 = asset.HeightAt(197f, 253f);
            float tesma240 = asset.HeightAt(191f, 240f);
            float tesma223 = asset.HeightAt(196f, 223f);
            float tesma205 = asset.HeightAt(205f, 205f);
            float tesma189 = asset.HeightAt(202f, 189f);
            float tesma173 = asset.HeightAt(194f, 173f);
            float tesma154 = asset.HeightAt(199f, 154f);
            float tesma135 = asset.HeightAt(209f, 135f);
            float tesma116 = asset.HeightAt(207f, 116f);
            float tesma98 = asset.HeightAt(202f, 98f);
            float tesma79 = asset.HeightAt(204f, 79f);
            float tesma57 = asset.HeightAt(205f, 57f);
            float tesma34 = asset.HeightAt(209f, 34f);
            float tesmaGorgeNear = asset.HeightAt(201f, 240f);
            float tesmaMiddleNear = asset.HeightAt(212f, 189f);
            float tesmaBowl205Bank = asset.HeightAt(235f, 205f);
            float tesmaBowl173Bank = asset.HeightAt(224f, 173f);
            float tesmaBowl98Bank = asset.HeightAt(232f, 98f);
            float sluiceWestApronTop = asset.HeightAt(142f, 242f);
            float sluiceWestApronMidA = asset.HeightAt(150f, 232f);
            float sluiceWestApronMidB = asset.HeightAt(160f, 222f);
            float sluiceWestApronFoot = asset.HeightAt(170f, 214f);
            float sluiceEastApronTop = asset.HeightAt(250f, 243f);
            float sluiceEastApronMidA = asset.HeightAt(244f, 233f);
            float sluiceEastApronMidB = asset.HeightAt(238f, 223f);
            float sluiceEastApronFoot = asset.HeightAt(229f, 214f);
            float oreNorthApronWash = asset.HeightAt(164f, 210f);
            float oreNorthApronBank = asset.HeightAt(172f, 200f);
            float oreSouthApronWash = asset.HeightAt(155f, 181f);
            float oreSouthApronBank = asset.HeightAt(155f, 194f);
            float glassNorthSaddle = asset.HeightAt(250f, 217f);
            float glassNorthShoulder = asset.HeightAt(265f, 217f);
            float glassRailSaddle = asset.HeightAt(255f, 196f);
            float glassRailShoulder = asset.HeightAt(255f, 181f);
            float glassTractSaddle = asset.HeightAt(247f, 165f);
            float glassTractShoulder = asset.HeightAt(262f, 177f);
            float chalkNorthSaddle = asset.HeightAt(249f, 109f);
            float chalkNorthShoulder = asset.HeightAt(270f, 109f);
            float chalkNorthBasin = asset.HeightAt(232f, 109f);
            float chalkSouthSaddle = asset.HeightAt(258f, 78f);
            float chalkSouthShoulder = asset.HeightAt(280f, 78f);
            float chalkSouthBasin = asset.HeightAt(238f, 78f);
            float stvorTerrace = asset.HeightAt(190f, 262f);
            float keysTerraceHeight = asset.HeightAt(195f, 205f);
            float razdolyeTerrace = asset.HeightAt(76f, 210f);
            float balanceTerrace = asset.HeightAt(247f, 49f);
            float stvorSpread = TerraceSpread(asset, 190f, 262f, 4f);
            float filterSpread = TerraceSpread(asset, 235f, 184f, 5f);
            float razdolyeSpread = TerraceSpread(asset, 76f, 210f, 5f);
            float factorySpread = TerraceSpread(asset, 128f, 244f, 5f);
            float crossroadsSpread = TerraceSpread(asset, 125f, 155f, 5f);
            float chalkYardSpread = TerraceSpread(asset, 297f, 110f, 5f);
            float chalkSluiceSpread = TerraceSpread(asset, 267f, 88f, 5f);
            float contourSpread = TerraceSpread(asset, 300f, 181f, 5f);
            float balanceSpread = TerraceSpread(asset, 247f, 49f, 5f);
            float regeneratorSpread = TerraceSpread(asset, 205f, 65f, 5f);
            float hydroSpread = TerraceSpread(asset, 235f, 271f, 5f);
            float orePassSpread = TerraceSpread(asset, 84f, 265f, 5f);
            float relaySpread = TerraceSpread(asset, 358f, 184f, 5f);
            float fortSpread = TerraceSpread(asset, 220f, 22f, 5f);
            float ninthQuarryRelief = OrientedRingMean(asset,
                112f, 250f, 9f, 7f, -16f, 0.93f) - asset.HeightAt(112f, 250f);
            float dryIntakeRelief = OrientedRingMean(asset,
                226f, 229f, 7f, 5f, 8f, 0.93f) - asset.HeightAt(226f, 229f);
            float farRowRelief = OrientedRingMean(asset,
                151f, 190f, 8f, 5.5f, -11f, 0.93f) - asset.HeightAt(151f, 190f);
            float ironMineRelief = OrientedRingMean(asset,
                43f, 267f, 10f, 7f, 19f, 0.93f) - asset.HeightAt(43f, 267f);
            float sortingFieldRelief = OrientedRingMean(asset,
                95f, 237f, 9f, 6f, -7f, 0.93f) - asset.HeightAt(95f, 237f);
            float polymerRelief = OrientedRingMean(asset,
                82f, 144f, 8f, 5.5f, 4f, 0.93f) - asset.HeightAt(82f, 144f);
            float ceramicRelief = OrientedRingMean(asset,
                274f, 139f, 9f, 6.5f, -18f, 0.93f) - asset.HeightAt(274f, 139f);
            float chemicalRelief = OrientedRingMean(asset,
                168f, 76f, 8f, 5.5f, 13f, 0.93f) - asset.HeightAt(168f, 76f);
            float fuelRelief = OrientedRingMean(asset,
                147f, 45f, 8f, 6f, -9f, 0.93f) - asset.HeightAt(147f, 45f);
            float storehouseCraterRelief = OrientedRingMean(asset,
                315f, 143f, 17f, 12f, -12f, 0.96f) - asset.HeightAt(315f, 143f);
            float satelliteCraterRelief = OrientedRingMean(asset,
                328f, 132f, 7f, 5f, 17f, 0.96f) - asset.HeightAt(328f, 132f);
            float vectorApronSpread = TerraceSpread(asset, 338f, 225f, 3.5f);
            float solarApronSpread = TerraceSpread(asset, 345f, 154f, 4f);
            float vectorApronHeight = asset.HeightAt(338f, 225f);
            float solarApronHeight = asset.HeightAt(345f, 154f);
            float ninthAccessA = asset.HeightAt(128f, 244f);
            float ninthAccessB = asset.HeightAt(121f, 246f);
            float ninthAccessC = asset.HeightAt(116f, 248f);
            float ironAccessA = asset.HeightAt(84f, 265f);
            float ironAccessB = asset.HeightAt(73f, 260f);
            float ironAccessC = asset.HeightAt(60f, 261f);
            float ironAccessD = asset.HeightAt(51f, 264f);
            float sortingAccessA = asset.HeightAt(76f, 210f);
            float sortingAccessB = asset.HeightAt(82f, 218f);
            float sortingAccessC = asset.HeightAt(89f, 227f);
            float ceramicAccessA = asset.HeightAt(295f, 155f);
            float ceramicAccessB = asset.HeightAt(287f, 149f);
            float ceramicAccessC = asset.HeightAt(280f, 144f);
            float craterAccessA = asset.HeightAt(295f, 155f);
            float craterAccessB = asset.HeightAt(302f, 152f);
            float craterAccessC = asset.HeightAt(309f, 148f);
            float vectorAccessA = asset.HeightAt(330f, 196f);
            float vectorAccessB = asset.HeightAt(332f, 206f);
            float vectorAccessC = asset.HeightAt(335f, 216f);
            float solarAccessA = asset.HeightAt(330f, 166f);
            float solarAccessB = asset.HeightAt(336f, 162f);
            float solarAccessC = asset.HeightAt(341f, 158f);
            float glassTalusCrown = TalusCrossSlopeCrown(asset,
                260f, 225f, 12f, -8f, 0.95f);
            float chalkTalusNorthCrown = TalusCrossSlopeCrown(asset,
                276f, 120f, 11f, -18f, 0.95f);
            float chalkTalusMiddleCrown = TalusCrossSlopeCrown(asset,
                291f, 91f, 10f, -8f, 0.95f);
            float ringTalusNorthEastCrown = TalusCrossSlopeCrown(asset,
                297f, 246f, 13f, -30f, 0.95f);
            float ringTalusSouthWestCrown = TalusCrossSlopeCrown(asset,
                88f, 54f, 13f, 142f, 0.95f);
            float ringTalusWestCrown = TalusCrossSlopeCrown(asset,
                36f, 181f, 12f, 78f, 0.95f);
            float oreStrataNorthDepth = CrossSectionDepth(asset,
                50f, 238f, 1.5f, 3.7f);
            float oreStrataSouthDepth = CrossSectionDepth(asset,
                52f, 213f, -1.5f, 3.7f);
            float glassSplinterNorthDepth = CrossSectionDepth(asset,
                301f, 232f, 3f, 3.5f);
            float glassSplinterEastDepth = CrossSectionDepth(asset,
                332f, 196f, 2.8f, 3.6f);
            float chalkRunnelNorthDepth = CrossSectionDepth(asset,
                282f, 128f, 2.3f, 3.3f);
            float chalkRunnelSouthDepth = CrossSectionDepth(asset,
                344f, 70f, 1.5f, 3.2f);
            float zeroSubsidenceWestDepth = CrossSectionDepth(asset,
                129f, 78f, 3f, 3.6f);
            float zeroSubsidenceEastDepth = CrossSectionDepth(asset,
                260f, 71f, 3.4f, -3.6f);
            float silentRillNorthEastDepth = CrossSectionDepth(asset,
                303f, 268f, 4f, -2f);
            float silentRillSouthWestDepth = CrossSectionDepth(asset,
                108f, 25f, -3.2f, 3.4f);
            float silentRillWestDepth = CrossSectionDepth(asset,
                22f, 207f, 1f, 4.5f);
            float shorelineWestPeak = RelictShorelinePeak(
                157f, 273f, 34f, 20f, 0.014f);
            float shorelineCentrePeak = RelictShorelinePeak(
                211f, 276f, 33f, 21f, 0.012f);
            float shorelineEastPeak = RelictShorelinePeak(
                249f, 258f, 30f, 18f, 0.011f);
            float sluiceCascadeWestDepth = CrossSectionDepth(asset,
                179f, 255f, 3.5f, 3.5f);
            float sluiceCascadeEastDepth = CrossSectionDepth(asset,
                234f, 253f, 1.2f, -4.3f);
            float zeroConnectorWestDepth = CrossSectionDepth(asset,
                154f, 67f, 2.2f, 3.3f);
            float zeroConnectorCentreDepth = CrossSectionDepth(asset,
                190f, 55f, 1.35f, 3.8f);
            float zeroConnectorEastDepth = CrossSectionDepth(asset,
                231f, 52f, 2f, -3.5f);
            float zeroBraidWestDepth = CrossSectionDepth(asset,
                202f, 34f, 2.65f, -2.27f);
            float zeroBraidEastDepth = CrossSectionDepth(asset,
                232f, 37f, 1.87f, 2.95f);
            float wetlandWestPeak = WetlandShorelinePeak(
                151f, 54f, 32f, 19f, 0.015f);
            float wetlandCentrePeak = WetlandShorelinePeak(
                214f, 43f, 38f, 17f, 0.014f);
            float wetlandEastPeak = WetlandShorelinePeak(
                257f, 68f, 30f, 18f, 0.014f);
            float wetlandNorthWestPeak = WetlandShorelinePeak(
                137f, 82f, 27f, 16f, 0.013f);
            float sluiceSplayRelief = AlluvialDistributaryRelief(
                194f, 231f, 13f, 17f, -4f, 0.024f);
            float westSplayRelief = AlluvialDistributaryRelief(
                183f, 174f, 14f, 10f, -14f, 0.022f);
            float eastSplayRelief = AlluvialDistributaryRelief(
                226f, 142f, 15f, 10f, 14f, 0.021f);
            float southSplayRelief = AlluvialDistributaryRelief(
                186f, 91f, 14f, 10f, -10f, 0.020f);
            float outlineMinimum = float.MaxValue;
            float outlineMaximum = float.MinValue;
            float outlineVariation = 0f;
            float previousOutline = OutlineRadius(0f);
            float sideFloorMinimum = float.MaxValue;
            float sideFloorMaximum = float.MinValue;
            for (int i = 0; i <= 720; i++)
            {
                float angle = i / 720f * Mathf.PI * 2f;
                float outline = OutlineRadius(angle);
                outlineMinimum = Mathf.Min(outlineMinimum, outline);
                outlineMaximum = Mathf.Max(outlineMaximum, outline);
                if (i > 0) outlineVariation += Mathf.Abs(outline - previousOutline);
                previousOutline = outline;
                float sideFloor = SideWallFloor(angle);
                sideFloorMinimum = Mathf.Min(sideFloorMinimum, sideFloor);
                sideFloorMaximum = Mathf.Max(sideFloorMaximum, sideFloor);
            }
            float oreProjectionOutline = OutlineRadius(-2.42f);
            float northernBayOutline = OutlineRadius(-1.92f);
            float chalkPromontoryOutline = OutlineRadius(0.58f);
            float easternNotchOutline = OutlineRadius(-0.18f);
            float northEastFootRelief = RadialFootRelief(asset, Mathf.PI * 0.25f);
            float northFootRelief = RadialFootRelief(asset, Mathf.PI * 0.50f);
            float fieldMinimum = float.MaxValue;
            float fieldMaximum = float.MinValue;
            float maximumGridStep = 0f;
            float surfaceGrainMinimum = float.MaxValue;
            float surfaceGrainMaximum = float.MinValue;
            float surfaceGrainAbsoluteSum = 0f;
            int gentleCells = 0;
            int measuredCells = 0;
            for (int sampleY = 0; sampleY < asset.SamplesY; sampleY++)
            {
                for (int sampleX = 0; sampleX < asset.SamplesX; sampleX++)
                {
                    int index = sampleY * asset.SamplesX + sampleX;
                    float sample = asset.Heights[index];
                    float mapX = sampleX / (float)(asset.SamplesX - 1) * WidthPoints;
                    float mapY = sampleY / (float)(asset.SamplesY - 1) * HeightPoints;
                    float surfaceGrain = FinalRegionalSurfaceRelief(mapX, mapY);
                    Require(!float.IsNaN(sample) && !float.IsInfinity(sample),
                        "The final relief field contains an invalid height sample.");
                    fieldMinimum = Mathf.Min(fieldMinimum, sample);
                    fieldMaximum = Mathf.Max(fieldMaximum, sample);
                    surfaceGrainMinimum = Mathf.Min(surfaceGrainMinimum, surfaceGrain);
                    surfaceGrainMaximum = Mathf.Max(surfaceGrainMaximum, surfaceGrain);
                    surfaceGrainAbsoluteSum += Mathf.Abs(surfaceGrain);
                    if (sampleX + 1 < asset.SamplesX)
                    {
                        float step = Mathf.Abs(sample - asset.Heights[index + 1]);
                        maximumGridStep = Mathf.Max(maximumGridStep, step);
                        if (step < 0.18f) gentleCells++;
                        measuredCells++;
                    }
                    if (sampleY + 1 < asset.SamplesY)
                    {
                        float step = Mathf.Abs(sample
                            - asset.Heights[index + asset.SamplesX]);
                        maximumGridStep = Mathf.Max(maximumGridStep, step);
                        if (step < 0.18f) gentleCells++;
                        measuredCells++;
                    }
                }
            }
            float gentleCellRatio = gentleCells / (float)Mathf.Max(1, measuredCells);
            float surfaceGrainRange = surfaceGrainMaximum - surfaceGrainMinimum;
            float surfaceGrainMean = surfaceGrainAbsoluteSum
                / Mathf.Max(1, asset.Heights.Length);
            Require(oreFloor < middle - 0.45f, "Ore Arc floor is not deep enough.");
            Require(oreRim > oreFloor + 0.60f, "Ore Arc rim is not readable.");
            Require(north > middle + 0.28f, "Northern Sluices shelf is not raised.");
            Require(chalk > middle + 0.20f, "Chalk escarpment is not raised.");
            Require(zero < middle - 0.22f, "Zero Basin is not depressed.");
            Require(silentRing > middle + 0.18f, "Silent Ring does not frame the map.");
            Require(northReservoir < north - 0.12f,
                "Northern reservoir is not recessed into the upper shelf.");
            Require(northDam > middle + 0.20f,
                "Northern dam front does not rise above the Middle Vein.");
            Require(tesmaChannel < tesmaBank - 0.09f,
                "Tesma channel is not lower than its floodplain bank.");
            Require(glassShelf > glassApproach + 0.18f,
                "Glasslands escarpment is not readable from the Middle Vein.");
            Require(westDrain < westDrainBank - 0.08f,
                "Western tributary is not recessed into its local floodplain.");
            Require(eastDrain < eastDrainBank - 0.08f,
                "Eastern tributary is not recessed into the Glasslands approach.");
            Require(southDrain < southDrainBank - 0.08f,
                "Southern tributary is not recessed into the Zero Basin.");
            Require(chalkGully < chalkShoulder - 0.05f,
                "Chalk erosion gully is not readable against its shoulder.");
            Require(oreFan > oreFanSide + 0.10f,
                "Ore Arc spoil fan does not bridge into the Middle Vein.");
            Require(southRiverPass < silentRing - 0.25f,
                "Tesma does not cut a readable southern pass through the Silent Ring.");
            Require(silentRing > ringInterior + 0.45f,
                "Outer scarp does not rise clearly above the interior basin.");
            Require(zeroPool < zeroIsland - 0.15f,
                "Zero Basin sub-basins do not retain readable dry islands.");
            Require(zeroPoolWest < zeroIsland - 0.10f,
                "Zero Basin western pool is not separated from its dry island.");
            Require(zeroPoolEast < zeroEastIsland - 0.08f,
                "Zero Basin eastern pool is not separated from its dry island.");
            Require(zeroPoolNorthWest < zeroNorthWestBank - 0.20f,
                "Zero Basin north-western pool lacks a readable enclosing bank.");
            Require(zeroWetlandSpine < zeroWetlandBank - 0.07f,
                "Zero Basin pool chain does not read as one connected wetland.");
            Require(zeroEastDrain < zeroEastDrainBank - 0.12f,
                "Zero Basin eastern overflow does not cut a readable drain.");
            Require(zeroSouthRim > zeroPool + 0.45f,
                "Zero Basin southern shelf does not enclose the deepest pool.");
            Require(outerFloodBank > centralChannel + 0.15f,
                "Second Tesma floodplain bench is not readable at the central confluence.");
            Require(northReservoir < westReservoirRim - 0.12f,
                "Western Sluices reservoir lacks a readable enclosing rim.");
            Require(centreReservoir < centreReservoirRim - 0.15f,
                "Central Sluices reservoir lacks a readable enclosing rim.");
            Require(eastReservoir < eastReservoirRim - 0.12f,
                "Eastern Sluices reservoir lacks a readable enclosing rim.");
            Require(northReservoir > centreReservoir + 0.08f
                && centreReservoir > eastReservoir + 0.08f,
                "Northern reservoir floors do not form a descending cascade.");
            Require(spillwayFloor < spillwayBank - 0.12f,
                "Sluice spillway does not cut clearly through the dam shelf.");
            Require(northRampStart < northRampMidA - 0.12f
                && northRampMidA < northRampMidB - 0.12f
                && northRampMidB < northRampExit - 0.12f,
                "Northern Ore Arc haul ramp is not continuously ascending.");
            Require(southRampStart < southRampMidA - 0.12f
                && southRampMidA < southRampMidB - 0.12f
                && southRampMidB < southRampExit - 0.12f,
                "Southern Ore Arc haul ramp is not continuously ascending.");
            Require(northTailings > northTailingsSide + 0.15f,
                "Northern spoil ridge does not rise above adjacent ground.");
            Require(southTailings > southTailingsSide + 0.20f,
                "Southern spoil ridge does not rise above adjacent ground.");
            Require(glassPlateNorthEast > glassGapNorth + 0.12f,
                "North-eastern Glasslands plate does not rise above its saddle.");
            Require(glassPlateCentre > glassGapWest + 0.10f,
                "Central Glasslands plate does not rise above the western approach.");
            Require(glassFaultCentre < glassFaultCentreSide - 0.10f,
                "Central Glasslands fault is not recessed between plates.");
            Require(glassFaultEastFloor < glassFaultEastSide - 0.10f,
                "Eastern Glasslands fault is not recessed between plates.");
            Require(glassSinkNorth < glassSinkNorthSide - 0.06f,
                "Northern Glasslands sink does not interrupt its plate.");
            Require(glassSinkSouth < glassSinkSouthSide - 0.10f,
                "Southern Glasslands sink does not interrupt its plate.");
            Require(chalkFrontHigh > chalkFrontLow + 0.25f,
                "Chalk Lowland western scarp does not rise above the Tract Isthmus.");
            Require(chalkRidgeWestPoint > chalkRidgeWestValley + 0.07f,
                "Western chalk ridge is not readable beside the Tract cut.");
            Require(chalkRidgeCentrePoint > chalkRidgeCentreValley + 0.10f,
                "Central chalk ridge is not readable against its wash.");
            Require(chalkRidgeSouthPoint > chalkRidgeSouthValley + 0.10f,
                "Southern chalk ridge is not readable against its lower shelf.");
            Require(karstWest < karstWestRim - 0.12f
                && karstCentre < karstCentreRim - 0.18f
                && karstSouth < karstSouthRim - 0.18f
                && karstEast < karstEastRim - 0.04f,
                "One or more Chalk Lowland karst bowls lacks a readable rim.");
            Require(middleKeysBank > tesmaChannel + 0.18f,
                "Keys terrace does not remain dry above the Tesma channel.");
            Require(middleOuterWest > tesmaChannel + 0.20f
                && middleOuterEast > tesmaChannel + 0.20f,
                "Middle Vein outer floodplain shelves are not readable.");
            Require(Mathf.Abs(middleFarmTerrace - middleFarmTerraceEdge) < 0.06f,
                "Middle Vein western field terrace is too uneven for settlement.");
            Require(middleCanalWestFloor < middleCanalWestBank - 0.025f,
                "Middle Vein western distributary is not recessed into its bank.");
            Require(middleCanalEastFloor < middleCanalEastBank - 0.05f,
                "Middle Vein eastern distributary is not recessed into its bank.");
            Require(tractWestCrown > tractWestLow + 0.04f,
                "Western Tract earthwork does not rise above the contaminated low ground.");
            Require(tractCrossroads > tractCrossroadsLow + 0.06f,
                "Crossroads approach is not carried by a readable stable-ground crown.");
            Require(tractBypass > tractBypassLow + 0.12f,
                "Southern Tract bypass is not protected from the Zero Basin slope.");
            Require(tractEastCrown > tractEastLow + 0.07f,
                "Eastern Tract crown is not readable above its lower verge.");
            Require(tractChalkCut < tractChalkShoulder - 0.07f,
                "Tract Isthmus does not cut a readable pass through the chalk shoulder.");
            Require(silentNorthPass < silentNorthPassWest - 0.55f
                && silentNorthPass < silentNorthPassEast - 0.55f,
                "Northern Tesma pass is not clearly enclosed by the Silent Ring.");
            Require(silentSouthPass < silentSouthPassWest - 0.35f
                && silentSouthPass < silentSouthPassEast - 0.35f,
                "Southern Tesma pass is not clearly enclosed by the Silent Ring.");
            Require(silentWestPass < silentWestPassNorth - 0.35f
                && silentWestPass < silentWestPassSouth - 0.35f,
                "Western caravan pass is not clearly enclosed by the Silent Ring.");
            Require(silentEastPass < silentEastPassNorth - 0.30f
                && silentEastPass < silentEastPassSouth - 0.30f,
                "Eastern Great Tract pass is not clearly enclosed by the Silent Ring.");
            Require(silentFormerEastGap > silentEastPass + 0.35f,
                "Retired eastern gap still reads as a pass instead of a closed ridge.");
            Require(silentNorthWestRidge > silentNorthWestInner + 0.25f
                && silentNorthEastRidge > silentNorthEastInner + 0.25f
                && silentWestRidge > silentWestInner + 0.25f
                && silentEastRidge > silentEastInner + 0.25f
                && silentSouthWestRidge > silentSouthWestInner + 0.25f
                && silentSouthEastRidge > silentSouthEastInner + 0.25f,
                "One or more Silent Ring geological sectors lacks a readable scarp.");
            Require(tesma267 > tesma253 + 0.15f
                && tesma253 > tesma240 + 0.08f
                && tesma240 > tesma223 + 0.06f,
                "Tesma upper gorge does not descend continuously from the Sluices.");
            Require(tesma223 > tesma205 + 0.02f
                && tesma205 > tesma189 + 0.02f
                && tesma189 > tesma173 + 0.04f
                && tesma173 > tesma154 + 0.025f,
                "Tesma Middle Vein reaches do not maintain a continuous grade.");
            Require(tesma154 > tesma135 + 0.06f
                && tesma135 > tesma116 + 0.05f
                && tesma116 > tesma98 + 0.08f
                && tesma98 > tesma79 + 0.09f
                && tesma79 > tesma57 + 0.12f,
                "Tesma lower reaches do not descend continuously into Zero Basin.");
            Require(tesma57 < tesma34 - 0.12f
                && tesma34 < silentSouthPass - 0.30f,
                "Tesma terminal basin and southern outlet ramp lack distinct levels.");
            Require((tesmaGorgeNear - tesma240)
                > (tesmaMiddleNear - tesma189) + 0.08f,
                "Tesma channel does not narrow enough below the Sluices.");
            Require(tesma205 < tesmaBowl205Bank - 0.20f
                && tesma173 < tesmaBowl173Bank - 0.25f
                && tesma98 < tesmaBowl98Bank - 0.25f,
                "One or more Tesma flood bowls lacks a readable enclosing shelf.");
            Require(sluiceWestApronTop > sluiceWestApronMidA + 0.12f
                && sluiceWestApronMidA >= sluiceWestApronMidB - 0.01f
                && sluiceWestApronMidB > sluiceWestApronFoot + 0.02f,
                "Western Sluices apron does not descend cleanly into the Middle Vein.");
            Require(sluiceEastApronTop > sluiceEastApronMidA + 0.12f
                && sluiceEastApronMidA > sluiceEastApronMidB + 0.03f
                && sluiceEastApronMidB > sluiceEastApronFoot + 0.03f,
                "Eastern Sluices apron does not descend cleanly into the Middle Vein.");
            Require(oreNorthApronWash < oreNorthApronBank - 0.05f
                && oreSouthApronWash < oreSouthApronBank - 0.04f,
                "Ore Arc colluvial aprons lack readable axial drainage.");
            Require(glassNorthSaddle < glassNorthShoulder - 0.15f
                && glassRailSaddle < glassRailShoulder - 0.05f
                && glassTractSaddle < glassTractShoulder - 0.10f,
                "Glasslands broken front does not preserve its three terrain saddles.");
            Require(chalkNorthSaddle < chalkNorthShoulder - 0.20f
                && chalkNorthSaddle > chalkNorthBasin + 0.05f
                && chalkSouthSaddle < chalkSouthShoulder - 0.30f
                && chalkSouthSaddle > chalkSouthBasin + 0.04f,
                "Chalk-to-Zero transition saddles do not bridge highland and basin.");
            Require(stvorTerrace > centreReservoir + 0.10f,
                "Stvor terrace does not remain above the central reservoir.");
            Require(keysTerraceHeight > tesma205 + 0.07f,
                "Keys riverfront terrace does not remain above the Tesma channel.");
            Require(razdolyeTerrace > oreFloor + 0.09f,
                "Razdolye terrace is not separated from the Ore Arc pit floor.");
            Require(balanceTerrace > zeroPool + 0.22f,
                "Balance bunker terrace is not separated from the deepest Zero pool.");
            Require(stvorSpread < 0.07f
                && filterSpread < 0.05f
                && razdolyeSpread < 0.05f
                && factorySpread < 0.06f
                && crossroadsSpread < 0.04f,
                "One or more western or central settlement terraces is too uneven.");
            Require(chalkYardSpread < 0.06f
                && chalkSluiceSpread < 0.09f
                && contourSpread < 0.04f
                && balanceSpread < 0.06f
                && regeneratorSpread < 0.08f,
                "One or more eastern or southern settlement terraces is too uneven.");
            Require(hydroSpread < 0.08f
                && orePassSpread < 0.09f
                && relaySpread < 0.09f
                && fortSpread < 0.09f,
                "One or more strategic edge terraces is too uneven.");
            Require(ninthQuarryRelief > 0.055f
                && ironMineRelief > 0.065f
                && ceramicRelief > 0.045f,
                "One or more major mineral resource pockets lacks a readable rim.");
            Require(dryIntakeRelief > 0.025f
                && farRowRelief > 0.020f
                && sortingFieldRelief > 0.035f
                && polymerRelief > 0.025f,
                "One or more inhabited resource pockets is not readable in terrain.");
            Require(chemicalRelief > 0.035f && fuelRelief > 0.035f,
                "Zero Basin chemical or fuel extraction pockets lack containment.");
            Require(storehouseCraterRelief > 0.135f
                && satelliteCraterRelief > 0.045f,
                "The Storehouse accident crater system lacks a readable bowl and rim.");
            Require(vectorApronSpread < 0.075f && solarApronSpread < 0.075f,
                "One or more pre-war research aprons is too uneven for later MEP dressing.");
            Require(vectorApronHeight > 0.72f && solarApronHeight > 0.48f,
                "Research aprons do not remain above their surrounding hazardous ground.");
            Require(ninthAccessA > ninthAccessB + 0.02f
                && ninthAccessB > ninthAccessC + 0.035f
                && ninthAccessC > asset.HeightAt(112f, 250f) + 0.035f,
                "Ninth Quarry access does not descend continuously into the pocket.");
            Require(ironAccessA > ironAccessB + 0.05f
                && ironAccessB >= ironAccessC - 0.025f
                && ironAccessC >= ironAccessD - 0.025f
                && ironAccessD > asset.HeightAt(43f, 267f) + 0.08f,
                "Three Shifts mine access has an obstructing reverse grade.");
            Require(sortingAccessB > sortingAccessA
                && sortingAccessC > sortingAccessB + 0.02f
                && asset.HeightAt(95f, 237f) > sortingAccessC + 0.04f,
                "Sorting Fields access does not climb continuously from Razdolye.");
            Require(ceramicAccessA > ceramicAccessB + 0.035f
                && ceramicAccessB >= ceramicAccessC - 0.005f
                && ceramicAccessC > asset.HeightAt(274f, 139f) + 0.07f,
                "Ceramic Ledge access does not descend cleanly from the Tract.");
            Require(craterAccessA >= craterAccessB - 0.025f
                && craterAccessB > craterAccessC + 0.055f
                && craterAccessC > asset.HeightAt(315f, 143f) + 0.055f,
                "Storehouse crater approach contains an obstructing terrain hump.");
            Require(vectorAccessB > vectorAccessA + 0.05f
                && vectorAccessC > vectorAccessB + 0.07f
                && vectorApronHeight > vectorAccessC + 0.05f,
                "Vector research approach does not climb continuously onto its apron.");
            Require(solarAccessB >= solarAccessA - 0.005f
                && solarAccessC > solarAccessB + 0.025f
                && solarApronHeight >= solarAccessC - 0.01f,
                "Solar Field 4 approach contains an obstructing reverse grade.");
            Require(glassTalusCrown > 0.012f
                && chalkTalusNorthCrown > 0.008f
                && chalkTalusMiddleCrown > 0.015f,
                "Glasslands or Chalk Lowland talus fans lack readable cross-slope relief.");
            Require(ringTalusNorthEastCrown > 0.005f
                && ringTalusSouthWestCrown > 0.008f
                && ringTalusWestCrown > 0.08f,
                "Silent Ring talus fans do not break the inner scarp silhouette.");
            Require(shorelineWestPeak > 0.009f
                && shorelineCentrePeak > 0.008f
                && shorelineEastPeak > 0.007f,
                "One or more Northern Sluices relict shorelines is not expressed.");
            Require(oreStrataNorthDepth > 0.020f
                && oreStrataSouthDepth > 0.022f,
                "Ore Arc erosion ribbons do not expose two readable strata washes.");
            Require(glassSplinterNorthDepth > 0.008f
                && glassSplinterEastDepth > 0.014f,
                "Glasslands secondary fracture splinters are not recessed.");
            Require(chalkRunnelNorthDepth > 0.012f
                && chalkRunnelSouthDepth > 0.009f,
                "Chalk Lowland runnels do not retain readable cross sections.");
            Require(zeroSubsidenceWestDepth > 0.028f
                && zeroSubsidenceEastDepth > 0.035f,
                "Zero Basin subsidence seams are not connected to the pool chain.");
            Require(silentRillNorthEastDepth > 0.018f
                && silentRillSouthWestDepth > 0.010f
                && silentRillWestDepth > 0.040f,
                "Silent Ring erosion rills are not readable against the inner scarp.");
            Require(sluiceCascadeWestDepth > 0.040f
                && sluiceCascadeEastDepth > 0.040f,
                "Northern Sluices side basins do not connect to the main spillway.");
            Require(zeroConnectorWestDepth > 0.025f
                && zeroConnectorCentreDepth > 0.040f
                && zeroConnectorEastDepth > 0.050f,
                "Zero Basin pools lack readable connecting thalwegs.");
            Require(zeroBraidWestDepth > 0.020f
                && zeroBraidEastDepth > 0.005f,
                "Zero Basin terminal outlet does not retain two braided channels.");
            Require(wetlandWestPeak > 0.010f
                && wetlandCentrePeak > 0.009f
                && wetlandEastPeak > 0.009f
                && wetlandNorthWestPeak > 0.008f,
                "One or more toxic-pool shorelines lacks a broken littoral lip.");
            Require(sluiceSplayRelief > 0.018f
                && westSplayRelief > 0.016f
                && eastSplayRelief > 0.015f
                && southSplayRelief > 0.014f,
                "One or more alluvial splays lacks a central distributary.");
            Require(outlineMinimum > 0.94f && outlineMaximum < 1.04f,
                "The authored continental outline leaves the safe map envelope.");
            Require(outlineMaximum - outlineMinimum > 0.075f
                && outlineVariation > 0.50f,
                "The continental outline remains too regular at strategic scale.");
            Require(oreProjectionOutline > northernBayOutline + 0.015f,
                "The north-western Ore projection does not break the adjacent bay.");
            Require(chalkPromontoryOutline > easternNotchOutline + 0.055f,
                "The Chalk promontory does not project beyond the eastern fracture notch.");
            Require(sideFloorMinimum < -0.99f
                && sideFloorMaximum > -0.94f
                && sideFloorMaximum - sideFloorMinimum > 0.075f,
                "The exposed continental sidewall still ends on one artificial plane.");
            Require(northEastFootRelief > 0.040f && northFootRelief > 0.10f,
                "The northern perimeter scarp lacks a readable deposited foot.");
            Require(surfaceGrainRange > 0.025f && surfaceGrainMean > 0.0015f,
                "The final regional ground grain is too weak or too sparse: range="
                + surfaceGrainRange.ToString("F4") + ", mean="
                + surfaceGrainMean.ToString("F4") + ".");
            Require(fieldMinimum < -0.90f && fieldMaximum >= 1.20f
                && fieldMaximum - fieldMinimum > 2.10f,
                "The final field no longer preserves the authored vertical range: "
                + fieldMinimum.ToString("F3") + ".." + fieldMaximum.ToString("F3") + ".");
            Require(maximumGridStep < 0.80f,
                "The final field contains an implausible single-cell height spike.");
            Require(gentleCellRatio > 0.86f,
                "Too little of the final field remains traversable at strategic scale.");
            Require(Mathf.Abs(asset.HeightAt(100f, 120f) - HeightAtMap(100f, 120f)) < 0.002f
                && Mathf.Abs(asset.HeightAt(288f, 206f) - HeightAtMap(288f, 206f)) < 0.002f
                && Mathf.Abs(asset.HeightAt(320f, 92f) - HeightAtMap(320f, 92f)) < 0.002f,
                "The baked runtime relief does not match the final authored surface.");
            Debug.Log("[KROMKA RELIEF 100%] PASS: 23681 vertices, 380x300 field; "
                + "middle=" + middle.ToString("F2")
                + ", oreFloor=" + oreFloor.ToString("F2")
                + ", oreRim=" + oreRim.ToString("F2")
                + ", north=" + north.ToString("F2")
                + ", chalk=" + chalk.ToString("F2")
                + ", zero=" + zero.ToString("F2")
                + ", silentRing=" + silentRing.ToString("F2")
                + ", northReservoir=" + northReservoir.ToString("F2")
                + ", northDam=" + northDam.ToString("F2")
                + ", tesmaChannel=" + tesmaChannel.ToString("F2")
                + ", tesmaBank=" + tesmaBank.ToString("F2")
                + ", glassShelf=" + glassShelf.ToString("F2")
                + ", glassApproach=" + glassApproach.ToString("F2")
                + ", westDrain=" + westDrain.ToString("F2")
                + ", eastDrain=" + eastDrain.ToString("F2")
                + ", southDrain=" + southDrain.ToString("F2")
                + ", chalkGully=" + chalkGully.ToString("F2")
                + ", oreFan=" + oreFan.ToString("F2")
                + ", southPass=" + southRiverPass.ToString("F2")
                + ", ringInterior=" + ringInterior.ToString("F2")
                + ", zeroPool=" + zeroPool.ToString("F2")
                + ", zeroIsland=" + zeroIsland.ToString("F2")
                + ", zeroPoolW=" + zeroPoolWest.ToString("F2")
                + ", zeroPoolE=" + zeroPoolEast.ToString("F2")
                + ", zeroPoolNW=" + zeroPoolNorthWest.ToString("F2")
                + ", zeroIslandE=" + zeroEastIsland.ToString("F2")
                + ", zeroBankNW=" + zeroNorthWestBank.ToString("F2")
                + ", zeroSpine=" + zeroWetlandSpine.ToString("F2")
                + ", zeroBank=" + zeroWetlandBank.ToString("F2")
                + ", zeroOverflow=" + zeroEastDrain.ToString("F2")
                + ", zeroOverflowBank=" + zeroEastDrainBank.ToString("F2")
                + ", zeroSouthRim=" + zeroSouthRim.ToString("F2")
                + ", outerFloodBank=" + outerFloodBank.ToString("F2")
                + ", centreReservoir=" + centreReservoir.ToString("F2")
                + ", eastReservoir=" + eastReservoir.ToString("F2")
                + ", spillway=" + spillwayFloor.ToString("F2")
                + ", northRamp=" + northRampStart.ToString("F2") + "→"
                + northRampExit.ToString("F2")
                + ", southRamp=" + southRampStart.ToString("F2") + "→"
                + southRampExit.ToString("F2")
                + ", northTailings=" + northTailings.ToString("F2")
                + ", southTailings=" + southTailings.ToString("F2")
                + ", glassPlateNE=" + glassPlateNorthEast.ToString("F2")
                + ", glassFaultC=" + glassFaultCentre.ToString("F2")
                + ", glassFaultE=" + glassFaultEastFloor.ToString("F2")
                + ", glassSinkN=" + glassSinkNorth.ToString("F2")
                + ", glassSinkS=" + glassSinkSouth.ToString("F2")
                + ", chalkFront=" + chalkFrontHigh.ToString("F2")
                + ", chalkRidgeW=" + chalkRidgeWestPoint.ToString("F2")
                + ", chalkRidgeC=" + chalkRidgeCentrePoint.ToString("F2")
                + ", karstW=" + karstWest.ToString("F2")
                + ", karstC=" + karstCentre.ToString("F2")
                + ", karstS=" + karstSouth.ToString("F2")
                + ", karstE=" + karstEast.ToString("F2")
                + ", middleKeys=" + middleKeysBank.ToString("F2")
                + ", middleOuterW=" + middleOuterWest.ToString("F2")
                + ", middleOuterE=" + middleOuterEast.ToString("F2")
                + ", middleCanalW=" + middleCanalWestFloor.ToString("F2")
                + ", middleCanalE=" + middleCanalEastFloor.ToString("F2")
                + ", tractWest=" + tractWestCrown.ToString("F2")
                + ", tractCrossroads=" + tractCrossroads.ToString("F2")
                + ", tractBypass=" + tractBypass.ToString("F2")
                + ", tractEast=" + tractEastCrown.ToString("F2")
                + ", tractChalkCut=" + tractChalkCut.ToString("F2")
                + ", silentNorthPass=" + silentNorthPass.ToString("F2")
                + ", silentSouthPass=" + silentSouthPass.ToString("F2")
                + ", silentWestPass=" + silentWestPass.ToString("F2")
                + ", silentEastPass=" + silentEastPass.ToString("F2")
                + ", silentNWRidge=" + silentNorthWestRidge.ToString("F2")
                + ", silentNERidge=" + silentNorthEastRidge.ToString("F2")
                + ", silentWRidge=" + silentWestRidge.ToString("F2")
                + ", silentERidge=" + silentEastRidge.ToString("F2")
                + ", silentSWRidge=" + silentSouthWestRidge.ToString("F2")
                + ", silentSERidge=" + silentSouthEastRidge.ToString("F2")
                + ", tesmaGrade=" + tesma267.ToString("F2") + "->"
                + tesma223.ToString("F2") + "->" + tesma173.ToString("F2") + "->"
                + tesma116.ToString("F2") + "->" + tesma57.ToString("F2")
                + ", tesmaOutlet=" + tesma34.ToString("F2")
                + ", tesmaGorgeDelta=" + (tesmaGorgeNear - tesma240).ToString("F2")
                + ", tesmaMiddleDelta=" + (tesmaMiddleNear - tesma189).ToString("F2")
                + ", sluiceApronW=" + sluiceWestApronTop.ToString("F2") + "->"
                + sluiceWestApronFoot.ToString("F2")
                + ", sluiceApronE=" + sluiceEastApronTop.ToString("F2") + "->"
                + sluiceEastApronFoot.ToString("F2")
                + ", oreApronN=" + oreNorthApronWash.ToString("F2")
                + ", oreApronS=" + oreSouthApronWash.ToString("F2")
                + ", glassSaddles=" + glassNorthSaddle.ToString("F2") + "/"
                + glassRailSaddle.ToString("F2") + "/" + glassTractSaddle.ToString("F2")
                + ", chalkSaddles=" + chalkNorthSaddle.ToString("F2") + "/"
                + chalkSouthSaddle.ToString("F2")
                + ", terraceSpreadCore=" + stvorSpread.ToString("F2") + "/"
                + razdolyeSpread.ToString("F2") + "/" + contourSpread.ToString("F2")
                + ", terraceSpreadEdge=" + hydroSpread.ToString("F2") + "/"
                + orePassSpread.ToString("F2") + "/" + relaySpread.ToString("F2")
                + "/" + fortSpread.ToString("F2")
                + ", resourceMineral=" + ninthQuarryRelief.ToString("F2") + "/"
                + ironMineRelief.ToString("F2") + "/" + ceramicRelief.ToString("F2")
                + ", resourceCivil=" + dryIntakeRelief.ToString("F2") + "/"
                + farRowRelief.ToString("F2") + "/" + sortingFieldRelief.ToString("F2")
                + "/" + polymerRelief.ToString("F2")
                + ", resourceZero=" + chemicalRelief.ToString("F2") + "/"
                + fuelRelief.ToString("F2")
                + ", accidentCraters=" + storehouseCraterRelief.ToString("F2") + "/"
                + satelliteCraterRelief.ToString("F2")
                + ", researchAprons=" + vectorApronSpread.ToString("F2") + "/"
                + solarApronSpread.ToString("F2")
                + ", accessNinth=" + ninthAccessA.ToString("F2") + "->"
                + ninthAccessB.ToString("F2") + "->" + ninthAccessC.ToString("F2")
                + ", accessIron=" + ironAccessA.ToString("F2") + "->"
                + ironAccessB.ToString("F2") + "->" + ironAccessC.ToString("F2")
                + "->" + ironAccessD.ToString("F2")
                + ", accessVector=" + vectorAccessA.ToString("F2") + "->"
                + vectorAccessB.ToString("F2") + "->" + vectorAccessC.ToString("F2")
                + "->" + vectorApronHeight.ToString("F2")
                + ", talusCrown=" + glassTalusCrown.ToString("F2") + "/"
                + chalkTalusNorthCrown.ToString("F2") + "/"
                + chalkTalusMiddleCrown.ToString("F2") + "/"
                + ringTalusNorthEastCrown.ToString("F2") + "/"
                + ringTalusSouthWestCrown.ToString("F2") + "/"
                + ringTalusWestCrown.ToString("F2")
                + ", shorelinePeaks=" + shorelineWestPeak.ToString("F3") + "/"
                + shorelineCentrePeak.ToString("F3") + "/"
                + shorelineEastPeak.ToString("F3")
                + ", oreStrata=" + oreStrataNorthDepth.ToString("F2") + "/"
                + oreStrataSouthDepth.ToString("F2")
                + ", glassSplinters=" + glassSplinterNorthDepth.ToString("F2") + "/"
                + glassSplinterEastDepth.ToString("F2")
                + ", chalkRunnels=" + chalkRunnelNorthDepth.ToString("F2") + "/"
                + chalkRunnelSouthDepth.ToString("F2")
                + ", zeroSubsidence=" + zeroSubsidenceWestDepth.ToString("F2") + "/"
                + zeroSubsidenceEastDepth.ToString("F2")
                + ", silentRills=" + silentRillNorthEastDepth.ToString("F2") + "/"
                + silentRillSouthWestDepth.ToString("F2") + "/"
                + silentRillWestDepth.ToString("F2")
                + ", sluiceLinks=" + sluiceCascadeWestDepth.ToString("F2") + "/"
                + sluiceCascadeEastDepth.ToString("F2")
                + ", zeroLinks=" + zeroConnectorWestDepth.ToString("F2") + "/"
                + zeroConnectorCentreDepth.ToString("F2") + "/"
                + zeroConnectorEastDepth.ToString("F2")
                + ", zeroBraids=" + zeroBraidWestDepth.ToString("F2") + "/"
                + zeroBraidEastDepth.ToString("F2")
                + ", wetlandShore=" + wetlandWestPeak.ToString("F3") + "/"
                + wetlandCentrePeak.ToString("F3") + "/"
                + wetlandEastPeak.ToString("F3") + "/"
                + wetlandNorthWestPeak.ToString("F3")
                + ", alluvialChannels=" + sluiceSplayRelief.ToString("F3") + "/"
                + westSplayRelief.ToString("F3") + "/"
                + eastSplayRelief.ToString("F3") + "/"
                + southSplayRelief.ToString("F3")
                + ", outline=" + outlineMinimum.ToString("F3") + ".."
                + outlineMaximum.ToString("F3") + "/var"
                + outlineVariation.ToString("F3")
                + ", outlineSectors=" + oreProjectionOutline.ToString("F3") + "/"
                + northernBayOutline.ToString("F3") + "/"
                + chalkPromontoryOutline.ToString("F3") + "/"
                + easternNotchOutline.ToString("F3")
                + ", sideFloor=" + sideFloorMinimum.ToString("F3") + ".."
                + sideFloorMaximum.ToString("F3")
                + ", scarpFoot=" + northEastFootRelief.ToString("F2") + "/"
                + northFootRelief.ToString("F2")
                + ", surfaceGrain=" + surfaceGrainMinimum.ToString("F3") + ".."
                + surfaceGrainMaximum.ToString("F3") + "/mean"
                + surfaceGrainMean.ToString("F3")
                + ", field=" + fieldMinimum.ToString("F2") + ".."
                + fieldMaximum.ToString("F2")
                + ", maxGridStep=" + maximumGridStep.ToString("F2")
                + ", gentle=" + (gentleCellRatio * 100f).ToString("F1") + "%"
                + "; final regional grain, traversal envelope and runtime field are valid.");
        }

        internal static GameObject BuildSurface(Transform parent, Material material)
        {
            EnsureAssetFolders();
            SaveRuntimeField();

            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(MeshPath);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh { name = "Kromka_GlobalRelief" };
            FillLandmassMesh(mesh);
            if (fresh) AssetDatabase.CreateAsset(mesh, MeshPath);
            else EditorUtility.SetDirty(mesh);

            var surface = new GameObject("KromkaLandmass_Relief_100pct");
            surface.transform.SetParent(parent, false);
            surface.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            GameObjectUtility.SetStaticEditorFlags(surface, StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
            return surface;
        }

        internal static void RefreshTerrainMeshAndField()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(MeshPath);
            Require(mesh != null, "The authored global terrain mesh is missing.");
            SaveRuntimeField();
            FillLandmassMesh(mesh);
            EditorUtility.SetDirty(mesh);
        }

        internal static float HeightAtMap(float pointX, float pointY)
        {
            return KromkaGlobalMapWaterAuthoring.CarveTesmaBed(pointX, pointY,
                UncarvedHeightAtMap(pointX, pointY));
        }

        internal static float UncarvedHeightAtMap(float pointX, float pointY)
        {
            float x = Mathf.Clamp(pointX, 0f, WidthPoints);
            float y = Mathf.Clamp(pointY, 0f, HeightPoints);

            // A quiet continental base. Small-scale breakup remains restrained
            // while the fourth pass resolves floodplain and perimeter structure.
            float height = -0.10f;
            height += (Fbm(x * 0.0105f, y * 0.0105f) - 0.5f) * 0.13f;

            // Iteration 20: fine relief has a different directional language in
            // every macroregion. Its amplitude stays below authored channels,
            // benches and pads, which are layered afterwards, but it removes the
            // last broad computer-smooth areas from the untextured landmass.
            height += FinalRegionalSurfaceRelief(x, y);

            // Northern Sluices: a broad raised shelf behind the dam chain.
            float northShelf = Smooth01((y - 226f) / 50f)
                * Gaussian(x, y, 188f, 270f, 162f, 50f);
            height += northShelf * 0.66f;

            // The northern shelf front follows broken ground instead of a straight
            // horizontal cut. Its height is then divided into two cascade steps.
            float northernMass = Gaussian(x, y, 193f, 262f, 150f, 55f);
            float shelfFrontY = 231f
                + Mathf.Sin(x * 0.043f + 0.7f) * 4.2f
                + Mathf.Sin(x * 0.097f - 0.4f) * 1.8f;
            height += Smooth01((y - shelfFrontY) / 17f) * northernMass * 0.16f;
            float upperStepY = 254f + Mathf.Sin(x * 0.035f - 1.1f) * 3.5f;
            height += Smooth01((y - upperStepY) / 13f) * northernMass * 0.095f;

            float serviceDistance = DistanceToPolyline(
                new Vector2(x, y), NorthernServiceBench);
            height += Mathf.Exp(-(serviceDistance * serviceDistance) / 46f)
                * Gaussian(x, y, 196f, 228f, 104f, 18f) * 0.060f;
            float damDistance = DistanceToPolyline(new Vector2(x, y), NorthernDamFront);
            height += Mathf.Exp(-(damDistance * damDistance) / 34f) * 0.18f
                * Gaussian(x, y, 194f, 242f, 92f, 20f);

            // Broad abutments anchor both ends of the future concrete dam model.
            height += Gaussian(x, y, 126f, 242f, 23f, 18f) * 0.115f;
            height += Gaussian(x, y, 264f, 241f, 23f, 18f) * 0.105f;

            // Three water beds are partially levelled at distinct elevations.
            // This is terrain, not water geometry; reflective surfaces come later.
            float westReservoir = Gaussian(x, y, 157f, 273f, 31f, 17f);
            float centreReservoir = Gaussian(x, y, 211f, 276f, 30f, 18f);
            float eastReservoir = Gaussian(x, y, 249f, 258f, 27f, 15f);
            float sluiceWaterProtection = Mathf.Clamp01(
                westReservoir + centreReservoir + eastReservoir);
            height = Mathf.Lerp(height, 0.34f, westReservoir * 0.78f);
            height = Mathf.Lerp(height, 0.43f, centreReservoir * 0.72f);
            height = Mathf.Lerp(height, 0.31f, eastReservoir * 0.72f);

            float westReservoirRadius = EllipticalRadius(x, y, 157f, 273f, 34f, 20f);
            float centreReservoirRadius = EllipticalRadius(x, y, 211f, 276f, 33f, 21f);
            float eastReservoirRadius = EllipticalRadius(x, y, 249f, 258f, 30f, 18f);
            height += QuarryBench(westReservoirRadius, 1f, 0.13f) * 0.070f;
            height += QuarryBench(centreReservoirRadius, 1f, 0.13f) * 0.062f;
            height += QuarryBench(eastReservoirRadius, 1f, 0.14f) * 0.055f;
            height += RelictShoreline(westReservoirRadius, x, y, 157f, 273f, 0.014f);
            height += RelictShoreline(centreReservoirRadius, x, y, 211f, 276f, 0.012f);
            height += RelictShoreline(eastReservoirRadius, x, y, 249f, 258f, 0.011f);

            // The spillway cuts through the dam crown and descends toward the
            // Middle Vein in one continuous, slightly meandering gorge.
            float spillwayDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), SluiceSpillway, 6);
            float spillwayMask = Gaussian(x, y, 201f, 247f, 43f, 61f);
            height -= Mathf.Exp(-(spillwayDistance * spillwayDistance) / 72f)
                * spillwayMask * 0.075f;

            // Middle Vein: low, inhabitable rolling ground around the main hub.
            float middleMass = Gaussian(x, y, 190f, 193f, 118f, 70f);
            height += middleMass * 0.14f;

            // Ore Arc: the broad bowl from iteration 01 gains five readable quarry
            // benches. The rings remain landform-scale; MEP rocks arrive later.
            float oreDx = (x - 70f) / 70f;
            float oreDy = (y - 220f) / 54f;
            float oreAngle = Mathf.Atan2(oreDy, oreDx);
            float oreOutline = 1f
                + Mathf.Sin(oreAngle * 3f + 0.45f) * 0.052f
                + Mathf.Sin(oreAngle * 7f - 0.90f) * 0.024f;
            float oreRadius = Mathf.Sqrt(oreDx * oreDx + oreDy * oreDy) * oreOutline;
            float oreBowl = Mathf.Exp(-oreRadius * oreRadius * 1.65f);
            float oreRim = Mathf.Exp(-Mathf.Pow((oreRadius - 0.93f) / 0.19f, 2f));
            height -= oreBowl * 0.78f;
            height += oreRim * 0.47f;
            float oreInterior = 1f - Smooth01((oreRadius - 0.08f) / 0.90f);
            float terracedDescent = 1f - Terraced01(Mathf.Clamp01(oreRadius / 0.94f), 5);
            height -= terracedDescent * oreInterior * 0.12f;
            float benchNoiseA = (Fbm(x * 0.031f + 11f, y * 0.031f + 7f) - 0.5f) * 0.045f;
            float benchNoiseB = (Fbm(x * 0.027f + 37f, y * 0.027f + 19f) - 0.5f) * 0.052f;
            height += QuarryBench(oreRadius + benchNoiseA, 0.24f, 0.052f) * 0.085f;
            height += QuarryBench(oreRadius - benchNoiseB, 0.43f, 0.050f) * 0.080f;
            height += QuarryBench(oreRadius + benchNoiseB * 0.7f, 0.62f, 0.048f) * 0.073f;
            height += QuarryBench(oreRadius - benchNoiseA * 0.8f, 0.80f, 0.046f) * 0.065f;
            height += (Fbm(x * 0.025f + 17f, y * 0.025f + 41f) - 0.5f)
                * 0.15f * Mathf.Clamp01(1.25f - oreRadius);

            // Two broad haul ramps cut across the benches instead of floating
            // above them. Their target elevations climb continuously from the pit
            // floor to separate rim breaches, creating playable-looking exits.
            float northRampProgress;
            float northRampDistance = DistanceAndProgressToPolyline(
                new Vector2(x, y), OreHaulRampNorth, out northRampProgress);
            float northRampTarget = Mathf.Lerp(-0.84f, 0.16f, northRampProgress);
            float northRampMask = Mathf.Exp(-(northRampDistance * northRampDistance) / 34f)
                * Gaussian(x, y, 105f, 218f, 93f, 49f);
            height = Mathf.Lerp(height, northRampTarget, northRampMask * 0.78f);

            float southRampProgress;
            float southRampDistance = DistanceAndProgressToPolyline(
                new Vector2(x, y), OreHaulRampSouth, out southRampProgress);
            float southRampTarget = Mathf.Lerp(-0.88f, 0.11f, southRampProgress);
            float southRampMask = Mathf.Exp(-(southRampDistance * southRampDistance) / 32f)
                * Gaussian(x, y, 93f, 199f, 82f, 45f);
            height = Mathf.Lerp(height, southRampTarget, southRampMask * 0.75f);

            // Long, asymmetric spoil ridges explain where the removed overburden
            // went. Broad noise breaks them into dump terraces rather than dunes.
            float tailingsNorthDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), OreTailingsNorth, 5);
            float tailingsSouthDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), OreTailingsSouth, 5);
            float tailingsNoise = 0.82f
                + (Fbm(x * 0.045f + 91f, y * 0.045f + 24f) - 0.5f) * 0.36f;
            height += Mathf.Exp(-(tailingsNorthDistance * tailingsNorthDistance) / 155f)
                * Gaussian(x, y, 134f, 249f, 56f, 25f) * tailingsNoise * 0.145f;
            height += Mathf.Exp(-(tailingsSouthDistance * tailingsSouthDistance) / 140f)
                * Gaussian(x, y, 119f, 180f, 51f, 23f) * tailingsNoise * 0.125f;

            // A broad spoil fan carries the quarry rim into the Middle Vein.
            // Its crown is high and dry, while a shallow wash breaks its centre.
            float oreFanDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), OreSpillFan, 5);
            float oreFanMask = Gaussian(x, y, 154f, 194f, 70f, 38f);
            height += Mathf.Exp(-(oreFanDistance * oreFanDistance) / 540f)
                * oreFanMask * 0.13f;
            height -= Mathf.Exp(-(oreFanDistance * oreFanDistance) / 58f)
                * oreFanMask * 0.045f;

            // Glasslands: a hard eastern shelf, high enough to read separately
            // before its fractured surface and MEP rocks are introduced.
            float glassMass = Gaussian(x, y, 307f, 191f, 86f, 78f);
            height += glassMass * 0.34f;
            float glassEdgeX = 246f + Mathf.Sin((y - 145f) * 0.040f) * 7f;
            height += Smooth01((x - glassEdgeX) / 22f) * glassMass * 0.24f;
            float glassNorthRidge = DistanceToPolyline(new Vector2(x, y), GlassFractureNorth);
            float glassSouthRidge = DistanceToPolyline(new Vector2(x, y), GlassFractureSouth);
            height += Mathf.Exp(-(glassNorthRidge * glassNorthRidge) / 95f)
                * glassMass * 0.10f;
            height += Mathf.Exp(-(glassSouthRidge * glassSouthRidge) / 90f)
                * glassMass * 0.09f;

            // Iteration 07: broad super-elliptic plates lift independently from
            // the shelf. Their softened edges remain natural terrain rather than
            // architectural slabs, while retaining the shattered silhouette.
            float glassPlateNorthWest = OrientedPlateMask(
                x, y, 286f, 224f, 29f, 20f, -18f, 0.24f);
            float glassPlateNorthEast = OrientedPlateMask(
                x, y, 329f, 222f, 27f, 18f, 12f, 0.23f);
            float glassPlateCentre = OrientedPlateMask(
                x, y, 310f, 187f, 30f, 21f, -8f, 0.25f);
            float glassPlateEast = OrientedPlateMask(
                x, y, 348f, 177f, 22f, 24f, 22f, 0.25f);
            float glassPlateSouth = OrientedPlateMask(
                x, y, 294f, 153f, 24f, 17f, 15f, 0.24f);
            height += glassPlateNorthWest * glassMass * 0.105f;
            height += glassPlateNorthEast * glassMass * 0.130f;
            height += glassPlateCentre * glassMass * 0.082f;
            height += glassPlateEast * glassMass * 0.112f;
            height += glassPlateSouth * glassMass * 0.078f;

            // Two faults cut through several plates. Paired low shoulders prevent
            // them from reading as painted lines when viewed at strategic scale.
            float glassFaultCentral = DistanceToCatmullRomPath(
                new Vector2(x, y), GlassFaultCentral, 6);
            float glassFaultEast = DistanceToCatmullRomPath(
                new Vector2(x, y), GlassFaultEast, 6);
            height -= Mathf.Exp(-(glassFaultCentral * glassFaultCentral) / 54f)
                * glassMass * 0.115f;
            height -= Mathf.Exp(-(glassFaultEast * glassFaultEast) / 48f)
                * glassMass * 0.105f;
            float centralFaultShoulder = (glassFaultCentral - 11f) / 5.5f;
            float eastFaultShoulder = (glassFaultEast - 10f) / 5f;
            height += Mathf.Exp(-(centralFaultShoulder * centralFaultShoulder))
                * glassMass * 0.033f;
            height += Mathf.Exp(-(eastFaultShoulder * eastFaultShoulder))
                * glassMass * 0.030f;

            // Local collapses interrupt the lifted plates and reserve natural
            // basins for later anomaly fields and fused-glass pools.
            height -= Gaussian(x, y, 313f, 210f, 12f, 8f) * glassMass * 0.135f;
            height -= Gaussian(x, y, 350f, 194f, 10f, 7f) * glassMass * 0.115f;
            height -= Gaussian(x, y, 289f, 166f, 11f, 8f) * glassMass * 0.105f;

            // Chalk Lowland: a pale south-eastern escarpment mass.
            float chalk = Gaussian(x, y, 313f, 91f, 80f, 66f);
            height += chalk * 0.57f;
            height += (Fbm(x * 0.020f + 73f, y * 0.020f + 9f) - 0.5f)
                * chalk * 0.12f;

            // A broken western front separates the chalk country from the Tract
            // Isthmus. Three broad, noise-softened ridges then step down southward.
            float chalkFrontX = 247f
                + Mathf.Sin(y * 0.052f + 0.3f) * 6f
                + Mathf.Sin(y * 0.109f - 0.8f) * 2.2f;
            height += Smooth01((x - chalkFrontX) / 23f) * chalk * 0.145f;
            float chalkRidgeWest = DistanceToCatmullRomPath(
                new Vector2(x, y), ChalkRidgeWest, 5);
            float chalkRidgeCentre = DistanceToCatmullRomPath(
                new Vector2(x, y), ChalkRidgeCentre, 5);
            float chalkRidgeSouth = DistanceToCatmullRomPath(
                new Vector2(x, y), ChalkRidgeSouth, 5);
            float chalkRidgeBreakup = 0.78f
                + (Fbm(x * 0.039f + 54f, y * 0.039f + 31f) - 0.5f) * 0.42f;
            height += Mathf.Exp(-(chalkRidgeWest * chalkRidgeWest) / 175f)
                * chalk * chalkRidgeBreakup * 0.095f;
            height += Mathf.Exp(-(chalkRidgeCentre * chalkRidgeCentre) / 145f)
                * chalk * chalkRidgeBreakup * 0.085f;
            height += Mathf.Exp(-(chalkRidgeSouth * chalkRidgeSouth) / 125f)
                * chalk * chalkRidgeBreakup * 0.075f;

            // Two erosion gullies stop the chalk mass from reading as one smooth
            // dome and lead its runoff toward the Tract Isthmus.
            float chalkGullyA = DistanceToCatmullRomPath(
                new Vector2(x, y), ChalkGullyNorth, 5);
            float chalkGullyB = DistanceToCatmullRomPath(
                new Vector2(x, y), ChalkGullySouth, 5);
            height -= Mathf.Exp(-(chalkGullyA * chalkGullyA) / 125f)
                * chalk * 0.095f;
            height -= Mathf.Exp(-(chalkGullyB * chalkGullyB) / 105f)
                * chalk * 0.075f;

            // Four irregular karst bowls interrupt the ridge rhythm. Each includes
            // a low enclosing lip, preserving a basin even before materials arrive.
            height += KarstBowl(x, y, 291f, 108f, 14f, 10f, 0.115f, 0.047f) * chalk;
            height += KarstBowl(x, y, 329f, 96f, 13f, 9f, 0.105f, 0.043f) * chalk;
            height += KarstBowl(x, y, 308f, 66f, 15f, 10f, 0.120f, 0.050f) * chalk;
            height += KarstBowl(x, y, 350f, 72f, 11f, 8f, 0.140f, 0.050f) * chalk;

            // Zero Basin: a low enclosing shelf contains several connected pool
            // beds. The floors are only partially levelled so they remain terrain.
            float zeroMass = Gaussian(x, y, 203f, 56f, 122f, 58f);
            height -= zeroMass * 0.52f;
            float zeroRadius = EllipticalRadius(x, y, 203f, 58f, 119f, 55f);
            height += QuarryBench(zeroRadius, 1f, 0.12f) * zeroMass * 0.060f;

            float zeroPoolWest = Gaussian(x, y, 151f, 54f, 32f, 19f);
            float zeroPoolCentre = Gaussian(x, y, 214f, 43f, 38f, 17f);
            float zeroPoolEast = Gaussian(x, y, 257f, 68f, 30f, 18f);
            float zeroPoolNorthWest = Gaussian(x, y, 137f, 82f, 27f, 16f);
            height -= zeroPoolWest * zeroMass * 0.060f;
            height -= zeroPoolCentre * zeroMass * 0.075f;
            height -= zeroPoolEast * zeroMass * 0.070f;
            height -= zeroPoolNorthWest * zeroMass * 0.080f;
            height = Mathf.Lerp(height, -0.70f, zeroPoolWest * zeroMass * 0.38f);
            height = Mathf.Lerp(height, -0.76f, zeroPoolCentre * zeroMass * 0.42f);
            height = Mathf.Lerp(height, -0.67f, zeroPoolEast * zeroMass * 0.66f);
            height = Mathf.Lerp(height, -0.65f, zeroPoolNorthWest * zeroMass * 0.85f);

            // Iteration 18: broken littoral lips frame the future toxic mirrors.
            // They are low enough to flood visually but stop four pools from
            // becoming one featureless depression at strategic-map distance.
            height += WetlandShoreline(EllipticalRadius(
                x, y, 151f, 54f, 32f, 19f), x, y, 151f, 54f, 0.015f) * zeroMass;
            height += WetlandShoreline(EllipticalRadius(
                x, y, 214f, 43f, 38f, 17f), x, y, 214f, 43f, 0.014f) * zeroMass;
            height += WetlandShoreline(EllipticalRadius(
                x, y, 257f, 68f, 30f, 18f), x, y, 257f, 68f, 0.014f) * zeroMass;
            height += WetlandShoreline(EllipticalRadius(
                x, y, 137f, 82f, 27f, 16f), x, y, 137f, 82f, 0.013f) * zeroMass;

            float wetlandSpine = DistanceToCatmullRomPath(
                new Vector2(x, y), ZeroWetlandSpine, 6);
            height -= Mathf.Exp(-(wetlandSpine * wetlandSpine) / 175f)
                * zeroMass * 0.052f;

            // Dry levees divide the future toxic water into distinct lakes and
            // create land bridges for roads and encounters.
            height += Gaussian(x, y, 181f, 69f, 23f, 14f) * zeroMass * 0.085f;
            height += Gaussian(x, y, 233f, 76f, 20f, 13f) * zeroMass * 0.080f;
            height += OrientedPlateMask(x, y, 177f, 60f, 24f, 8f, 18f, 0.30f)
                * zeroMass * 0.070f;
            height += OrientedPlateMask(x, y, 226f, 61f, 21f, 7f, -14f, 0.30f)
                * zeroMass * 0.065f;
            height += OrientedPlateMask(x, y, 198f, 83f, 18f, 7f, 7f, 0.30f)
                * zeroMass * 0.058f;

            // Iteration 13: paired alluvial aprons carry the Northern Sluices
            // down into the Middle Vein without softening the dam front itself.
            float sluiceWestProgress;
            float sluiceWestDistance = DistanceAndProgressToPolyline(
                new Vector2(x, y), SluiceMiddleApronWest, out sluiceWestProgress);
            float sluiceEastProgress;
            float sluiceEastDistance = DistanceAndProgressToPolyline(
                new Vector2(x, y), SluiceMiddleApronEast, out sluiceEastProgress);
            float sluiceTransitionMask = Gaussian(x, y, 198f, 228f, 87f, 35f);
            float sluiceWestTarget = Mathf.Lerp(0.27f, 0.075f, sluiceWestProgress);
            float sluiceEastTarget = Mathf.Lerp(0.30f, 0.095f, sluiceEastProgress);
            height = Mathf.Lerp(height, sluiceWestTarget,
                Mathf.Exp(-(sluiceWestDistance * sluiceWestDistance) / 205f)
                * sluiceTransitionMask * 0.68f);
            height = Mathf.Lerp(height, sluiceEastTarget,
                Mathf.Exp(-(sluiceEastDistance * sluiceEastDistance) / 190f)
                * sluiceTransitionMask * 0.62f);

            // Two colluvial tongues blend quarry spoil into inhabited ground.
            // Their shallow axial washes preserve drainage and stop the fans from
            // reading as artificial ramps or rectangular biome borders.
            float oreNorthTransition = DistanceToCatmullRomPath(
                new Vector2(x, y), OreMiddleApronNorth, 5);
            float oreSouthTransition = DistanceToCatmullRomPath(
                new Vector2(x, y), OreMiddleApronSouth, 5);
            float oreTransitionMask = Gaussian(x, y, 151f, 202f, 70f, 49f);
            height += Mathf.Exp(-(oreNorthTransition * oreNorthTransition) / 340f)
                * oreTransitionMask * 0.052f;
            height += Mathf.Exp(-(oreSouthTransition * oreSouthTransition) / 315f)
                * oreTransitionMask * 0.047f;
            height -= Mathf.Exp(-(oreNorthTransition * oreNorthTransition) / 52f)
                * oreTransitionMask * 0.026f;
            height -= Mathf.Exp(-(oreSouthTransition * oreSouthTransition) / 48f)
                * oreTransitionMask * 0.024f;

            // The Glasslands western edge becomes a broken escarpment with three
            // terrain saddles: northern service access, ore railway and Great Tract.
            float glassTransition = DistanceToCatmullRomPath(
                new Vector2(x, y), GlassMiddleBrokenFront, 6);
            float glassTransitionMask = Gaussian(x, y, 250f, 184f, 42f, 74f);
            height += Mathf.Exp(-(glassTransition * glassTransition) / 430f)
                * glassTransitionMask * glassMass * 0.042f;
            height += Mathf.Exp(-(glassTransition * glassTransition) / 92f)
                * glassTransitionMask * glassMass * 0.047f;
            float glassTransitionSaddles = Gaussian(x, y, 250f, 217f, 13f, 11f)
                + Gaussian(x, y, 255f, 196f, 14f, 10f)
                + Gaussian(x, y, 247f, 165f, 14f, 11f);
            height -= Mathf.Clamp01(glassTransitionSaddles)
                * glassTransitionMask * glassMass * 0.120f;

            // A broad chalk apron overlaps the Zero Basin instead of ending at a
            // hard contour. Two lowered saddles continue the existing karst gullies,
            // while their outer lobes form dry mineral fans above the black pools.
            float chalkZeroTransition = DistanceToCatmullRomPath(
                new Vector2(x, y), ChalkZeroBrokenApron, 5);
            float chalkZeroMask = Gaussian(x, y, 258f, 94f, 43f, 58f);
            float zeroLakeProtection = Mathf.Clamp01(zeroPoolWest + zeroPoolCentre
                + zeroPoolEast + zeroPoolNorthWest);
            height += Mathf.Exp(-(chalkZeroTransition * chalkZeroTransition) / 390f)
                * chalkZeroMask * (1f - zeroLakeProtection * 0.88f) * 0.048f;
            height += Mathf.Exp(-(chalkZeroTransition * chalkZeroTransition) / 88f)
                * chalkZeroMask * (1f - zeroLakeProtection * 0.88f) * 0.034f;
            float chalkTransitionSaddles = Gaussian(x, y, 249f, 109f, 13f, 11f)
                + Gaussian(x, y, 258f, 78f, 15f, 11f);
            height -= Mathf.Clamp01(chalkTransitionSaddles) * chalkZeroMask * 0.082f;
            height += Gaussian(x, y, 240f, 92f, 26f, 17f) * zeroMass
                * (1f - zeroLakeProtection * 0.80f) * 0.026f;
            height += Gaussian(x, y, 270f, 70f, 25f, 16f) * zeroMass
                * (1f - zeroLakeProtection * 0.86f) * 0.024f;

            // Iteration 14: major settlements occupy small natural benches with a
            // residual drainage tilt and broken lip. These are terrain landforms,
            // not marker plinths; roads, walls and MEP buildings remain later work.
            height = NaturalTerrace(height, x, y,
                190f, 262f, 13f, 9f, -6f, 0.64f, 0.66f, 0.012f); // Stvor
            height = NaturalTerrace(height, x, y,
                195f, 205f, 14f, 9f, -10f, 0.070f, 0.62f, 0.010f); // Keys
            height = NaturalTerrace(height, x, y,
                235f, 184f, 12f, 8f, 8f, 0.120f, 0.58f, -0.008f); // Filter T-6
            height = NaturalTerrace(height, x, y,
                76f, 210f, 15f, 10f, 12f, -0.720f, 0.72f, 0.010f); // Razdolye
            height = NaturalTerrace(height, x, y,
                128f, 244f, 12f, 8f, -14f, 0.560f, 0.62f, 0.010f); // Cycle works
            height = NaturalTerrace(height, x, y,
                125f, 155f, 17f, 10f, 2f, -0.040f, 0.54f, 0.008f); // Crossroads
            height = NaturalTerrace(height, x, y,
                297f, 110f, 8.5f, 6.5f, -8f, 0.470f, 0.58f, -0.010f); // Chalk Yard
            height = NaturalTerrace(height, x, y,
                267f, 88f, 12f, 8f, 16f, 0.050f, 0.58f, 0.010f); // Chalk Sluice
            height = NaturalTerrace(height, x, y,
                300f, 181f, 15f, 10f, 12f, 0.620f, 0.60f, -0.008f); // Contour-3
            height = NaturalTerrace(height, x, y,
                247f, 49f, 13f, 9f, -12f, -0.500f, 0.62f, 0.008f); // Balance
            height = NaturalTerrace(height, x, y,
                205f, 65f, 12f, 8f, 4f, -0.760f, 0.48f, 0.006f); // R-12

            // Iteration 10: the settled Middle Vein is a stepped floodplain, not
            // one smooth mound. Wide natural shelves reserve dry ground for fields,
            // filtration works and settlements while keeping the river dominant.
            float riverDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), TesmaPath, 6);
            float middleFloodplain = Gaussian(x, y, 196f, 187f, 93f, 63f);
            float middleOuterTerrace = (riverDistance - 43f) / 14f;
            height += Mathf.Exp(-(middleOuterTerrace * middleOuterTerrace))
                * middleFloodplain * 0.052f;
            height += Smooth01((riverDistance - 24f) / 43f)
                * middleFloodplain * 0.035f;

            float keysTerrace = OrientedPlateMask(
                x, y, 195f, 205f, 29f, 18f, -9f, 0.34f);
            float northFieldTerrace = OrientedPlateMask(
                x, y, 192f, 222f, 61f, 18f, -4f, 0.36f);
            float southFieldTerrace = OrientedPlateMask(
                x, y, 190f, 169f, 66f, 21f, 5f, 0.36f);
            height = Mathf.Lerp(height, 0.075f,
                keysTerrace * middleFloodplain * 0.24f);
            height = Mathf.Lerp(height, 0.105f,
                northFieldTerrace * middleFloodplain * 0.14f);
            height = Mathf.Lerp(height, 0.060f,
                southFieldTerrace * middleFloodplain * 0.15f);

            // The Tract Isthmus follows two old engineered grades. The broad base
            // is natural-looking compacted high ground; its narrow crown reserves
            // a continuous road and rail bed for the later MEP dressing pass.
            float tractProgress;
            float tractDistance = DistanceAndProgressToPolyline(
                new Vector2(x, y), TractMainEarthwork, out tractProgress);
            float tractRegion = Gaussian(x, y, 185f, 149f, 190f, 56f);
            float tractBase = Mathf.Exp(-(tractDistance * tractDistance) / 330f)
                * tractRegion;
            float tractCrown = Mathf.Exp(-(tractDistance * tractDistance) / 52f)
                * tractRegion;
            float tractTarget = Mathf.Lerp(-0.035f, 0.145f, tractProgress)
                + Mathf.Sin(tractProgress * Mathf.PI) * 0.025f;
            height += tractBase * 0.038f;
            height = Mathf.Lerp(height, tractTarget, tractCrown * 0.54f);
            height += tractCrown * 0.025f;

            float bypassProgress;
            float bypassDistance = DistanceAndProgressToPolyline(
                new Vector2(x, y), TractSouthBypass, out bypassProgress);
            float bypassMask = Mathf.Exp(-(bypassDistance * bypassDistance) / 48f)
                * Gaussian(x, y, 186f, 155f, 81f, 28f);
            float bypassTarget = Mathf.Lerp(-0.025f, 0.055f, bypassProgress);
            height += Mathf.Exp(-(bypassDistance * bypassDistance) / 245f)
                * Gaussian(x, y, 184f, 155f, 92f, 35f) * 0.030f;
            height = Mathf.Lerp(height, bypassTarget, bypassMask * 0.50f);

            // The central hub occupies a defensible low terrace rather than a
            // featureless plane. River and tributaries are carved through it below.
            height += Gaussian(x, y, 189f, 158f, 48f, 34f) * 0.080f;

            // The Tesma depression gives the future water course a natural bed.
            float tesmaWidth = TesmaChannelWidthAtY(y);
            float tesmaBroadWidth = tesmaWidth * 2.45f;
            height -= Mathf.Exp(-(riverDistance * riverDistance)
                / (tesmaBroadWidth * tesmaBroadWidth)) * 0.085f;
            height -= Mathf.Exp(-(riverDistance * riverDistance)
                / (tesmaWidth * tesmaWidth)) * 0.125f;

            // Low paired banks define a readable floodplain without turning the
            // river into a canyon. Three subdued tributaries explain the regional
            // drainage seen in the concept instead of ending as arbitrary grooves.
            float bankDelta = (riverDistance - (tesmaWidth + 6f))
                / (tesmaWidth * 0.34f + 4f);
            height += Mathf.Exp(-(bankDelta * bankDelta)) * 0.052f;
            float outerBankDelta = (riverDistance - (tesmaWidth + 20f))
                / (tesmaWidth * 0.42f + 6f);
            height += Mathf.Exp(-(outerBankDelta * outerBankDelta)) * 0.026f;
            float westDrain = DistanceToCatmullRomPath(
                new Vector2(x, y), WestDrainage, 5);
            float eastDrain = DistanceToCatmullRomPath(
                new Vector2(x, y), EastDrainage, 5);
            float southDrain = DistanceToCatmullRomPath(
                new Vector2(x, y), SouthDrainage, 5);
            float zeroEastDrain = DistanceToCatmullRomPath(
                new Vector2(x, y), ZeroEastDrain, 5);
            height -= Mathf.Exp(-(westDrain * westDrain) / 185f)
                * Gaussian(x, y, 145f, 164f, 94f, 39f) * 0.065f;
            height -= Mathf.Exp(-(eastDrain * eastDrain) / 210f)
                * Gaussian(x, y, 287f, 151f, 104f, 40f) * 0.057f;
            height -= Mathf.Exp(-(southDrain * southDrain) / 165f)
                * Gaussian(x, y, 160f, 74f, 88f, 34f) * 0.052f;
            height -= Mathf.Exp(-(zeroEastDrain * zeroEastDrain) / 145f)
                * Gaussian(x, y, 241f, 79f, 71f, 30f) * 0.055f;
            float zeroDrainLevee = (zeroEastDrain - 13f) / 5.5f;
            height += Mathf.Exp(-(zeroDrainLevee * zeroDrainLevee))
                * zeroMass * 0.026f;

            // Two shallow distributary canals explain the inhabited fields in the
            // Middle Vein. Their subdued paired banks keep them legible before
            // water and concrete channel models are introduced in later phases.
            float middleCanalWest = DistanceToCatmullRomPath(
                new Vector2(x, y), MiddleCanalWest, 5);
            float middleCanalEast = DistanceToCatmullRomPath(
                new Vector2(x, y), MiddleCanalEast, 5);
            height -= Mathf.Exp(-(middleCanalWest * middleCanalWest) / 42f)
                * middleFloodplain * 0.034f;
            height -= Mathf.Exp(-(middleCanalEast * middleCanalEast) / 42f)
                * middleFloodplain * 0.032f;
            float middleCanalWestBank = (middleCanalWest - 8f) / 4.5f;
            float middleCanalEastBank = (middleCanalEast - 8f) / 4.5f;
            height += Mathf.Exp(-(middleCanalWestBank * middleCanalWestBank))
                * middleFloodplain * 0.017f;
            height += Mathf.Exp(-(middleCanalEastBank * middleCanalEastBank))
                * middleFloodplain * 0.016f;

            // Confluence bowls blend the tributaries into the Tesma, while an
            // abandoned western oxbow gives the central floodplain a history.
            height -= Gaussian(x, y, 194f, 173f, 22f, 18f) * 0.043f;
            height -= Gaussian(x, y, 209f, 135f, 21f, 17f) * 0.037f;
            float oxbowDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), CentralOxbowWest, 6);
            height -= Mathf.Exp(-(oxbowDistance * oxbowDistance) / 92f)
                * Gaussian(x, y, 181f, 129f, 52f, 34f) * 0.047f;

            // Iteration 12 gives the full river a controlled longitudinal grade.
            // Three shallow flood bowls widen inhabited confluences, while the
            // thalweg remains continuous through the alternating broad and narrow
            // reaches. The terminal basin is deliberately lower than its outlet.
            float tesmaFloodBowls = Gaussian(x, y, 199f, 207f, 35f, 21f)
                + Gaussian(x, y, 194f, 173f, 38f, 22f)
                + Gaussian(x, y, 203f, 99f, 33f, 20f);
            height -= Mathf.Clamp01(tesmaFloodBowls)
                * Mathf.Exp(-(riverDistance * riverDistance) / 640f) * 0.026f;
            float tesmaGrade = TesmaGradeAtY(y);
            float tesmaGradeCore = Mathf.Exp(-(riverDistance * riverDistance)
                / (tesmaWidth * tesmaWidth * 0.68f));
            float tesmaGradeBounds = Smooth01((y - 25f) / 20f)
                * (1f - Smooth01((y - 282f) / 14f));
            height = Mathf.Lerp(height, tesmaGrade,
                tesmaGradeCore * tesmaGradeBounds * 0.80f
                * (1f - sluiceWaterProtection * 0.90f));
            height -= Mathf.Exp(-(riverDistance * riverDistance)
                / (tesmaWidth * tesmaWidth * 0.24f))
                * tesmaGradeBounds * 0.018f;

            // The Silent Ring rises around the playable landmass and is broken by
            // long, low waves rather than a perfectly circular wall.
            float nx = (x - WidthPoints * 0.5f) / 186f;
            float ny = (y - HeightPoints * 0.5f) / 146f;
            float radius = Mathf.Sqrt(nx * nx + ny * ny);
            float perimeterAngle = Mathf.Atan2(ny, nx);
            float edge = Smooth01((radius - 0.78f) / 0.20f);
            float ringBreakup = 0.78f + 0.22f * Mathf.Sin(x * 0.083f + y * 0.047f);
            height += edge * ringBreakup * 0.58f;

            // A second, narrower scarp and a broken inner bench give the outer
            // boundary the layered cliff profile visible in the reference.
            float outerScarp = Smooth01((radius - 0.855f) / 0.095f);
            float angularBreakup = 0.72f
                + Mathf.Sin(perimeterAngle * 5f + 0.8f) * 0.16f
                + Mathf.Sin(perimeterAngle * 11f - 0.3f) * 0.08f;
            height += outerScarp * angularBreakup * 0.16f;
            height += QuarryBench(radius, 0.875f, 0.030f)
                * (0.72f + 0.28f * ringBreakup) * 0.050f;

            // Iteration 11 divides the perimeter into six geological sectors.
            // Broad path ridges follow the actual oval boundary, while different
            // amplitudes keep the western spoil, fused east and southern ash rim
            // from reading as one procedural tube.
            float silentNorthWest = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentRidgeNorthWest, 5);
            float silentNorthEast = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentRidgeNorthEast, 5);
            float silentEast = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentRidgeEast, 5);
            float silentSouthEast = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentRidgeSouthEast, 5);
            float silentSouthWest = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentRidgeSouthWest, 5);
            float silentWest = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentRidgeWest, 5);
            float ringSectorNoise = 0.82f
                + (Fbm(x * 0.034f + 121f, y * 0.034f + 47f) - 0.5f) * 0.44f;
            float eastKarstProtection = Gaussian(x, y, 350f, 72f, 12f, 9f);
            height += Mathf.Exp(-(silentNorthWest * silentNorthWest) / 150f)
                * ringSectorNoise * 0.115f;
            height += Mathf.Exp(-(silentNorthEast * silentNorthEast) / 138f)
                * ringSectorNoise * 0.105f;
            height += Mathf.Exp(-(silentEast * silentEast) / 125f)
                * ringSectorNoise * 0.185f * (1f - eastKarstProtection * 0.80f);
            height += Mathf.Exp(-(silentSouthEast * silentSouthEast) / 135f)
                * ringSectorNoise * 0.175f * (1f - eastKarstProtection * 0.90f);
            height += Mathf.Exp(-(silentSouthWest * silentSouthWest) / 145f)
                * ringSectorNoise * 0.130f;
            height += Mathf.Exp(-(silentWest * silentWest) / 132f)
                * ringSectorNoise * 0.145f;

            // A broken inner bench creates the two-step enclosing profile visible
            // in the reference. Four erosion clefts interrupt it without opening
            // additional traversable routes through the perimeter.
            float innerRingNoise = (Fbm(x * 0.026f + 9f, y * 0.026f + 83f) - 0.5f)
                * 0.032f;
            float silentInnerBench = QuarryBench(
                radius + innerRingNoise, 0.825f, 0.038f);
            height += silentInnerBench * (0.78f + ringSectorNoise * 0.22f) * 0.050f
                * (1f - sluiceWaterProtection * 0.90f);
            float ringClefts = Gaussian(x, y, 48f, 232f, 15f, 18f)
                + Gaussian(x, y, 320f, 244f, 15f, 17f)
                + Gaussian(x, y, 337f, 61f, 13f, 16f)
                + Gaussian(x, y, 58f, 64f, 15f, 18f);
            height -= edge * Mathf.Clamp01(ringClefts) * 0.085f;

            // Iteration 19: a sector-dependent toe and apron stop the Silent Ring
            // from ending as one clean procedural wall. Radial furrows expose the
            // scarp face while the later pass cuts retain all four legal exits.
            height += EdgeFootProfile(radius, perimeterAngle, x, y);

            // Four terrain-level passes keep the Ring a boundary rather than a
            // sealed bowl. North and south follow the Tesma, west carries the main
            // caravan entry, and the eastern saddle now aligns with the Great Tract.
            float northPassDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentPassNorth, 5);
            float southPassDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentPassSouth, 5);
            float westPassDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentPassWest, 5);
            float eastPassDistance = DistanceToCatmullRomPath(
                new Vector2(x, y), SilentPassEast, 5);
            float northPass = Mathf.Exp(-(northPassDistance * northPassDistance) / 105f)
                * Gaussian(x, y, 205f, 286f, 43f, 35f);
            float southPass = Mathf.Exp(-(southPassDistance * southPassDistance) / 100f)
                * Gaussian(x, y, 210f, 15f, 39f, 31f);
            float westPass = Mathf.Exp(-(westPassDistance * westPassDistance) / 115f)
                * Gaussian(x, y, 20f, 155f, 39f, 45f);
            float eastPass = Mathf.Exp(-(eastPassDistance * eastPassDistance) / 105f)
                * Gaussian(x, y, 355f, 85f, 46f, 36f);
            float eastPassKarstProtection = Mathf.Clamp01(
                Gaussian(x, y, 329f, 96f, 14f, 10f) * 0.65f
                + Gaussian(x, y, 350f, 72f, 13f, 9f) * 0.78f);
            eastPass *= 1f - eastPassKarstProtection;
            height = Mathf.Lerp(height, 0.18f, northPass * edge * 0.88f);
            height = Mathf.Lerp(height, -0.25f, southPass * edge * 0.90f);
            height = Mathf.Lerp(height, -0.025f, westPass * edge * 0.86f);
            height = Mathf.Lerp(height, 0.16f, eastPass * edge * 0.88f);

            float northPassShoulder = (northPassDistance - 15f) / 6.5f;
            float southPassShoulder = (southPassDistance - 14f) / 6.0f;
            float westPassShoulder = (westPassDistance - 14f) / 6.5f;
            float eastPassShoulder = (eastPassDistance - 14f) / 6.0f;
            height += Mathf.Exp(-(northPassShoulder * northPassShoulder))
                * edge * Gaussian(x, y, 205f, 286f, 45f, 36f) * 0.065f;
            height += Mathf.Exp(-(southPassShoulder * southPassShoulder))
                * edge * Gaussian(x, y, 210f, 15f, 42f, 32f) * 0.070f;
            height += Mathf.Exp(-(westPassShoulder * westPassShoulder))
                * edge * Gaussian(x, y, 20f, 155f, 42f, 46f) * 0.060f;
            height += Mathf.Exp(-(eastPassShoulder * eastPassShoulder))
                * edge * Gaussian(x, y, 355f, 85f, 48f, 38f)
                * (1f - eastPassKarstProtection * 0.75f) * 0.065f;

            // Four strategic edge terraces are applied after the perimeter so
            // their defensible ledges survive sector uplift without cutting new
            // passes through the Silent Ring.
            height = NaturalTerrace(height, x, y,
                190f, 262f, 9f, 6f, -6f, 0.630f, 0.76f, 0.010f); // Stvor upper ledge
            height = NaturalTerrace(height, x, y,
                235f, 271f, 12f, 8f, -5f, 0.910f, 0.90f, 0.008f); // HES-2
            height = NaturalTerrace(height, x, y,
                84f, 265f, 13f, 9f, 15f, 0.980f, 0.88f, 0.010f); // Ore Pass
            height = NaturalTerrace(height, x, y,
                358f, 184f, 10f, 7f, 4f, 0.930f, 0.72f, -0.008f); // Relay V-9
            height = NaturalTerrace(height, x, y,
                220f, 22f, 13f, 9f, -8f, -0.030f, 0.82f, 0.008f); // Fort 14

            // Iteration 17: narrow erosion ribbons give each wild macroregion a
            // recognisable geological handwriting before materials are applied.
            // Ore Arc exposes rust strata, Glasslands fractures branch, chalk
            // drains into karst, Zero Basin subsides, and the Ring sheds rills.
            height = ErosionRibbon(height, x, y, OreStrataWashNorth,
                2.5f, 0.032f, 0.010f);
            height = ErosionRibbon(height, x, y, OreStrataWashSouth,
                2.6f, 0.035f, 0.011f);
            height = ErosionRibbon(height, x, y, GlassSplinterNorth,
                2.2f, 0.031f, 0.010f);
            height = ErosionRibbon(height, x, y, GlassSplinterEast,
                2.0f, 0.029f, 0.010f);
            height = ErosionRibbon(height, x, y, ChalkRunnelNorth,
                2.4f, 0.030f, 0.009f);
            height = ErosionRibbon(height, x, y, ChalkRunnelSouth,
                2.2f, 0.027f, 0.009f);
            height = ErosionRibbon(height, x, y, ZeroSubsidenceWest,
                2.8f, 0.034f, 0.009f);
            height = ErosionRibbon(height, x, y, ZeroSubsidenceEast,
                2.7f, 0.033f, 0.009f);
            height = ErosionRibbon(height, x, y, SilentNorthEastRill,
                2.4f, 0.036f, 0.010f);
            height = ErosionRibbon(height, x, y, SilentSouthWestRill,
                2.3f, 0.034f, 0.010f);
            height = ErosionRibbon(height, x, y, SilentWestRill,
                2.4f, 0.035f, 0.010f);

            // The hydrological pass adds narrow thalwegs between already-authored
            // basins. Paired low banks preserve readable water corridors without
            // replacing the terrain with separate river geometry.
            height = HydraulicChannel(height, x, y, SluiceCascadeWest,
                3.2f, 0.045f, 0.014f);
            height = HydraulicChannel(height, x, y, SluiceCascadeEast,
                3.0f, 0.040f, 0.013f);
            height = HydraulicChannel(height, x, y, ZeroPoolConnectorWest,
                2.8f, 0.035f, 0.009f);
            height = HydraulicChannel(height, x, y, ZeroPoolConnectorCentre,
                3.2f, 0.040f, 0.009f);
            height = HydraulicChannel(height, x, y, ZeroPoolConnectorEast,
                3.0f, 0.038f, 0.009f);
            height = HydraulicChannel(height, x, y, ZeroTerminalBraidWest,
                2.5f, 0.031f, 0.008f);
            height = HydraulicChannel(height, x, y, ZeroTerminalBraidEast,
                2.5f, 0.030f, 0.008f);

            // Four low alluvial splays explain how sediment accumulates below the
            // Sluices and at the three principal Tesma confluences.
            height = AlluvialSplay(height, x, y,
                194f, 231f, 13f, 17f, -4f, 0.024f);
            height = AlluvialSplay(height, x, y,
                183f, 174f, 14f, 10f, -14f, 0.022f);
            height = AlluvialSplay(height, x, y,
                226f, 142f, 15f, 10f, 14f, 0.021f);
            height = AlluvialSplay(height, x, y,
                186f, 91f, 14f, 10f, -10f, 0.020f);

            // Iteration 16: narrow graded benches connect difficult locations to
            // existing terrain corridors. They remain slightly crowned and broken,
            // reading as eroded access lines rather than finished asphalt roads.
            height = TerrainAccessGrade(height, x, y, NinthQuarryAccess,
                2.8f, 0.560f, 0.410f, 0.68f);
            height = TerrainAccessGrade(height, x, y, IronMineAccess,
                3.2f, 0.980f, 0.820f, 0.90f);
            height = TerrainAccessGrade(height, x, y, SortingFieldsAccess,
                3.0f, -0.720f, -0.540f, 0.66f);
            height = TerrainAccessGrade(height, x, y, CeramicLedgeAccess,
                2.8f, 0.350f, 0.230f, 0.62f);
            height = TerrainAccessGrade(height, x, y, StorehouseCraterAccess,
                2.9f, 0.350f, 0.330f, 0.82f);
            height = TerrainAccessGrade(height, x, y, VectorResearchAccess,
                3.1f, 0.570f, 0.830f, 0.70f);
            height = TerrainAccessGrade(height, x, y, SolarFieldAccess,
                2.8f, 0.520f, 0.590f, 0.64f);

            // Colluvial fans soften the hard meeting points between the inner
            // basin and its Glasslands, Chalk and Silent Ring scarps. Fine ribs
            // provide erosion direction; MEP boulders are still deferred.
            height = TalusApron(height, x, y,
                260f, 225f, 12f, 18f, -8f, 0.052f);
            height = TalusApron(height, x, y,
                246f, 188f, 11f, 17f, 6f, 0.022f);
            height = TalusApron(height, x, y,
                252f, 155f, 12f, 18f, 12f, 0.025f);
            height = TalusApron(height, x, y,
                276f, 120f, 11f, 17f, -18f, 0.048f);
            height = TalusApron(height, x, y,
                291f, 91f, 10f, 15f, -8f, 0.043f);
            height = TalusApron(height, x, y,
                310f, 69f, 10f, 15f, 8f, 0.045f);
            height = TalusApron(height, x, y,
                61f, 246f, 13f, 19f, 34f, 0.060f);
            height = TalusApron(height, x, y,
                297f, 246f, 13f, 19f, -30f, 0.057f);
            height = TalusApron(height, x, y,
                340f, 176f, 12f, 18f, -79f, 0.055f);
            height = TalusApron(height, x, y,
                322f, 64f, 12f, 18f, -142f, 0.058f);
            height = TalusApron(height, x, y,
                88f, 54f, 13f, 19f, 142f, 0.056f);
            height = TalusApron(height, x, y,
                36f, 181f, 12f, 18f, 78f, 0.058f);

            // Iteration 15: every authored resource location receives a small,
            // geologically plausible extraction pocket. Their broken rims and
            // shallow inner shelves will later seat MEP machinery, spoil and pipes
            // without turning strategic-map markers into floating props.
            height = ResourcePocket(height, x, y,
                112f, 250f, 9f, 7f, -16f, 0.070f, 0.045f); // Ninth Quarry
            height = ResourcePocket(height, x, y,
                226f, 229f, 7f, 5f, 8f, 0.045f, 0.026f); // Dry Intake
            height = ResourcePocket(height, x, y,
                151f, 190f, 8f, 5.5f, -11f, 0.030f, 0.018f); // Far Row farm
            height = ResourcePocket(height, x, y,
                43f, 267f, 10f, 7f, 19f, 0.125f, 0.070f); // Three Shifts mine
            height = ResourcePocket(height, x, y,
                95f, 237f, 9f, 6f, -7f, 0.058f, 0.036f); // Sorting fields
            height = ResourcePocket(height, x, y,
                82f, 144f, 8f, 5.5f, 4f, 0.043f, 0.026f); // Polymer depot
            height = ResourcePocket(height, x, y,
                274f, 139f, 9f, 6.5f, -18f, 0.068f, 0.041f); // Ceramic ledge
            height = ResourcePocket(height, x, y,
                168f, 76f, 8f, 5.5f, 13f, 0.056f, 0.032f); // Drain 4-B
            height = ResourcePocket(height, x, y,
                147f, 45f, 8f, 6f, -9f, 0.052f, 0.031f); // Fuel ramp

            // The Storehouse crater is an asymmetric experimental-blast scar,
            // with a smaller sympathetic collapse on its south-eastern ejecta.
            // It explains the mutant lair at terrain scale before props or VFX.
            height = ImpactCrater(height, x, y,
                315f, 143f, 17f, 12f, -12f, 0.165f, 0.090f, 0.75f);
            height = ImpactCrater(height, x, y,
                328f, 132f, 7f, 5f, 17f, 0.075f, 0.038f, 0.35f);

            // Distant pre-war research structures need cut-and-fill aprons rather
            // than perfectly horizontal plinths. Vector occupies a fused shelf;
            // Solar Field 4 follows a lower Glasslands shoulder.
            height = ResearchApron(height, x, y,
                338f, 225f, 8.5f, 6f, 11f, 0.830f, 0.68f, -0.010f); // Vector
            height = ResearchApron(height, x, y,
                345f, 154f, 11f, 7f, -6f, 0.600f, 0.62f, 0.010f); // Solar Field 4

            return Mathf.Clamp(height, -1.05f, 1.28f);
        }

        internal static bool ContainsMapPoint(float pointX, float pointY,
                                              float normalizedInset = 0f)
        {
            float worldX = (pointX - WidthPoints * 0.5f) * WorldScale;
            float worldZ = (HeightPoints * 0.5f - pointY) * WorldScale;
            float normalizedX = worldX / 18.65f;
            float normalizedZ = worldZ / 14.65f;
            float angle = Mathf.Atan2(normalizedZ, normalizedX);
            float radius = Mathf.Sqrt(normalizedX * normalizedX
                + normalizedZ * normalizedZ);
            return radius <= OutlineRadius(angle) - Mathf.Max(0f, normalizedInset);
        }

        internal static Vector2 BoundaryMapPoint(float angle,
                                                 float normalizedInset = 0f)
        {
            float radius = OutlineRadius(angle) - normalizedInset;
            float worldX = Mathf.Cos(angle) * 18.65f * radius;
            float worldZ = Mathf.Sin(angle) * 14.65f * radius;
            return new Vector2(worldX / WorldScale + WidthPoints * 0.5f,
                HeightPoints * 0.5f - worldZ / WorldScale);
        }

        internal static Vector3 BoundaryWorldPoint(float angle,
                                                   float normalizedInset = 0f,
                                                   float lift = 0f)
        {
            Vector2 map = BoundaryMapPoint(angle, normalizedInset);
            return new Vector3((map.x - WidthPoints * 0.5f) * WorldScale,
                HeightAtMap(map.x, map.y) + lift,
                (HeightPoints * 0.5f - map.y) * WorldScale);
        }

        private static void FillLandmassMesh(Mesh mesh)
        {
            var vertices = new List<Vector3>(1 + RadialSegments * AngularSegments
                + AngularSegments * 2);
            var uv = new List<Vector2>(vertices.Capacity);
            var triangles = new List<int>(RadialSegments * AngularSegments * 6);

            vertices.Add(new Vector3(0f, HeightAtMap(190f, 150f), 0f));
            uv.Add(new Vector2(0.5f, 0.5f));

            for (int ring = 1; ring <= RadialSegments; ring++)
            {
                float radial = ring / (float)RadialSegments;
                for (int segment = 0; segment < AngularSegments; segment++)
                {
                    float angle = segment / (float)AngularSegments * Mathf.PI * 2f;
                    float outline = OutlineRadius(angle);
                    float worldX = Mathf.Cos(angle) * 18.65f * outline * radial;
                    float worldZ = Mathf.Sin(angle) * 14.65f * outline * radial;
                    float pointX = worldX / WorldScale + WidthPoints * 0.5f;
                    float pointY = HeightPoints * 0.5f - worldZ / WorldScale;
                    vertices.Add(new Vector3(worldX, HeightAtMap(pointX, pointY), worldZ));
                    uv.Add(new Vector2(pointX / WidthPoints, pointY / HeightPoints));
                }
            }

            // Centre fan.
            for (int segment = 0; segment < AngularSegments; segment++)
            {
                int current = 1 + segment;
                int next = 1 + (segment + 1) % AngularSegments;
                triangles.Add(0);
                triangles.Add(next);
                triangles.Add(current);
            }

            // Concentric quads.
            for (int ring = 1; ring < RadialSegments; ring++)
            {
                int inner = 1 + (ring - 1) * AngularSegments;
                int outer = inner + AngularSegments;
                for (int segment = 0; segment < AngularSegments; segment++)
                {
                    int next = (segment + 1) % AngularSegments;
                    int a = inner + segment;
                    int b = inner + next;
                    int c = outer + segment;
                    int d = outer + next;
                    triangles.Add(a); triangles.Add(b); triangles.Add(c);
                    triangles.Add(c); triangles.Add(b); triangles.Add(d);
                }
            }

            // Separate side vertices keep the top normals smooth and the exposed
            // continental edge crisp in the strategic camera.
            int outerStart = 1 + (RadialSegments - 1) * AngularSegments;
            int sideTop = vertices.Count;
            for (int segment = 0; segment < AngularSegments; segment++)
            {
                Vector3 top = vertices[outerStart + segment];
                vertices.Add(top);
                uv.Add(new Vector2(segment / (float)AngularSegments, 1f));
            }
            int sideBottom = vertices.Count;
            for (int segment = 0; segment < AngularSegments; segment++)
            {
                Vector3 top = vertices[outerStart + segment];
                float angle = segment / (float)AngularSegments * Mathf.PI * 2f;
                vertices.Add(new Vector3(top.x, SideWallFloor(angle), top.z));
                uv.Add(new Vector2(segment / (float)AngularSegments, 0f));
            }
            for (int segment = 0; segment < AngularSegments; segment++)
            {
                int next = (segment + 1) % AngularSegments;
                int a = sideTop + segment;
                int b = sideTop + next;
                int c = sideBottom + segment;
                int d = sideBottom + next;
                triangles.Add(a); triangles.Add(c); triangles.Add(b);
                triangles.Add(b); triangles.Add(c); triangles.Add(d);
            }

            mesh.Clear();
            mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
        }

        private static void SaveRuntimeField()
        {
            RoaGlobalMapRelief asset =
                AssetDatabase.LoadAssetAtPath<RoaGlobalMapRelief>(ReliefAssetPath);
            bool fresh = asset == null;
            if (fresh) asset = ScriptableObject.CreateInstance<RoaGlobalMapRelief>();
            asset.SamplesX = FieldSamplesX;
            asset.SamplesY = FieldSamplesY;
            asset.WidthPoints = WidthPoints;
            asset.HeightPoints = HeightPoints;
            asset.Heights = new float[FieldSamplesX * FieldSamplesY];
            for (int y = 0; y < FieldSamplesY; y++)
            {
                float pointY = y / (float)(FieldSamplesY - 1) * HeightPoints;
                for (int x = 0; x < FieldSamplesX; x++)
                {
                    float pointX = x / (float)(FieldSamplesX - 1) * WidthPoints;
                    asset.Heights[y * FieldSamplesX + x] = HeightAtMap(pointX, pointY);
                }
            }
            if (fresh) AssetDatabase.CreateAsset(asset, ReliefAssetPath);
            else EditorUtility.SetDirty(asset);
        }

        private static float NaturalTerrace(float currentHeight, float x, float y,
                                            float centreX, float centreY,
                                            float radiusX, float radiusY,
                                            float angleDegrees, float targetHeight,
                                            float strength, float drainageTilt)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - centreX;
            float dy = y - centreY;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float radius = Mathf.Sqrt(localX * localX + localY * localY);
            float mask = 1f - Smooth01((radius - 0.58f) / 0.42f);
            float residualNoise = (Fbm(x * 0.061f + centreX * 0.013f,
                y * 0.061f + centreY * 0.017f) - 0.5f) * 0.010f;
            float targetSurface = targetHeight + localX * drainageTilt
                + localY * drainageTilt * 0.32f + residualNoise;
            float result = Mathf.Lerp(currentHeight, targetSurface,
                mask * Mathf.Clamp01(strength));
            float brokenLip = 0.76f + 0.24f
                * Mathf.Sin(localX * 5.3f + localY * 3.7f + centreX * 0.041f);
            result += QuarryBench(radius, 0.94f, 0.12f)
                * brokenLip * Mathf.Clamp01(strength) * 0.015f;
            return result;
        }

        private static float ResourcePocket(float currentHeight, float x, float y,
                                            float centreX, float centreY,
                                            float radiusX, float radiusY,
                                            float angleDegrees, float depth,
                                            float rimHeight)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - centreX;
            float dy = y - centreY;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float azimuth = Mathf.Atan2(localY, localX);
            float radius = Mathf.Sqrt(localX * localX + localY * localY);
            float warp = (Fbm(x * 0.083f + centreX * 0.031f,
                y * 0.083f + centreY * 0.027f) - 0.5f) * 0.14f;
            float fracturedRadius = radius + warp * Smooth01(radius / 1.18f);
            float basin = Mathf.Exp(-(fracturedRadius * fracturedRadius) * 2.70f);
            float innerShelf = QuarryBench(fracturedRadius, 0.56f, 0.17f);
            float brokenRim = 0.74f + 0.26f
                * Mathf.Sin(azimuth * 3f + centreX * 0.037f - centreY * 0.019f);
            float rim = QuarryBench(fracturedRadius, 0.93f, 0.15f) * brokenRim;
            return currentHeight - basin * depth
                + innerShelf * rimHeight * 0.14f + rim * rimHeight;
        }

        private static float ImpactCrater(float currentHeight, float x, float y,
                                          float centreX, float centreY,
                                          float radiusX, float radiusY,
                                          float angleDegrees, float depth,
                                          float rimHeight, float ejectaStrength)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - centreX;
            float dy = y - centreY;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float azimuth = Mathf.Atan2(localY, localX);
            float radius = Mathf.Sqrt(localX * localX + localY * localY);
            float fracturedRadius = radius
                + Mathf.Sin(azimuth * 5f + 0.7f) * 0.035f
                + (Fbm(x * 0.071f + 43f, y * 0.071f + 17f) - 0.5f) * 0.08f;
            float bowl = Mathf.Exp(-(fracturedRadius * fracturedRadius) * 2.25f);
            float brokenRim = 0.70f + 0.30f * Mathf.Sin(azimuth * 4f - 0.45f);
            float rim = QuarryBench(fracturedRadius, 0.96f, 0.16f) * brokenRim;
            float rayPattern = Mathf.Pow(Mathf.Max(0f,
                Mathf.Cos(azimuth * 3f + 0.35f)), 3f);
            float ejecta = QuarryBench(fracturedRadius, 1.28f, 0.31f)
                * (0.28f + rayPattern * 0.72f) * ejectaStrength;
            float slump = QuarryBench(fracturedRadius, 0.58f, 0.16f)
                * (0.64f + Mathf.Sin(azimuth * 2f + 1.1f) * 0.18f);
            return currentHeight - bowl * depth + rim * rimHeight
                + ejecta * rimHeight * 0.38f - slump * depth * 0.10f;
        }

        private static float ResearchApron(float currentHeight, float x, float y,
                                           float centreX, float centreY,
                                           float radiusX, float radiusY,
                                           float angleDegrees, float targetHeight,
                                           float strength, float drainageTilt)
        {
            float result = NaturalTerrace(currentHeight, x, y,
                centreX, centreY, radiusX, radiusY, angleDegrees,
                targetHeight, strength, drainageTilt);
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - centreX;
            float dy = y - centreY;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float radius = Mathf.Sqrt(localX * localX + localY * localY);
            float cutLip = QuarryBench(radius, 0.88f, 0.12f)
                * (0.72f + 0.28f * Mathf.Sin(localX * 4.1f + localY * 2.7f));
            float drain = Mathf.Exp(-(localY * localY) / 0.055f)
                * Smooth01((localX - 0.10f) / 0.72f)
                * (1f - Smooth01((radius - 0.42f) / 0.46f));
            return result + cutLip * 0.012f * Mathf.Clamp01(strength)
                - drain * 0.006f;
        }

        private static float TerrainAccessGrade(float currentHeight, float x, float y,
                                                Vector2[] path, float halfWidth,
                                                float startHeight, float endHeight,
                                                float strength)
        {
            float progress;
            float distance = DistanceAndProgressToPolyline(
                new Vector2(x, y), path, out progress);
            float core = Mathf.Exp(-(distance * distance)
                / Mathf.Max(0.01f, halfWidth * halfWidth));
            float target = Mathf.Lerp(startHeight, endHeight, progress)
                + (Fbm(x * 0.092f + 29f, y * 0.092f + 61f) - 0.5f) * 0.012f;
            float result = Mathf.Lerp(currentHeight, target,
                core * Mathf.Clamp01(strength));
            float shoulderDelta = (distance - halfWidth * 1.45f)
                / Mathf.Max(0.1f, halfWidth * 0.46f);
            float shoulder = Mathf.Exp(-(shoulderDelta * shoulderDelta));
            float pathMask = Gaussian(x, y,
                (path[0].x + path[path.Length - 1].x) * 0.5f,
                (path[0].y + path[path.Length - 1].y) * 0.5f,
                Mathf.Abs(path[0].x - path[path.Length - 1].x) * 0.75f + 12f,
                Mathf.Abs(path[0].y - path[path.Length - 1].y) * 0.75f + 12f);
            return result + shoulder * pathMask * 0.010f * Mathf.Clamp01(strength);
        }

        private static float TalusApron(float currentHeight, float x, float y,
                                        float centreX, float centreY,
                                        float radiusX, float radiusY,
                                        float angleDegrees, float depositHeight)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - centreX;
            float dy = y - centreY;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float progress = Smooth01((localY + 0.82f) / 1.55f);
            float sourceFade = Smooth01((localY + 0.92f) / 0.28f);
            float toeFade = 1f - Smooth01((localY - 0.68f) / 0.27f);
            float halfWidth = 0.24f + progress * 0.70f;
            float lateral = 1f - Smooth01((Mathf.Abs(localX) - halfWidth) / 0.22f);
            float body = sourceFade * toeFade * lateral;
            float ribs = 0.72f + 0.28f
                * Mathf.Pow(Mathf.Sin(localX * 12.5f + localY * 4.8f), 2f);
            float centreWash = Mathf.Exp(-(localX * localX) / 0.045f)
                * body * depositHeight * 0.18f;
            return currentHeight + body * ribs * depositHeight - centreWash;
        }

        private static float RelictShoreline(float radius, float x, float y,
                                             float centreX, float centreY,
                                             float amplitude)
        {
            float angle = Mathf.Atan2(y - centreY, x - centreX);
            float breakup = 0.68f + 0.32f
                * Mathf.Sin(angle * 5f + centreX * 0.021f);
            float warp = (Fbm(x * 0.058f + 71f, y * 0.058f + 13f) - 0.5f) * 0.035f;
            float outerA = QuarryBench(radius + warp, 1.18f, 0.045f);
            float outerB = QuarryBench(radius - warp * 0.7f, 1.36f, 0.042f);
            return (outerA + outerB * 0.62f) * breakup * amplitude;
        }

        private static float RelictShorelinePeak(float centreX, float centreY,
                                                 float radiusX, float radiusY,
                                                 float amplitude)
        {
            float peak = 0f;
            for (int i = 0; i < 12; i++)
            {
                float angle = i / 12f * Mathf.PI * 2f;
                float x = centreX + Mathf.Cos(angle) * radiusX * 1.18f;
                float y = centreY + Mathf.Sin(angle) * radiusY * 1.18f;
                peak = Mathf.Max(peak,
                    RelictShoreline(1.18f, x, y, centreX, centreY, amplitude));
            }
            return peak;
        }

        private static float ErosionRibbon(float currentHeight, float x, float y,
                                           Vector2[] path, float halfWidth,
                                           float depth, float shoulderHeight)
        {
            float distance = DistanceToCatmullRomPath(new Vector2(x, y), path, 6);
            float centreX = (path[0].x + path[path.Length - 1].x) * 0.5f;
            float centreY = (path[0].y + path[path.Length - 1].y) * 0.5f;
            float radiusX = Mathf.Abs(path[0].x - path[path.Length - 1].x) * 0.72f + 10f;
            float radiusY = Mathf.Abs(path[0].y - path[path.Length - 1].y) * 0.72f + 10f;
            float mask = Gaussian(x, y, centreX, centreY, radiusX, radiusY);
            float irregular = 0.82f + (Fbm(x * 0.103f + 31f,
                y * 0.103f + 97f) - 0.5f) * 0.36f;
            float groove = Mathf.Exp(-(distance * distance)
                / Mathf.Max(0.01f, halfWidth * halfWidth)) * irregular;
            float shoulderDelta = (distance - halfWidth * 1.65f)
                / Mathf.Max(0.1f, halfWidth * 0.48f);
            float shoulder = Mathf.Exp(-(shoulderDelta * shoulderDelta));
            return currentHeight - groove * mask * depth
                + shoulder * mask * shoulderHeight;
        }

        private static float HydraulicChannel(float currentHeight, float x, float y,
                                              Vector2[] path, float halfWidth,
                                              float depth, float bankHeight)
        {
            float progress;
            float distance = DistanceAndProgressToPolyline(
                new Vector2(x, y), path, out progress);
            float widthWave = halfWidth * (0.88f + 0.16f
                * Mathf.Sin(progress * Mathf.PI * 5f + 0.4f));
            float centreX = (path[0].x + path[path.Length - 1].x) * 0.5f;
            float centreY = (path[0].y + path[path.Length - 1].y) * 0.5f;
            float mask = Gaussian(x, y, centreX, centreY,
                Mathf.Abs(path[0].x - path[path.Length - 1].x) * 0.76f + 13f,
                Mathf.Abs(path[0].y - path[path.Length - 1].y) * 0.76f + 13f);
            float thalweg = Mathf.Exp(-(distance * distance)
                / Mathf.Max(0.01f, widthWave * widthWave));
            float endpointFade = 0.25f + 0.75f
                * Smooth01(progress / 0.16f)
                * (1f - Smooth01((progress - 0.84f) / 0.16f));
            float bankDelta = (distance - widthWave * 1.62f)
                / Mathf.Max(0.1f, widthWave * 0.48f);
            float banks = Mathf.Exp(-(bankDelta * bankDelta));
            return currentHeight - thalweg * mask * depth * endpointFade
                + banks * mask * bankHeight * endpointFade;
        }

        private static float WetlandShoreline(float radius, float x, float y,
                                              float centreX, float centreY,
                                              float amplitude)
        {
            float angle = Mathf.Atan2(y - centreY, x - centreX);
            float breakup = 0.56f + 0.44f
                * Mathf.Pow(Mathf.Sin(angle * 4f + centreX * 0.017f), 2f);
            float warp = (Fbm(x * 0.074f + 23f, y * 0.074f + 83f) - 0.5f) * 0.050f;
            float lip = QuarryBench(radius + warp, 1.04f, 0.085f);
            float shelf = QuarryBench(radius - warp * 0.55f, 0.83f, 0.14f);
            return (lip + shelf * 0.22f) * breakup * amplitude;
        }

        private static float WetlandShorelinePeak(float centreX, float centreY,
                                                  float radiusX, float radiusY,
                                                  float amplitude)
        {
            float peak = 0f;
            for (int i = 0; i < 12; i++)
            {
                float angle = i / 12f * Mathf.PI * 2f;
                float x = centreX + Mathf.Cos(angle) * radiusX * 1.04f;
                float y = centreY + Mathf.Sin(angle) * radiusY * 1.04f;
                peak = Mathf.Max(peak,
                    WetlandShoreline(1.04f, x, y, centreX, centreY, amplitude));
            }
            return peak;
        }

        private static float AlluvialSplay(float currentHeight, float x, float y,
                                           float centreX, float centreY,
                                           float radiusX, float radiusY,
                                           float angleDegrees, float depositHeight)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - centreX;
            float dy = y - centreY;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float radius = Mathf.Sqrt(localX * localX + localY * localY);
            float mask = 1f - Smooth01((radius - 0.66f) / 0.34f);
            float lobes = 0.70f + 0.30f
                * Mathf.Pow(Mathf.Sin(localX * 8.5f + localY * 2.8f), 2f);
            float distributaries = Mathf.Pow(Mathf.Max(0f,
                Mathf.Cos(localX * 10.5f + localY * 1.8f)), 7f);
            return currentHeight + mask * depositHeight
                * (lobes - distributaries * 1.10f);
        }

        private static float AlluvialDistributaryRelief(float centreX, float centreY,
                                                        float radiusX, float radiusY,
                                                        float angleDegrees,
                                                        float depositHeight)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float dx = Mathf.Cos(angle) * radiusX * 0.35f;
            float dy = Mathf.Sin(angle) * radiusX * 0.35f;
            float centre = AlluvialSplay(0f, centreX, centreY,
                centreX, centreY, radiusX, radiusY, angleDegrees, depositHeight);
            float sides = (AlluvialSplay(0f, centreX + dx, centreY + dy,
                    centreX, centreY, radiusX, radiusY, angleDegrees, depositHeight)
                + AlluvialSplay(0f, centreX - dx, centreY - dy,
                    centreX, centreY, radiusX, radiusY, angleDegrees, depositHeight)) * 0.5f;
            return sides - centre;
        }

        private static float TerraceSpread(RoaGlobalMapRelief asset,
                                           float x, float y, float delta)
        {
            float minimum = asset.HeightAt(x, y);
            float maximum = minimum;
            float[] samples =
            {
                asset.HeightAt(x + delta, y), asset.HeightAt(x - delta, y),
                asset.HeightAt(x, y + delta), asset.HeightAt(x, y - delta)
            };
            for (int i = 0; i < samples.Length; i++)
            {
                minimum = Mathf.Min(minimum, samples[i]);
                maximum = Mathf.Max(maximum, samples[i]);
            }
            return maximum - minimum;
        }

        private static float OrientedRingMean(RoaGlobalMapRelief asset,
                                              float centreX, float centreY,
                                              float radiusX, float radiusY,
                                              float angleDegrees,
                                              float normalizedRadius)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            Vector2[] localSamples =
            {
                new Vector2(radiusX * normalizedRadius, 0f),
                new Vector2(-radiusX * normalizedRadius, 0f),
                new Vector2(0f, radiusY * normalizedRadius),
                new Vector2(0f, -radiusY * normalizedRadius)
            };
            float sum = 0f;
            for (int i = 0; i < localSamples.Length; i++)
            {
                float worldX = centreX + localSamples[i].x * cosine
                    - localSamples[i].y * sine;
                float worldY = centreY + localSamples[i].x * sine
                    + localSamples[i].y * cosine;
                sum += asset.HeightAt(worldX, worldY);
            }
            return sum / localSamples.Length;
        }

        private static float TalusCrossSlopeCrown(RoaGlobalMapRelief asset,
                                                  float centreX, float centreY,
                                                  float radiusX,
                                                  float angleDegrees,
                                                  float normalizedOffset)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float dx = Mathf.Cos(angle) * radiusX * normalizedOffset;
            float dy = Mathf.Sin(angle) * radiusX * normalizedOffset;
            float flanks = (asset.HeightAt(centreX + dx, centreY + dy)
                + asset.HeightAt(centreX - dx, centreY - dy)) * 0.5f;
            return asset.HeightAt(centreX, centreY) - flanks;
        }

        private static float CrossSectionDepth(RoaGlobalMapRelief asset,
                                               float centreX, float centreY,
                                               float sideX, float sideY)
        {
            float shoulders = (asset.HeightAt(centreX + sideX, centreY + sideY)
                + asset.HeightAt(centreX - sideX, centreY - sideY)) * 0.5f;
            return shoulders - asset.HeightAt(centreX, centreY);
        }

        private static float RadialFootRelief(RoaGlobalMapRelief asset, float angle)
        {
            float centreX = WidthPoints * 0.5f;
            float centreY = HeightPoints * 0.5f;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float foot = asset.HeightAt(centreX + cosine * 186f * 0.775f,
                centreY + sine * 146f * 0.775f);
            float inner = asset.HeightAt(centreX + cosine * 186f * 0.70f,
                centreY + sine * 146f * 0.70f);
            float outer = asset.HeightAt(centreX + cosine * 186f * 0.84f,
                centreY + sine * 146f * 0.84f);
            return foot - (inner + outer) * 0.5f;
        }

        private static float FinalRegionalSurfaceRelief(float x, float y)
        {
            float ore = Gaussian(x, y, 74f, 218f, 92f, 76f);
            float glass = Gaussian(x, y, 317f, 205f, 82f, 72f);
            float chalk = Gaussian(x, y, 312f, 91f, 88f, 67f);
            float zero = Gaussian(x, y, 191f, 58f, 116f, 53f);
            float middle = Gaussian(x, y, 191f, 157f, 125f, 73f);

            float oreStrata = Mathf.Sin(x * 0.205f + y * 0.066f + 0.8f)
                * (0.50f + 0.50f * Mathf.Sin(y * 0.041f - 1.2f)) * 0.012f;
            float glassFracture = (Mathf.Sin(x * 0.171f + y * 0.137f)
                + Mathf.Sin(x * 0.113f - y * 0.196f + 1.7f)) * 0.007f;
            float chalkRunnels = (Fbm(x * 0.047f + 51f, y * 0.071f + 17f) - 0.5f)
                * 0.030f;
            float zeroHummocks = (Fbm(x * 0.039f + 83f, y * 0.034f + 29f) - 0.5f)
                * 0.018f;
            float middleRoll = (Fbm(x * 0.032f + 7f, y * 0.036f + 61f) - 0.5f)
                * 0.015f;

            float nx = (x - WidthPoints * 0.5f) / 186f;
            float ny = (y - HeightPoints * 0.5f) / 146f;
            float radius = Mathf.Sqrt(nx * nx + ny * ny);
            float angle = Mathf.Atan2(ny, nx);
            float ringMask = Mathf.Exp(-Mathf.Pow((radius - 0.88f) / 0.095f, 2f));
            float ringGrain = Mathf.Sin(angle * 13f + radius * 31f)
                * ringMask * 0.010f;

            float regional = oreStrata * ore
                + glassFracture * glass
                + chalkRunnels * chalk
                + zeroHummocks * zero
                + middleRoll * middle
                + ringGrain;
            return Mathf.Clamp(regional, -0.032f, 0.032f);
        }

        private static float TesmaGradeAtY(float y)
        {
            if (y <= 7f) return -0.24f;
            if (y <= 34f) return Mathf.Lerp(-0.24f, -0.52f,
                Mathf.InverseLerp(7f, 34f, y));
            if (y <= 57f) return Mathf.Lerp(-0.52f, -0.80f,
                Mathf.InverseLerp(34f, 57f, y));
            if (y <= 79f) return Mathf.Lerp(-0.80f, -0.65f,
                Mathf.InverseLerp(57f, 79f, y));
            if (y <= 98f) return Mathf.Lerp(-0.65f, -0.52f,
                Mathf.InverseLerp(79f, 98f, y));
            if (y <= 116f) return Mathf.Lerp(-0.52f, -0.43f,
                Mathf.InverseLerp(98f, 116f, y));
            if (y <= 135f) return Mathf.Lerp(-0.43f, -0.36f,
                Mathf.InverseLerp(116f, 135f, y));
            if (y <= 154f) return Mathf.Lerp(-0.36f, -0.29f,
                Mathf.InverseLerp(135f, 154f, y));
            if (y <= 173f) return Mathf.Lerp(-0.29f, -0.23f,
                Mathf.InverseLerp(154f, 173f, y));
            if (y <= 189f) return Mathf.Lerp(-0.23f, -0.18f,
                Mathf.InverseLerp(173f, 189f, y));
            if (y <= 205f) return Mathf.Lerp(-0.18f, -0.13f,
                Mathf.InverseLerp(189f, 205f, y));
            if (y <= 223f) return Mathf.Lerp(-0.13f, -0.08f,
                Mathf.InverseLerp(205f, 223f, y));
            if (y <= 240f) return Mathf.Lerp(-0.08f, -0.02f,
                Mathf.InverseLerp(223f, 240f, y));
            if (y <= 253f) return Mathf.Lerp(-0.02f, 0.08f,
                Mathf.InverseLerp(240f, 253f, y));
            if (y <= 267f) return Mathf.Lerp(0.08f, 0.20f,
                Mathf.InverseLerp(253f, 267f, y));
            if (y <= 281f) return Mathf.Lerp(0.20f, 0.28f,
                Mathf.InverseLerp(267f, 281f, y));
            return Mathf.Lerp(0.28f, 0.34f,
                Mathf.InverseLerp(281f, 296f, y));
        }

        private static float TesmaChannelWidthAtY(float y)
        {
            float width = 7.0f;
            width += GaussianAlongAxis(y, 191f, 43f) * 3.8f;
            width += GaussianAlongAxis(y, 94f, 27f) * 2.8f;
            width += GaussianAlongAxis(y, 58f, 15f) * 2.5f;
            width -= GaussianAlongAxis(y, 238f, 19f) * 2.0f;
            width -= GaussianAlongAxis(y, 127f, 17f) * 1.4f;
            return Mathf.Clamp(width, 4.8f, 12.5f);
        }

        private static float GaussianAlongAxis(float value, float centre, float radius)
        {
            float normalized = (value - centre) / Mathf.Max(0.001f, radius);
            return Mathf.Exp(-(normalized * normalized));
        }

        private static float OutlineRadius(float angle)
        {
            float sectorShape =
                AngularBump(angle, -2.42f, 0.34f) * 0.016f // Ore north-west projection
                - AngularBump(angle, -1.92f, 0.20f) * 0.010f // northern broken bay
                + AngularBump(angle, -0.72f, 0.31f) * 0.017f // Glasslands shoulder
                - AngularBump(angle, -0.18f, 0.22f) * 0.009f // eastern fracture notch
                + AngularBump(angle, 0.58f, 0.34f) * 0.018f // Chalk promontory
                + AngularBump(angle, 1.47f, 0.27f) * 0.008f // southern outlet apron
                + AngularBump(angle, 2.28f, 0.34f) * 0.014f // Zero south-west shelf
                - AngularBump(angle, 2.88f, 0.22f) * 0.008f; // western caravan notch
            return 0.978f
                + Mathf.Sin(angle * 2f - 0.20f) * 0.016f
                + Mathf.Sin(angle * 3f + 0.35f) * 0.012f
                + Mathf.Sin(angle * 7f - 1.10f) * 0.009f
                + Mathf.Sin(angle * 13f + 0.80f) * 0.005f
                + Mathf.Sin(angle * 19f - 0.55f) * 0.0035f
                + Mathf.Sin(angle * 29f + 1.20f) * 0.0020f
                + sectorShape;
        }

        private static float AngularBump(float angle, float centre, float width)
        {
            float delta = Mathf.Atan2(Mathf.Sin(angle - centre),
                Mathf.Cos(angle - centre));
            float normalized = delta / Mathf.Max(0.001f, width);
            return Mathf.Exp(-(normalized * normalized));
        }

        private static float SideWallFloor(float angle)
        {
            float strata = 0.5f + 0.5f
                * Mathf.Sin(angle * 5f - 0.35f)
                * Mathf.Sin(angle * 9f + 0.70f);
            return -0.92f - strata * 0.085f;
        }

        private static float EdgeFootProfile(float radius, float angle,
                                             float x, float y)
        {
            float warp = (Fbm(x * 0.041f + 131f, y * 0.041f + 17f) - 0.5f)
                * 0.020f;
            float sector = 0.76f + 0.16f * Mathf.Sin(angle * 4f + 0.55f)
                + 0.08f * Mathf.Sin(angle * 9f - 0.20f);
            float toe = QuarryBench(radius + warp, 0.775f, 0.035f);
            float apron = QuarryBench(radius - warp * 0.55f, 0.735f, 0.060f);
            float radialFurrows = Mathf.Pow(Mathf.Max(0f,
                Mathf.Cos(angle * 17f + radius * 43f)), 9f);
            float scarpFace = QuarryBench(radius + warp * 0.35f, 0.905f, 0.070f);
            float factoryProtection = 1f - Gaussian(x, y,
                128f, 244f, 17f, 12f) * 0.99f;
            return (toe * sector * 0.040f + apron * sector * 0.017f
                - scarpFace * radialFurrows * 0.024f) * factoryProtection;
        }

        private static float Fbm(float x, float y)
        {
            float value = 0f;
            float weight = 0.58f;
            float total = 0f;
            for (int octave = 0; octave < 4; octave++)
            {
                value += Mathf.PerlinNoise(x + 19.37f, y + 71.91f) * weight;
                total += weight;
                x = x * 2.03f + 13.7f;
                y = y * 2.03f - 8.9f;
                weight *= 0.48f;
            }
            return value / Mathf.Max(0.0001f, total);
        }

        private static float Gaussian(float x, float y, float cx, float cy,
                                      float radiusX, float radiusY)
        {
            float dx = (x - cx) / Mathf.Max(0.001f, radiusX);
            float dy = (y - cy) / Mathf.Max(0.001f, radiusY);
            return Mathf.Exp(-(dx * dx + dy * dy) * 2f);
        }

        private static float EllipticalRadius(float x, float y, float cx, float cy,
                                              float radiusX, float radiusY)
        {
            float dx = (x - cx) / Mathf.Max(0.001f, radiusX);
            float dy = (y - cy) / Mathf.Max(0.001f, radiusY);
            return Mathf.Sqrt(dx * dx + dy * dy);
        }

        private static float OrientedPlateMask(float x, float y, float cx, float cy,
                                               float radiusX, float radiusY,
                                               float angleDegrees, float edgeWidth)
        {
            float angle = angleDegrees * Mathf.Deg2Rad;
            float cosine = Mathf.Cos(angle);
            float sine = Mathf.Sin(angle);
            float dx = x - cx;
            float dy = y - cy;
            float localX = (dx * cosine + dy * sine) / Mathf.Max(0.001f, radiusX);
            float localY = (-dx * sine + dy * cosine) / Mathf.Max(0.001f, radiusY);
            float superEllipse = Mathf.Pow(
                Mathf.Pow(Mathf.Abs(localX), 4f) + Mathf.Pow(Mathf.Abs(localY), 4f), 0.25f);
            float inner = 1f - Mathf.Clamp(edgeWidth, 0.05f, 0.45f);
            return 1f - Smooth01((superEllipse - inner) / Mathf.Max(0.01f, 1f - inner));
        }

        private static float KarstBowl(float x, float y, float cx, float cy,
                                      float radiusX, float radiusY,
                                      float depth, float rimHeight)
        {
            float radius = EllipticalRadius(x, y, cx, cy, radiusX, radiusY);
            float floor = Mathf.Exp(-(radius * radius) * 2.25f) * depth;
            float rim = QuarryBench(radius, 1f, 0.18f) * rimHeight;
            return rim - floor;
        }

        private static float DistanceToSegment(Vector2 point, Vector2 a, Vector2 b)
        {
            Vector2 ab = b - a;
            float length = ab.sqrMagnitude;
            if (length < 0.0001f) return Vector2.Distance(point, a);
            float t = Mathf.Clamp01(Vector2.Dot(point - a, ab) / length);
            return Vector2.Distance(point, a + ab * t);
        }

        private static float DistanceToPolyline(Vector2 point, Vector2[] points)
        {
            float distance = 999f;
            for (int i = 1; i < points.Length; i++)
                distance = Mathf.Min(distance,
                    DistanceToSegment(point, points[i - 1], points[i]));
            return distance;
        }

        private static float DistanceAndProgressToPolyline(Vector2 point, Vector2[] points,
                                                           out float progress)
        {
            float totalLength = 0f;
            for (int i = 1; i < points.Length; i++)
                totalLength += Vector2.Distance(points[i - 1], points[i]);

            float bestDistance = 999f;
            float bestProgress = 0f;
            float travelled = 0f;
            for (int i = 1; i < points.Length; i++)
            {
                Vector2 a = points[i - 1];
                Vector2 b = points[i];
                Vector2 ab = b - a;
                float segmentLength = ab.magnitude;
                float t = segmentLength > 0.0001f
                    ? Mathf.Clamp01(Vector2.Dot(point - a, ab) / (segmentLength * segmentLength))
                    : 0f;
                float distance = Vector2.Distance(point, a + ab * t);
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    bestProgress = (travelled + segmentLength * t)
                        / Mathf.Max(0.0001f, totalLength);
                }
                travelled += segmentLength;
            }
            progress = Mathf.Clamp01(bestProgress);
            return bestDistance;
        }

        private static float DistanceToCatmullRomPath(Vector2 point, Vector2[] points,
                                                       int subdivisions)
        {
            float distance = 999f;
            int last = points.Length - 1;
            for (int i = 0; i < last; i++)
            {
                Vector2 p0 = points[Mathf.Max(0, i - 1)];
                Vector2 p1 = points[i];
                Vector2 p2 = points[i + 1];
                Vector2 p3 = points[Mathf.Min(last, i + 2)];
                Vector2 previous = p1;
                for (int step = 1; step <= subdivisions; step++)
                {
                    float t = step / (float)subdivisions;
                    float t2 = t * t;
                    float t3 = t2 * t;
                    Vector2 current = 0.5f * ((2f * p1)
                        + (-p0 + p2) * t
                        + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2
                        + (-p0 + 3f * p1 - 3f * p2 + p3) * t3);
                    distance = Mathf.Min(distance,
                        DistanceToSegment(point, previous, current));
                    previous = current;
                }
            }
            return distance;
        }

        private static float Terraced01(float value, int steps)
        {
            value = Mathf.Clamp01(value);
            float scaled = value * steps;
            float level = Mathf.Floor(scaled);
            float local = scaled - level;
            float transition = Smooth01((local - 0.66f) / 0.24f);
            return Mathf.Clamp01((level + transition) / Mathf.Max(1, steps));
        }

        private static float QuarryBench(float radius, float centre, float width)
        {
            float delta = (radius - centre) / Mathf.Max(0.001f, width);
            return Mathf.Exp(-(delta * delta));
        }

        private static float Smooth01(float value)
        {
            value = Mathf.Clamp01(value);
            return value * value * (3f - 2f * value);
        }

        private static void EnsureAssetFolders()
        {
            if (!AssetDatabase.IsValidFolder("Assets/Art/Kromka/Meshes"))
                AssetDatabase.CreateFolder("Assets/Art/Kromka", "Meshes");
            if (!AssetDatabase.IsValidFolder("Assets/Resources/RealmOfAshes"))
                AssetDatabase.CreateFolder("Assets/Resources", "RealmOfAshes");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.InvalidOperationException(message);
        }
    }
}
