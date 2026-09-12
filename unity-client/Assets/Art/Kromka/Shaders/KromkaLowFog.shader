Shader "Kromka/Global Map/Low Fog"
{
    Properties
    {
        _BaseMap ("Licensed MEP 4x4 fog atlas", 2D) = "white" {}
        _BaseColor ("Fog tint", Color) = (0.70, 0.78, 0.76, 0.46)
        _AlphaCutoff ("Transparent fringe cutoff", Range(0, 0.1)) = 0.006
        _FrameRate ("Slow atlas animation", Range(0.1, 8.0)) = 1.35
        _DriftAmount ("Horizontal breathing", Range(0, 0.2)) = 0.045
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent+5"
        }

        Pass
        {
            Name "LowFog"
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
                half _AlphaCutoff;
                half _FrameRate;
                half _DriftAmount;
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
                half fogFactor : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                half phase = input.color.g;
                float3 positionOS = input.positionOS.xyz;
                positionOS.x += sin(_Time.y * 0.23h + phase * 6.28318h)
                    * _DriftAmount;
                output.positionCS = TransformObjectToHClip(positionOS);
                output.color = input.color;
                output.uv = input.uv;

                half frame = fmod(floor(_Time.y * _FrameRate
                    + phase * 16.0h), 16.0h);
                half2 cell = half2(fmod(frame, 4.0h),
                    3.0h - floor(frame * 0.25h));
                half2 localUv = saturate(input.uv
                    + half2(sin(_Time.y * 0.11h + phase * 5.0h) * 0.018h,
                        0.0h));
                output.atlasUv = (localUv + cell) * 0.25h;
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                half4 sample = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap,
                    input.atlasUv);
                half luminance = dot(sample.rgb,
                    half3(0.299h, 0.587h, 0.114h));
                half softMask = smoothstep(0.11h, 0.74h,
                    max(luminance, sample.a * 0.82h));
                float2 edgeDistance = min(input.uv, 1.0 - input.uv);
                half edgeFade = smoothstep(0.0h, 0.13h,
                    min(edgeDistance.x, edgeDistance.y));
                half2 radialUv = (input.uv - 0.5h) * 2.0h;
                half radialFade = 1.0h - smoothstep(0.38h, 1.0h,
                    length(radialUv));
                half pulse = 0.91h + sin(_Time.y * 0.19h
                    + input.color.g * 6.28318h) * 0.09h;
                half alpha = saturate(softMask * input.color.r
                    * _BaseColor.a * edgeFade * radialFade * radialFade
                    * pulse * 0.58h);
                clip(alpha - _AlphaCutoff);

                half3 color = _BaseColor.rgb
                    * lerp(0.88h, 1.08h, luminance);
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
