Shader "Realm of Ashes/Kromka Global Transition Deposits"
{
    Properties
    {
        _MainTex ("Direct MEP Transition Soil", 2D) = "gray" {}
        _SecondaryTex ("Direct MEP Transition Stone", 2D) = "gray" {}
        _MineralTex ("Direct MEP Transition Mineral", 2D) = "white" {}
        _Tint ("Deposit Tint", Color) = (0.42, 0.38, 0.28, 1)
        _DarkTint ("Deposit Shadow Tint", Color) = (0.10, 0.085, 0.06, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 4.0
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.42
        _Opacity ("Opacity", Range(0.05, 1)) = 0.48
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.32
        _Oxide ("Ore Oxide", Range(0, 1)) = 0.2
        _WetWash ("Hydraulic Wash", Range(0, 1)) = 0.2
        _GlassDust ("Glassland Dust", Range(0, 1)) = 0.2
        _ChalkDust ("Chalk Dust", Range(0, 1)) = 0.2
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-44"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardTransitionDeposits"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_SecondaryTex); SAMPLER(sampler_SecondaryTex);
            TEXTURE2D(_MineralTex); SAMPLER(sampler_MineralTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float4 _DarkTint;
                float _DetailTiling;
                float _MacroTiling;
                float _Opacity;
                float _EdgeFade;
                float _Oxide;
                float _WetWash;
                float _GlassDust;
                float _ChalkDust;
                float _Seed;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fogFactor : TEXCOORD3;
                half4 color : COLOR;
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
                output.color = input.color;
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 worldUv = input.positionWS.xz;
                half3 soil = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.13, _Seed * 0.37)).rgb;
                half3 stone = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * (_DetailTiling * 0.62)
                        + float2(_Seed * 0.29, _Seed * 0.07)).rgb;
                half3 mineral = SAMPLE_TEXTURE2D(_MineralTex, sampler_MineralTex,
                    worldUv * _MacroTiling + float2(_Seed * 0.09, _Seed * 0.41)).rgb;

                half soilLuma = dot(soil, half3(0.299, 0.587, 0.114));
                half stoneLuma = dot(stone, half3(0.299, 0.587, 0.114));
                half mineralLuma = dot(mineral, half3(0.299, 0.587, 0.114));
                half flowNoise = sin(input.uv.y * 2.61 + _Seed * 1.79) * 0.5 + 0.5;
                half granular = smoothstep(0.16, 0.84,
                    soilLuma * 0.37 + stoneLuma * 0.36 + flowNoise * 0.27);
                half edge = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));

                half oxideMask = _Oxide * smoothstep(0.22, 0.76,
                    1.0 - soilLuma) * lerp(0.56, 1.0, granular);
                half wetMask = _WetWash * smoothstep(0.24, 0.75,
                    1.0 - mineralLuma) * lerp(0.52, 1.0, flowNoise);
                half glassMask = _GlassDust * smoothstep(0.25, 0.76,
                    stoneLuma) * lerp(0.58, 1.0, 1.0 - flowNoise);
                half chalkMask = _ChalkDust * smoothstep(0.30, 0.78,
                    mineralLuma) * lerp(0.60, 1.0, granular);

                half3 baseDeposit = lerp(soil, stone, 0.34 + granular * 0.22)
                    * _Tint.rgb * 1.62;
                half3 oxideDeposit = lerp(soil, mineral, 0.22)
                    * half3(0.55, 0.20, 0.09) * 1.84;
                half3 wetDeposit = lerp(soil, stone, 0.48)
                    * _DarkTint.rgb * 1.52;
                half3 glassDeposit = stone * lerp(_Tint.rgb,
                    half3(0.20, 0.43, 0.43), 0.42) * 1.58;
                half3 chalkDeposit = mineral * lerp(_Tint.rgb,
                    half3(0.75, 0.70, 0.58), 0.48) * 1.56;
                half3 albedo = lerp(baseDeposit, oxideDeposit, oxideMask * 0.64);
                albedo = lerp(albedo, wetDeposit, wetMask * 0.58);
                albedo = lerp(albedo, glassDeposit, glassMask * 0.62);
                albedo = lerp(albedo, chalkDeposit, chalkMask * 0.66);

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.73;
                half3 direct = mainLight.color * (0.27 + diffuse * 0.73);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half breakup = lerp(0.36, 1.0,
                    saturate(granular * 0.72 + flowNoise * 0.28));
                half alpha = _Opacity * edge * breakup * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
