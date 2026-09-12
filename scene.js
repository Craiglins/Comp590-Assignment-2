/*
 * scene.js
 * One swimmer, freestyle, in a single lane. Flip turn at each wall.
 *
 * Scene graph:
 *   Deck
 *   Pool
 *   ├── Ripples          the wake, stored in pool coordinates
 *   ├── Swimmer          the torso is the root of the body
 *   │   ├── Upper arm x2 → Forearm (+ hand)
 *   │   ├── Thigh x2     → Shin (+ foot)
 *   │   └── Head
 *   └── LaneRopes
 *   PaceClock → minute hand, second hand
 *
 * AI assistance: written with help from Claude Opus 5 (Anthropic), September 2026. See README.md.
 */

'use strict';

// --- Layout and helpers ----------------------------------------------------

const TAU = Math.PI * 2;
const VIEW = { width: 1000, height: 320 };
const POOL = { x: 60, y: 52, length: 880, width: 132 };

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.min(1, Math.max(0, t));
const smooth = t => t * t * (3 - 2 * t);   // ease in and out
const ease = t => 0.5 * (t + smooth(t));   // gentler ease that keeps some speed at the ends
const wrap01 = p => p - Math.floor(p);
// Blend two angles the short way around the circle.
const lerpAngle = (a, b, t) => a + ((((b - a) % TAU) + TAU + Math.PI) % TAU - Math.PI) * t;
// 1 at `center`, falling smoothly to 0 at center ± width.
const bump = (p, center, width) => {
  const d = Math.abs(p - center) / width;
  return d < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * d) : 0;
};

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Builds a pose from keyframes [[phase, values], ...]. Values ease between frames and loop back to the first. */
function keyframes(frames, curve = smooth) {
  return p => {
    let i = frames.length - 1;
    while (i > 0 && frames[i][0] > p) i--;
    const [p0, a] = frames[i];
    const [p1, b] = frames[i + 1] || [1, frames[0][1]];
    const t = curve((p - p0) / (p1 - p0));
    const out = {};
    for (const key in a) out[key] = lerp(a[key], b[key], t);
    return out;
  };
}

// --- Body parts ------------------------------------------------------------

/**
 * One rigid segment (upper arm, forearm, thigh, shin), drawn as a rounded capsule from its
 * joint at (0, 0) out along local +x. The next segment is attached at the far end.
 */
class Segment extends GameObject {
  constructor({ length, width, color, tip = 0 }) {
    super();
    this.length = length;
    this.width = width;
    this.color = color;
    this.tip = tip;  // radius of a hand or foot at the end (0 = none)
    this.reach = 1;  // 1 = lying flat; less than 1 = tilted toward or away from the camera
  }

  /** Length as seen from above. A limb angled down into the water looks shorter. */
  get apparentLength() {
    return this.length * this.reach;
  }

  draw(ctx) {
    const len = this.apparentLength;
    ctx.lineCap = 'round';
    ctx.lineWidth = this.width;
    ctx.strokeStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();

    if (this.tip) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.ellipse(len + this.tip * 0.4, 0, this.tip * 1.35, this.tip, 0, 0, TAU);
      ctx.fill();
    }
  }
}

/** The head pivots at the neck, so it can turn to breathe. */
class Head extends GameObject {
  constructor(cap) {
    super({ x: 19, z: 1 });
    this.cap = cap;
  }

  draw(ctx) {
    ctx.fillStyle = this.cap;
    ctx.beginPath();
    ctx.arc(8, 0, 8, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#15202b'; // goggles, peeking out at the front of the cap
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(14.6, side * 3.3, 1.3, 1.9, 0, 0, TAU);
      ctx.fill();
    }
  }
}

// --- Freestyle -------------------------------------------------------------
//
// The stroke maps a cycle phase p in [0, 1) to joint angles for the swimmer's RIGHT side.
// The left side is mirrored automatically (see Swimmer.poseLimb) and runs half a cycle behind.
//   arm: angle 0 = reaching straight ahead, positive = swinging out to the side
//        bend = elbow angle, upper/lower = how flat each segment lies (foreshortening)
//   leg: spread 0 = straight back, positive = out to the side, knee = shin angle

const HIP_EXIT = -Math.PI - 0.2; // arm pointing back, just outside the hip

// The underwater pull. The angle keeps decreasing, so the recovery carries on the same way
// around and the shoulder completes a full 360 degrees per cycle.
const pullPath = keyframes([
  [0.00, { angle: 0, bend: 0, upper: 1, lower: 1 }],             // hand enters in front of the shoulder
  [0.25, { angle: 0.35, bend: -0.2, upper: 0.9, lower: 0.95 }],  // catch: press out a little
  [0.60, { angle: -1.3, bend: -0.7, upper: 0.45, lower: 0.6 }],  // sweep in under the chest
  [1.00, { angle: HIP_EXIT, bend: 0, upper: 1, lower: 1 }],      // push back past the hip
], ease);

/** Pull under the body, then swing forward over the water with a high, bent elbow. */
function freestyleArm(q) {
  const pullEnd = 0.5;
  if (q < pullEnd) return { ...pullPath(q / pullEnd), underwater: true };
  const t = (q - pullEnd) / (1 - pullEnd);
  const s = Math.sin(Math.PI * t);
  return {
    angle: lerp(HIP_EXIT, -TAU, t),
    bend: 0.9 * s,        // elbow high
    upper: 1 - 0.4 * s,   // upper arm tilts up out of the water
    lower: 1 - 0.55 * s,  // forearm hangs down from it
    underwater: false,
  };
}

/** Six-beat flutter kick: legs alternate, three kicks each per arm cycle. */
function flutterKick(p, side) {
  const k = Math.sin(TAU * (3 * p + (side < 0 ? 0.5 : 0)));
  return { spread: 0.04 + 0.03 * k, knee: 0.05 * k, upper: 0.95 + 0.05 * k, lower: 0.82 + 0.18 * k };
}

const FREE = {
  period: 1.1,  // seconds per arm cycle
  speed: 128,   // pixels per second
  arm: freestyleArm,
  leg: flutterKick,
  head: p => ({ turn: 0.5 * bump(p, 0.6, 0.15) }), // breathe to the right once a cycle
};

// Held poses for the wall
const STREAMLINE = {
  arm: { angle: -0.33, bend: 0, upper: 1, lower: 1, underwater: true }, // hands stacked past the head
  leg: { spread: -0.05, knee: 0, upper: 1, lower: 1 },
};
const TUCK = {
  arm: { angle: Math.PI - 0.35, bend: 0, upper: 0.75, lower: 0.75, underwater: true },
  leg: { spread: 0.02, knee: 0, upper: 0.5, lower: 0.5 },
};

function blendLimb(a, b, t) {
  const out = {};
  for (const key in b) {
    if (typeof b[key] === 'boolean') out[key] = t < 0.5 ? a[key] : b[key];
    else if (key === 'angle') out[key] = lerpAngle(a[key], b[key], t);
    else out[key] = lerp(a[key], b[key], t);
  }
  return out;
}

const blendPose = (a, b, t) => ({ arm: blendLimb(a.arm, b.arm, t), leg: blendLimb(a.leg, b.leg, t) });

// --- Swimmer ---------------------------------------------------------------

const TURN_TIME = 0.8;  // seconds to flip at the wall
const GLIDE_TIME = 0.7; // seconds of streamline after pushing off
const HEAD_REACH = 36;  // distance from the body's pivot to the front of the head

class Swimmer extends GameObject {
  constructor({ x, dir, cap, suit, skin, ripples }) {
    super({ x, y: POOL.width / 2, rotation: dir > 0 ? 0 : Math.PI });
    this.dir = dir;       // +1 = swimming right, -1 = swimming left
    this.phase = 0;       // position in the stroke cycle, 0 to 1
    this.state = 'swim';  // swim → turn → glide → swim
    this.stateTime = 0;
    this.suit = suit;
    this.skin = skin;
    this.ripples = ripples;
    this.wakeTimer = 0;

    // Build the body. Joint positions are in the torso's space: +x = forward, +y = the swimmer's right.
    this.legs = [1, -1].map(side => this.addLimb(side, -18, 5.5, -1,
      { length: 20, width: 8.5, color: skin },
      { length: 18, width: 6.5, color: skin, tip: 3.4 }));
    this.arms = [1, -1].map(side => this.addLimb(side, 13, 11.5, 1,
      { length: 17, width: 6.5, color: skin },
      { length: 16, width: 5.5, color: skin, tip: 3.3 }));
    this.head = this.addChild(new Head(cap));

    this.applyPose(this.strokePose(0));
  }

  addLimb(side, jointX, jointY, z, upperSpec, lowerSpec) {
    const upper = this.addChild(new Segment(upperSpec));
    const lower = upper.addChild(new Segment(lowerSpec));
    upper.x = jointX;
    upper.y = side * jointY;
    upper.z = z; // legs start underneath the torso
    return { side, upper, lower };
  }

  /**
   * Point one limb. The left side reuses the right side's numbers: scaleY = -1 mirrors this
   * segment's local space, and the forearm or shin attached to it inherits the mirror.
   */
  poseLimb({ side, upper, lower }, angle, bend, upperReach, lowerReach) {
    upper.rotation = side * angle;
    upper.scaleY = side;
    upper.reach = upperReach;
    lower.x = upper.apparentLength; // keep the elbow or knee at the end of the upper segment
    lower.rotation = bend;
    lower.reach = lowerReach;
  }

  /** Joint targets for both sides at phase p. The left arm runs half a cycle behind the right. */
  strokePose(p) {
    return this.arms.map(arm => ({
      arm: FREE.arm(arm.side < 0 ? wrap01(p + 0.5) : p),
      leg: FREE.leg(p, arm.side),
    }));
  }

  applyPose(sides, head = { turn: 0 }) {
    sides.forEach(({ arm, leg }, i) => {
      const armLimb = this.arms[i];
      this.poseLimb(armLimb, arm.angle, arm.bend, arm.upper, arm.lower);
      armLimb.upper.z = arm.underwater ? -1 : 1; // arms pull beneath the torso and recover above it
      this.poseLimb(this.legs[i], Math.PI - leg.spread, -leg.knee, leg.upper, leg.lower);
    });
    this.head.rotation = head.turn;
  }

  update(dt) {
    this.stateTime += dt;
    if (this.state === 'swim') this.swim(dt);
    else if (this.state === 'turn') this.turn();
    else this.glide(dt);
  }

  swim(dt) {
    this.phase = wrap01(this.phase + dt / FREE.period);
    this.applyPose(this.strokePose(this.phase), FREE.head(this.phase));
    this.x += this.dir * FREE.speed * dt;
    this.leaveWake(dt);

    const headX = this.x + this.dir * HEAD_REACH;
    if (this.dir > 0 ? headX >= POOL.length - 2 : headX <= 2) {
      this.state = 'turn';
      this.stateTime = 0;
      this.turnStart = { rotation: this.rotation, pose: this.strokePose(this.phase) };
    }
  }

  /** Flip turn: rotating and shrinking the torso carries every attached limb with it. */
  turn() {
    const t = clamp01(this.stateTime / TURN_TIME);
    this.rotation = this.turnStart.rotation + Math.PI * smooth(t);
    this.scaleX = this.scaleY = 1 - 0.3 * Math.sin(Math.PI * t); // tuck, then stretch back out

    const tuck = [TUCK, TUCK];
    const stretch = [STREAMLINE, STREAMLINE];
    if (t < 0.4) this.applyPose(this.turnStart.pose.map((from, i) => blendPose(from, tuck[i], smooth(t / 0.4))));
    else if (t < 0.7) this.applyPose(tuck);
    else this.applyPose(tuck.map((from, i) => blendPose(from, stretch[i], smooth((t - 0.7) / 0.3))));

    if (t >= 1) {
      this.dir = -this.dir;
      this.rotation = this.dir > 0 ? 0 : Math.PI;
      this.scaleX = this.scaleY = 1;
      this.state = 'glide';
      this.stateTime = 0;
    }
  }

  glide(dt) {
    const t = clamp01(this.stateTime / GLIDE_TIME);
    this.x += this.dir * FREE.speed * lerp(1.7, 1, t) * dt; // push off hard, then slow down
    this.leaveWake(dt);

    const stretch = [STREAMLINE, STREAMLINE];
    if (t < 0.6) this.applyPose(stretch);
    else this.applyPose(stretch.map((from, i) => blendPose(from, this.strokePose(0)[i], smooth((t - 0.6) / 0.4))));

    if (t >= 1) {
      this.state = 'swim';
      this.stateTime = 0;
      this.phase = 0;
    }
  }

  /** Drop a ring behind the shoulders, converted from body space into pool space. */
  leaveWake(dt) {
    this.wakeTimer += dt;
    if (this.wakeTimer < 0.09) return;
    this.wakeTimer = 0;
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    this.ripples.spawn(this.x + 24 * c, this.y + 24 * s);
  }

  /** The torso. Limbs and head are children, so they are drawn by the engine around this. */
  draw(ctx) {
    ctx.fillStyle = this.skin;
    ctx.beginPath();
    ctx.moveTo(19, 0);
    ctx.bezierCurveTo(19, -10, 14, -13.5, 8, -13);
    ctx.bezierCurveTo(-4, -12.5, -14, -10, -20, -7);
    ctx.bezierCurveTo(-25, -4, -25, 4, -20, 7);
    ctx.bezierCurveTo(-14, 10, -4, 12.5, 8, 13);
    ctx.bezierCurveTo(14, 13.5, 19, 10, 19, 0);
    ctx.fill();

    ctx.save(); // swimsuit, clipped to the torso outline
    ctx.clip();
    ctx.fillStyle = this.suit;
    ctx.fillRect(-30, -20, 18, 40);
    ctx.restore();
  }
}

// --- Environment -----------------------------------------------------------

class Deck extends GameObject {
  draw(ctx) {
    ctx.fillStyle = '#d3d7d6';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    // Tile grid
    ctx.strokeStyle = 'rgba(40, 60, 70, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= VIEW.width; x += 25) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, VIEW.height);
    }
    for (let y = 0; y <= VIEW.height; y += 25) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(VIEW.width, y + 0.5);
    }
    ctx.stroke();

    // Starting block at the left wall
    roundRectPath(ctx, 12, POOL.y + POOL.width / 2 - 17, 34, 34, 4);
    ctx.fillStyle = '#2f3843';
    ctx.fill();
  }
}

class Pool extends GameObject {
  constructor() {
    super({ x: POOL.x, y: POOL.y });
  }

  draw(ctx) {
    const L = POOL.length;
    const W = POOL.width;

    // Gutter
    roundRectPath(ctx, -12, -12, L + 24, W + 24, 6);
    ctx.fillStyle = '#f1f4f5';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Water
    const water = ctx.createLinearGradient(0, 0, L, W);
    water.addColorStop(0, '#47b9ea');
    water.addColorStop(1, '#1f8dd0');
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, L, W);

    // Floor markings: a line down the lane with a T near each wall
    ctx.fillStyle = 'rgba(15, 45, 90, 0.5)';
    ctx.fillRect(70, W / 2 - 4, L - 140, 8);
    ctx.fillRect(66, W / 2 - 18, 8, 36);
    ctx.fillRect(L - 74, W / 2 - 18, 8, 36);
  }
}

/** The wake: rings that expand and fade. Lives in pool space, so they stay put as the swimmer moves on. */
class Ripples extends GameObject {
  constructor() {
    super();
    this.rings = [];
  }

  spawn(x, y) {
    this.rings.push({ x, y, r: 6, life: 1.3 });
  }

  update(dt) {
    for (const ring of this.rings) {
      ring.r += 26 * dt;
      ring.life -= dt;
    }
    this.rings = this.rings.filter(ring => ring.life > 0);
  }

  draw(ctx) {
    ctx.lineWidth = 1.5;
    for (const ring of this.rings) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.22 * ring.life / 1.3})`;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, TAU);
      ctx.stroke();
    }
  }
}

/** The ropes on both sides of the lane. The floats bob. */
class LaneRopes extends GameObject {
  constructor() {
    super();
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
  }

  draw(ctx) {
    for (const [k, y] of [[0, 6], [1, POOL.width - 6]]) {
      for (let i = 0, x = 6; x < POOL.length; i++, x += 11) {
        const endZone = x < 98 || x > POOL.length - 98;
        ctx.fillStyle = endZone ? '#d62839' : (Math.floor(x / 44) % 2 ? '#1f5fbf' : '#f3f5f7');
        ctx.beginPath();
        ctx.arc(x, y + Math.sin(this.time * 1.8 + i * 0.4 + k * 1.3) * 0.9, 4.2, 0, TAU);
        ctx.fill();
      }
    }
  }
}

// --- Pace clock (a second hierarchy: the hands are children of the face) ----

class ClockHand extends GameObject {
  constructor(length, width, color, hub = 0) {
    super();
    this.length = length;
    this.width = width;
    this.color = color;
    this.hub = hub;
  }

  draw(ctx) {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-this.length * 0.18, 0);
    ctx.lineTo(this.length, 0);
    ctx.stroke();
    if (this.hub) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.hub, 0, TAU);
      ctx.fill();
    }
  }
}

class PaceClock extends GameObject {
  constructor(x, y, radius) {
    super({ x, y });
    this.radius = radius;
    this.elapsed = 0;
    this.minuteHand = this.addChild(new ClockHand(radius * 0.55, 5, '#1b242e'));
    this.secondHand = this.addChild(new ClockHand(radius * 0.86, 2.5, '#d62839', 4.5));
  }

  update(dt) {
    this.elapsed += dt;
    // Canvas angle 0 points at 3 o'clock, so subtract a quarter turn to start at the top.
    this.secondHand.rotation = (this.elapsed % 60) / 60 * TAU - Math.PI / 2;
    this.minuteHand.rotation = (this.elapsed % 3600) / 3600 * TAU - Math.PI / 2;
  }

  draw(ctx) {
    const r = this.radius;

    ctx.fillStyle = '#1b242e';
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fbfaf6';
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, TAU);
    ctx.fill();

    // Tick marks: rotate the canvas for each one instead of computing coordinates.
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      ctx.save();
      ctx.rotate(i / 60 * TAU);
      ctx.fillStyle = major ? '#1b242e' : '#9aa3ab';
      ctx.fillRect(r - (major ? 10 : 6), major ? -1.25 : -0.6, major ? 8 : 4, major ? 2.5 : 1.2);
      ctx.restore();
    }

    ctx.fillStyle = '#1b242e';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let n = 15; n <= 60; n += 15) {
      const a = n / 60 * TAU - Math.PI / 2;
      ctx.fillText(String(n), Math.cos(a) * (r - 19), Math.sin(a) * (r - 19));
    }
  }
}

// --- Build the scene and start the loop ------------------------------------

const engine = new Engine(document.getElementById('scene'), VIEW.width, VIEW.height);

engine.add(new Deck());
const pool = engine.add(new Pool());
const ripples = pool.addChild(new Ripples());
pool.addChild(new Swimmer({ x: 260, dir: 1, cap: '#ffd60a', suit: '#1d3557', skin: '#f1c27d', ripples }));
pool.addChild(new LaneRopes());
engine.add(new PaceClock(76, 250, 48));

const speedInput = document.getElementById('speed');
const speedOutput = document.getElementById('speed-value');
speedInput.addEventListener('input', () => {
  engine.timeScale = Number(speedInput.value);
  speedOutput.textContent = engine.timeScale === 0 ? 'Paused' : `${engine.timeScale.toFixed(2)}×`;
});
document.getElementById('show-joints').addEventListener('change', event => {
  DEBUG.showJoints = event.target.checked;
});

engine.start();
