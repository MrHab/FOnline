Shader "Kromka/Global Map/Road Dust"
{
    Properties
    {
        _BaseMap ("Licensed MEP dust mask", 2D) = "white" {}
        _BaseColor ("Dust tint", Color) = (0.72, 0.56, 0.36, 0.62)
        _AlphaCutoff ("Transparent fringe cutoff", Range(0, 0.1)) = 0.008
        _FlowSpeed ("Subtle road flow", Range(-0.2, 0.2)) = 0.028
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent"
        }

        Pass
        {
            Name "RoadDust"
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
                half _FlowSpeed;
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
                float2 maskUv : TEXCOORD1;
                half fogFactor : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.color = input.color;
                output.uv = input.uv;
                float phase = input.color.g * 0.73h;
                float2 flow = float2(_Time.y * _FlowSpeed + phase,
                    sin(_Time.y * 0.17h + phase * 6.28318h) * 0.018h);
                output.maskUv = frac(TRANSFORM_TEX(input.uv, _BaseMap) + flow);
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                half4 mask = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap,
                    input.maskUv);
                float2 edgeDistance = min(input.uv, 1.0 - input.uv);
                half edgeFade = smoothstep(0.0h, 0.14h,
                    min(edgeDistance.x, edgeDistance.y));
                half2 radialUv = (input.uv - 0.5h) * 2.0h;
                half radialFade = 1.0h - smoothstep(0.42h, 1.0h,
                    length(radialUv));
                half pulse = 0.86h + sin(_Time.y * 0.31h
                    + input.color.g * 6.28318h) * 0.14h;
                // Preserve the irregular texture mask. The former additive
                // floor and 2.2 multiplier exposed each quad as a pale ribbon
                // when viewed from the low strategic camera.
                half alpha = saturate(mask.a * input.color.r
                    * _BaseColor.a * edgeFade * radialFade * radialFade
                    * pulse * 0.62h);
                clip(alpha - _AlphaCutoff);

                // The MEP source stores useful soft luminance in RGB. Keep it
                // restrained so stacked particles never become black cards.
                half luminance = dot(mask.rgb, half3(0.299h, 0.587h, 0.114h));
                half3 color = _BaseColor.rgb
                    * lerp(0.84h, 1.08h, luminance);
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
