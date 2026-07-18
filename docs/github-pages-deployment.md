# GitHub Pages deployment

`MrHab/FOnline` stores the complete Realm of Ashes source: the Node.js server,
browser client, authored world data, tools and tests.

`MrHab/mrhab.github.io` stores only the contents of `public/`. GitHub Pages is a
static host and does not run `server.js`, REST APIs or Socket.IO.

## Browser client

The static client includes its own copies of Three.js, GLTFLoader and the
Socket.IO browser client under `public/vendor/`. On `github.io`, the login form
requires a public HTTPS URL for the game server and saves it in browser local
storage.

## Node.js server

Run the complete repository on a Node.js host with persistent storage. The
deployment must provide at least:

- `PORT` — normally supplied by the hosting provider;
- `ORIGINS=https://mrhab.github.io` — permits REST and Socket.IO requests from
  the Pages client;
- `DATA_DIR` — a directory on a persistent volume for accounts, characters,
  saves and wasteland simulation state.

The public server URL must use HTTPS. Enter that URL in the Pages login screen.
Do not commit `data/users.json`, `data/saves.json`, simulation state, logs,
backups, `.env` files or hosting credentials.

## Publishing the static tree

Publish the `public/` subtree to the `main` branch of
`https://github.com/MrHab/mrhab.github.io`. The `.nojekyll` file keeps GitHub
Pages from applying Jekyll processing to the game assets.
