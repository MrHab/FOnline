Shader "Kromka/Global Map/Industrial Smoke"
{
    Properties
    {
        _BaseMap ("Licensed MEP smoke mask", 2D) = "white" {}
        _BaseColor ("Smoke tint", Color) = (0.29, 0.27, 0.24, 0.68)
        _AlphaCutoff ("Transparent fringe cutoff", Range(0, 0.1)) = 0.006
        _RiseSpeed ("Smoke rise speed", Range(0.01, 0.5)) = 0.075
        _RiseDistance ("Smoke rise distance", Range(0, 1.2)) = 0.38
        _SwayAmount ("Wind sway", Range(0, 0.3)) = 0.075
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent+10"
        }

        Pass
        {
            Name "IndustrialSmoke"
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
                half _RiseSpeed;
                half _RiseDistance;
                half _SwayAmount;
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
                half life : TEXCOORD1;
                half fogFactor : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                half phase = input.color.g;
                half life = frac(_Time.y * _RiseSpeed + phase);
                float3 positionOS = input.positionOS.xyz;
                positionOS.y += life * _RiseDistance;
                positionOS.x += sin(_Time.y * 0.31h
                    + phase * 6.28318h) * _SwayAmount * (0.35h + life);
                positionOS.z += cos(_Time.y * 0.23h
                    + phase * 5.11h) * _SwayAmount * 0.42h * (0.35h + life);
                output.positionCS = TransformObjectToHClip(positionOS);
                output.color = input.color;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.life = life;
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                half4 sample = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap,
                    input.uv);
                float2 edgeDistance = min(input.uv, 1.0 - input.uv);
                half edgeFade = smoothstep(0.0h, 0.10h,
                    min(edgeDistance.x, edgeDistance.y));
                half lifeFade = smoothstep(0.0h, 0.16h, input.life)
                    * (1.0h - smoothstep(0.76h, 1.0h, input.life));
                half alpha = saturate(sample.a * input.color.r
                    * _BaseColor.a * edgeFade * lifeFade * 1.18h);
                clip(alpha - _AlphaCutoff);

                half luminance = dot(sample.rgb,
                    half3(0.299h, 0.587h, 0.114h));
                half3 color = _BaseColor.rgb
                    * lerp(0.72h, 1.20h, luminance);
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
