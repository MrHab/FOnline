# Кромка (Realm of Ashes) repository guidance

## Runtime and setup

- Use Node.js 22 and npm. The pinned major version is stored in `.nvmrc`.
- Install the exact dependency tree with `npm ci`.
- Start the development server with `npm start`.
- The default local address is `http://127.0.0.1:3000`.

## Repository layout

- `server.js` is the production entry point and authoritative multiplayer server.
- `src/server/` contains extracted server-side systems.
- `unity-client/` is the game client (Unity 6000.5.8f1, URP). Players get the
  Unity WebGL build served from the site root; all client work happens here.
- `public/` holds the static files the server serves: GLB models
  (`public/assets/`) and the generated Unity WebGL build (`public/unity/`, not
  in git) with its fallback page `unity-unavailable.html`. There is no browser
  client besides the Unity build.
- `data/` contains authored world data. Runtime account, save and simulation files are ignored.
- `tools/` contains generators and verification scripts.
- `docs/wiki/` documents the current game architecture; the design canon is
  `docs/KROMKA_GAME_BIBLE_AND_PATCH_PLAN.md`.

## Working rules

- Treat server state as authoritative for multiplayer gameplay.
- Preserve unique global-map location IDs and their authored location definitions.
- Keep authored JSON deterministic; do not introduce generated runtime state into `data/`.
- Do not edit generated GLB models or collider catalogs by hand when a generator exists in `tools/`.
- Preserve unrelated user changes in a dirty worktree.
- Never commit secrets, production credentials, accounts, saves, logs, backups or VPS data.

## Verification

- Run the narrowest relevant `npm run check:*` command while iterating.
- Run `npm run check` before handing off a substantial change or publishing a branch.
  It is the whole chain; nothing runs before it.
- Checks assert behaviour: unit tests of `src/server` modules, scenarios against a
  real server, authored data and built assets. Do not add checks that only search
  source files or docs for strings: they break on every refactor and prove nothing.
- When changing networking, also verify `/health` and a Socket.IO connection.
- When changing the Unity client, run `unity-client/Tools/compile-check.ps1`,
  the relevant **Realm of Ashes** editor probes (or the batch audit
  `RoaClientAuditRunner.Run`) and `npm run check:unity-parity`.
- When changing visuals or interaction, test the running Unity client at
  desktop and mobile landscape sizes.

## Documentation

- `docs/wiki/` describes the game as it is now. Do not add patch-note files or dated
  fix diaries: history lives in git.
- Player-facing release notes go to the top of `docs/wiki/CHANGELOG.md`; read only its
  first lines before editing. It holds the current month; when a new month starts, move
  the older entries to `docs/wiki/CHANGELOG_ARCHIVE.md`.

## Git and delivery

- Start work from the latest `main`.
- Use a focused branch such as `agent/<short-description>`.
- Keep commits scoped and use pull requests to merge into `main`.
- Production deployment is manual. Never connect tests directly to production data.
- VPS deployment instructions are in `docs/CODEX_WORKFLOW.md`.
