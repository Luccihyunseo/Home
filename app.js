import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });
const video = document.getElementById("camera");
const lensCanvas = document.getElementById("lensCanvas");
const lensCtx = lensCanvas.getContext("2d");

const cameraButton = document.getElementById("cameraButton");
const clearButton = document.getElementById("clearButton");
const cameraStatus = document.getElementById("cameraStatus");
const gestureStatus = document.getElementById("gestureStatus");

const DPR_LIMIT = 2;
const palette = [
  "#b8ff2c",
  "#19b8ff",
  "#b68cff",
  "#ff5cc8",
  "#ff9a72",
  "#fff05c",
  "#f5f7ff",
  "#b9a51d",
];

const state = {
  width: 1,
  height: 1,
  dpr: 1,
  bodies: [],
  particles: [],
  sparks: [],
  lastPoint: null,
  lastTime: performance.now(),
  cameraReady: false,
  handLandmarker: null,
  handLandmarkerReady: false,
  handLandmarkerLoading: false,
  handLandmarkerPromise: null,
  gestureCooldown: 0,
  bgWisps: [],
  tracker: {
    point: null,
    lastPoint: null,
    velocity: 0,
    lostFrames: 0,
    frameSkip: 0,
    pinchHold: 0,
    pinching: false,
    landmarks: null,
    pinchRatio: Infinity,
  },
};

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  lensCanvas.width = 320;
  lensCanvas.height = 240;
  seedWisps();
}

function seedWisps() {
  if (state.bgWisps.length) return;
  const edges = [
    { x: 0.12, y: 0.08, vx: 16, vy: 10 },
    { x: 0.82, y: 0.18, vx: -12, vy: 15 },
    { x: 0.2, y: 0.86, vx: 11, vy: -14 },
    { x: 0.88, y: 0.82, vx: -18, vy: -9 },
  ];
  state.bgWisps = edges.map((edge, index) => ({
    x: edge.x * state.width,
    y: edge.y * state.height,
    vx: edge.vx,
    vy: edge.vy,
    r: 260 + index * 46,
    phase: Math.random() * Math.PI * 2,
  }));
}

function randomColor() {
  return palette[Math.floor(Math.random() * palette.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function randomShapeType() {
  const types = ["circle", "square", "star"];
  return types[Math.floor(Math.random() * types.length)];
}

function triggerPinch(point) {
  if (!point || state.gestureCooldown > 0) return;
  const type = randomShapeType();
  const size = 46 + Math.random() * 72;
  const color = randomColor();
  spawnShape(type, point.x, point.y, size, color);
  burst(point.x, point.y, color, 20);
  addSpark(point.x, point.y, 12, 0.62);
  state.gestureCooldown = 0.58;
  gestureStatus.textContent = "Pinch point";
  setTimeout(() => {
    gestureStatus.textContent = "Pinch ready";
  }, 720);
}

function emitScatterTrail(point, velocity = 0) {
  if (!point) return;
  const intensity = clamp(velocity / 900, 0.2, 0.9);
  const count = velocity > 220 ? 2 : 1;
  if (Math.random() < 0.55) addParticle(point.x, point.y, count, intensity);
}

function spawnShape(type, x, y, size, color) {
  const body = {
    id: globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    type,
    x,
    y,
    vx: (Math.random() - 0.5) * 140,
    vy: -40 - Math.random() * 90,
    r: size * (type === "square" ? 0.62 : 0.58),
    size,
    color,
    angle: Math.random() * Math.PI * 2,
    av: (Math.random() - 0.5) * 2.4,
    life: 1,
    wobble: Math.random() * Math.PI * 2,
  };

  state.bodies.push(body);
  if (state.bodies.length > 130) state.bodies.splice(0, state.bodies.length - 130);
}

function addParticle(x, y, count = 1, intensity = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (40 + Math.random() * 190) * intensity;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 7,
      type: Math.random() > 0.72 ? "square" : Math.random() > 0.5 ? "dot" : "cross",
      color: randomColor(),
      life: 0.42 + Math.random() * 0.58,
      maxLife: 1,
      angle: Math.random() * Math.PI * 2,
      av: (Math.random() - 0.5) * 9,
    });
  }
}

function addSpark(x, y, count = 8, intensity = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.18;
    const speed = (80 + Math.random() * 220) * intensity;
    state.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      length: 12 + Math.random() * 30,
      color: randomColor(),
      life: 0.22 + Math.random() * 0.34,
      maxLife: 0.56,
    });
  }
}

function burst(x, y, color, count) {
  addSpark(x, y, Math.floor(count * 0.46), 0.9);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 300;
    state.particles.push({
      x: x + (Math.random() - 0.5) * 34,
      y: y + (Math.random() - 0.5) * 34,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 12,
      type: Math.random() > 0.82 ? "star" : Math.random() > 0.45 ? "square" : "dot",
      color: Math.random() > 0.34 ? color : randomColor(),
      life: 0.62 + Math.random() * 0.78,
      maxLife: 1.4,
      angle: Math.random() * Math.PI * 2,
      av: (Math.random() - 0.5) * 10,
    });
  }
}

function updatePhysics(dt) {
  const gravity = 820;
  const floor = state.height - 78;

  for (const body of state.bodies) {
    body.vy += gravity * dt;
    body.vx *= 0.996;
    body.av *= 0.995;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.angle += body.av * dt;
    body.wobble += dt * 1.5;

    if (body.x - body.r < 12) {
      body.x = 12 + body.r;
      body.vx = Math.abs(body.vx) * 0.42;
    } else if (body.x + body.r > state.width - 12) {
      body.x = state.width - 12 - body.r;
      body.vx = -Math.abs(body.vx) * 0.42;
    }

    if (body.y + body.r > floor) {
      body.y = floor - body.r;
      body.vy *= -0.24;
      body.vx *= 0.86;
      body.av *= 0.76;
      if (Math.abs(body.vy) < 42) body.vy = 0;
    }
  }

  for (let i = 0; i < state.bodies.length; i += 1) {
    for (let j = i + 1; j < state.bodies.length; j += 1) {
      const a = state.bodies[i];
      const b = state.bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const minDist = (a.r + b.r) * 0.86;
      if (dist >= minDist) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      const split = overlap * 0.5;
      a.x -= nx * split;
      a.y -= ny * split;
      b.x += nx * split;
      b.y += ny * split;

      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const separating = rvx * nx + rvy * ny;
      if (separating > 0) continue;

      const impulse = -separating * 0.42;
      a.vx -= nx * impulse;
      a.vy -= ny * impulse;
      b.vx += nx * impulse;
      b.vy += ny * impulse;
      a.av += (Math.random() - 0.5) * 0.14;
      b.av += (Math.random() - 0.5) * 0.14;
    }
  }

  for (const particle of state.particles) {
    particle.life -= dt;
    particle.vy += 190 * dt;
    particle.vx *= 0.985;
    particle.vy *= 0.985;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.angle += particle.av * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  for (const spark of state.sparks) {
    spark.life -= dt;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vx *= 0.92;
    spark.vy *= 0.92;
  }
  state.sparks = state.sparks.filter((s) => s.life > 0);
}

function drawBackground(dt) {
  ctx.fillStyle = "#08090b";
  ctx.fillRect(0, 0, state.width, state.height);

  for (const wisp of state.bgWisps) {
    wisp.phase += dt;
    wisp.x += wisp.vx * dt;
    wisp.y += wisp.vy * dt;

    if (wisp.x < -wisp.r * 0.35 || wisp.x > state.width + wisp.r * 0.35) {
      wisp.vx *= -1;
    }
    if (wisp.y < -wisp.r * 0.35 || wisp.y > state.height + wisp.r * 0.35) {
      wisp.vy *= -1;
    }

    const alpha = 0.052 + Math.sin(wisp.phase) * 0.012;
    const gradient = ctx.createRadialGradient(wisp.x, wisp.y, 0, wisp.x, wisp.y, wisp.r);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    gradient.addColorStop(0.44, `rgba(255, 255, 255, ${alpha * 0.38})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
  }

  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18, state.height - 78);
  ctx.lineTo(state.width - 18, state.height - 78);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawShape(body) {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  ctx.shadowColor = body.color;
  ctx.shadowBlur = 18;
  ctx.lineWidth = Math.max(2, body.size * 0.07);
  ctx.strokeStyle = body.color;
  ctx.fillStyle = body.color;
  ctx.globalAlpha = body.life;

  if (body.type === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, body.size * 0.42, 0, Math.PI * 2);
    ctx.fill();
  } else if (body.type === "square") {
    const s = body.size * 0.72;
    ctx.fillRect(-s / 2, -s / 2, s, s);
  } else if (body.type === "star") {
    drawStar(0, 0, body.size * 0.46, body.size * 0.18, 8);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 1.2;
  if (body.type === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, body.size * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  } else if (body.type === "square") {
    const s = body.size * 0.72;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
  }
  ctx.restore();
}

function drawStar(x, y, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawParticle(particle) {
  const alpha = clamp(particle.life / particle.maxLife, 0, 1);
  ctx.save();
  ctx.translate(particle.x, particle.y);
  ctx.rotate(particle.angle);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = particle.color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = particle.color;
  ctx.strokeStyle = particle.color;
  ctx.lineWidth = 1.6;

  if (particle.type === "square") {
    ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
  } else if (particle.type === "star") {
    drawStar(0, 0, particle.size, particle.size * 0.34, 4);
    ctx.fill();
  } else if (particle.type === "cross") {
    ctx.beginPath();
    ctx.moveTo(-particle.size, 0);
    ctx.lineTo(particle.size, 0);
    ctx.moveTo(0, -particle.size);
    ctx.lineTo(0, particle.size);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, particle.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCursor(point) {
  if (!point) return;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.shadowColor = "#b8ff2c";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "rgba(184,255,44,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(14, 0);
  ctx.moveTo(0, -14);
  ctx.lineTo(0, 14);
  ctx.stroke();
  ctx.restore();
}

function render(dt) {
  drawBackground(dt);

  for (const particle of state.particles) drawParticle(particle);

  for (const spark of state.sparks) {
    const alpha = clamp(spark.life / spark.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = spark.color;
    ctx.shadowColor = spark.color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(spark.x, spark.y);
    ctx.lineTo(
      spark.x - (spark.vx / 240) * spark.length,
      spark.y - (spark.vy / 240) * spark.length,
    );
    ctx.stroke();
    ctx.restore();
  }

  for (const body of state.bodies) drawShape(body);
  drawCursor(state.tracker.point);
}

function animate(now) {
  const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
  state.lastTime = now;
  state.gestureCooldown = Math.max(0, state.gestureCooldown - dt);

  updateTracker();
  updatePhysics(dt);
  render(dt);

  requestAnimationFrame(animate);
}

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    t: performance.now(),
  };
}

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r") clearScene();
});

function clearScene() {
  state.bodies = [];
  state.particles = [];
  state.sparks = [];
  state.tracker.pinching = false;
  state.tracker.pinchHold = 0;
  gestureStatus.textContent = "Pinch ready";
  addSpark(state.width / 2, state.height - 90, 16, 0.55);
}

clearButton.addEventListener("click", clearScene);

cameraButton.addEventListener("click", async () => {
  if (state.cameraReady) {
    stopCamera();
  } else {
    await startCamera();
  }
});

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "No camera";
    return;
  }

  try {
    await ensureHandLandmarker();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    state.cameraReady = true;
    cameraButton.classList.add("is-active");
    cameraStatus.textContent = "Camera on";
    gestureStatus.textContent = "Pinch ready";
  } catch (error) {
    cameraStatus.textContent = state.handLandmarkerReady ? "Camera blocked" : "Model blocked";
  }
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
  state.cameraReady = false;
  state.tracker.point = null;
  state.tracker.landmarks = null;
  cameraButton.classList.remove("is-active");
  cameraStatus.textContent = "Camera off";
  lensCtx.clearRect(0, 0, lensCanvas.width, lensCanvas.height);
}

async function ensureHandLandmarker() {
  if (state.handLandmarkerReady) return;
  if (state.handLandmarkerPromise) return state.handLandmarkerPromise;

  state.handLandmarkerLoading = true;
  cameraStatus.textContent = "Loading model";
  state.handLandmarkerPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
      );
      const options = {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.58,
        minHandPresenceConfidence: 0.58,
        minTrackingConfidence: 0.62,
      };

      try {
        state.handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      } catch (error) {
        options.baseOptions.delegate = "CPU";
        state.handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      }
      state.handLandmarkerReady = true;
    } finally {
      state.handLandmarkerLoading = false;
      state.handLandmarkerPromise = null;
    }
  })();
  return state.handLandmarkerPromise;
}

function landmarkDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.34);
}

function mirroredPoint(landmark) {
  return {
    x: (1 - landmark.x) * state.width,
    y: landmark.y * state.height,
    t: performance.now(),
  };
}

function detectPinch(pinchRatio, point) {
  const pinchCandidate = pinchRatio < 0.42 && state.tracker.velocity < 1250;

  if (pinchCandidate) {
    state.tracker.pinchHold += 1;
    gestureStatus.textContent = "Pinching";
  } else {
    state.tracker.pinchHold = Math.max(0, state.tracker.pinchHold - 1);
    if (!state.tracker.pinching && state.gestureCooldown <= 0) {
      gestureStatus.textContent = "Pinch ready";
    }
  }

  if (state.tracker.pinchHold >= 4 && !state.tracker.pinching) {
    state.tracker.pinching = true;
    triggerPinch(point);
  }

  if (!pinchCandidate && state.tracker.pinching) {
    state.tracker.pinching = false;
  }
}

function updateTracker() {
  if (!state.cameraReady || !state.handLandmarkerReady || video.readyState < 2) return;
  state.tracker.frameSkip = (state.tracker.frameSkip + 1) % 2;
  if (state.tracker.frameSkip) return;

  const results = state.handLandmarker.detectForVideo(video, performance.now());
  const landmarks = results.landmarks?.[0];
  state.tracker.landmarks = landmarks || null;
  drawLens(landmarks);

  if (!landmarks) {
    state.tracker.lostFrames += 1;
    if (state.tracker.lostFrames > 8) {
      state.tracker.point = null;
      state.tracker.pinching = false;
      state.tracker.pinchHold = 0;
      if (state.gestureCooldown <= 0) gestureStatus.textContent = "Pinch ready";
    }
    return;
  }

  state.tracker.lostFrames = 0;
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const wrist = landmarks[0];
  const middleBase = landmarks[9];
  const palmScale = Math.max(0.001, landmarkDistance(wrist, middleBase));
  const pinchRatio = landmarkDistance(indexTip, thumbTip) / palmScale;
  const point = mirroredPoint(indexTip);
  state.tracker.pinchRatio = pinchRatio;

  const last = state.tracker.lastPoint;
  if (last) {
    const dt = Math.max(16, point.t - last.t);
    state.tracker.velocity = (distance(point, last) / dt) * 1000;
  }
  state.tracker.lastPoint = point;

  const smoothed = state.tracker.point
    ? {
        x: state.tracker.point.x * 0.62 + point.x * 0.38,
        y: state.tracker.point.y * 0.62 + point.y * 0.38,
        t: point.t,
      }
    : point;

  state.tracker.point = smoothed;
  emitScatterTrail(smoothed, state.tracker.velocity);
  detectPinch(pinchRatio, smoothed);
}

function drawLens(landmarks) {
  lensCtx.clearRect(0, 0, lensCanvas.width, lensCanvas.height);
  lensCtx.save();
  lensCtx.scale(-1, 1);
  lensCtx.drawImage(video, -lensCanvas.width, 0, lensCanvas.width, lensCanvas.height);
  lensCtx.restore();
  lensCtx.fillStyle = "rgba(8, 9, 11, 0.42)";
  lensCtx.fillRect(0, 0, lensCanvas.width, lensCanvas.height);

  if (!landmarks) return;

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
  ];

  lensCtx.strokeStyle = "rgba(184, 255, 44, 0.74)";
  lensCtx.lineWidth = 1.4;
  for (const [a, b] of connections) {
    lensCtx.beginPath();
    lensCtx.moveTo((1 - landmarks[a].x) * lensCanvas.width, landmarks[a].y * lensCanvas.height);
    lensCtx.lineTo((1 - landmarks[b].x) * lensCanvas.width, landmarks[b].y * lensCanvas.height);
    lensCtx.stroke();
  }

  for (let i = 0; i < landmarks.length; i += 1) {
    const point = landmarks[i];
    lensCtx.fillStyle = i === 4 || i === 8 ? "#b8ff2c" : "rgba(245, 247, 255, 0.82)";
    lensCtx.beginPath();
    lensCtx.arc((1 - point.x) * lensCanvas.width, point.y * lensCanvas.height, i === 4 || i === 8 ? 5 : 2.8, 0, Math.PI * 2);
    lensCtx.fill();
  }
}

resize();
window.addEventListener("resize", resize);
requestAnimationFrame(animate);
