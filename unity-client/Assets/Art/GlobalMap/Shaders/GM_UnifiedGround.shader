Shader "Universal Render Pipeline/Realm of Ashes/Global Map Unified Ground"
{
    // Земля глобальной карты: песчаный берег на западе переходит в тёмную
    // пустошь. Мировые планарные UV — бесшовные стыки тайлов конструктивно.
    // Анти-тайлинг у обоих слоёв: смесь двух выборок (прямой и повёрнутой
    // на 90° с другим шагом) не имеет общего периода; макро-подмес и
    // низкочастотная вариация прячут остаток. Граница песка не прямая:
    // порог по X возмущается шумом (рваная кромка), ширина и рваность
    // настраиваются.
    Properties
    {
        _SandMap ("Sand A (берег)", 2D) = "white" {}
        _SandMapB ("Sand B (берег)", 2D) = "white" {}
        _DesertMap ("Desert base (пустошь)", 2D) = "white" {}
        _Tint ("Tint", Color) = (1, 1, 1, 1)
        _DetailTiling ("Detail tiling (повторов на юнит)", Float) = 0.18
        _MacroTiling ("Macro tiling", Float) = 0.033
        _MacroBlend ("Macro blend", Range(0, 1)) = 0.45
        _VariationStrength ("Variation strength", Range(0, 1)) = 0.35
        _Contrast ("Contrast", Range(0.5, 3)) = 1.6
        _ShoreX ("Shore X (мир)", Float) = -27
        _ShoreWidth ("Shore width", Float) = 6
        _ShoreJitter ("Shore jitter", Float) = 5
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_SandMap);
            SAMPLER(sampler_SandMap);
            TEXTURE2D(_SandMapB);
            SAMPLER(sampler_SandMapB);
            TEXTURE2D(_DesertMap);
            SAMPLER(sampler_DesertMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _SandMap_ST;
                float4 _SandMapB_ST;
                float4 _DesertMap_ST;
                half4 _Tint;
                float _DetailTiling;
                float _MacroTiling;
                half _MacroBlend;
                half _VariationStrength;
                half _Contrast;
                float _ShoreX;
                float _ShoreWidth;
                float _ShoreJitter;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half fogFactor : TEXCOORD2;
                float4 shadowCoord : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(input.normalOS);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = normals.normalWS;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                output.shadowCoord = GetShadowCoord(positions);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 world = input.positionWS.xz;
                float2 rotated = float2(-world.y, world.x);
                float tiling = max(0.001, _DetailTiling);

                // Берег: две разные песчаные текстуры без общего периода.
                half3 sandA = SAMPLE_TEXTURE2D(_SandMap, sampler_SandMap,
                    world * tiling).rgb;
                half3 sandB = SAMPLE_TEXTURE2D(_SandMapB, sampler_SandMapB,
                    rotated * tiling * 0.83 + 0.37).rgb;
                half3 sand = lerp(sandA, sandB, 0.5h);

                // Пустошь: та же база прямо и повёрнуто + макро-подмес.
                half3 desertA = SAMPLE_TEXTURE2D(_DesertMap, sampler_DesertMap,
                    world * tiling * 1.09).rgb;
                half3 desertB = SAMPLE_TEXTURE2D(_DesertMap, sampler_DesertMap,
                    rotated * tiling * 0.77 + 0.21).rgb;
                half3 desert = lerp(desertA, desertB, 0.5h);
                half3 macro = SAMPLE_TEXTURE2D(_DesertMap, sampler_DesertMap,
                    world * max(0.0001, _MacroTiling) + 0.19).rgb;
                desert = lerp(desert, macro, _MacroBlend);

                // Рваная береговая линия: порог по X возмущается шумом
                // вдоль побережья — граница гуляет, а не режет линейкой.
                half shoreNoise = SAMPLE_TEXTURE2D(_SandMap, sampler_SandMap,
                    world * 0.021 + 0.53).g;
                float shore = _ShoreX + (shoreNoise - 0.5) * 2.0 * _ShoreJitter;
                half t = smoothstep(shore, shore + max(0.5, _ShoreWidth),
                    input.positionWS.x);
                half3 albedo = lerp(sand, desert, t);

                // Низкочастотная вариация и контраст вокруг локального
                // среднего СВОЕГО слоя: возвращают рисунок, съеденный
                // мипмапами, не выдувая светлый песок в клип.
                half varSand = dot(SAMPLE_TEXTURE2D(_SandMap, sampler_SandMap,
                    world * 0.013 + 0.41).rgb, half3(0.33h, 0.34h, 0.33h));
                half varDesert = dot(SAMPLE_TEXTURE2D(_DesertMap, sampler_DesertMap,
                    world * 0.011 + 0.71).rgb, half3(0.33h, 0.34h, 0.33h));
                half varLum = lerp(varSand, varDesert, t);
                albedo *= lerp(1.0h, 0.4h + varLum * 0.6h, _VariationStrength);
                albedo = saturate((albedo - varLum) * _Contrast + varLum);
                albedo *= _Tint.rgb;

                Light mainLight = GetMainLight(input.shadowCoord);
                half3 normalWS = normalize(input.normalWS);
                half ndl = saturate(dot(normalWS, mainLight.direction));
                half shadow = mainLight.distanceAttenuation * mainLight.shadowAttenuation;
                half3 lighting = SampleSH(normalWS) + mainLight.color * ndl * shadow;
                half3 color = albedo * max(lighting, half3(0.02h, 0.02h, 0.02h));
                color = MixFog(color, input.fogFactor);
                return half4(color, 1.0h);
            }
            ENDHLSL
        }

        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
    }
}
