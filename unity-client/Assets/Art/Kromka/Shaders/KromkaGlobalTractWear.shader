Shader "Realm of Ashes/Kromka Global Tract Wear"
{
    Properties
    {
        _MainTex ("Direct MEP Dry Dust", 2D) = "white" {}
        _SecondaryTex ("Direct MEP Compacted Soil", 2D) = "gray" {}
        _AggregateTex ("Direct MEP Road Aggregate", 2D) = "gray" {}
        _Tint ("Dust Tint", Color) = (0.50, 0.39, 0.23, 1)
        _DarkTint ("Compressed Ground Tint", Color) = (0.16, 0.11, 0.065, 1)
        _DetailTiling ("Detail Tiling", Range(0.2, 10)) = 4.0
        _MacroTiling ("Macro Tiling", Range(0.02, 2)) = 0.42
        _Opacity ("Opacity", Range(0.05, 1)) = 0.55
        _EdgeFade ("Edge Fade", Range(0.04, 0.8)) = 0.30
        _Dust ("Dry Dust", Range(0, 1)) = 0.7
        _Compaction ("Traffic Compaction", Range(0, 1)) = 0.6
        _Ruts ("Paired Wheel Ruts", Range(0, 1)) = 0.8
        _Aggregate ("Broken Aggregate", Range(0, 1)) = 0.2
        _Seed ("Pattern Seed", Range(0, 8)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent-34"
            "RenderPipeline"="UniversalPipeline"
        }
        Pass
        {
            Name "ForwardTractWear"
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
            TEXTURE2D(_AggregateTex); SAMPLER(sampler_AggregateTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float4 _DarkTint;
                float _DetailTiling;
                float _MacroTiling;
                float _Opacity;
                float _EdgeFade;
                float _Dust;
                float _Compaction;
                float _Ruts;
                float _Aggregate;
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
                half3 dustTex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
                    worldUv * _DetailTiling + float2(_Seed * 0.17, _Seed * 0.31)).rgb;
                half3 compactTex = SAMPLE_TEXTURE2D(_SecondaryTex, sampler_SecondaryTex,
                    float2(-worldUv.y, worldUv.x) * _MacroTiling
                        + float2(_Seed * 0.29, _Seed * 0.11)).rgb;
                half3 aggregateTex = SAMPLE_TEXTURE2D(_AggregateTex, sampler_AggregateTex,
                    worldUv * (_DetailTiling * 0.68)
                        + float2(_Seed * 0.07, _Seed * 0.43)).rgb;

                half dustLuma = dot(dustTex, half3(0.299, 0.587, 0.114));
                half compactLuma = dot(compactTex, half3(0.299, 0.587, 0.114));
                half aggregateLuma = dot(aggregateTex, half3(0.299, 0.587, 0.114));
                half longitudinal = sin(input.uv.y * 2.73 + _Seed * 1.91) * 0.5 + 0.5;
                half crossRoute = input.uv.x;
                half interior = 1.0 - saturate(abs(crossRoute));
                half edge = smoothstep(0.0, _EdgeFade, interior);
                half breakup = smoothstep(0.16, 0.84,
                    dustLuma * 0.42 + compactLuma * 0.31 + longitudinal * 0.27);

                half3 dryGround = lerp(compactTex, dustTex, 0.42 + _Dust * 0.38)
                    * _Tint.rgb * 1.72;
                half compressed = smoothstep(0.10, 0.88, interior)
                    * lerp(0.58, 1.0, breakup) * _Compaction;
                half rutPair = (1.0 - smoothstep(0.045, 0.16,
                    abs(abs(crossRoute) - 0.43)))
                    * lerp(0.52, 1.0, breakup) * _Ruts;
                half vergeDust = pow(saturate(abs(crossRoute)), 1.45)
                    * edge * lerp(0.55, 1.0, 1.0 - breakup) * _Dust;
                half gravel = smoothstep(0.30, 0.72, aggregateLuma)
                    * lerp(0.55, 1.0, longitudinal) * _Aggregate;

                half3 compactedGround = compactTex * _DarkTint.rgb * 1.58;
                half3 albedo = lerp(dryGround, compactedGround, compressed * 0.52);
                albedo = lerp(albedo, aggregateTex * _Tint.rgb * 1.48, gravel * 0.62);
                albedo *= 1.0 - rutPair * 0.23;
                albedo = lerp(albedo, dustTex * _Tint.rgb * 1.92, vergeDust * 0.38);

                half3 normalWS = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 ambient = SampleSH(normalWS) * 0.73;
                half3 direct = mainLight.color * (0.27 + diffuse * 0.73);
                half3 lit = MixFog(albedo * (ambient + direct), input.fogFactor);

                half ragged = lerp(0.46, 1.0, breakup);
                half alpha = _Opacity * edge * ragged * input.color.a;
                return half4(lit, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
