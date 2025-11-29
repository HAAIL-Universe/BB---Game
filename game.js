// ========================================================
// Tilt Platform Runner — core logic
// ========================================================

// High-level idea:
// - Matter.js physics world with gravity pointing down.
// - Static platforms arranged in a line to the right.
// - We ROTATE all platforms together based on phone tilt.
//   This changes the surface angle, so the ball rolls.
// - Camera follows the ball; we spawn new platforms as it moves.
// - Distance travelled = score.

// ------------------------
// 1. Canvas / DOM setup
// ------------------------

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Keep track of viewport size in JS
let width = window.innerWidth;
let height = window.innerHeight;

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
}
resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
  updateOrientationOverlay(); // keep portrait check in sync
});

// HUD elements for debugging + score
const hudTiltX = document.getElementById('hudTiltX');
const hudAngle = document.getElementById('hudAngle');
const hudDistance = document.getElementById('hudDistance');

// Overlays
const overlay = document.getElementById('overlay');
const btnStart = document.getElementById('btnStart');
const statusEl = document.getElementById('status');
const rotateOverlay = document.getElementById('rotateOverlay');

// "Lock" to horizontal by nagging in portrait
function updateOrientationOverlay() {
  const isPortrait = window.innerHeight > window.innerWidth;
  rotateOverlay.style.display = isPortrait ? 'flex' : 'none';
}
window.addEventListener('orientationchange', updateOrientationOverlay);
updateOrientationOverlay();

// ------------------------
// 2. Physics setup (Matter.js)
// ------------------------

const Engine = Matter.Engine;
const World = Matter.World;
const Bodies = Matter.Bodies;
const Body = Matter.Body;

const engine = Engine.create();
const world = engine.world;

// Global world gravity: we keep this constant downward.
// Tilt only affects platform angle, not gravity vector itself.
world.gravity.x = 0;
world.gravity.y = 1; // scaled down later via engine timing

// ------------------------
// 3. Game config (tweakable)
// ------------------------

// Put all magic numbers here so you can tune them easily.
const CONFIG = {
  PLATFORM_LENGTH: 260,       // width of each platform (in world units / pixels)
  PLATFORM_HEIGHT: 20,
  PLATFORM_GAP_MIN: 80,       // minimum gap between platforms
  PLATFORM_GAP_MAX: 140,      // maximum gap
  PLATFORM_Y_BASE_RATIO: 0.6, // base Y as fraction of screen height
  PLATFORM_Y_VARIATION: 60,   // random up/down variation

  MAX_TILT_DEG: 25,           // max device tilt we care about
  MAX_PLATFORM_ANGLE_RAD: Math.PI / 5, // ~36 degrees max platform angle
  PLATFORM_ANGLE_LERP: 8,     // how “stiff” the platform is (higher = snappier)

  CAMERA_LEAD_RATIO: 0.3,     // ball is drawn 30% from left edge
  CAMERA_LERP: 6,             // how quickly camera catches up (higher = snappier)

  KILL_Y_MULTIPLIER: 2.0      // if ball y > height * this, player dies
};

// ------------------------
// 4. World state variables
// ------------------------

// Ball body
let ball;
// All platform bodies
let platforms = [];
// Track end of the right-most platform so we know where to spawn next
let lastPlatformEndX = 0;

// Camera x-offset (we only scroll horizontally)
let cameraX = 0;

// Platform rotation state
let platformAngle = 0;      // current angle in radians
let targetPlatformAngle = 0; // desired angle (from tilt / keys)

// Distance tracking
let startX = 0;            // where the ball started
let distanceTravelled = 0; // updated each frame

// Tilt state (device)
let tiltX = 0; // gamma (left/right)
let useTilt = false; // true when device sensors are enabled

// Keyboard fallback controls (for desktop testing)
const keys = {
  left: false,
  right: false
};

// Game loop timing
let lastTime = null;
let running = false;

// ------------------------
// 5. Utility helpers
// ------------------------

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Simple degrees <-> radians helpers (for HUD/debug)
function radToDeg(rad) {
  return rad * (180 / Math.PI);
}

// ------------------------
// 6. World / level generation
// ------------------------

// Clears physics world and builds a fresh ball + initial platforms
function createWorld() {
  // Remove all bodies from the world (but keep engine instance)
  World.clear(world, false);

  platforms = [];

  const platformLen = CONFIG.PLATFORM_LENGTH;
  const platformH = CONFIG.PLATFORM_HEIGHT;

  // Compute a base Y position for platforms based on current screen height
  const baseY = height * CONFIG.PLATFORM_Y_BASE_RATIO;

  // Create the ball near the first platform
  startX = 0;
  ball = Bodies.circle(startX, baseY - 40, 18, {
    restitution: 0.2,
    friction: 0.05,
    label: 'ball'
  });

  World.add(world, ball);

  // Initial platforms: one slightly behind ball, several ahead
  let currentEndX = startX - platformLen / 2;
  const initialCount = 10;

  for (let i = 0; i < initialCount; i++) {
    const gap = i === 0 ? 0 : randBetween(CONFIG.PLATFORM_GAP_MIN, CONFIG.PLATFORM_GAP_MAX);
    const centerX = currentEndX + gap + platformLen / 2;
    const yVariation = randBetween(-CONFIG.PLATFORM_Y_VARIATION, CONFIG.PLATFORM_Y_VARIATION);
    const centerY = baseY + yVariation;

    const platform = Bodies.rectangle(centerX, centerY, platformLen, platformH, {
      isStatic: true,
      label: 'platform'
    });

    platforms.push(platform);
    World.add(world, platform);

    // Update "end" of platform line
    currentEndX = centerX + platformLen / 2;
  }

  lastPlatformEndX = currentEndX;

  // Reset camera to start
  cameraX = ball.position.x - width * CONFIG.CAMERA_LEAD_RATIO;

  // Reset angles and distance
  platformAngle = 0;
  targetPlatformAngle = 0;
  distanceTravelled = 0;
}

// Spawn a new platform ahead of the last one
function spawnPlatform() {
  const platformLen = CONFIG.PLATFORM_LENGTH;
  const platformH = CONFIG.PLATFORM_HEIGHT;
  const baseY = height * CONFIG.PLATFORM_Y_BASE_RATIO;

  const gap = randBetween(CONFIG.PLATFORM_GAP_MIN, CONFIG.PLATFORM_GAP_MAX);
  const centerX = lastPlatformEndX + gap + platformLen / 2;
  const yVariation = randBetween(-CONFIG.PLATFORM_Y_VARIATION, CONFIG.PLATFORM_Y_VARIATION);
  const centerY = baseY + yVariation;

  const platform = Bodies.rectangle(centerX, centerY, platformLen, platformH, {
    isStatic: true,
    label: 'platform'
  });

  platforms.push(platform);
  World.add(world, platform);

  lastPlatformEndX = centerX + platformLen / 2;
}

// Remove platforms that are far behind the camera (keep world light)
function cullOldPlatforms() {
  const platformLen = CONFIG.PLATFORM_LENGTH;
  const cutoff = cameraX - width * 2; // anything more than 2 screens left of camera is removed

  platforms = platforms.filter(p => {
    const endX = p.position.x + platformLen / 2;
    if (endX < cutoff) {
      World.remove(world, p);
      return false;
    }
    return true;
  });
}

// ------------------------
// 7. Input: tilt + keyboard
// ------------------------

// Device tilt (gamma = left/right) -> we map to target platform angle
window.addEventListener('deviceorientation', (event) => {
  if (!useTilt) return;

  // gamma: left/right tilt (-90 to 90)
  const gamma = event.gamma || 0;
  tiltX = gamma;
});

// Keyboard fallback: left/right arrows control platform angle
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') keys.left = true;
  if (e.key === 'ArrowRight') keys.right = true;
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') keys.left = false;
  if (e.key === 'ArrowRight') keys.right = false;
});

// Computes the desired (target) platform angle based on tilt/keys
function updateTargetPlatformAngle() {
  if (useTilt) {
    // Clamp tilt to a max angle
    const maxTilt = CONFIG.MAX_TILT_DEG;
    const clamped = Math.max(-maxTilt, Math.min(maxTilt, tiltX));
    // Map device deg -> platform radians
    targetPlatformAngle = (clamped / maxTilt) * CONFIG.MAX_PLATFORM_ANGLE_RAD;
  } else {
    // Desktop: press/hold arrows to tip the platforms
    let desired = 0;
    if (keys.left) desired -= CONFIG.MAX_PLATFORM_ANGLE_RAD;
    if (keys.right) desired += CONFIG.MAX_PLATFORM_ANGLE_RAD;
    targetPlatformAngle = desired;
  }
}

// Smoothly moves platformAngle towards targetPlatformAngle
function applyPlatformAngle(dt) {
  updateTargetPlatformAngle();

  const stiffness = CONFIG.PLATFORM_ANGLE_LERP;
  const t = Math.min(1, stiffness * dt); // cap to avoid overshoot

  platformAngle += (targetPlatformAngle - platformAngle) * t;

  // Apply this angle to every platform body
  for (const p of platforms) {
    Body.setAngle(p, platformAngle);
  }
}

// ------------------------
// 8. Camera + distance
// ------------------------

// Camera is just an x-offset; we subtract it when drawing
function updateCamera(dt) {
  // We want the ball to sit at some lead point from the left edge
  const desiredCameraX = ball.position.x - width * CONFIG.CAMERA_LEAD_RATIO;
  const t = Math.min(1, CONFIG.CAMERA_LERP * dt);
  cameraX += (desiredCameraX - cameraX) * t;
}

// Update distance metric for HUD & game-over
function updateDistance() {
  distanceTravelled = Math.max(0, ball.position.x - startX);
  hudDistance.textContent = distanceTravelled.toFixed(0);
}

// ------------------------
// 9. Physics step + fail condition
// ------------------------

function stepPhysics(dtMs) {
  // dtMs is in milliseconds, Engine.update expects ms, and uses world.gravity
  Engine.update(engine, dtMs);

  // If the ball falls too low, treat as "death"
  const killY = height * CONFIG.KILL_Y_MULTIPLIER;
  if (ball.position.y > killY) {
    onPlayerDied();
  }
}

function onPlayerDied() {
  running = false;
  overlay.style.display = 'flex';
  btnStart.textContent = 'Play Again';
  statusEl.textContent = `You fell! Distance: ${distanceTravelled.toFixed(0)} m`;
}

// ------------------------
// 10. Rendering
// ------------------------

// Draw a single rectangular body with camera offset
function drawRectBody(body, fill, stroke) {
  const verts = body.vertices;

  ctx.beginPath();
  ctx.moveTo(verts[0].x - cameraX, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(verts[i].x - cameraX, verts[i].y);
  }
  ctx.closePath();

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function draw() {
  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#020617');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Slight horizon line for orientation
  ctx.strokeStyle = 'rgba(30,64,175,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.7);
  ctx.lineTo(width, height * 0.7);
  ctx.stroke();

  // Draw platforms
  for (const p of platforms) {
    drawRectBody(p, '#111827', '#1f2937');
  }

  // Draw the ball
  ctx.save();
  const screenX = ball.position.x - cameraX;
  const screenY = ball.position.y;

  ctx.beginPath();
  ctx.arc(screenX, screenY, ball.circleRadius, 0, Math.PI * 2);

  const bGrad = ctx.createRadialGradient(
    screenX - ball.circleRadius / 2,
    screenY - ball.circleRadius / 2,
    4,
    screenX,
    screenY,
    ball.circleRadius * 1.4
  );
  bGrad.addColorStop(0, '#60a5fa');
  bGrad.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = bGrad;
  ctx.fill();

  // Optional shiny ring
  ctx.strokeStyle = 'rgba(191, 219, 254, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(screenX - 3, screenY - 3, ball.circleRadius * 0.7, -0.9, 0.5);
  ctx.stroke();

  ctx.restore();

  // HUD: tilt + angle
  hudTiltX.textContent = useTilt ? tiltX.toFixed(1) : 'KB';
  hudAngle.textContent = `${radToDeg(platformAngle).toFixed(1)}°`;
}

// ------------------------
// 11. Main loop
// ------------------------

function loop(timestamp) {
  if (!running) return;

  if (lastTime == null) lastTime = timestamp;
  const dtMs = timestamp - lastTime;
  lastTime = timestamp;
  const dt = dtMs / 1000; // seconds

  // Core update steps
  applyPlatformAngle(dt);
  stepPhysics(dtMs);
  updateCamera(dt);
  updateDistance();

  // Spawn / cull platforms as needed
  maybeSpawnPlatforms();
  cullOldPlatforms();

  // Render
  draw();

  requestAnimationFrame(loop);
}

// Spawn enough platforms ahead of the camera so we don't run out
function maybeSpawnPlatforms() {
  const aheadThreshold = cameraX + width * 2; // 2 screens ahead of camera
  while (lastPlatformEndX < aheadThreshold) {
    spawnPlatform();
  }
}

// ------------------------
// 12. Start / restart + tilt permission
// ------------------------

async function enableTiltIfPossible() {
  useTilt = false;

  // iOS (require explicit permission)
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        useTilt = true;
        statusEl.textContent = 'Tilt controls enabled (iOS).';
      } else {
        statusEl.textContent = 'Tilt permission denied. Use arrow keys on desktop.';
      }
    } catch (err) {
      statusEl.textContent = 'Tilt permission error. Use keyboard on desktop.';
    }
  } else if (typeof DeviceOrientationEvent !== 'undefined') {
    // Android / other devices that expose orientation directly
    useTilt = true;
    statusEl.textContent = 'Tilt controls enabled.';
  } else {
    statusEl.textContent = 'No motion sensors detected. Keyboard only.';
  }
}

async function startGame() {
  // If user is in portrait, nag them and don't start
  if (window.innerHeight > window.innerWidth) {
    updateOrientationOverlay();
    statusEl.textContent = 'Rotate device to landscape before starting.';
    return;
  }

  statusEl.textContent = 'Starting…';

  await enableTiltIfPossible();

  // Reset game state
  createWorld();
  overlay.style.display = 'none';

  running = true;
  lastTime = null;
  requestAnimationFrame(loop);
}

// Wire start button
btnStart.addEventListener('click', startGame);

// Build an initial world so there is something under the overlay
createWorld();
draw();
