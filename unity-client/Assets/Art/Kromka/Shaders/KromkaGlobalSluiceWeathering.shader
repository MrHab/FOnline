Shader "Realm of Ashes/Kromka Global Sluice Weathering"
{
    Properties
    {
        _MainTex ("Direct MEP Masonry Surface", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Weathered Rock", 2D) = "gray" {}
        _Tint ("Concrete Tint", Color) = (0.42, 0.45, 0.43, 1)
        _DarkTint ("Wet Tint", Color) = (0.08, 0.12, 0.12, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 3.2
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.40
        _Opacity ("Opacity", Range(0.05, 1)) = 0.58
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.30
        _Wetness ("Water Saturation", Range(0, 1)) = 0.56
        _Rust ("Rust Bleed", Range(0, 1)) = 0.32
        _Mineral ("Mineral Efflorescence", Range(0, 1)) = 0.45
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-41"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardSluiceWeathering"
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
                float _Wetness;
                float _Rust;
                float _Mineral;
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
                half3 masonry = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.16, _Seed * 0.28)).rgb;
                half3 rock = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.20, _Seed * 0.09)).rgb;
                half masonryLuma = dot(masonry, half3(0.299, 0.587, 0.114));
                half rockLuma = dot(rock, half3(0.299, 0.587, 0.114));
                half dripNoise = sin(input.uv.y * 4.47 + _Seed * 1.63) * 0.5 + 0.5;
                half breakup = smoothstep(0.20, 0.78,
                    masonryLuma * 0.50 + rockLuma * 0.29 + dripNoise * 0.21);
                half3 concrete = lerp(rock, masonry, 0.60) * _Tint.rgb * 1.52;
                half wetMask = saturate((1.0 - masonryLuma) * 0.52
                    + (1.0 - dripNoise) * 0.48) * _Wetness;
                half3 albedo = lerp(concrete,
                    _DarkTint.rgb * (0.78 + rock * 0.34), wetMask * 0.72);
                half rustMask = saturate((1.0 - rockLuma) * 0.56
                    + dripNoise * 0.44) * _Rust;
                half3 rust = albedo * half3(1.34, 0.59, 0.24)
                    + half3(0.045, 0.010, 0.0);
                albedo = lerp(albedo, rust, rustMask * 0.82);
                half mineralMask = breakup * (1.0 - wetMask) * _Mineral;
                albedo = lerp(albedo,
                    albedo * 1.20 + half3(0.050, 0.052, 0.045), mineralMask * 0.58);
                albedo *= lerp(0.78, 1.15, saturate(input.uv.x));

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.72;
                half3 direct = mainLight.color * (0.26 + diffuse * 0.74);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half band = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));
                half broken = smoothstep(0.10, 0.84,
                    breakup + dripNoise * (_Wetness + _Rust) * 0.18);
                half alpha = _Opacity * band * lerp(0.30, 1.0, broken)
                    * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
