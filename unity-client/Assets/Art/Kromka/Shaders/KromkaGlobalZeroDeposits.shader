Shader "Realm of Ashes/Kromka Global Zero Deposits"
{
    Properties
    {
        _MainTex ("Direct MEP Peat Surface", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Wet Soil", 2D) = "gray" {}
        _Tint ("Deposit Tint", Color) = (0.26, 0.30, 0.12, 1)
        _DarkTint ("Saturated Tint", Color) = (0.03, 0.06, 0.035, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 3.5
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.42
        _Opacity ("Opacity", Range(0.05, 1)) = 0.58
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.32
        _Organic ("Peat Organic", Range(0, 1)) = 0.70
        _Toxicity ("Chemical Toxicity", Range(0, 1)) = 0.30
        _Wetness ("Wet Saturation", Range(0, 1)) = 0.76
        _OilSheen ("Hydrocarbon Sheen", Range(0, 1)) = 0.10
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-42"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardZeroDeposits"
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

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float4 _DarkTint;
                float _DetailTiling;
                float _MacroTiling;
                float _Opacity;
                float _EdgeFade;
                float _Organic;
                float _Toxicity;
                float _Wetness;
                float _OilSheen;
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
                half3 peat = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.15, _Seed * 0.29)).rgb;
                half3 soil = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.21, _Seed * 0.08)).rgb;
                half peatLuma = dot(peat, half3(0.299, 0.587, 0.114));
                half soilLuma = dot(soil, half3(0.299, 0.587, 0.114));
                half seamNoise = sin(input.uv.y * 4.31 + _Seed * 1.77) * 0.5 + 0.5;
                half organicMask = smoothstep(0.18, 0.80,
                    peatLuma * 0.47 + soilLuma * 0.31 + seamNoise * 0.22);
                half3 organic = lerp(soil, peat, 0.62) * _Tint.rgb * 1.54;
                organic = lerp(organic, _DarkTint.rgb * (0.78 + peat * 0.30),
                    _Organic * (1.0 - organicMask) * 0.72);
                half chemicalMask = saturate((1.0 - peatLuma) * 0.50
                    + seamNoise * 0.50) * _Toxicity;
                half3 chemical = organic * half3(0.82, 1.24, 0.42)
                    + half3(0.018, 0.032, 0.0);
                half3 albedo = lerp(organic, chemical, chemicalMask * 0.76);
                albedo = lerp(albedo, albedo * 0.72 + _DarkTint.rgb * 0.28,
                    _Wetness * (0.28 + soilLuma * 0.30));
                half sheen = smoothstep(0.62, 0.94,
                    frac(seamNoise * 0.73 + soilLuma * 0.61 + _Seed * 0.11));
                albedo += half3(0.04, 0.11, 0.13) * sheen * _OilSheen;
                albedo *= lerp(0.78, 1.14, saturate(input.uv.x));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.72;
                half3 direct = mainLight.color * (0.26 + diffuse * 0.74);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.12, 0.84,
                    organicMask + seamNoise * (0.16 + _Organic * 0.24));
                half alpha = _Opacity * band * lerp(0.30, 1.0, broken)
                    * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
