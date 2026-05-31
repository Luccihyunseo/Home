const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });
const video = document.getElementById("camera");
const lensCanvas = document.getElementById("lensCanvas");
const lensCtx = lensCanvas.getContext("2d");

const cameraButton = document.getElementById("cameraButton");
const micButton = document.getElementById("micButton");
const clearButton = document.getElementById("clearButton");
const cameraStatus = document.getElementById("cameraStatus");
const gestureStatus = document.getElementById("gestureStatus");
const soundStatus = document.getElementById("soundStatus");

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
  trail: [],
  drawing: false,
  pointerDown: false,
  lastPoint: null,
  lastTime: performance.now(),
  cameraReady: false,
  micReady: false,
  blowCooldown: 0,
  gestureCooldown: 0,
  bgWisps: [],
  tracker: {
    sample: document.createElement("canvas"),
    previous: null,
    point: null,
    lastPoint: null,
    velocity: 0,
    lostFrames: 0,
    frameSkip: 0,
  },
};

const trackerCtx = state.tracker.sample.getContext("2d", {
  willReadFrequently: true,
});

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

function normalizePath(points, maxPoints = 130) {
  if (points.length <= maxPoints) return points.slice();
  const step = points.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(points[Math.floor(i * step)]);
  }
  return out;
}

function pathBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function countCorners(points, bounds) {
  const simplified = normalizePath(points, 28);
  let corners = 0;
  const minTurn = Math.PI * 0.34;
  const minSide = Math.max(10, Math.min(bounds.width, bounds.height) * 0.12);

  for (let i = 1; i < simplified.length - 1; i += 1) {
    const a = simplified[i - 1];
    const b = simplified[i];
    const c = simplified[i + 1];
    if (distance(a, b) < minSide || distance(b, c) < minSide) continue;
    const ab = Math.atan2(b.y - a.y, b.x - a.x);
    const bc = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(ab - bc);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn > minTurn) corners += 1;
  }
  return corners;
}

function radialExtrema(points, bounds) {
  const center = { x: bounds.cx, y: bounds.cy };
  const sample = normalizePath(points, 48).map((p) => distance(p, center));
  let peaks = 0;
  for (let i = 1; i < sample.length - 1; i += 1) {
    if (sample[i] > sample[i - 1] && sample[i] > sample[i + 1]) {
      const localAverage = (sample[i - 1] + sample[i + 1]) / 2;
      if (sample[i] > localAverage * 1.12) peaks += 1;
    }
  }
  return peaks;
}

function recognizeShape(points) {
  const clean = normalizePath(points.filter(Boolean), 160);
  const bounds = pathBounds(clean);
  const minSize = Math.min(bounds.width, bounds.height);
  const maxSize = Math.max(bounds.width, bounds.height);
  const closed = distance(clean[0], clean[clean.length - 1]) < Math.max(26, maxSize * 0.28);
  const area = polygonArea(clean);
  const length = pathLength(clean);
  const circularity = length > 0 ? (4 * Math.PI * area) / (length * length) : 0;
  const ratio = minSize / Math.max(1, maxSize);
  const corners = countCorners(clean, bounds);
  const peaks = radialExtrema(clean, bounds);

  if (closed && peaks >= 5 && corners >= 6) return "star";
  if (closed && ratio > 0.72 && circularity > 0.55 && corners < 7) return "circle";
  if (closed && ratio > 0.62 && corners >= 3 && corners <= 8) return "square";
  if (!closed && corners >= 5 && peaks >= 4) return "star";
  return "free";
}

function startDrawing(point) {
  if (!point || state.gestureCooldown > 0) return;
  state.drawing = true;
  state.trail = [point];
  state.lastPoint = point;
  gestureStatus.textContent = "Drawing";
  gestureStatus.classList.add("status-chip--hot");
  addSpark(point.x, point.y, 10, 0.65);
}

function addPoint(point, source = "pointer") {
  if (!point) return;
  const now = performance.now();
  if (!state.drawing) {
    if (source === "pointer" || state.tracker.velocity > 46) {
      startDrawing(point);
    }
    return;
  }

  const last = state.trail[state.trail.length - 1];
  if (!last || distance(last, point) > 4) {
    state.trail.push({ ...point, t: now });
    state.lastPoint = point;
    if (Math.random() > 0.6) addParticle(point.x, point.y, 1, 0.42);
  }

  const enoughPath = state.trail.length > 26 && pathLength(state.trail) > 130;
  const closeEnough =
    enoughPath &&
    distance(state.trail[0], state.trail[state.trail.length - 1]) <
      Math.max(30, Math.min(state.width, state.height) * 0.045);

  if (closeEnough) {
    finishDrawing();
  }
}

function finishDrawing(force = false) {
  if (!state.drawing || state.trail.length < 8) {
    state.drawing = false;
    return;
  }

  const bounds = pathBounds(state.trail);
  if (!force && Math.max(bounds.width, bounds.height) < 42) return;

  const type = recognizeShape(state.trail);
  const size = clamp(Math.max(bounds.width, bounds.height) * 0.44, 34, 118);
  const x = state.width / 2 + (Math.random() - 0.5) * Math.min(110, state.width * 0.16);
  const y = Math.max(88, state.height * 0.22);
  const color = randomColor();

  spawnShape(type, x, y, size, color);
  burst(x, y, color, type === "free" ? 18 : 28);
  state.drawing = false;
  state.trail = [];
  state.gestureCooldown = 0.32;
  gestureStatus.textContent = `${type.toUpperCase()} made`;
  setTimeout(() => {
    if (!state.drawing) gestureStatus.textContent = "Draw ready";
  }, 900);
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
    path: type === "free" ? normalizeFreePath(state.trail, size) : null,
  };

  state.bodies.push(body);
  if (state.bodies.length > 130) state.bodies.splice(0, state.bodies.length - 130);
}

function normalizeFreePath(points, size) {
  const bounds = pathBounds(points);
  const scale = size / Math.max(bounds.width, bounds.height, 1);
  return normalizePath(points, 60).map((p) => ({
    x: (p.x - bounds.cx) * scale,
    y: (p.y - bounds.cy) * scale,
  }));
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

function scatterBodies(power = 1) {
  const center = { x: state.width / 2, y: state.height * 0.72 };
  for (const body of state.bodies) {
    const dx = body.x - center.x || Math.random() - 0.5;
    const dy = body.y - center.y || Math.random() - 0.5;
    const len = Math.hypot(dx, dy) || 1;
    const impulse = (360 + Math.random() * 420) * power;
    body.vx += (dx / len) * impulse + (Math.random() - 0.5) * 220;
    body.vy += -Math.abs(dy / len) * impulse - 180 - Math.random() * 260;
    body.av += (Math.random() - 0.5) * 7;
    burst(body.x, body.y, body.color, 10);
  }
  soundStatus.textContent = "Blow";
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
  } else {
    drawFree(body.path, body.color);
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

function drawFree(path, color) {
  if (!path || path.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i += 1) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.stroke();
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

function drawTrail() {
  if (!state.trail.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#19b8ff";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = "rgba(245,247,255,0.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(state.trail[0].x, state.trail[0].y);
  for (let i = 1; i < state.trail.length; i += 1) {
    const p = state.trail[i];
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  for (let i = 0; i < state.trail.length; i += 8) {
    const p = state.trail[i];
    ctx.fillStyle = palette[(i / 8) % palette.length | 0];
    ctx.globalAlpha = 0.86;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
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
  drawTrail();
  drawCursor(state.tracker.point);
}

function animate(now) {
  const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
  state.lastTime = now;
  state.gestureCooldown = Math.max(0, state.gestureCooldown - dt);
  state.blowCooldown = Math.max(0, state.blowCooldown - dt);

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

canvas.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  canvas.setPointerCapture(event.pointerId);
  startDrawing(pointerPoint(event));
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.pointerDown) return;
  addPoint(pointerPoint(event), "pointer");
});

canvas.addEventListener("pointerup", (event) => {
  if (state.pointerDown) {
    addPoint(pointerPoint(event), "pointer");
    finishDrawing(true);
  }
  state.pointerDown = false;
});

canvas.addEventListener("pointercancel", () => {
  state.pointerDown = false;
  finishDrawing(true);
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "b") scatterBodies(0.85);
  if (event.key.toLowerCase() === "r") clearScene();
});

function clearScene() {
  state.bodies = [];
  state.particles = [];
  state.sparks = [];
  state.trail = [];
  state.drawing = false;
  gestureStatus.textContent = "Draw ready";
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

micButton.addEventListener("click", async () => {
  if (state.micReady) {
    stopMic();
  } else {
    await startMic();
  }
});

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "No camera";
    return;
  }

  try {
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
  } catch (error) {
    cameraStatus.textContent = "Camera blocked";
  }
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
  state.cameraReady = false;
  state.tracker.previous = null;
  state.tracker.point = null;
  cameraButton.classList.remove("is-active");
  cameraStatus.textContent = "Camera off";
  lensCtx.clearRect(0, 0, lensCanvas.width, lensCanvas.height);
}

let audioContext;
let analyser;
let micStream;
let micData;

async function startMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    soundStatus.textContent = "No mic";
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(micStream).connect(analyser);
    micData = new Uint8Array(analyser.frequencyBinCount);
    state.micReady = true;
    micButton.classList.add("is-active");
    soundStatus.textContent = "Mic on";
    monitorMic();
  } catch (error) {
    soundStatus.textContent = "Mic blocked";
  }
}

function stopMic() {
  if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
  }
  if (audioContext) audioContext.close();
  micStream = null;
  audioContext = null;
  analyser = null;
  state.micReady = false;
  micButton.classList.remove("is-active");
  soundStatus.textContent = "Mic off";
}

function monitorMic() {
  if (!state.micReady || !analyser) return;
  analyser.getByteTimeDomainData(micData);
  let sum = 0;
  let peak = 0;
  for (const value of micData) {
    const centered = Math.abs(value - 128) / 128;
    sum += centered * centered;
    peak = Math.max(peak, centered);
  }
  const rms = Math.sqrt(sum / micData.length);
  if ((rms > 0.12 || peak > 0.52) && state.blowCooldown <= 0) {
    state.blowCooldown = 1.2;
    scatterBodies(clamp(rms * 5.5, 0.7, 1.6));
  } else if (state.blowCooldown <= 0.1) {
    soundStatus.textContent = "Mic on";
  }
  requestAnimationFrame(monitorMic);
}

function updateTracker() {
  if (!state.cameraReady || video.readyState < 2) return;
  state.tracker.frameSkip = (state.tracker.frameSkip + 1) % 2;
  if (state.tracker.frameSkip) return;

  const sampleWidth = 112;
  const sampleHeight = 84;
  state.tracker.sample.width = sampleWidth;
  state.tracker.sample.height = sampleHeight;
  trackerCtx.save();
  trackerCtx.scale(-1, 1);
  trackerCtx.drawImage(video, -sampleWidth, 0, sampleWidth, sampleHeight);
  trackerCtx.restore();

  const frame = trackerCtx.getImageData(0, 0, sampleWidth, sampleHeight);
  const data = frame.data;
  const previous = state.tracker.previous;
  let total = 0;
  let sx = 0;
  let sy = 0;
  let best = null;

  for (let y = 0; y < sampleHeight; y += 2) {
    for (let x = 0; x < sampleWidth; x += 2) {
      const index = (y * sampleWidth + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const brightness = (r + g + b) / 3;
      let motion = 0;
      if (previous) {
        motion =
          Math.abs(r - previous[index]) +
          Math.abs(g - previous[index + 1]) +
          Math.abs(b - previous[index + 2]);
      }

      const skinish = r > 72 && g > 46 && b > 34 && r > b * 1.08 && r > g * 0.82;
      const saturated = Math.max(r, g, b) - Math.min(r, g, b) > 36;
      const score = motion * 0.72 + (skinish ? 42 : 0) + (saturated ? 14 : 0) + brightness * 0.04;

      if (score > 52) {
        const weight = Math.min(255, score);
        total += weight;
        sx += x * weight;
        sy += y * weight;
        if (!best || score > best.score || y < best.y - 4) best = { x, y, score };
      }
    }
  }

  drawLens(frame, sampleWidth, sampleHeight, best, previous);
  state.tracker.previous = new Uint8ClampedArray(data);

  if (total < 1600) {
    state.tracker.lostFrames += 1;
    if (state.tracker.lostFrames > 8) {
      state.tracker.point = null;
      if (state.drawing && !state.pointerDown) finishDrawing(true);
    }
    return;
  }

  state.tracker.lostFrames = 0;
  const centroid = { x: sx / total, y: sy / total };
  const selected = best ? { x: best.x * 0.58 + centroid.x * 0.42, y: best.y * 0.62 + centroid.y * 0.38 } : centroid;
  const point = {
    x: (selected.x / sampleWidth) * state.width,
    y: (selected.y / sampleHeight) * state.height,
    t: performance.now(),
  };

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
  addPoint(smoothed, "camera");

  if (state.drawing && state.trail.length > 46) {
    const age = performance.now() - (state.trail[0].t || performance.now());
    if (age > 3200) finishDrawing(true);
  }
}

function drawLens(frame, width, height, best, previous) {
  lensCtx.clearRect(0, 0, lensCanvas.width, lensCanvas.height);
  lensCtx.save();
  lensCtx.scale(-1, 1);
  lensCtx.drawImage(video, -lensCanvas.width, 0, lensCanvas.width, lensCanvas.height);
  lensCtx.restore();
  lensCtx.fillStyle = "rgba(8, 9, 11, 0.42)";
  lensCtx.fillRect(0, 0, lensCanvas.width, lensCanvas.height);

  const data = frame.data;
  const scaleX = lensCanvas.width / width;
  const scaleY = lensCanvas.height / height;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const motion = previous
        ? Math.abs(r - previous[index]) +
          Math.abs(g - previous[index + 1]) +
          Math.abs(b - previous[index + 2])
        : 0;
      if (motion > 70) {
        lensCtx.fillStyle = palette[(x + y) % palette.length];
        lensCtx.fillRect(x * scaleX, y * scaleY, 3, 3);
      }
    }
  }

  if (best) {
    lensCtx.strokeStyle = "#b8ff2c";
    lensCtx.lineWidth = 2;
    lensCtx.beginPath();
    lensCtx.arc(best.x * scaleX, best.y * scaleY, 9, 0, Math.PI * 2);
    lensCtx.stroke();
  }
}

resize();
window.addEventListener("resize", resize);
requestAnimationFrame(animate);
