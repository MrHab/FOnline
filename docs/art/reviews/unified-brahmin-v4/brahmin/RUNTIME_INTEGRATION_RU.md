# Runtime-интеграция B+C-брамина v4

## Защита приёмки

- утверждённый review SHA-256:
  `B12B53B02C502CD0007FDEF70295CF09E81732458F468BE2A600C8E9ED263EA5`;
- runtime-сборка разрешается только при наличии `APPROVE` в
  `CRITIC_APPROVAL_V4.md` и полном совпадении review GLB и
  `technical-report.json`;
- утверждённый SHA записан в метаданные корневого узла runtime GLB;
- runtime SHA-256:
  `F61FCA471CAAFE50A592697E075CAC253840F944C81CE4F54626D15D35D94F66`.

## Игровой файл

- путь: `public/assets/models/wasteland/brahmin.glb`;
- `1` mesh;
- `7 078` экспортированных POSITION-вершин;
- `3 478` треугольников;
- `1` skin, `51` joint;
- `9` материалов, `27` встроенных текстур `512 × 512`;
- `924` анимационных канала;
- клипы: `idle`, `walk`, `run`, `attack`, `hurt`, `death`.

## Масштаб и коллайдер

Компонентная компенсация корневого масштаба предотвращает повторное
применение масштаба skinned-модели в Three.js. Итоговые статические
габариты каталога:

- размер: `1,695023 × 1,087041 × 1,238178 м`;
- центр: `0 × 0,570542 × 0,157249 м`;
- walking collision строится по проекции одного цельного skinned mesh.

## Проверка

- runtime GLB повторно импортирован в Blender;
- пересмотрены `idle`, все опорные фазы `walk` и `run`, attack f7/f14/f22,
  `hurt`, `death` и кадры `112 × 112`;
- рендеры: `renders/runtime-actions/`;
- отчёт: `runtime-action-review-report.json`;
- `npm run check:npc-models` проходит для всей библиотеки из 14 моделей.
