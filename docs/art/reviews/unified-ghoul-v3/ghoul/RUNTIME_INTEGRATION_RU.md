# Runtime-интеграция B+C-гуля v3

- Review SHA-256:
  `DCAA6F7E2A2C48D3C89F9089399BE2BC4B12383265C2B16B5C825A2AB105CAF1`.
- Runtime SHA-256:
  `1360D1A0A0B4BD90CB49FD0ABC9BBDE83991BC430DB43D818D03B06928B1D91C`.
- Игровой файл: `public/assets/models/wasteland/npc_ghoul.glb`.
- Корневой масштаб: `×1,0`.
- Один skin, 65 суставов, две mesh-секции, семь материалов, 21 встроенная
  PBR-текстура `512 × 512`.
- Шесть действий и 1170 анимационных каналов.

Runtime-GLB отличается от review-файла только разрешающими метаданными:
`realm_review_only=false`, `realm_runtime_integration_allowed=true`, точным
SHA принятого кандидата и идентификатором `npc_ghoul`.

Сборка воспроизводится командой `npm run build:ghoul-model`. Любое изменение
review-байтов, исходной гуманоидной модели, runtime-GLB или документа приёмки
останавливает сборку и требует новой художественной проверки.
