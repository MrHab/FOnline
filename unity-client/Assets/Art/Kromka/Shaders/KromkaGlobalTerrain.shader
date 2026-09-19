Shader "Realm of Ashes/Kromka Global Terrain"
{
    Properties
    {
        _BaseTex ("MEP Central Ground", 2D) = "white" {}
        _NorthTex ("MEP Northern Soil", 2D) = "white" {}
        _OreTex ("MEP Cracked Ore Soil", 2D) = "white" {}
        _GlassTex ("MEP Cold Mineral Ground", 2D) = "white" {}
        _ChalkTex ("MEP Chalk Sand", 2D) = "white" {}
        _ZeroTex ("MEP Dark Wet Soil", 2D) = "white" {}
        _CliffTex ("MEP Exposed Cliff", 2D) = "white" {}
        _WetTex ("MEP Saturated Soil", 2D) = "white" {}
        _GranuleTex ("MEP Mineral Granules", 2D) = "white" {}
        _DustTex ("MEP Fine Mineral Dust", 2D) = "white" {}
        _PeatTex ("MEP Peat Litter", 2D) = "white" {}
        _PatinaTex ("MEP Global Stone Patina", 2D) = "gray" {}
        _MicroDustTex ("MEP Global Micro Dust", 2D) = "gray" {}
        _BaseTint ("Central Tint", Color) = (0.64, 0.62, 0.43, 1)
        _NorthTint ("Northern Tint", Color) = (0.55, 0.58, 0.53, 1)
        _OreTint ("Ore Tint", Color) = (0.88, 0.39, 0.20, 1)
        _GlassTint ("Glass Tint", Color) = (0.46, 0.73, 0.74, 1)
        _ChalkTint ("Chalk Tint", Color) = (0.92, 0.86, 0.70, 1)
        _ZeroTint ("Zero Tint", Color) = (0.45, 0.51, 0.31, 1)
        _RingTint ("Silent Ring Tint", Color) = (0.48, 0.40, 0.32, 1)
        _CliffTint ("Exposed Cliff Tint", Color) = (0.62, 0.56, 0.48, 1)
        _WetTint ("Saturated Soil Tint", Color) = (1.12, 1.34, 1.10, 1)
        _OreDepositTint ("Ore Deposit Tint", Color) = (0.94, 0.46, 0.28, 1)
        _GlassDepositTint ("Glass Deposit Tint", Color) = (0.58, 0.77, 0.78, 1)
        _ChalkDepositTint ("Chalk Deposit Tint", Color) = (1.02, 0.99, 0.84, 1)
        _PeatDepositTint ("Peat Deposit Tint", Color) = (1.04, 1.10, 0.72, 1)
        _TextureTiling ("Strategic Tiling", Range(4, 32)) = 16
        _MacroTiling ("Macro Tiling", Range(1, 12)) = 5.1
        _MacroBlend ("Macro Texture Blend", Range(0, 0.6)) = 0.30
        _MacroVariation ("Macro Tone Variation", Range(0, 0.25)) = 0.11
        _BoundaryWarp ("Regional Boundary Warp", Range(0, 24)) = 16
        _TransitionWidth ("Regional Transition Width", Range(0.08, 0.8)) = 0.46
        _CliffTiling ("Cliff Triplanar Tiling", Range(0.2, 2)) = 0.75
        _SlopeStart ("Cliff Slope Start", Range(0.05, 0.7)) = 0.28
        _SlopeFull ("Cliff Slope Full", Range(0.2, 0.95)) = 0.66
        _WeatheringStart ("Height Weathering Start", Range(-0.2, 1)) = 0.50
        _WeatheringEnd ("Height Weathering End", Range(0.2, 1.4)) = 1.02
        _WeatheringStrength ("Height Weathering Strength", Range(0, 0.35)) = 0.16
        _RiverWetInner ("River Wet Core", Range(0.5, 6)) = 2.8
        _RiverWetOuter ("Floodplain Wet Edge", Range(5, 22)) = 13.5
        _WetBlend ("Wet Soil Blend", Range(0, 1)) = 0.66
        _WetDarkening ("Wet Soil Darkening", Range(0, 0.5)) = 0.08
        _BasinWetStrength ("Basin Wet Strength", Range(0, 1)) = 0.72
        _DepositTiling ("Deposit Detail Tiling", Range(8, 40)) = 23
        _DepositMacroTiling ("Deposit Macro Tiling", Range(2, 16)) = 8.2
        _DepositBreakup ("Deposit Edge Breakup", Range(0, 0.6)) = 0.38
        _OreDepositStrength ("Ore Deposit Strength", Range(0, 1)) = 0.42
        _GlassDepositStrength ("Glass Deposit Strength", Range(0, 1)) = 0.34
        _ChalkDepositStrength ("Chalk Deposit Strength", Range(0, 1)) = 0.34
        _PeatDepositStrength ("Peat Deposit Strength", Range(0, 1)) = 0.30
        _PatinaTiling ("Final Patina Detail Tiling", Range(8, 48)) = 31
        _PatinaMacroTiling ("Final Patina Macro Tiling", Range(2, 14)) = 7.4
        _PatinaStrength ("Final Patina Strength", Range(0, 0.3)) = 0.10
        _ChromaticCompression ("Final Chromatic Compression", Range(0, 0.3)) = 0.10
        _DustVeil ("Final Dry Dust Veil", Range(0, 0.25)) = 0.09
        _WashContrast ("Final Wash Contrast", Range(0, 0.25)) = 0.12
        _Roughness ("Roughness", Range(0, 1)) = 0.82
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }
            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_BaseTex);  SAMPLER(sampler_BaseTex);
            TEXTURE2D(_NorthTex); SAMPLER(sampler_NorthTex);
            TEXTURE2D(_OreTex);   SAMPLER(sampler_OreTex);
            TEXTURE2D(_GlassTex); SAMPLER(sampler_GlassTex);
            TEXTURE2D(_ChalkTex); SAMPLER(sampler_ChalkTex);
            TEXTURE2D(_ZeroTex);  SAMPLER(sampler_ZeroTex);
            TEXTURE2D(_CliffTex); SAMPLER(sampler_CliffTex);
            TEXTURE2D(_WetTex);   SAMPLER(sampler_WetTex);
            TEXTURE2D(_GranuleTex); SAMPLER(sampler_GranuleTex);
            TEXTURE2D(_DustTex);    SAMPLER(sampler_DustTex);
            TEXTURE2D(_PeatTex);    SAMPLER(sampler_PeatTex);
            TEXTURE2D(_PatinaTex);  SAMPLER(sampler_PatinaTex);
            TEXTURE2D(_MicroDustTex); SAMPLER(sampler_MicroDustTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseTint;
                float4 _NorthTint;
                float4 _OreTint;
                float4 _GlassTint;
                float4 _ChalkTint;
                float4 _ZeroTint;
                float4 _RingTint;
                float4 _CliffTint;
                float4 _WetTint;
                float4 _OreDepositTint;
                float4 _GlassDepositTint;
                float4 _ChalkDepositTint;
                float4 _PeatDepositTint;
                float _TextureTiling;
                float _MacroTiling;
                float _MacroBlend;
                float _MacroVariation;
                float _BoundaryWarp;
                float _TransitionWidth;
                float _CliffTiling;
                float _SlopeStart;
                float _SlopeFull;
                float _WeatheringStart;
                float _WeatheringEnd;
                float _WeatheringStrength;
                float _RiverWetInner;
                float _RiverWetOuter;
                float _WetBlend;
                float _WetDarkening;
                float _BasinWetStrength;
                float _DepositTiling;
                float _DepositMacroTiling;
                float _DepositBreakup;
                float _OreDepositStrength;
                float _GlassDepositStrength;
                float _ChalkDepositStrength;
                float _PeatDepositStrength;
                float _PatinaTiling;
                float _PatinaMacroTiling;
                float _PatinaStrength;
                float _ChromaticCompression;
                float _DustVeil;
                float _WashContrast;
                float _Roughness;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fogFactor : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(input.normalOS);
                output.positionHCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = normals.normalWS;
                output.uv = input.uv;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                return output;
            }

            float EllipseMask(float2 samplePoint, float2 centre, float2 maskRadius)
            {
                float2 delta = (samplePoint - centre) / maskRadius;
                return exp(-dot(delta, delta) * 2.0);
            }

            float Hash21(float2 value)
            {
                value = frac(value * float2(123.34, 456.21));
                value += dot(value, value + 45.32);
                return frac(value.x * value.y);
            }

            float ValueNoise(float2 value)
            {
                float2 cell = floor(value);
                float2 local = frac(value);
                float2 blend = local * local * (3.0 - 2.0 * local);
                float lower = lerp(Hash21(cell), Hash21(cell + float2(1.0, 0.0)), blend.x);
                float upper = lerp(Hash21(cell + float2(0.0, 1.0)),
                    Hash21(cell + float2(1.0, 1.0)), blend.x);
                return lerp(lower, upper, blend.y);
            }

            float2 OrganicPoint(float2 mapPoint)
            {
                float2 domain = mapPoint * 0.021;
                float2 warp = float2(
                    ValueNoise(domain + float2(11.7, 37.2)),
                    ValueNoise(domain + float2(73.1, 19.4))) - 0.5;
                return mapPoint + warp * _BoundaryWarp;
            }

            float OrganicWeight(float mask, float centre, float breakup)
            {
                float halfWidth = max(0.04, _TransitionWidth * 0.5);
                return smoothstep(centre - halfWidth, centre + halfWidth,
                    mask + breakup);
            }

            half3 SampleTwoScale(Texture2D source, SamplerState sourceSampler,
                                 float2 fineUv, float2 macroUv,
                                 half3 tint, float macroBias)
            {
                half3 fineSample = SAMPLE_TEXTURE2D(source, sourceSampler, fineUv).rgb;
                half3 macroSample = SAMPLE_TEXTURE2D(source, sourceSampler, macroUv).rgb;
                half blend = saturate(_MacroBlend + macroBias);
                return lerp(fineSample, macroSample, blend) * tint * 1.42;
            }

            half3 SampleCliff(float3 positionWS, half3 normalWS)
            {
                half2 sideWeights = abs(normalWS.xz);
                sideWeights /= max(0.001, sideWeights.x + sideWeights.y);
                float2 xFacingUv = positionWS.zy * _CliffTiling + float2(0.17, 0.43);
                float2 zFacingUv = positionWS.xy * _CliffTiling + float2(0.61, 0.29);
                half3 xFacing = SAMPLE_TEXTURE2D(_CliffTex, sampler_CliffTex, xFacingUv).rgb;
                half3 zFacing = SAMPLE_TEXTURE2D(_CliffTex, sampler_CliffTex, zFacingUv).rgb;
                return lerp(zFacing, xFacing, sideWeights.x) * _CliffTint.rgb * 1.52;
            }

            float SegmentDistance(float2 samplePoint, float2 startPoint, float2 endPoint)
            {
                float2 segment = endPoint - startPoint;
                float progress = saturate(dot(samplePoint - startPoint, segment)
                    / max(0.001, dot(segment, segment)));
                return length(samplePoint - (startPoint + segment * progress));
            }

            float TesmaDistance(float2 samplePoint)
            {
                float result = SegmentDistance(samplePoint, float2(205, 296), float2(206, 281));
                result = min(result, SegmentDistance(samplePoint, float2(206, 281), float2(205, 267)));
                result = min(result, SegmentDistance(samplePoint, float2(205, 267), float2(197, 253)));
                result = min(result, SegmentDistance(samplePoint, float2(197, 253), float2(191, 240)));
                result = min(result, SegmentDistance(samplePoint, float2(191, 240), float2(196, 223)));
                result = min(result, SegmentDistance(samplePoint, float2(196, 223), float2(205, 205)));
                result = min(result, SegmentDistance(samplePoint, float2(205, 205), float2(202, 189)));
                result = min(result, SegmentDistance(samplePoint, float2(202, 189), float2(194, 173)));
                result = min(result, SegmentDistance(samplePoint, float2(194, 173), float2(199, 154)));
                result = min(result, SegmentDistance(samplePoint, float2(199, 154), float2(209, 135)));
                result = min(result, SegmentDistance(samplePoint, float2(209, 135), float2(207, 116)));
                result = min(result, SegmentDistance(samplePoint, float2(207, 116), float2(202, 98)));
                result = min(result, SegmentDistance(samplePoint, float2(202, 98), float2(204, 79)));
                result = min(result, SegmentDistance(samplePoint, float2(204, 79), float2(205, 57)));
                result = min(result, SegmentDistance(samplePoint, float2(205, 57), float2(209, 34)));
                return min(result, SegmentDistance(samplePoint, float2(209, 34), float2(212, 7)));
            }

            float OreDepositDistance(float2 samplePoint)
            {
                float result = SegmentDistance(samplePoint, float2(31, 245), float2(50, 238));
                result = min(result, SegmentDistance(samplePoint, float2(50, 238), float2(68, 230)));
                result = min(result, SegmentDistance(samplePoint, float2(35, 205), float2(52, 213)));
                result = min(result, SegmentDistance(samplePoint, float2(52, 213), float2(70, 220)));
                result = min(result, SegmentDistance(samplePoint, float2(105, 258), float2(126, 254)));
                result = min(result, SegmentDistance(samplePoint, float2(126, 254), float2(145, 247)));
                result = min(result, SegmentDistance(samplePoint, float2(145, 247), float2(162, 238)));
                result = min(result, SegmentDistance(samplePoint, float2(91, 172), float2(111, 174)));
                result = min(result, SegmentDistance(samplePoint, float2(111, 174), float2(130, 181)));
                return min(result, SegmentDistance(samplePoint, float2(130, 181), float2(146, 190)));
            }

            float GlassDepositDistance(float2 samplePoint)
            {
                float result = SegmentDistance(samplePoint, float2(269, 248), float2(297, 230));
                result = min(result, SegmentDistance(samplePoint, float2(297, 230), float2(326, 223)));
                result = min(result, SegmentDistance(samplePoint, float2(326, 223), float2(351, 204)));
                result = min(result, SegmentDistance(samplePoint, float2(267, 184), float2(294, 171)));
                result = min(result, SegmentDistance(samplePoint, float2(294, 171), float2(326, 169)));
                result = min(result, SegmentDistance(samplePoint, float2(326, 169), float2(355, 145)));
                result = min(result, SegmentDistance(samplePoint, float2(266, 246), float2(279, 225)));
                result = min(result, SegmentDistance(samplePoint, float2(279, 225), float2(273, 205)));
                result = min(result, SegmentDistance(samplePoint, float2(273, 205), float2(288, 184)));
                result = min(result, SegmentDistance(samplePoint, float2(288, 184), float2(283, 161)));
                result = min(result, SegmentDistance(samplePoint, float2(283, 161), float2(296, 139)));
                result = min(result, SegmentDistance(samplePoint, float2(342, 246), float2(332, 225)));
                result = min(result, SegmentDistance(samplePoint, float2(332, 225), float2(347, 204)));
                result = min(result, SegmentDistance(samplePoint, float2(347, 204), float2(339, 184)));
                result = min(result, SegmentDistance(samplePoint, float2(339, 184), float2(354, 163)));
                return min(result, SegmentDistance(samplePoint, float2(354, 163), float2(349, 139)));
            }

            float ChalkDepositDistance(float2 samplePoint)
            {
                float result = SegmentDistance(samplePoint, float2(367, 119), float2(344, 111));
                result = min(result, SegmentDistance(samplePoint, float2(344, 111), float2(322, 103)));
                result = min(result, SegmentDistance(samplePoint, float2(322, 103), float2(300, 94)));
                result = min(result, SegmentDistance(samplePoint, float2(300, 94), float2(278, 88)));
                result = min(result, SegmentDistance(samplePoint, float2(349, 72), float2(329, 68)));
                result = min(result, SegmentDistance(samplePoint, float2(329, 68), float2(307, 72)));
                result = min(result, SegmentDistance(samplePoint, float2(307, 72), float2(286, 80)));
                result = min(result, SegmentDistance(samplePoint, float2(286, 80), float2(267, 88)));
                result = min(result, SegmentDistance(samplePoint, float2(247, 132), float2(269, 121)));
                result = min(result, SegmentDistance(samplePoint, float2(269, 121), float2(292, 111)));
                result = min(result, SegmentDistance(samplePoint, float2(292, 111), float2(316, 104)));
                return min(result, SegmentDistance(samplePoint, float2(316, 104), float2(339, 101)));
            }

            float ZeroPeatDistance(float2 samplePoint)
            {
                float result = SegmentDistance(samplePoint, float2(119, 52), float2(144, 54));
                result = min(result, SegmentDistance(samplePoint, float2(144, 54), float2(169, 59)));
                result = min(result, SegmentDistance(samplePoint, float2(169, 59), float2(193, 55)));
                result = min(result, SegmentDistance(samplePoint, float2(193, 55), float2(216, 45)));
                result = min(result, SegmentDistance(samplePoint, float2(216, 45), float2(239, 54)));
                result = min(result, SegmentDistance(samplePoint, float2(239, 54), float2(260, 68)));
                result = min(result, SegmentDistance(samplePoint, float2(115, 91), float2(129, 78)));
                result = min(result, SegmentDistance(samplePoint, float2(129, 78), float2(145, 67)));
                result = min(result, SegmentDistance(samplePoint, float2(273, 83), float2(260, 71)));
                return min(result, SegmentDistance(samplePoint, float2(260, 71), float2(249, 60)));
            }

            float DepositRibbon(float distanceToFeature, float innerWidth,
                                float outerWidth, float breakup)
            {
                float ribbon = 1.0 - smoothstep(innerWidth, outerWidth,
                    distanceToFeature + (breakup - 0.5) * _DepositBreakup * 20.0);
                float patchCoverage = smoothstep(0.28, 0.72, breakup);
                return saturate(ribbon * lerp(0.28, 1.0, patchCoverage));
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 mapPoint = input.uv * float2(380.0, 300.0);
                float2 tiled = input.uv * _TextureTiling;
                float2 macro = input.uv * _MacroTiling;
                float2 organicPoint = OrganicPoint(mapPoint);
                float boundaryBreakup = (ValueNoise(mapPoint * 0.057
                    + float2(31.4, 57.8)) - 0.5) * 0.24;

                half3 central = SampleTwoScale(_BaseTex, sampler_BaseTex,
                    tiled, macro + float2(0.17, 0.41), _BaseTint.rgb, 0.00);
                half3 north = SampleTwoScale(_NorthTex, sampler_NorthTex,
                    tiled * 0.93 + float2(0.19, 0.31),
                    float2(macro.y, -macro.x) + float2(0.73, 0.29),
                    _NorthTint.rgb, -0.03);
                half3 ore = SampleTwoScale(_OreTex, sampler_OreTex,
                    tiled * 0.84 + float2(0.37, 0.11),
                    float2(-macro.y, macro.x) * 0.91 + float2(0.37, 0.83),
                    _OreTint.rgb, 0.04);
                half3 glass = SampleTwoScale(_GlassTex, sampler_GlassTex,
                    tiled * 1.08 + float2(0.13, 0.47),
                    float2(macro.x + macro.y * 0.31, macro.y - macro.x * 0.19)
                        + float2(0.61, 0.17), _GlassTint.rgb, -0.01);
                half3 chalk = SampleTwoScale(_ChalkTex, sampler_ChalkTex,
                    tiled * 0.91 + float2(0.61, 0.23),
                    float2(-macro.x, -macro.y) * 1.07 + float2(0.29, 0.67),
                    _ChalkTint.rgb, 0.02);
                half3 zero = SampleTwoScale(_ZeroTex, sampler_ZeroTex,
                    tiled * 1.02 + float2(0.29, 0.67),
                    float2(macro.y + macro.x * 0.23, macro.x - macro.y * 0.27)
                        + float2(0.47, 0.91), _ZeroTint.rgb, 0.01);

                float northMask = EllipseMask(organicPoint, float2(190.0, 266.0),
                    float2(168.0, 55.0)) * smoothstep(218.0, 252.0, organicPoint.y);
                float oreMask = EllipseMask(organicPoint, float2(72.0, 218.0),
                    float2(104.0, 78.0));
                float glassMask = EllipseMask(organicPoint, float2(318.0, 205.0),
                    float2(91.0, 76.0));
                float chalkMask = EllipseMask(organicPoint, float2(310.0, 88.0),
                    float2(94.0, 69.0));
                float zeroMask = EllipseMask(organicPoint, float2(190.0, 55.0),
                    float2(125.0, 55.0));

                float northWeight = OrganicWeight(northMask, 0.36, boundaryBreakup * 0.55);
                float oreWeight = OrganicWeight(oreMask, 0.37, boundaryBreakup);
                float glassWeight = OrganicWeight(glassMask, 0.36, -boundaryBreakup * 0.85);
                float chalkWeight = OrganicWeight(chalkMask, 0.38, boundaryBreakup * 0.78);
                float zeroWeight = OrganicWeight(zeroMask, 0.39, -boundaryBreakup * 0.72);

                half3 albedo = central;
                albedo = lerp(albedo, north, northWeight);
                albedo = lerp(albedo, ore, oreWeight);
                albedo = lerp(albedo, glass, glassWeight);
                albedo = lerp(albedo, chalk, chalkWeight);
                albedo = lerp(albedo, zero, zeroWeight);

                float2 ringPoint = (organicPoint - float2(190.0, 150.0))
                    / float2(186.0, 146.0);
                float ringMask = smoothstep(0.76, 0.94,
                    length(ringPoint) + boundaryBreakup * 0.08);
                half3 ring = central * _RingTint.rgb * 1.62;
                albedo = lerp(albedo, ring, ringMask * 0.78);

                float macroTone = ValueNoise(mapPoint * 0.017 + float2(91.3, 14.7));
                albedo *= lerp(1.0 - _MacroVariation, 1.0 + _MacroVariation, macroTone);

                float depositFineNoise = ValueNoise(mapPoint * 0.094 + float2(27.3, 83.1));
                float depositMacroNoise = ValueNoise(mapPoint * 0.027 + float2(64.9, 12.6));
                float depositBreakup = saturate(depositFineNoise * 0.58
                    + depositMacroNoise * 0.42);
                float ringProtection = 1.0 - ringMask * 0.72;
                float oreDepositMask = DepositRibbon(OreDepositDistance(mapPoint),
                    2.8, 10.0, depositBreakup) * oreWeight * ringProtection;
                float glassDepositMask = DepositRibbon(GlassDepositDistance(mapPoint),
                    1.8, 7.5, 1.0 - depositBreakup) * glassWeight * ringProtection;
                float chalkDepositMask = DepositRibbon(ChalkDepositDistance(mapPoint),
                    3.2, 10.5, depositBreakup) * chalkWeight * ringProtection;
                float peatDepositMask = DepositRibbon(ZeroPeatDistance(mapPoint),
                    3.5, 12.0, 1.0 - depositBreakup) * zeroWeight * ringProtection;

                float2 depositFine = input.uv * _DepositTiling;
                float2 depositMacro = input.uv * _DepositMacroTiling;
                half3 granules = SampleTwoScale(_GranuleTex, sampler_GranuleTex,
                    depositFine * 0.92 + float2(0.19, 0.73),
                    float2(-depositMacro.y, depositMacro.x) + float2(0.31, 0.57),
                    half3(1.0, 1.0, 1.0), 0.03);
                half3 dust = SampleTwoScale(_DustTex, sampler_DustTex,
                    depositFine * 1.07 + float2(0.67, 0.21),
                    float2(depositMacro.y, -depositMacro.x) * 0.91
                        + float2(0.83, 0.37),
                    _ChalkDepositTint.rgb, -0.02);
                half3 peat = SampleTwoScale(_PeatTex, sampler_PeatTex,
                    depositFine * 0.86 + float2(0.41, 0.17),
                    float2(depositMacro.x + depositMacro.y * 0.21,
                        depositMacro.y - depositMacro.x * 0.18) + float2(0.29, 0.61),
                    _PeatDepositTint.rgb, 0.01);
                half3 oreDeposit = granules * _OreDepositTint.rgb * 1.18;
                half3 glassDeposit = granules * _GlassDepositTint.rgb * 1.08;
                albedo = lerp(albedo, oreDeposit,
                    oreDepositMask * _OreDepositStrength);
                albedo = lerp(albedo, glassDeposit,
                    glassDepositMask * _GlassDepositStrength);
                albedo = lerp(albedo, dust,
                    chalkDepositMask * _ChalkDepositStrength);
                albedo = lerp(albedo, peat,
                    peatDepositMask * _PeatDepositStrength);

                float tesmaDistance = TesmaDistance(mapPoint);
                float riverCore = 1.0 - smoothstep(0.7, _RiverWetInner, tesmaDistance);
                float floodplainWet = 1.0 - smoothstep(_RiverWetInner,
                    _RiverWetOuter, tesmaDistance);
                float northernBeds = max(EllipseMask(mapPoint, float2(157, 273), float2(34, 20)),
                    max(EllipseMask(mapPoint, float2(211, 276), float2(33, 21)),
                        EllipseMask(mapPoint, float2(249, 258), float2(30, 18))));
                float zeroBeds = max(EllipseMask(mapPoint, float2(151, 54), float2(32, 19)),
                    max(EllipseMask(mapPoint, float2(214, 43), float2(38, 17)),
                        max(EllipseMask(mapPoint, float2(257, 68), float2(30, 18)),
                            EllipseMask(mapPoint, float2(137, 82), float2(27, 16)))));
                float basinWet = smoothstep(0.10, 0.48, max(northernBeds, zeroBeds));
                float wetWeight = saturate(max(floodplainWet,
                    basinWet * _BasinWetStrength)
                    + boundaryBreakup * 0.08);
                half3 wetSoil = SampleTwoScale(_WetTex, sampler_WetTex,
                    tiled * 1.06 + float2(0.53, 0.37),
                    float2(-macro.y, macro.x) * 0.88 + float2(0.23, 0.71),
                    _WetTint.rgb, 0.03);
                albedo = lerp(albedo, wetSoil, wetWeight * _WetBlend);
                albedo *= 1.0 - wetWeight * _WetDarkening;
                albedo = lerp(albedo, albedo * half3(0.78, 0.93, 0.88),
                    riverCore * 0.30);

                half3 normalWS = normalize(input.normalWS);
                half slopeSignal = 1.0 - saturate(abs(normalWS.y));
                half slopeWeight = smoothstep(_SlopeStart, _SlopeFull, slopeSignal);
                half3 cliff = SampleCliff(input.positionWS, normalWS);
                cliff *= lerp(half3(1.0, 1.0, 1.0), half3(1.18, 0.78, 0.61),
                    oreWeight * 0.48);
                cliff *= lerp(half3(1.0, 1.0, 1.0), half3(0.78, 1.03, 1.08),
                    glassWeight * 0.34);
                cliff *= lerp(half3(1.0, 1.0, 1.0), half3(1.15, 1.10, 0.94),
                    chalkWeight * 0.38);
                albedo = lerp(albedo, cliff, slopeWeight * 0.86);

                half weathering = smoothstep(_WeatheringStart, _WeatheringEnd,
                    input.positionWS.y) * (1.0 - slopeWeight * 0.38);
                half3 weathered = albedo * 1.16 + half3(0.025, 0.022, 0.016);
                albedo = lerp(albedo, weathered,
                    weathering * _WeatheringStrength);

                // Texture iteration 20/20: a restrained, MEP-backed patina
                // compresses digital-looking regional colour without erasing it.
                // Wet ground, steep scarps and authored mineral ribbons remain
                // protected so their material hierarchy stays readable.
                half3 patinaFine = SAMPLE_TEXTURE2D(_PatinaTex, sampler_PatinaTex,
                    input.uv * _PatinaTiling + float2(0.37, 0.71)).rgb;
                half3 patinaMacro = SAMPLE_TEXTURE2D(_PatinaTex, sampler_PatinaTex,
                    float2(-input.uv.y, input.uv.x) * _PatinaMacroTiling
                        + float2(0.19, 0.43)).rgb;
                half3 microDust = SAMPLE_TEXTURE2D(_MicroDustTex, sampler_MicroDustTex,
                    input.uv * (_PatinaTiling * 0.81) + float2(0.61, 0.23)).rgb;
                half patinaLuma = dot(patinaFine, half3(0.299, 0.587, 0.114));
                half patinaMacroLuma = dot(patinaMacro, half3(0.299, 0.587, 0.114));
                half microDustLuma = dot(microDust, half3(0.299, 0.587, 0.114));
                half patinaBreakup = smoothstep(0.16, 0.84,
                    patinaLuma * 0.48 + patinaMacroLuma * 0.34
                        + depositFineNoise * 0.18);
                half protectedDeposits = saturate(max(max(oreDepositMask,
                    glassDepositMask), max(chalkDepositMask, peatDepositMask)));
                half dryFlat = (1.0 - wetWeight) * (1.0 - slopeWeight);
                half sourceLuma = dot(albedo, half3(0.299, 0.587, 0.114));
                half3 restrained = sourceLuma * half3(1.035, 1.005, 0.94);
                half compression = _ChromaticCompression
                    * lerp(0.62, 1.0, patinaMacroLuma)
                    * (1.0 - protectedDeposits * 0.42);
                albedo = lerp(albedo, restrained, compression);

                half3 patinaColour = lerp(patinaFine, patinaMacro, 0.43)
                    * half3(0.62, 0.59, 0.51) * 1.46;
                half patinaMask = _PatinaStrength * dryFlat
                    * (1.0 - protectedDeposits * 0.58)
                    * lerp(0.38, 1.0, patinaBreakup);
                albedo = lerp(albedo, patinaColour, patinaMask);

                half dustMask = _DustVeil * dryFlat
                    * smoothstep(0.20, 0.78, microDustLuma)
                    * lerp(0.48, 1.0, 1.0 - patinaBreakup);
                half3 dustColour = microDust * half3(0.72, 0.66, 0.54) * 1.42;
                albedo = lerp(albedo, dustColour, dustMask);

                half washNoise = ValueNoise(mapPoint * 0.041 + float2(17.9, 63.7));
                half washTone = lerp(1.0 - _WashContrast * 0.62,
                    1.0 + _WashContrast * 0.38,
                    saturate(washNoise * 0.62 + patinaBreakup * 0.38));
                albedo *= lerp(1.0, washTone, dryFlat * 0.82);

                float4 shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                Light mainLight = GetMainLight(shadowCoord);
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.72;
                half3 direct = mainLight.color
                    * (0.22 + diffuse * 0.78) * mainLight.shadowAttenuation;
                half3 lit = albedo * (ambient + direct);
                lit = MixFog(lit, input.fogFactor);
                return half4(lit, 1.0);
            }
            ENDHLSL
        }

        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
        UsePass "Universal Render Pipeline/Lit/DepthOnly"
    }
    FallBack Off
}
