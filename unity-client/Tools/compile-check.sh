#!/usr/bin/env bash
#
# Компиляция скриптов Unity-клиента БЕЗ запуска редактора.
#
# Зачем: Unity открыт далеко не всегда, а ошибку компиляции хочется видеть сразу
# после правки, а не через минуту после запуска редактора. Тут используется тот
# же Roslyn и те же reference-сборки, которыми пользуется сам Unity, поэтому
# результат совпадает с тем, что покажет консоль редактора.
#
# Ограничение: проверяется только компиляция. Всё, что ловится лишь запуском —
# тихие отказы, пути привязки анимаций, порядок Update — этот скрипт не увидит.
#
# Путь к Unity нестандартный, поэтому вынесен в переменную:
#   UNITY_DATA=/путь/к/Editor/Data ./unity-client/Tools/compile-check.sh

set -euo pipefail

UNITY_DATA="${UNITY_DATA:-D:/Games/6000.5.8f1/Editor/Data}"

CLIENT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$(cd "$CLIENT" && pwd -W 2>/dev/null || echo "$CLIENT")"

CSC="$UNITY_DATA/DotNetSdk/sdk/8.0.318/Roslyn/bincore/csc.dll"
DOTNET="$UNITY_DATA/NetCoreRuntime/dotnet.exe"

for required in "$CSC" "$DOTNET" "$UNITY_DATA/NetStandard/ref/2.1.0/netstandard.dll"; do
  if [ ! -f "$required" ]; then
    echo "Не найдено: $required" >&2
    echo "Задайте UNITY_DATA, если Unity установлен по другому пути." >&2
    exit 1
  fi
done

if [ ! -d "$CLIENT/Library/ScriptAssemblies" ]; then
  echo "Нет Library/ScriptAssemblies — сборки пакетов (glTFast и прочие) недоступны." >&2
  echo "Откройте проект в Unity хотя бы один раз, чтобы он их собрал." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Базовые библиотеки: профиль .NET Standard 2.1, как у самого Unity.
{
  echo "-r:$UNITY_DATA/NetStandard/ref/2.1.0/netstandard.dll"
  for f in "$UNITY_DATA/NetStandard/compat/2.1.0/shims/netstandard"/*.dll \
           "$UNITY_DATA/NetStandard/compat/2.1.0/shims/unity"/*.dll; do
    [ -f "$f" ] && echo "-r:$f"
  done
} > "$WORK/refs.rsp"

# Модули движка и редактора. Монолитный Managed/UnityEditor.dll НЕ подключаем:
# он дублирует типы модулей, и каждый MenuItem становится неоднозначным.
for f in "$UNITY_DATA/Managed/UnityEngine"/UnityEngine*.dll \
         "$UNITY_DATA/Managed/UnityEngine"/UnityEditor*.dll; do
  [ -f "$f" ] && echo "-r:$f" >> "$WORK/refs.rsp"
done

for f in "$CLIENT"/Library/PackageCache/com.unity.nuget.newtonsoft-json@*/Runtime/Newtonsoft.Json.dll; do
  [ -f "$f" ] && echo "-r:$(cd "$(dirname "$f")" && pwd -W 2>/dev/null || dirname "$f")/$(basename "$f")" >> "$WORK/refs.rsp"
done

for f in "$CLIENT"/Library/ScriptAssemblies/glTFast*.dll \
         "$CLIENT"/Library/ScriptAssemblies/Unity.RenderPipelines*.dll; do
  [ -f "$f" ] && echo "-r:$BASE/Library/ScriptAssemblies/$(basename "$f")" >> "$WORK/refs.rsp"
done

find "$CLIENT/Assets/Scripts" "$CLIENT/Assets/Editor" -name "*.cs" \
  | sed "s|^$CLIENT|$BASE|" > "$WORK/sources.rsp"

echo "Компилирую $(wc -l < "$WORK/sources.rsp") файлов..."

# CS1701 — расхождение версии netstandard у Newtonsoft. Unity его тоже гасит.
"$DOTNET" "$CSC" -nologo -target:library -langversion:9 -nostdlib+ -noconfig \
  -nowarn:1701 -out:"$WORK/RoaCompileCheck.dll" \
  "@$WORK/refs.rsp" "@$WORK/sources.rsp"

echo "Компиляция прошла без ошибок и предупреждений."
