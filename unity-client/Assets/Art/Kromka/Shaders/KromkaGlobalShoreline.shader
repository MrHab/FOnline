Shader "Realm of Ashes/Kromka Global Shoreline"
{
    Properties
    {
        _MainTex ("Direct MEP Shore Surface", 2D) = "white" {}
        _Tint ("Dry Tint", Color) = (0.64, 0.56, 0.42, 1)
        _DarkTint ("Deposited Tint", Color) = (0.23, 0.20, 0.14, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 8)) = 2.6
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.38
        _Opacity ("Opacity", Range(0.1, 1)) = 0.74
        _EdgeFade ("Edge Fade", Range(0.05, 0.8)) = 0.32
        _Breakup ("Broken Waterline", Range(0, 1)) = 0.5
        _Wetness ("Wet Silt", Range(0, 1)) = 0.0
        _Toxicity ("Chemical Crust", Range(0, 1)) = 0.0
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-50"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardShoreline"
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

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float4 _DarkTint;
                float _DetailTiling;
                float _MacroTiling;
                float _Opacity;
                float _EdgeFade;
                float _Breakup;
                float _Wetness;
                float _Toxicity;
                float _Seed;
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

            half4 Frag(Varyings input) : SV_Target
            {
                float2 worldUv = input.positionWS.xz;
                half3 detail = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.19, _Seed * 0.31)).rgb;
                half3 macro = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.07, _Seed * 0.13)).rgb;
                half luma = dot(detail, half3(0.299, 0.587, 0.114));
                half longitudinal = sin(input.uv.y * 3.17 + _Seed * 1.91) * 0.5 + 0.5;
                half deposit = smoothstep(0.23, 0.78,
                    luma * 0.54 + longitudinal * 0.28 + macro.r * 0.18);
                half3 baseAlbedo = lerp(detail, macro, 0.31) * _Tint.rgb * 1.72;
                half3 deposited = lerp(_DarkTint.rgb, baseAlbedo,
                    deposit * lerp(0.42, 0.76, _Toxicity));
                half wetDarken = _Wetness * (0.16 + (1.0 - luma) * 0.17);
                half3 albedo = deposited * (1.0 - wetDarken);
                albedo = lerp(albedo,
                    albedo * half3(0.72, 0.86, 0.18) + half3(0.020, 0.018, 0.0),
                    _Toxicity * (0.38 + deposit * 0.16));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.76;
                half3 direct = mainLight.color * (0.30 + diffuse * 0.70);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.14, 0.77,
                    deposit + longitudinal * _Breakup * 0.38);
                half alpha = _Opacity * band * lerp(0.16, 1.0, broken);
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
