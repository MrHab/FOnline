# Runtime-интеграция B+C-гуля v3

- Review SHA-256:
  `6203193F87FD8B1FB3D0BDEB9E82F218BC7E1E1103827F3E09CA3D86861EF8D8`.
- Runtime SHA-256:
  `A937EEBCC1DA86EFE5BDBE91BC7CD29B34AA89D1F3B92D7539A287F51D963A90`.
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
