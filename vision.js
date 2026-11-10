// Webcam + MediaPipe HandLandmarker wrapper.
import { FilesetResolver, HandLandmarker }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const INDEX_TIP = 8;
const THUMB_TIP = 4;
const WRIST = 0;
const MIDDLE_MCP = 9;

// Pinch hysteresis, as a ratio of (thumb-index distance / hand size).
const PINCH_ON = 0.28;
const PINCH_OFF = 0.45;

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.ready = false;
    this.lastVideoTime = -1;
    this.pinching = false;
    this.result = null; // {x, y (normalised, un-mirrored), dist, ratio, pinching}
  }

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
      minHandDetectionConfidence: 0.7,
      minHandPresenceConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    this.ready = true;
  }

  /** Call once per frame. Returns the latest hand sample or null if no hand. */
  detect(now) {
    if (!this.ready || this.video.readyState < 2) return this.result;
    if (this.video.currentTime === this.lastVideoTime) return this.result; // no new frame
    this.lastVideoTime = this.video.currentTime;

    const res = this.landmarker.detectForVideo(this.video, now);
    if (!res.landmarks || res.landmarks.length === 0) {
      this.pinching = false;
      this.result = null;
      return null;
    }
    const lm = res.landmarks[0];
    const idx = lm[INDEX_TIP];
    const thumb = lm[THUMB_TIP];

    // Euclidean distance between thumb tip and index tip (normalised coords).
    const dist = Math.hypot(thumb.x - idx.x, thumb.y - idx.y);
    // Normalise by hand size so the pinch works at any distance from the camera.
    const handSize = Math.hypot(lm[WRIST].x - lm[MIDDLE_MCP].x, lm[WRIST].y - lm[MIDDLE_MCP].y) || 1;
    const ratio = dist / handSize;

    if (this.pinching) { if (ratio > PINCH_OFF) this.pinching = false; }
    else if (ratio < PINCH_ON) this.pinching = true;

    this.result = { x: idx.x, y: idx.y, dist, ratio, pinching: this.pinching };
    return this.result;
  }
}
