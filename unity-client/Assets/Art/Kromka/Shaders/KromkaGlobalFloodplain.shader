Shader "Realm of Ashes/Kromka Global Floodplain"
{
    Properties
    {
        _MainTex ("Direct MEP Floodplain Vegetation", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Silt Ground", 2D) = "gray" {}
        _Tint ("Floodplain Tint", Color) = (0.46, 0.48, 0.24, 1)
        _DarkTint ("Trampled Tint", Color) = (0.12, 0.13, 0.07, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 3.4
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.42
        _Opacity ("Opacity", Range(0.05, 1)) = 0.56
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.34
        _Fertility ("Fertile Growth", Range(0, 1)) = 0.68
        _Silt ("Flood Silt", Range(0, 1)) = 0.60
        _Trample ("Human Wear", Range(0, 1)) = 0.26
        _Wetness ("Soil Wetness", Range(0, 1)) = 0.44
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-40"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardFloodplain"
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
                float _Fertility;
                float _Silt;
                float _Trample;
                float _Wetness;
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
                half3 grass = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.14, _Seed * 0.30)).rgb;
                half3 ground = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.22, _Seed * 0.08)).rgb;
                half grassLuma = dot(grass, half3(0.299, 0.587, 0.114));
                half groundLuma = dot(ground, half3(0.299, 0.587, 0.114));
                half furrowNoise = sin(input.uv.y * 4.09 + _Seed * 1.83) * 0.5 + 0.5;
                half growthMask = smoothstep(0.18, 0.82,
                    grassLuma * 0.52 + groundLuma * 0.27 + furrowNoise * 0.21);
                half3 fertile = lerp(ground, grass, 0.58 + _Fertility * 0.22)
                    * _Tint.rgb * 1.54;
                half3 silted = lerp(fertile,
                    ground * _Tint.rgb * 1.38, _Silt * (1.0 - growthMask) * 0.58);
                half wetMask = saturate((1.0 - groundLuma) * 0.55
                    + (1.0 - furrowNoise) * 0.45) * _Wetness;
                half3 albedo = lerp(silted,
                    _DarkTint.rgb * (0.80 + ground * 0.32), wetMask * 0.64);
                half wearMask = saturate((1.0 - grassLuma) * 0.54
                    + furrowNoise * 0.46) * _Trample;
                albedo = lerp(albedo,
                    lerp(_DarkTint.rgb, ground * _Tint.rgb, 0.30), wearMask * 0.78);
                albedo *= lerp(0.80, 1.14, saturate(input.uv.x));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.73;
                half3 direct = mainLight.color * (0.27 + diffuse * 0.73);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.10, 0.84,
                    growthMask + furrowNoise * (_Fertility + _Silt) * 0.15);
                half alpha = _Opacity * band * lerp(0.34, 1.0, broken)
                    * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
