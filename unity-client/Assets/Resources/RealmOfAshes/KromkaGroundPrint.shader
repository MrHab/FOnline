// Печать отпечатков в карту следов (RoaGroundPrints). Каждый отпечаток — четырёхугольник
// в мировых XZ; форма считается здесь по его координатам: подошва с протектором, лапа с
// когтями или полоса шины с ёлочкой. В канал R пишется глубина, наложение — по максимуму,
// чтобы следы поверх друг друга не углублялись. Карту читает шейдер земли Kromka Ground.
Shader "Hidden/Realm of Ashes/Kromka Ground Print"
{
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            Name "Stamp"
            Cull Off
            ZWrite Off
            ZTest Always
            BlendOp Max
            Blend One One

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma target 3.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes
            {
                float3 positionOS : POSITION;
                // xy — координаты внутри отпечатка (x поперёк, y вдоль; у шины y — метры пути),
                // z — глубина, w — форма: 0 ботинок, 1 лапа, 2 шина.
                float4 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float4 uv : TEXCOORD0;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = mul(UNITY_MATRIX_VP, float4(input.positionOS, 1.0));
                output.uv = input.uv;
                return output;
            }

            float Inside(float2 p, float2 centre, float2 radius, float soft)
            {
                return smoothstep(1.0, 1.0 - soft, length((p - centre) / radius));
            }

            // Подошва: носок и каблук глубже, свод мельче; поперечные грунтозацепы.
            float Boot(float2 p)
            {
                float mask = max(Inside(p, float2(0.0, 0.36), float2(0.95, 0.62), 0.22),
                                 Inside(p, float2(0.0, -0.64), float2(0.8, 0.34), 0.25));
                mask = max(mask, Inside(p, float2(0.12, -0.14), float2(0.58, 0.42), 0.3) * 0.55);
                float lugs = 0.7 + 0.3 * step(0.42, frac(p.y * 4.5 + 0.2));
                return mask * lugs;
            }

            float Toe(float2 p, float2 toe)
            {
                float2 claw = toe + normalize(toe - float2(0.0, -0.3)) * 0.36;
                return max(Inside(p, toe, float2(0.24, 0.27), 0.35), Inside(p, claw, float2(0.08, 0.1), 0.5) * 0.8);
            }

            // Лапа: подушка, четыре пальца и точки когтей перед ними.
            float Paw(float2 p)
            {
                float mask = Inside(p, float2(0.0, -0.36), float2(0.6, 0.46), 0.3);
                mask = max(mask, max(Toe(p, float2(-0.64, 0.22)), Toe(p, float2(-0.23, 0.56))));
                mask = max(mask, max(Toe(p, float2(0.23, 0.56)), Toe(p, float2(0.64, 0.22))));
                return mask;
            }

            // Шина: плоское дно, мягкие края, ёлочка протектора по метрам пути.
            float Tire(float2 p)
            {
                float across = smoothstep(1.0, 0.7, abs(p.x));
                float tread = 0.7 + 0.3 * step(0.5, frac(p.y / 0.07 + abs(p.x) * 0.35));
                return across * tread;
            }

            float Shape(float2 p, float shape)
            {
                if (shape < 0.5) return Boot(p);
                if (shape < 1.5) return Paw(p);
                return Tire(p);
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // Отпечаток — несколько текселей карты: четыре выборки внутри текселя
                // сглаживают край.
                float2 p = input.uv.xy;
                float2 dx = ddx(p) * 0.25;
                float2 dy = ddy(p) * 0.25;
                float shape = input.uv.w;
                float value = (Shape(p + dx + dy, shape) + Shape(p + dx - dy, shape)
                             + Shape(p - dx + dy, shape) + Shape(p - dx - dy, shape)) * 0.25;
                return half4(value * input.uv.z, 0, 0, 0);
            }
            ENDHLSL
        }
    }
}
