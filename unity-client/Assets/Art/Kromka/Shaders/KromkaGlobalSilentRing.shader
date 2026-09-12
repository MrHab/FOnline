Shader "Realm of Ashes/Kromka Global Silent Ring"
{
    Properties
    {
        _MainTex ("Direct MEP Ash Ground", 2D) = "gray" {}
        _SecondaryTex ("Direct MEP Burned Rock", 2D) = "gray" {}
        _MineralTex ("Direct MEP Mineral Dust", 2D) = "white" {}
        _Tint ("Ring Tint", Color) = (0.24, 0.23, 0.20, 1)
        _DarkTint ("Burned Tint", Color) = (0.05, 0.045, 0.038, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 4.2
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.42
        _Opacity ("Opacity", Range(0.05, 1)) = 0.52
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.28
        _Ash ("Ash Mantle", Range(0, 1)) = 0.75
        _Burn ("Thermal Scorch", Range(0, 1)) = 0.35
        _Erosion ("Boundary Erosion", Range(0, 1)) = 0.45
        _Mineral ("Mineral Edge", Range(0, 1)) = 0.25
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-33"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardSilentRing"
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
                float _Ash;
                float _Burn;
                float _Erosion;
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
                half3 ashTex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.17, _Seed * 0.39)).rgb;
                half3 burnedTex = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * (_DetailTiling * 0.64)
                        + float2(_Seed * 0.31, _Seed * 0.09)).rgb;
                half3 mineralTex = SAMPLE_TEXTURE2D(_MineralTex, sampler_MineralTex,
                    worldUv * _MacroTiling + float2(_Seed * 0.11, _Seed * 0.27)).rgb;

                half ashLuma = dot(ashTex, half3(0.299, 0.587, 0.114));
                half burnedLuma = dot(burnedTex, half3(0.299, 0.587, 0.114));
                half mineralLuma = dot(mineralTex, half3(0.299, 0.587, 0.114));
                half lengthNoise = sin(input.uv.y * 2.47 + _Seed * 1.73) * 0.5 + 0.5;
                half fineBreakup = smoothstep(0.16, 0.84,
                    ashLuma * 0.40 + burnedLuma * 0.34 + lengthNoise * 0.26);
                half edge = smoothstep(0.0, _EdgeFade, saturate(input.uv.x));

                half ashMask = saturate(_Ash
                    * lerp(0.56, 1.0, 1.0 - fineBreakup));
                half scorchMask = saturate(_Burn
                    * smoothstep(0.22, 0.74, 1.0 - burnedLuma)
                    * lerp(0.58, 1.0, lengthNoise));
                half erosionMask = saturate(_Erosion
                    * smoothstep(0.18, 0.80,
                        abs(sin(input.uv.y * 3.11 + ashLuma * 4.7))));
                half mineralMask = saturate(_Mineral
                    * smoothstep(0.30, 0.76, mineralLuma)
                    * lerp(0.62, 1.0, fineBreakup));

                half3 ashGround = ashTex * _Tint.rgb * 1.52;
                half3 scorched = burnedTex * _DarkTint.rgb * 1.34;
                half3 eroded = lerp(ashTex, burnedTex, 0.42)
                    * _Tint.rgb * 1.64;
                half3 mineral = mineralTex * lerp(_Tint.rgb, half3(0.72, 0.66, 0.52), 0.44)
                    * 1.54;
                half3 albedo = lerp(ashGround, scorched, scorchMask * 0.78);
                albedo = lerp(albedo, eroded, erosionMask * 0.40);
                albedo = lerp(albedo, mineral, mineralMask * 0.62);
                albedo *= lerp(0.82, 1.08, ashMask * fineBreakup);

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.72;
                half3 direct = mainLight.color * (0.26 + diffuse * 0.74);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half brokenAlpha = lerp(0.38, 1.0,
                    saturate(fineBreakup * 0.58 + erosionMask * 0.24
                        + mineralMask * 0.18));
                half alpha = _Opacity * edge * brokenAlpha * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
