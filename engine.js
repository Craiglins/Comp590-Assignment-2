/*
 * engine.js
 * A tiny 2D engine: a scene graph of GameObjects plus a main loop.
 *
 * Every GameObject has a local transform (position, rotation, scale) relative to its parent.
 * Rendering walks the tree: save the canvas state, apply this object's transform, draw it,
 * draw its children inside that transform, then restore. That save/restore stack is what
 * makes hierarchical models work: move, rotate, or scale a parent and its children come along.
 *
 * AI assistance: written with help from Claude Opus 5 (Anthropic), September 2026. See README.md.
 */

'use strict';

const DEBUG = { showJoints: false };

class GameObject {
  constructor({ x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1, z = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.rotation = rotation; // radians; positive turns clockwise on screen
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.z = z;               // children with z < 0 are drawn underneath their parent
    this.visible = true;
    this.parent = null;
    this.children = [];
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /** Override: advance this object's state by dt seconds. */
  update(dt) {}

  /** Override: draw in local coordinates, where (0, 0) is this object's pivot. */
  draw(ctx) {}

  /** Parents update before their children, so children always see the parent's latest pose. */
  updateTree(dt) {
    this.update(dt);
    for (const child of this.children) child.updateTree(dt);
  }

  render(ctx) {
    if (!this.visible) return;

    ctx.save();                          // push: remember the parent's coordinate system
    ctx.translate(this.x, this.y);       // move the origin to this object's pivot
    ctx.rotate(this.rotation);           // turn the axes around that pivot
    ctx.scale(this.scaleX, this.scaleY); // stretch them (a negative scale mirrors)

    for (const child of this.children) if (child.z < 0) child.render(ctx);
    this.draw(ctx);
    for (const child of this.children) if (child.z >= 0) child.render(ctx);

    if (DEBUG.showJoints) drawAxes(ctx);
    ctx.restore();                       // pop: back to the parent's coordinate system
  }
}

/** Debug view: this object's local axes. Red = local +x, green = local +y. */
function drawAxes(ctx) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ff3b30';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.strokeStyle = '#30d158';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

class Engine {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;     // logical size; all scene code uses these units
    this.height = height;
    this.root = new GameObject();
    this.timeScale = 1;     // 1 = real time, 0.5 = slow motion, 0 = paused
    this.maxStep = 1 / 20;  // cap on dt so a long pause (like switching tabs) doesn't teleport anything
    this.lastTime = null;
    this.pixelRatio = 0;

    this.fitToScreen();
    window.addEventListener('resize', () => this.fitToScreen());
  }

  add(obj) {
    return this.root.addChild(obj);
  }

  /** Match the canvas's pixel buffer to the screen's pixel density so lines stay sharp on retina displays. */
  fitToScreen() {
    const ratio = window.devicePixelRatio || 1;
    if (ratio === this.pixelRatio) return;
    this.pixelRatio = ratio;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
  }

  start() {
    requestAnimationFrame(now => this.frame(now));
  }

  /** The game loop: measure elapsed time, update the world, draw the world, repeat. */
  frame(now) {
    if (this.lastTime === null) this.lastTime = now;
    const dt = Math.min((now - this.lastTime) / 1000, this.maxStep) * this.timeScale;
    this.lastTime = now;

    // Assignment 3: read player input here, before updating.
    this.root.updateTree(dt);

    const ctx = this.ctx;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.root.render(ctx);

    requestAnimationFrame(next => this.frame(next));
  }
}
