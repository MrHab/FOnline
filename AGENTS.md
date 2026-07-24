# Realm of Ashes repository guidance

## Runtime and setup

- Use Node.js 22 and npm. The pinned major version is stored in `.nvmrc`.
- Install the exact dependency tree with `npm ci`.
- Start the development server with `npm start`.
- The default local address is `http://127.0.0.1:3000`.

## Repository layout

- `server.js` is the production entry point and authoritative multiplayer server.
- `src/server/` contains extracted server-side systems.
- `public/` contains the browser client and all shipped static assets.
- `data/` contains authored world data. Runtime account, save and simulation files are ignored.
- `tools/` contains generators and verification scripts.
- `docs/wiki/` documents the current game architecture.

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
- When changing networking, also verify `/health` and a Socket.IO connection.
- When changing visuals or interaction, test the running client in a browser at desktop and mobile landscape sizes.

## Git and delivery

- Start work from the latest `main`.
- Use a focused branch such as `agent/<short-description>`.
- Keep commits scoped and use pull requests to merge into `main`.
- Production deployment is manual. Never connect tests directly to production data.
- VPS deployment instructions are in `docs/CODEX_WORKFLOW.md`.
