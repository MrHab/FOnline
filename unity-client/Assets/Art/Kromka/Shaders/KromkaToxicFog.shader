Shader "Kromka/Global Map/Toxic Fog"
{
    Properties
    {
        _BaseMap ("Licensed MEP toxic-fog atlas", 2D) = "white" {}
        _BaseColor ("Toxic body tint", Color) = (0.24, 0.39, 0.13, 0.42)
        _GlowColor ("Toxic core tint", Color) = (0.53, 0.70, 0.18, 1)
        _AlphaCutoff ("Transparent fringe cutoff", Range(0, 0.1)) = 0.006
        _FrameRate ("Slow atlas animation", Range(0.1, 8.0)) = 0.82
        _DriftAmount ("Horizontal drift", Range(0, 0.3)) = 0.045
        _PulseSpeed ("Toxic pulse speed", Range(0, 4.0)) = 0.48
        _GlowStrength ("Restrained toxic glow", Range(0, 1.0)) = 0.22
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent+15"
        }

        Pass
        {
            Name "ToxicFog"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            Cull Off
            ZWrite Off
            ZTest LEqual

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half4 _GlowColor;
                half _AlphaCutoff;
                half _FrameRate;
                half _DriftAmount;
                half _PulseSpeed;
                half _GlowStrength;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                half4 color : COLOR;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                half4 color : COLOR;
                float2 uv : TEXCOORD0;
                float2 atlasUv : TEXCOORD1;
                float2 atlasUvSecondary : TEXCOORD2;
                half fogFactor : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                half phase = input.color.g;
                float3 positionOS = input.positionOS.xyz;
                positionOS.x += sin(_Time.y * 0.19h
                    + phase * 6.28318h) * _DriftAmount;
                positionOS.z += cos(_Time.y * 0.13h
                    + phase * 5.17h) * _DriftAmount * 0.45h;
                output.positionCS = TransformObjectToHClip(positionOS);
                output.color = input.color;
                output.uv = input.uv;

                half frame = fmod(floor(_Time.y * _FrameRate
                    + phase * 16.0h), 16.0h);
                half2 cell = half2(fmod(frame, 4.0h),
                    3.0h - floor(frame * 0.25h));
                half2 localUv = saturate(input.uv
                    + half2(sin(_Time.y * 0.09h + phase * 4.3h) * 0.014h,
                        cos(_Time.y * 0.07h + phase * 3.7h) * 0.010h));
                output.atlasUv = (localUv + cell) * 0.25h;
                output.atlasUvSecondary = ((1.0h - localUv) + cell) * 0.25h;
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                half4 primary = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap,
                    input.atlasUv);
                half4 secondary = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap,
                    input.atlasUvSecondary);
                half primaryLuma = dot(primary.rgb,
                    half3(0.299h, 0.587h, 0.114h));
                half secondaryLuma = dot(secondary.rgb,
                    half3(0.299h, 0.587h, 0.114h));
                half mask = max(max(primary.a, primaryLuma),
                    max(secondary.a, secondaryLuma) * 0.62h);
                half softMask = smoothstep(0.10h, 0.72h, mask);
                float2 edgeDistance = min(input.uv, 1.0 - input.uv);
                half edgeFade = smoothstep(0.0h, 0.13h,
                    min(edgeDistance.x, edgeDistance.y));
                half2 radialUv = (input.uv - 0.5h) * 2.0h;
                half radialFade = 1.0h - smoothstep(0.40h, 1.0h,
                    length(radialUv));
                half pulse = 0.86h + sin(_Time.y * _PulseSpeed
                    + input.color.g * 6.28318h) * 0.14h;
                half alpha = saturate(softMask * input.color.r
                    * _BaseColor.a * edgeFade * radialFade * radialFade
                    * pulse * 0.56h);
                clip(alpha - _AlphaCutoff);

                half core = smoothstep(0.52h, 0.92h, softMask);
                half3 color = lerp(_BaseColor.rgb, _GlowColor.rgb,
                    core * _GlowStrength);
                color += _GlowColor.rgb * core * _GlowStrength * 0.08h;
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
