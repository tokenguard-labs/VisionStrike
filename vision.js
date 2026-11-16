// Webcam + MediaPipe HandLandmarker wrapper.
import { FilesetResolver, HandLandmarker }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const INDEX_TIP = 8;
const THUMB_TIP = 4;
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

const LOST_GRACE_MS = 250;   // keep the last sample alive across brief tracking drops
const REACQUIRE_RESET_MS = 1200; // hand gone this long -> rebuild the landmarker to clear stuck tracker state

/** One-Euro filter: heavy smoothing when the hand is slow/still, almost none when it moves fast. */
class OneEuro {
  constructor(minCutoff = 1.6, beta = 10, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0 });
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(v, dt) {
    if (this.x === null) { this.x = v; return v; }
    dt = Math.max(dt, 1e-3);
    const d = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.ready = false;
    this.lastVideoTime = -1;
    this.pinching = false;
    this.pinchOn = 0.33;           // pinch when thumb-index distance < this * hand size (adjustable in-game)
    this.result = null;            // {x, y (normalised, un-mirrored, filtered), dist, ratio, pinching, stale}
    this.lastSeen = 0;
    this.lastTime = 0;
    this.fx = new OneEuro();
    this.fy = new OneEuro();
    this.lostAt = 0;               // timestamp of first lost-hand frame in the current gap
    this.recreating = false;
  }

  get pinchOff() { return this.pinchOn * 1.5; }

  async init(onStatus = () => {}) {
    onStatus('Requesting webcam...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.video.classList.add('on');

    onStatus('Loading hand-tracking model...');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      // Lower presence/detection thresholds so a hand re-entering the frame is
      // picked up immediately instead of being rejected while "searching".
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.fileset = fileset;
    this.makeLandmarker = async () => {
      try {
        return await HandLandmarker.createFromOptions(fileset, opts('GPU'));
      } catch (e) {
        console.warn('GPU delegate failed, falling back to CPU', e);
        return await HandLandmarker.createFromOptions(fileset, opts('CPU'));
      }
    };
    this.landmarker = await this.makeLandmarker();
    this.ready = true;
  }

  /** Rebuild the landmarker after a long hand loss. MediaPipe's internal tracker can
   *  latch onto the last seen region and re-acquire slowly; a fresh instance searches
   *  the whole frame again right away. */
  async recreate() {
    if (this.recreating) return;
    this.recreating = true;
    this.ready = false;
    try {
      this.landmarker.close();
    } catch (e) { /* ignore */ }
    try {
      this.landmarker = await this.makeLandmarker();
      this.lastVideoTime = -1; // force the next camera frame to be processed
      this.ready = true;
    } catch (e) {
      console.error('landmarker rebuild failed', e);
      this.ready = false;
    } finally {
      this.recreating = false;
    }
  }

  /** Call once per frame. Returns the latest hand sample or null if no hand. */
  detect(now) {
    if (!this.ready || this.video.readyState < 2) return this.result;
    if (this.video.currentTime === this.lastVideoTime) return this.result; // no new camera frame
    this.lastVideoTime = this.video.currentTime;

    const res = this.landmarker.detectForVideo(this.video, now);
    if (!res.landmarks || res.landmarks.length === 0) {
      // Brief dropouts (common while the fingers close) must not release the pinch or reset aim.
      if (this.result && now - this.lastSeen < LOST_GRACE_MS) return this.result;
      if (!this.lostAt) this.lostAt = now;
      // Keep searching every frame; if the hand stays gone long enough, rebuild the
      // landmarker so its tracker forgets the old hand position and re-scans instantly.
      if (now - this.lostAt > REACQUIRE_RESET_MS) {
        this.lostAt = now;
        if (!this.recreating) this.recreate();
      }
      this.pinching = false;
      this.result = null;
      this.fx.reset(); this.fy.reset();
      return null;
    }
    this.lostAt = 0;
    const lm = res.landmarks[0];
    const idx = lm[INDEX_TIP];
    const thumb = lm[THUMB_TIP];

    // Euclidean distance between thumb tip and index tip (normalised coords).
    const dist = Math.hypot(thumb.x - idx.x, thumb.y - idx.y);
    // Normalise by hand size (largest of palm length / palm width, so a hand tilted toward the
    // camera does not shrink the reference and fake a pinch).
    const handSize = Math.max(
      Math.hypot(lm[WRIST].x - lm[MIDDLE_MCP].x, lm[WRIST].y - lm[MIDDLE_MCP].y),
      Math.hypot(lm[INDEX_MCP].x - lm[PINKY_MCP].x, lm[INDEX_MCP].y - lm[PINKY_MCP].y) * 1.1,
    ) || 1;
    const ratio = dist / handSize;

    if (this.pinching) { if (ratio > this.pinchOff) this.pinching = false; }
    else if (ratio < this.pinchOn) this.pinching = true;

    const dt = this.lastTime ? (now - this.lastTime) / 1000 : 1 / 30;
    this.lastTime = now; this.lastSeen = now;
    this.result = {
      x: this.fx.filter(idx.x, dt), y: this.fy.filter(idx.y, dt),
      rawX: idx.x, rawY: idx.y, dist, ratio, pinching: this.pinching,
    };
    return this.result;
  }
}
