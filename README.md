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
