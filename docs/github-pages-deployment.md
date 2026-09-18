# GitHub Pages deployment

GitHub Pages publishing is no longer supported. `MrHab/mrhab.github.io` used to
host a copy of `public/` with the former static Three.js browser client, whose
login form accepted the URL of a remote game server. That client has been
removed from the repository.

The only client is the Unity WebGL build (`public/unity/`, produced by
**Кромка → Build WebGL**, not stored in git). In the browser it always talks to
the server at its own page origin, so it must be served by `server.js` or by
Nginx on the game server's domain. VPS deployment is described in
[`CODEX_WORKFLOW.md`](CODEX_WORKFLOW.md).
