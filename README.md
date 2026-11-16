# VisionStrike — Zombie Apocalypse

Hand-tracking zombie shooter that runs in the browser. Aim with your index finger, pinch thumb + index to fire.

## Run locally

```
npm start
```

Then open http://localhost:3000 (set `PORT=xxxx` to change the port). No install step: the server has zero dependencies.
Requires Node 14+, a webcam, and internet access for the MediaPipe model/WASM (loaded from CDN).

## Controls

| Hand tracking | Mouse fallback |
|---|---|
| Index fingertip = aim | Move mouse = aim |
| Pinch thumb + index = fire | Click / Space = fire |
| — | `R` = reload (also automatic when empty) |

Headshots deal double damage. Desks and pillars block shots, so wait until a zombie steps out from behind cover.

## Files

- `index.html` / `style.css` — page shell, cyberpunk overlay, webcam preview
- `vision.js` — webcam + MediaPipe HandLandmarker (landmark 8 aim, landmark 4 pinch)
- `game.js` — rendering layers, HUD, zombies, waves, hit/occlusion detection, audio
- `server.js` — tiny static server for `npm start`
- `api/` — global leaderboard (Vercel Blob): `GET /api/leaderboard`, `POST /api/score`

## Global leaderboard

Scores are stored in a single `leaderboard.json` blob on Vercel Blob, so the top 10 is shared by all players. On GitHub Pages or when the API is unreachable, the game silently falls back to per-device `localStorage` scores.

To enable it on Vercel:

1. Import the repo into Vercel (the `api/` folder is picked up automatically).
2. In the Vercel dashboard: **Storage → Create Database → Blob**, and connect it to the project (this sets `BLOB_READ_WRITE_TOKEN`).
3. Redeploy. `GET /api/leaderboard` should return `{"board":[],"online":true}`.

Local `npm start` has no API routes — the game just shows that device's local scores.
