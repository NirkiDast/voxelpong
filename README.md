# Voxel Ping Pong

A browser ping pong game for the living room. The PC/TV opens the site. Each phone scans a QR code and becomes a motion-controlled paddle. Nothing to install.

## How it works

- `index.html` is the big screen. It renders the game with three.js (voxel scene, bloom, depth of field, VFX) and runs all physics, rules and AI.
- `controller.html` is the phone. It reads tilt (aim) and swing spikes (hit) from the motion sensors and streams them to the PC. A touch mode is there as a fallback.
- The link is WebRTC through PeerJS. PeerJS's free cloud broker (`0.peerjs.com`) only handles the handshake, then data flows phone to PC directly. On home Wi-Fi the lag readout in the top-right corner usually shows 5 to 30 ms.
- Haptics: on Android the phone vibrates on every hit, smash and point. iOS Safari has no vibration API, so on iOS 18+ the page falls back to the system "switch" haptic tick, which is lighter. Older iPhones get the screen flash only.
- There's no build step and everything is vendored in `vendor/`, so the folder can be hosted as plain static files.

## Running it

Motion sensors only work over **https**, so the phone side needs a real host. Any static host works: Netlify Drop (drag the folder onto app.netlify.com/drop), Vercel, GitHub Pages or Cloudflare Pages.

To try it locally without a phone: `python3 -m http.server` in this folder, open `http://localhost:8000`, and play with the mouse (move to aim, click to swing, right-click or Space for a power shot). The controller page also works in a desktop browser in touch mode.

Optional: `?signal=host:port` points both pages at a self-hosted PeerJS server instead of the public one.

## Phases

**Phase 1 (done): playable vertical slice**
- Single player vs AI (easy, medium or hard), first to 11, win by 2, serve switches every 2 points
- Phone pairing by QR code, a motion controller with recenter, a touch fallback, and a mouse fallback on the PC
- Voxel living-room arena with a voxel table, net, paddles and scoreboard
- Bloom, depth of field that follows the ball, chromatic aberration pulses, vignette
- Juice: hit-stop, camera shake, FOV punch, voxel sparks, shock rings, bounce decals, a ball trail that heats up as the rally goes on, smash slow-mo, popups, synthesized sound
- Haptics on hit, smash, win and lose
- Attract mode (AI vs AI demo) behind the menu

**Phase 2 (done): two players and latency**
- 2-player split screen: two QR codes, a camera and post-processing stack per player, a front wall and a mirrored scoreboard for player 2's view, and phones colored by player
- Mode picker in the lobby (1P vs AI or 2 Players). Scanning the Player 2 code switches to 2 Players automatically
- Latency work:
  - Paddle input goes over a second, lossy WebRTC channel (unordered, no retransmits), so a dropped packet is skipped and never queued
  - Tilt is fused from the raw gyroscope, so it responds instantly; the OS orientation only corrects drift
  - The phone sends every sensor update right away instead of on a 33 ms timer
  - A swing is sent the moment it starts, on both channels
  - Less paddle smoothing on the PC
  - Shadows render once per frame
  - Quality drops automatically (depth of field off, then lower resolution) if the PC falls under 50 fps
- Toned-down bloom and fewer ambient particles
- FPS and per-phone round-trip readouts in the top-right corner

**Phase 3: depth and polish**
- Spin (topspin and backspin from swing direction, curve with the Magnus effect) and better swing classification (forehand, backhand, smash)
- Proper serve rules, AI personalities, match stats and replays of great rallies
- Music, more arenas, voxel avatars, an effects-intensity setting
- 2P co-op vs AI, plus a self-hosted signaling or TURN fallback for strict networks
