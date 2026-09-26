// Мягкие светящиеся искры над точкой добычи (цвет тира в цвете частицы).
Shader "RealmOfAshes/TierGlow"
{
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; float fogFactor : TEXCOORD1; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                output.color = input.color;
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float r = length(input.uv * 2 - 1);
                // Яркое ядро и мягкий ореол.
                float glow = saturate(1 - r);
                float core = saturate(1 - r * 2.6);
                half3 color = lerp(input.color.rgb, half3(1, 1, 1), core * 0.45);
                // Туман гасит свечение, а не красит его.
                float visibility = 1;
            #if defined(FOG_LINEAR) || defined(FOG_EXP) || defined(FOG_EXP2)
                visibility = ComputeFogIntensity(input.fogFactor);
            #endif
                float alpha = input.color.a * (glow * glow * 0.8 + core) * visibility;
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
