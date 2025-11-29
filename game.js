// ===== Basic setup =====
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width = window.innerWidth;
let height = window.innerHeight;

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// HUD refs
const hudTiltX = document.getElementById('hudTiltX');
const hudTiltY = document.getElementById('hudTiltY');
const hudEffect = document.getElementById('hudEffect');

// Overlay refs
const overlay = document.getElementById('overlay');
const btnStart = document.getElementById('btnStart');
const statusEl = document.getElementById('status');

// ===== Matter.js aliases =====
const Engine = Matter.Engine;
const World = Matter.World;
const Bodies = Matter.Bodies;
const Events = Matter.Events;

// Physics engine
const engine = Engine.create();
const world = engine.world;

// Lower world gravity by default (we'll override with tilt)
world.gravity.x = 0;
world.gravity.y = 0.001;

// ===== Game objects =====
let ball;
let ground;
let leftWall;
let rightWall;
let ceiling;
let platform;
let goal;
let pickup;

const gameObjects = [];

// Player state / effect logic
const playerState = {
  effect: null,       // 'low_gravity', etc.
  effectTimeLeft: 0,  // seconds
};

// Tilt state
let tiltX = 0;
let tiltY = 0;
let useTilt = false;

// Timing
let lastTime = null;
let running = false;

// ===== Helpers =====
function createWorld() {
  World.clear(world, false);

  gameObjects.length = 0;

  // Boundaries
  const thickness = 40;
  ground = Bodies.rectangle(width / 2, height + thickness / 2, width * 2, thickness, {
    isStatic: true,
    label: 'ground'
  });
  ceiling = Bodies.rectangle(width / 2, -thickness / 2, width * 2, thickness, {
    isStatic: true,
    label: 'ceiling'
  });
  leftWall = Bodies.rectangle(-thickness / 2, height / 2, thickness, height * 2, {
    isStatic: true,
    label: 'wall'
  });
  rightWall = Bodies.rectangle(width + thickness / 2, height / 2, thickness, height * 2, {
    isStatic: true,
    label: 'wall'
  });

  // Simple platform in middle
  platform = Bodies.rectangle(width * 0.5, height * 0.65, width * 0.4, 14, {
    isStatic: true,
    label: 'platform'
  });

  // Ball (player)
  ball = Bodies.circle(width * 0.15, height * 0.3, 18, {
    restitution: 0.2,
    friction: 0.05,
    label: 'ball'
  });

  // Goal zone on the right
  goal = Bodies.rectangle(width * 0.85, height * 0.3, 40, 80, {
    isStatic: true,
    isGoal: true,
    label: 'goal'
  });

  // Pickup orb
  pickup = Bodies.circle(width * 0.5, height * 0.25, 14, {
    isStatic: true,
    isPickup: true,
    label: 'pickup'
  });

  World.add(world, [ground, ceiling, leftWall, rightWall, platform, ball, goal, pickup]);

  gameObjects.push(ground, ceiling, leftWall, rightWall, platform, ball, goal, pickup);
}

// ===== Collision handling =====
Events.on(engine, 'collisionStart', (event) => {
  const pairs = event.pairs;

  pairs.forEach(pair => {
    const bodies = [pair.bodyA, pair.bodyB];

    const hasBall = bodies.some(b => b.label === 'ball');
    const pickupBody = bodies.find(b => b.isPickup);
    const goalBody = bodies.find(b => b.isGoal);

    // Pickup collected
    if (hasBall && pickupBody && pickup) {
      activatePickupEffect(pickupBody);
      World.remove(world, pickupBody);
      pickup = null;
    }

    // Reached goal
    if (hasBall && goalBody) {
      onGoalReached();
    }
  });
});

function activatePickupEffect(pickupBody) {
  // For now: "low gravity" effect for 6 seconds
  playerState.effect = 'low_gravity';
  playerState.effectTimeLeft = 6.0;
  hudEffect.textContent = 'Low gravity (6s)';
}

function onGoalReached() {
  running = false;
  overlay.style.display = 'flex';
  statusEl.textContent = 'Level complete! Tap to play again.';
  btnStart.textContent = 'Play Again';
}

// ===== Input: tilt + keyboard fallback =====
window.addEventListener('deviceorientation', (event) => {
  if (!useTilt) return;

  const gamma = event.gamma || 0; // left-right
  const beta = event.beta || 0;   // front-back

  tiltX = gamma;
  tiltY = beta;
});

// Simple keyboard fallback so you can play on desktop
const keys = {
  left: false,
  right: false,
  up: false,
  down: false
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') keys.left = true;
  if (e.key === 'ArrowRight') keys.right = true;
  if (e.key === 'ArrowUp') keys.up = true;
  if (e.key === 'ArrowDown') keys.down = true;
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') keys.left = false;
  if (e.key === 'ArrowRight') keys.right = false;
  if (e.key === 'ArrowUp') keys.up = false;
  if (e.key === 'ArrowDown') keys.down = false;
});

// ===== Effect + physics update =====
function applyPlayerEffects(dt) {
  // Decay timer
  if (playerState.effectTimeLeft > 0) {
    playerState.effectTimeLeft -= dt;
    if (playerState.effectTimeLeft <= 0) {
      playerState.effect = null;
      hudEffect.textContent = 'None';
    } else if (playerState.effect === 'low_gravity') {
      const remaining = Math.max(0, playerState.effectTimeLeft).toFixed(1);
      hudEffect.textContent = `Low gravity (${remaining}s)`;
    }
  }

  // Base gravity from tilt or keyboard
  const gBase = 0.0015;

  let gX = 0;
  let gY = 0.001; // small default downward pull

  if (useTilt) {
    const deadzone = 2;
    const dx = Math.abs(tiltX) < deadzone ? 0 : tiltX;
    const dy = Math.abs(tiltY) < deadzone ? 0 : tiltY;

    gX = dx * gBase;
    gY = dy * gBase;
  } else {
    // Keyboard fallback
    if (keys.left) gX -= gBase * 30;
    if (keys.right) gX += gBase * 30;
    if (keys.up) gY -= gBase * 30;
    if (keys.down) gY += gBase * 30;
  }

  // Apply effect modifiers
  if (playerState.effect === 'low_gravity') {
    gX *= 0.4;
    gY *= 0.4;
  }

  world.gravity.x = gX;
  world.gravity.y = gY;
}

// ===== Render =====
function draw() {
  ctx.clearRect(0, 0, width, height);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#050814');
  grad.addColorStop(1, '#020309');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Helper to draw rectangles with body vertices
  function drawBodyRect(body, fill, stroke) {
    const verts = body.vertices;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
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

  // Draw static geometry
  drawBodyRect(ground, '#111827');
  drawBodyRect(ceiling, '#020617');
  drawBodyRect(leftWall, '#020617');
  drawBodyRect(rightWall, '#020617');
  drawBodyRect(platform, '#111827', '#1f2937');

  // Draw goal
  if (goal) {
    const verts = goal.vertices;
    const gx = (verts[0].x + verts[2].x) / 2;
    const gy = (verts[0].y + verts[2].y) / 2;

    const goalGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 60);
    goalGrad.addColorStop(0, 'rgba(56, 189, 248, 0.9)');
    goalGrad.addColorStop(1, 'rgba(8, 47, 73, 0.0)');
    ctx.fillStyle = goalGrad;
    ctx.beginPath();
    ctx.arc(gx, gy, 60, 0, Math.PI * 2);
    ctx.fill();

    drawBodyRect(goal, 'rgba(15,23,42,0.95)', 'rgba(56,189,248,0.8)');
  }

  // Draw pickup
  if (pickup) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(pickup.position.x, pickup.position.y, 14, 0, Math.PI * 2);
    const pGrad = ctx.createRadialGradient(
      pickup.position.x, pickup.position.y, 0,
      pickup.position.x, pickup.position.y, 18
    );
    pGrad.addColorStop(0, 'rgba(249, 115, 22, 1)');
    pGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = pGrad;
    ctx.fill();
    ctx.restore();
  }

  // Draw ball
  if (ball) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ball.position.x, ball.position.y, ball.circleRadius, 0, Math.PI * 2);
    const bGrad = ctx.createRadialGradient(
      ball.position.x - ball.circleRadius / 2,
      ball.position.y - ball.circleRadius / 2,
      4,
      ball.position.x,
      ball.position.y,
      ball.circleRadius * 1.3
    );
    bGrad.addColorStop(0, '#60a5fa');
    bGrad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = bGrad;
    ctx.fill();

    // Simple "shine" line
    ctx.strokeStyle = 'rgba(191, 219, 254, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ball.position.x - 4, ball.position.y - 4, ball.circleRadius * 0.7, -0.8, 0.6);
    ctx.stroke();

    ctx.restore();
  }

  // HUD update
  hudTiltX.textContent = useTilt ? tiltX.toFixed(1) : 'KB';
  hudTiltY.textContent = useTilt ? tiltY.toFixed(1) : 'KB';
}

// ===== Main loop =====
function loop(timestamp) {
  if (!running) return;

  if (lastTime == null) lastTime = timestamp;
  const dtMs = timestamp - lastTime;
  lastTime = timestamp;
  const dt = dtMs / 1000; // seconds

  applyPlayerEffects(dt);
  Engine.update(engine, dtMs);

  draw();
  requestAnimationFrame(loop);
}

// ===== Start / restart =====
async function startGame() {
  // Try to enable tilt on supported devices
  await enableTiltIfPossible();

  // Reset world & state
  createWorld();
  playerState.effect = null;
  playerState.effectTimeLeft = 0;
  hudEffect.textContent = 'None';

  // Hide overlay and run
  overlay.style.display = 'none';
  running = true;
  lastTime = null;
  requestAnimationFrame(loop);
}

async function enableTiltIfPossible() {
  useTilt = false;

  // iOS requires explicit permission request
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        useTilt = true;
        statusEl.textContent = 'Tilt controls enabled (iOS).';
      } else {
        statusEl.textContent = 'Tilt permission denied. Using keyboard if available.';
      }
    } catch (err) {
      statusEl.textContent = 'Tilt permission error, using keyboard.';
    }
  } else if (typeof DeviceOrientationEvent !== 'undefined') {
    // Likely Android / desktop with sensors
    useTilt = true;
    statusEl.textContent = 'Tilt controls enabled.';
  } else {
    statusEl.textContent = 'No motion sensors. Keyboard only.';
  }
}

// Wire button
btnStart.addEventListener('click', () => {
  statusEl.textContent = 'Starting…';
  startGame();
});

// Initial world so there’s something on screen under the overlay
createWorld();
draw();
