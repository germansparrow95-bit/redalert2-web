/*
 * Red Alert Web - procedural art.
 *
 * Every sprite in the game is drawn with code: isometric boxes, tapered
 * towers and small figures, pre-rendered once into off-screen canvases and
 * then blitted.  No external image files are used anywhere in the project.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;

  var Art = RA.Art = {};

  Art.TILE_W = 64;
  Art.TILE_H = 32;
  var TW = Art.TILE_W, TH = Art.TILE_H;

  var doc = null;
  var cache = { units: {}, buildings: {}, tiles: {}, ore: {}, objects: {}, icons: {}, flags: {} };

  Art.init = function (documentRef) {
    doc = documentRef;
    cache = { units: {}, buildings: {}, tiles: {}, ore: {}, objects: {}, icons: {}, flags: {} };
  };

  Art.canvas = function (w, h) {
    var c = doc.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  function ctxOf(c) {
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return g;
  }

  // ---------------------------------------------------------------------
  // Projection helpers
  // ---------------------------------------------------------------------
  /** tile-space offset (dx,dy) + height (px) -> screen offset (px). */
  function projX(dx, dy) { return (dx - dy) * (TW / 2); }
  function projY(dx, dy, z) { return (dx + dy) * (TH / 2) - (z || 0); }
  Art.projX = projX;
  Art.projY = projY;

  function shade(hex, factor) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = U.clamp(Math.round(r * factor), 0, 255);
    g = U.clamp(Math.round(g * factor), 0, 255);
    b = U.clamp(Math.round(b * factor), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  Art.shade = shade;

  function mix(a, b, t) {
    var na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    var r = Math.round(U.lerp((na >> 16) & 255, (nb >> 16) & 255, t));
    var g = Math.round(U.lerp((na >> 8) & 255, (nb >> 8) & 255, t));
    var bl = Math.round(U.lerp(na & 255, nb & 255, t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  Art.mix = mix;

  /**
   * Draw an axis-aligned-then-rotated 3D box in isometric space.
   * (cx,cy) is the ground centre in tile space, angle rotates the box about
   * the vertical axis, sizes are in tiles (len/wid) and pixels (h).
   */
  function isoBox(ctx, cx, cy, len, wid, h, angle, colors, opts) {
    opts = opts || {};
    var ca = Math.cos(angle || 0), sa = Math.sin(angle || 0);
    var uv = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
    var ground = uv.map(function (p) {
      var u = p[0], v = p[1];
      return { x: cx + u * ca - v * sa, y: cy + u * sa + v * ca };
    });
    var faces = [];
    for (var i = 0; i < 4; i++) {
      var a = ground[i], b = ground[(i + 1) % 4];
      var ex = b.x - a.x, ey = b.y - a.y;
      // outward normal in tile space
      var nx = ey, ny = -ex;
      var nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      var toCenterX = cx - (a.x + b.x) / 2, toCenterY = cy - (a.y + b.y) / 2;
      if (nx * toCenterX + ny * toCenterY > 0) { nx = -nx; ny = -ny; }
      var lit = U.clamp((-(nx + ny)) / Math.SQRT2, -1, 1);
      faces.push({
        a: a, b: b,
        depth: (a.x + a.y + b.x + b.y) / 2,
        bright: 0.58 + 0.42 * U.clamp((lit + 1) / 2, 0, 1)
      });
    }
    faces.sort(function (p, q) { return p.depth - q.depth; });
    for (i = 0; i < faces.length; i++) {
      var f = faces[i];
      ctx.beginPath();
      ctx.moveTo(projX(f.a.x, f.a.y), projY(f.a.x, f.a.y, 0));
      ctx.lineTo(projX(f.b.x, f.b.y), projY(f.b.x, f.b.y, 0));
      ctx.lineTo(projX(f.b.x, f.b.y), projY(f.b.x, f.b.y, h));
      ctx.lineTo(projX(f.a.x, f.a.y), projY(f.a.x, f.a.y, h));
      ctx.closePath();
      ctx.fillStyle = shade(colors.base, f.bright);
      ctx.fill();
      if (opts.stroke !== false) {
        ctx.strokeStyle = shade(colors.dark, 0.85);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // top face
    ctx.beginPath();
    for (i = 0; i < 4; i++) {
      var p = ground[i];
      var px = projX(p.x, p.y), py = projY(p.x, p.y, h);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = shade(colors.base, opts.topBright || 1.06);
    ctx.fill();
    if (opts.stroke !== false) {
      ctx.strokeStyle = shade(colors.dark, 0.9);
      ctx.stroke();
    }
    return { ground: ground, top: h };
  }
  Art.isoBox = isoBox;

  /** A tapered box (tower): different top and bottom footprint sizes. */
  function isoFrustum(ctx, cx, cy, lenB, widB, lenT, widT, h, angle, colors) {
    var ca = Math.cos(angle || 0), sa = Math.sin(angle || 0);
    function corners(len, wid, z) {
      return [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]].map(function (p) {
        var x = cx + p[0] * ca - p[1] * sa;
        var y = cy + p[0] * sa + p[1] * ca;
        return { x: x, y: y, z: z };
      });
    }
    var bottom = corners(lenB, widB, 0);
    var top = corners(lenT, widT, h);
    var faces = [];
    for (var i = 0; i < 4; i++) {
      var a = bottom[i], b = bottom[(i + 1) % 4];
      var ex = b.x - a.x, ey = b.y - a.y;
      var nx = ey, ny = -ex;
      var nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      if (nx * (cx - (a.x + b.x) / 2) + ny * (cy - (a.y + b.y) / 2) > 0) { nx = -nx; ny = -ny; }
      var lit = U.clamp((-(nx + ny)) / Math.SQRT2, -1, 1);
      faces.push({ i: i, depth: (a.x + a.y + b.x + b.y) / 2, bright: 0.55 + 0.45 * U.clamp((lit + 1) / 2, 0, 1) });
    }
    faces.sort(function (p, q) { return p.depth - q.depth; });
    faces.forEach(function (f) {
      var i = f.i;
      var a = bottom[i], b = bottom[(i + 1) % 4], c = top[(i + 1) % 4], d = top[i];
      ctx.beginPath();
      ctx.moveTo(projX(a.x, a.y), projY(a.x, a.y, a.z));
      ctx.lineTo(projX(b.x, b.y), projY(b.x, b.y, b.z));
      ctx.lineTo(projX(c.x, c.y), projY(c.x, c.y, c.z));
      ctx.lineTo(projX(d.x, d.y), projY(d.x, d.y, d.z));
      ctx.closePath();
      ctx.fillStyle = shade(colors.base, f.bright);
      ctx.fill();
      ctx.strokeStyle = shade(colors.dark, 0.8);
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.beginPath();
    for (i = 0; i < 4; i++) {
      var p = top[i];
      var px = projX(p.x, p.y), py = projY(p.x, p.y, p.z);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = shade(colors.base, 1.08);
    ctx.fill();
    ctx.strokeStyle = shade(colors.dark, 0.8);
    ctx.stroke();
  }
  Art.isoFrustum = isoFrustum;

  /** Small details that live on the top face of a box (in tile space). */
  function topFace(ctx, cx, cy, len, wid, h, angle, drawFn) {
    var ca = Math.cos(angle || 0), sa = Math.sin(angle || 0);
    ctx.save();
    var o = { x: projX(cx, cy), y: projY(cx, cy, h) };
    ctx.translate(o.x, o.y);
    // iso basis vectors for the rotated box
    var ux = projX(ca, sa), uy = projY(ca, sa, 0);
    var vx = projX(-sa, ca), vy = projY(-sa, ca, 0);
    ctx.transform(ux, uy, vx, vy, 0, 0);
    drawFn(ctx, len, wid);
    ctx.restore();
  }
  Art.topFace = topFace;

  /** Flat iso quad on the ground (shadows, scorch marks, ...). */
  function groundQuad(ctx, cx, cy, len, wid, angle, style) {
    var ca = Math.cos(angle || 0), sa = Math.sin(angle || 0);
    var uv = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var x = cx + uv[i][0] * ca - uv[i][1] * sa;
      var y = cy + uv[i][0] * sa + uv[i][1] * ca;
      var px = projX(x, y), py = projY(x, y, 0);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }
  Art.groundQuad = groundQuad;

  // ---------------------------------------------------------------------
  // Terrain
  // ---------------------------------------------------------------------
  var TERRAIN_BASE = {
    1: ['#4a7a3c', '#43703a', '#518243', '#3f6b36'],   // grass
    2: ['#6b7346', '#626a41', '#727a4c', '#5d6540'],   // rough
    3: ['#b8a674', '#ad9c6d', '#c2b07e', '#a2926a'],   // sand
    0: ['#2a5a86', '#255078', '#31648f', '#20476c'],   // water
    4: ['#4a7a3c', '#43703a', '#518243', '#3f6b36'],
    5: ['#4a7a3c', '#43703a', '#518243', '#3f6b36']
  };

  function diamondPath(ctx, w, h, ox, oy) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + w / 2, oy + h / 2);
    ctx.lineTo(ox, oy + h);
    ctx.lineTo(ox - w / 2, oy + h / 2);
    ctx.closePath();
  }

  function tileSprite(terrain, variant) {
    var c = Art.canvas(TW + 2, TH + 2);
    var g = ctxOf(c);
    var colors = TERRAIN_BASE[terrain] || TERRAIN_BASE[1];
    // Drawn 2px oversized so neighbouring tiles overlap and leave no seams.
    diamondPath(g, TW + 2, TH + 2, TW / 2 + 1, 0);
    g.fillStyle = colors[variant % colors.length];
    g.fill();
    if (terrain === 1 || terrain === 2 || terrain === 3) {
      // a few deterministic speckles so the ground is not flat colour
      var seed = (variant * 37 + terrain * 91) % 97;
      for (var i = 0; i < 3; i++) {
        var t = (seed + i * 29) % 100 / 100;
        var px = 1 + TW * (0.22 + t * 0.56);
        var py = 1 + TH * (0.25 + ((seed + i * 13) % 50) / 100 * 0.5);
        g.fillStyle = shade(colors[variant % colors.length], i % 2 ? 0.9 : 1.1);
        g.fillRect(px, py, 3, 2);
      }
    } else if (terrain === 0) {
      g.strokeStyle = 'rgba(190,228,255,0.22)';
      g.lineWidth = 1;
      for (var k = 0; k < 3; k++) {
        var yy = 1 + TH * (0.3 + k * 0.2);
        g.beginPath();
        g.moveTo(1 + TW * 0.3, yy);
        g.lineTo(1 + TW * 0.42, yy - 1);
        g.stroke();
        g.beginPath();
        g.moveTo(1 + TW * 0.58, yy + 2);
        g.lineTo(1 + TW * 0.7, yy + 1);
        g.stroke();
      }
    }
    return c;
  }

  function oreSprite(kind, level) {
    var c = Art.canvas(TW + 2, TH + 2);
    var g = ctxOf(c);
    var base = kind === 2 ? '#e8d24a' : '#c8a63a';
    var dark = kind === 2 ? '#9d831a' : '#7d651d';
    diamondPath(g, TW + 2, TH + 2, TW / 2 + 1, 0);
    g.fillStyle = kind === 2 ? 'rgba(120,100,10,0.45)' : 'rgba(90,70,20,0.4)';
    g.fill();
    var count = 4 + level * 4;
    for (var i = 0; i < count; i++) {
      var t = (i * 53 + level * 17) % 100 / 100;
      var px = 1 + TW * (0.15 + t * 0.7);
      var py = 1 + TH * (0.2 + ((i * 31 + level * 11) % 60) / 100 * 0.6);
      var size = 2 + (i % 3) + (level > 3 ? 1 : 0);
      g.fillStyle = i % 3 === 0 ? shade(dark, 0.9) : base;
      g.fillRect(px, py, size, size - 1);
      if (size > 2) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(px, py, size - 1, 1);
      }
    }
    return c;
  }

  function objectSprite(kind, variant) {
    var w = TW * 1.4, h = TH * 2.6;
    var c = Art.canvas(w, h);
    var g = ctxOf(c);
    var cx = w / 2, baseY = h - TH / 2 - 2;
    if (kind === 'tree') {
      var trunk = '#4a3524';
      g.fillStyle = trunk;
      g.fillRect(cx - 3, baseY - 20, 6, 20);
      var greens = ['#2f6b32', '#357a38', '#295e2c'];
      for (var i = 0; i < 3; i++) {
        g.fillStyle = greens[(variant + i) % 3];
        g.beginPath();
        g.moveTo(cx - 20 + i * 9, baseY - 14 - i * 2);
        g.lineTo(cx + 20 - i * 9, baseY - 14 - i * 2);
        g.lineTo(cx, baseY - 40 - i * 6);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,0.22)';
      groundQuad(g, 0, 0, 0, 0, 0, 'rgba(0,0,0,0)');
      g.beginPath();
      g.ellipse ? g.ellipse(cx, baseY, 16, 8, 0, 0, Math.PI * 2) : g.arc(cx, baseY, 10, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 'cliff') {
      var greys = ['#8b8578', '#78736a', '#9a9486'];
      for (i = 0; i < 3; i++) {
        g.fillStyle = greys[(variant + i) % 3];
        g.beginPath();
        g.moveTo(cx - 22 + i * 4, baseY);
        g.lineTo(cx + 14 - i * 3, baseY);
        g.lineTo(cx + 6 - i * 3, baseY - 20 - i * 6);
        g.lineTo(cx - 14 + i * 3, baseY - 16 - i * 5);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(cx - 16, baseY - 26, 20, 3);
    } else {
      // rock / bush scatter
      g.fillStyle = variant % 2 ? '#6d6455' : '#3c6b34';
      g.beginPath();
      g.moveTo(cx - 8, baseY);
      g.lineTo(cx + 7, baseY - 1);
      g.lineTo(cx + 3, baseY - 9);
      g.lineTo(cx - 6, baseY - 7);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(cx - 8, baseY - 1, 15, 2);
    }
    return c;
  }

  // ---------------------------------------------------------------------
  // Units
  // ---------------------------------------------------------------------
  var ALLIED = { base: '#8b9a7c', dark: '#333c2e', light: '#cbd7b8' };
  var SOVIET = { base: '#9b7350', dark: '#3a2818', light: '#d2ae86' };
  var METAL = { base: '#8d979b', dark: '#2f3639', light: '#c6d0d4' };
  var METAL_DARK = { base: '#5c6469', dark: '#23282b', light: '#8f989c' };

  function palette(faction, playerColor) {
    var p = faction === 'soviet' ? SOVIET : ALLIED;
    return { base: p.base, dark: p.dark, light: p.light, accent: playerColor.hex, accentDark: playerColor.dark };
  }
  Art.palette = palette;

  function drawTracks(ctx, len, wid, h, colors) {
    isoBox(ctx, 0, -wid / 2, len, wid * 0.28, h, 0, { base: colors.dark, dark: '#1c1c1c' }, { stroke: false, topBright: 1.0 });
    isoBox(ctx, 0, wid / 2, len, wid * 0.28, h, 0, { base: colors.dark, dark: '#1c1c1c' }, { stroke: false, topBright: 1.0 });
    for (var i = 0; i < 4; i++) {
      var u = -len / 2 + len * (0.14 + i * 0.24);
      var p1 = projX(u, -wid / 2), p2 = projY(u, -wid / 2, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1 - 4, p2 + 1);
      ctx.lineTo(p1 + 4, p2 + 1);
      ctx.stroke();
    }
  }

  /**
   * Tanks are split in two layers: the hull (rotates with the unit's facing,
   * cached) and the turret (rotates independently, drawn every frame).
   */
  function chassisSpec(type) {
    switch (type) {
      // 尺寸、底盘类型、炮塔造型三者共同构成辨识度
      case 'grizzly': return { kind: 'tracked', len: 1.12, wid: 0.92, hull: 14, turret: 'round', turretLen: 0.52, turretWid: 0.50, barrel: 0.56, barrels: 1 };
      case 'rhino': return { kind: 'tracked', len: 1.28, wid: 1.06, hull: 18, turret: 'box', turretLen: 0.66, turretWid: 0.62, barrel: 0.64, barrels: 1 };
      case 'apoc': return { kind: 'tracked', len: 1.52, wid: 1.18, hull: 21, turret: 'box', turretLen: 0.80, turretWid: 0.76, barrel: 0.68, barrels: 2, missiles: true };
      case 'prismtank': return { kind: 'tracked', len: 1.14, wid: 0.90, hull: 13, turret: 'prism', turretLen: 0.50, turretWid: 0.50, barrel: 0, barrels: 0 };
      case 'mirage': return { kind: 'tracked', len: 1.08, wid: 0.88, hull: 12, turret: 'dish', turretLen: 0.46, turretWid: 0.46, barrel: 0.30, barrels: 1 };
      case 'ifv': return { kind: 'wheeled', len: 0.92, wid: 0.72, hull: 10, turret: 'missile', turretLen: 0.36, turretWid: 0.36, barrel: 0, barrels: 0 };
      case 'flaktrack': return { kind: 'tracked', len: 1.00, wid: 0.78, hull: 9, turret: 'flak', turretLen: 0.4, turretWid: 0.4, barrel: 0, barrels: 4 };
      case 'v3': return { kind: 'truck', len: 1.38, wid: 0.88, hull: 11, turret: 'rail', turretLen: 0.95, turretWid: 0.38, barrel: 0, barrels: 0 };
      default: return null;
    }
  }

  /** 轮式底盘（多功能步兵车）：4 个黑色轮子，一眼区别于履带。 */
  function drawWheels(ctx, len, wid, colors) {
    var pts = [[-len * 0.32, -wid * 0.52], [len * 0.32, -wid * 0.52],
      [-len * 0.32, wid * 0.52], [len * 0.32, wid * 0.52]];
    for (var i = 0; i < pts.length; i++) {
      var px = projX(pts[i][0], pts[i][1]);
      var py = projY(pts[i][0], pts[i][1], 0);
      ctx.fillStyle = '#1b1f22';
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(px, py, 5, 3, 0, 0, Math.PI * 2) : ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    void colors;
  }

  /** 卡车底盘（V3）：驾驶室 + 平板货箱。 */
  function drawTruckBody(ctx, s, colors) {
    isoBox(ctx, len0(s), 0, 0.42, s.wid * 0.8, s.hull * 0.75, 0,
      { base: colors.light || colors.base, dark: colors.dark }, { topBright: 1.05 });
    isoBox(ctx, -0.15, 0, s.len * 0.62, s.wid * 0.86, s.hull * 0.55, 0, colors, { topBright: 1.02 });
    drawTracksWheels(ctx, s, colors);
  }
  function len0(s) { return s.len * 0.5 - 0.18; }
  function drawTracksWheels(ctx, s, colors) {
    var pts = [[-s.len * 0.3, -s.wid * 0.5], [s.len * 0.1, -s.wid * 0.5],
      [-s.len * 0.3, s.wid * 0.5], [s.len * 0.1, s.wid * 0.5]];
    for (var i = 0; i < pts.length; i++) {
      var px = projX(pts[i][0], pts[i][1]), py = projY(pts[i][0], pts[i][1], 0);
      ctx.fillStyle = '#1b1f22';
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(px, py, 4, 2.5, 0, 0, Math.PI * 2) : ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    void colors;
  }

  function drawTankHull(ctx, s, colors, facing) {
    if (s.kind === 'wheeled') drawWheels(ctx, s.len, s.wid, colors);
    else if (s.kind === 'truck') drawTruckBody(ctx, s, colors);
    else drawTracks(ctx, s.len, s.wid, s.hull * 0.55, colors);
    // 车体：底盘 + 上方装甲盒 + 前部斜坡，三层结构看起来更"实"
    isoBox(ctx, 0, 0, s.len * 0.96, s.wid * 0.84, s.hull * 0.5, facing, { base: colors.dark, dark: '#20241f' }, { topBright: 1.02 });
    isoBox(ctx, 0, 0, s.len, s.wid * 0.86, s.hull, facing, colors, { topBright: 1.12 });
    isoBox(ctx, s.len * 0.42, 0, s.len * 0.16, s.wid * 0.8, s.hull * 0.75, facing,
      { base: colors.light || colors.base, dark: colors.dark }, { topBright: 0.98 });
    // 队伍颜色：车体顶部后方的醒目标条（原版的"阵营色"）
    topFace(ctx, -s.len * 0.3, 0, s.len * 0.26, s.wid * 0.6, s.hull + 1, facing, function (g) {
      g.fillStyle = colors.accent;
      g.fillRect(-s.len * 0.13, -s.wid * 0.3, s.len * 0.15, s.wid * 0.6);
    });
  }

  function drawTankTurret(ctx, s, colors, angle) {
    var h = s.hull * 0.55;
    if (s.turret === 'prism') {
      // 光棱坦克：没有炮管，顶部是一块发光棱镜
      isoBox(ctx, 0, 0, s.turretLen, s.turretWid, h * 0.7, angle, { base: colors.base, dark: colors.dark }, { topBright: 1.15 });
      var px = projX(0, 0), py = projY(0, 0, h * 0.7);
      ctx.fillStyle = 'rgba(150,225,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(px, py - 20);
      ctx.lineTo(px + 10, py - 6);
      ctx.lineTo(px, py + 6);
      ctx.lineTo(px - 10, py - 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    if (s.turret === 'dish') {
      // 幻影坦克：顶部是频谱发生器（圆盘）
      isoBox(ctx, 0, 0, s.turretLen, s.turretWid, h * 0.6, angle, { base: colors.base, dark: colors.dark }, { topBright: 1.12 });
      var dx = projX(0, 0), dy = projY(0, 0, h * 0.6 + 4);
      ctx.fillStyle = '#cfd8dd';
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(dx, dy, 12, 6, 0, 0, Math.PI * 2) : ctx.arc(dx, dy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a545a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(dx, dy - 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (s.turret === 'missile') {
      // 多功能步兵车：小车身 + 顶部导弹箱
      isoBox(ctx, 0, 0, s.turretLen, s.turretWid, h * 0.8, angle, { base: colors.dark, dark: '#1c1c1c' }, { topBright: 1.05 });
      for (var mm = 0; mm < 2; mm++) {
        isoBox(ctx, -0.05, mm ? 0.14 : -0.14, 0.36, 0.11, h * 1.1, angle,
          { base: '#cfd8dd', dark: '#4a545a' }, { topBright: 1.15 });
      }
      return;
    }
    if (s.turret === 'flak') {
      // 防空履带车：4 根竖直短炮管
      isoBox(ctx, -0.05, 0, 0.34, 0.34, h * 0.6, angle, { base: colors.dark, dark: '#1b1b1b' }, { topBright: 1.05 });
      for (var fb = 0; fb < 4; fb++) {
        var fx = (fb % 2 ? 0.13 : -0.13), fy = (fb < 2 ? -0.13 : 0.13);
        isoBox(ctx, fx, fy, 0.13, 0.13, h * 3.4, angle, { base: '#4a4a4a', dark: '#141414' }, { stroke: false, topBright: 1.15 });
      }
      // 炮盾
      isoBox(ctx, 0.14, 0, 0.16, 0.6, h * 1.3, angle, { base: colors.light || colors.base, dark: colors.dark }, { topBright: 1.05 });
      return;
    }
    if (s.turret === 'rail') {
      // V3：斜架上的大火箭
      isoBox(ctx, 0, 0, s.turretLen, s.turretWid, h * 0.4, angle, { base: colors.dark, dark: '#20211f' }, { topBright: 1.05 });
      isoBox(ctx, 0.1, 0, 1.25, 0.3, h * 1.9, angle, { base: '#b8402f', dark: '#3a1410' }, { topBright: 1.1 });
      var rx = projX(Math.cos(angle) * 0.72, Math.sin(angle) * 0.72);
      var ry = projY(Math.cos(angle) * 0.72, Math.sin(angle) * 0.72, h * 1.9);
      ctx.fillStyle = '#e8e0c0';
      ctx.beginPath();
      ctx.moveTo(rx, ry - 9);
      ctx.lineTo(rx + 5, ry);
      ctx.lineTo(rx - 5, ry);
      ctx.closePath();
      ctx.fill();
      return;
    }
    isoBox(ctx, 0, 0, s.turretLen, s.turretWid, h, angle, { base: colors.base, dark: colors.dark }, { topBright: 1.18 });
    for (var b = 0; b < s.barrels; b++) {
      var off = (s.barrels === 1) ? 0 : (b === 0 ? -0.09 : 0.09);
      var bx = Math.cos(angle) * (s.turretLen * 0.62 + s.barrel * 0.5) - Math.sin(angle) * off;
      var by = Math.sin(angle) * (s.turretLen * 0.62 + s.barrel * 0.5) + Math.cos(angle) * off;
      isoBox(ctx, bx, by, s.barrel, 0.11, h * 1.2, angle,
        { base: colors.dark, dark: '#20211f' }, { stroke: false, topBright: 1.1 });
    }
    if (s.missiles) {
      for (var m = 0; m < 2; m++) {
        isoBox(ctx, -s.turretLen * 0.05, m ? 0.16 : -0.16, 0.34, 0.14, h * 1.7, angle,
          { base: colors.dark, dark: '#151515' }, { topBright: 0.9 });
      }
    }
    topFace(ctx, 0, 0, s.turretLen, s.turretWid, h + 1, angle, function (g) {
      g.fillStyle = colors.accent;
      g.fillRect(-0.12, -0.06, 0.24, 0.12);
    });
  }

  function drawHarvester(ctx, colors) {
    drawTracks(ctx, 1.3, 0.95, 6, colors);
    isoBox(ctx, 0, 0, 1.3, 0.82, 11, 0, colors);
    isoBox(ctx, 0.5, 0, 0.4, 0.8, 9, 0, { base: colors.dark, dark: '#1b1b1b' });
    isoBox(ctx, -0.25, 0, 0.62, 0.7, 5, 0, { base: '#3a3a3a', dark: '#191919' }, { topBright: 1.2 });
    topFace(ctx, -0.25, 0, 0.62, 0.7, 16, 0, function (gg) {
      gg.fillStyle = '#c8a63a';
      gg.fillRect(-0.28, -0.32, 0.56, 0.64);
      gg.fillStyle = '#e8d24a';
      gg.fillRect(-0.22, -0.26, 0.44, 0.52);
    });
    var px = projX(0.72, 0), py = projY(0.72, 0, 2);
    ctx.fillStyle = colors.light || colors.base;
    ctx.beginPath();
    ctx.moveTo(px - 8, py - 4);
    ctx.lineTo(px + 10, py + 3);
    ctx.lineTo(px + 8, py + 9);
    ctx.lineTo(px - 8, py + 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(colors.dark, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    isoBox(ctx, -0.5, 0, 0.3, 0.72, 6, 0, { base: colors.dark, dark: '#181818' }, { topBright: 1.05 });
  }

  function unitDrawer(type, colors, angle) {
    switch (type) {
      case 'grizzly':
      case 'rhino':
      case 'apoc':
      case 'prismtank':
        return function (g) {
          drawTankHull(g, chassisSpec(type), colors, angle);
        };
      case 'harvester':
        return function (g) { drawHarvester(g, colors); };
      case 'gi':
      case 'conscript':
      case 'guardian':
      case 'flak':
      case 'engineer':
      case 'tesla_trooper':
      case 'spy':
        return function (g) { drawInfantry(g, type, colors, angle); };
      case 'rocketeer':
        return function (g) { drawRocketeer(g, colors, angle); };
      case 'ifv':
        return function (g) { drawTankHull(g, chassisSpec('ifv'), colors, angle); };
      case 'mirage':
        return function (g) { drawTankHull(g, chassisSpec('mirage'), colors, angle); };
      case 'v3':
        return function (g) { drawTankHull(g, chassisSpec('v3'), colors, angle); };
      case 'warminer':
        return function (g) { drawHarvester(g, colors); drawMinerGun(g); };
      case 'flaktrack':
        return function (g) { drawTankHull(g, chassisSpec('flaktrack'), colors, angle); };
      default:
        return function (g) {
          isoBox(g, 0, 0, 0.9, 0.8, 10, angle, colors);
        };
    }
  }

  function drawInfantry(g, type, colors, angle) {
    // 每个兵种靠"体格 + 头盔 + 武器"三件事区分，并整体放大到能看清
    var spec = INFANTRY_SPEC[type] || INFANTRY_SPEC.gi;
    var body = spec.body, helmet = spec.helmet;
    g.save();
    g.scale(spec.scale || 1, spec.scale || 1);
    var swing = Math.sin(angle * 3) * 0.6;
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.beginPath();
    g.moveTo(-8, 2);
    g.lineTo(4, -2);
    g.lineTo(8, 2);
    g.lineTo(-4, 6);
    g.closePath();
    g.fill();
    // legs
    g.fillStyle = shade(body, 0.72);
    var legX = Math.cos(angle) * 2.2, legY = Math.sin(angle) * 1.3;
    g.fillRect(-5 + legX, -9 + legY, 3.6, 10);
    g.fillRect(1 - legX, -9 - legY, 3.6, 10);
    // torso（体格差异：间谍最瘦、磁暴/防空最壮）
    g.fillStyle = body;
    g.fillRect(-spec.w, -18, spec.w * 2, 11);
    g.strokeStyle = shade(colors.dark, 0.9);
    g.lineWidth = 1;
    g.strokeRect(-spec.w, -18, spec.w * 2, 11);
    // 队伍颜色肩章
    g.fillStyle = colors.accent;
    g.fillRect(-spec.w, -17, 2.4, 4.5);
    // 队伍颜色胸前竖条（步兵体型小，这一条是最主要的敌我识别标志）
    g.fillRect(-spec.w + 0.6, -16, 2.0, 7);
    // head + helmet
    g.fillStyle = '#d7b291';
    g.beginPath();
    g.arc(0, -22, 4.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = helmet;
    if (spec.hat === 'fedora') {
      g.fillRect(-6, -25, 12, 2.4);
      g.fillRect(-4, -29, 8, 4.6);
    } else if (spec.hat === 'cap') {
      g.beginPath();
      g.arc(0, -23, 4.7, Math.PI, Math.PI * 2);
      g.fill();
      g.fillRect(-4.7, -23.4, 9.4, 2.2);
    } else {
      g.beginPath();
      g.arc(0, -23, 4.7, Math.PI, Math.PI * 2);
      g.fill();
    }
    // 阵营色只保留"肩章 + 背后小色块"（和原版一样是小面积高对比，而不是整顶帽子）
    g.fillStyle = colors.accent;
    g.fillRect(spec.w - 2.4, -16.5, 2.4, 4.0);
    if (type === 'spy') {
      g.fillStyle = '#0d1014';
      g.fillRect(-3.8, -22.6, 7.6, 1.8);
    }
    drawInfantryWeapon(g, type, angle, spec);
    g.restore();
    void swing;
  }

  /** 兵种武器/装备造型——辨识度主要靠这个。 */
  function drawInfantryWeapon(g, type, angle, spec) {
    var wx = Math.cos(angle), wy = Math.sin(angle) * 0.75;
    if (type === 'guardian') {
      g.strokeStyle = '#3f4a3c';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(-4, -19);
      g.lineTo(-4 + wx * 15, -19 + wy * 11);
      g.stroke();
      g.strokeStyle = '#20241f';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-4 + wx * 15, -19 + wy * 11);
      g.lineTo(-4 + wx * 19, -19 + wy * 14);
      g.stroke();
      g.fillStyle = '#4a5445';
      g.fillRect(2, -16, 6, 6);
    } else if (type === 'flak') {
      g.fillStyle = '#3a3a3a';
      g.fillRect(-5 + wx * 7, -19 + wy * 6, 11, 7);
      for (var i = 0; i < 4; i++) {
        g.fillStyle = '#151515';
        g.fillRect(-4 + wx * 11, -21 + wy * 9 + i * 2.2, 7, 1.7);
      }
    } else if (type === 'tesla_trooper') {
      g.fillStyle = '#2f3a44';
      g.fillRect(-11, -21, 4.4, 13);
      for (var c = 0; c < 2; c++) {
        for (var k = 0; k < 3; k++) {
          g.strokeStyle = 'rgba(150,225,255,0.95)';
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(-9, -19 + c * 7 + k * 2.6, 4 - k * 0.7, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.strokeStyle = '#8fd8f0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -14);
      g.lineTo(wx * 12, -14 + wy * 8);
      g.stroke();
    } else if (type === 'engineer') {
      g.fillStyle = '#e0a02a';
      g.fillRect(2, -14, 7, 6);
      g.fillStyle = '#8a6412';
      g.fillRect(2, -11.4, 7, 1.4);
      void spec;
    } else if (type === 'spy') {
      // 间谍：细高西装 + 明显的公文包（和动员兵拉开轮廓）
      g.fillStyle = '#3d444e';
      g.fillRect(3, -15, 9, 7);
      g.fillStyle = '#0f1114';
      g.fillRect(6, -16.6, 3, 1.8);
    } else if (type === 'rocketeer') {
      g.fillStyle = '#2f2f2f';
      g.fillRect(-9, -20, 4, 12);
    } else {
      g.strokeStyle = '#2b2b2b';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(0, -14);
      g.lineTo(wx * 13, -14 + wy * 10);
      g.stroke();
      if (type === 'conscript') {
        g.strokeStyle = '#5a4a3a';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(-spec.w, -12);
        g.lineTo(spec.w, -12);
        g.stroke();
      }
    }
  }

  var INFANTRY_SPEC = {
    gi: { body: '#66745f', helmet: '#4a5a4a', w: 4.6, scale: 1.25 },
    guardian: { body: '#4f5c4c', helmet: '#3d4a3c', w: 5.2, scale: 1.3 },
    rocketeer: { body: '#7d8a94', helmet: '#5d6a74', w: 5.0, scale: 1.3 },
    engineer: { body: '#d8d2c0', helmet: '#e8e2d0', w: 4.6, scale: 1.25 },
    conscript: { body: '#7a5a44', helmet: '#5d4a3a', w: 4.8, hat: 'cap', scale: 1.12 },
    flak: { body: '#6b5a46', helmet: '#57493a', w: 5.4, hat: 'cap', scale: 1.3 },
    tesla_trooper: { body: '#6c7a86', helmet: '#9fb6c4', w: 6.0, scale: 1.4 },
    spy: { body: '#3c4048', helmet: '#2b2f36', w: 3.4, hat: 'fedora', scale: 1.4 }
  };

  /** 武装矿车顶上的机枪（占位造型）。 */
  function drawMinerGun(g) {
    var px = projX(0.15, 0.35), py = projY(0.15, 0.35, 13);
    g.fillStyle = '#2f3639';
    g.fillRect(px - 3, py - 3, 6, 6);
    g.strokeStyle = '#1b1f22';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, py - 1);
    g.lineTo(px + 11, py - 6);
    g.stroke();
  }

  function drawRocketeer(g, colors, angle) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.moveTo(-8, -4);
    g.lineTo(2, -8);
    g.lineTo(8, -4);
    g.lineTo(-2, 0);
    g.closePath();
    g.fill();
    g.fillStyle = colors.base;
    g.fillRect(-5, -20, 10, 12);
    g.strokeStyle = shade(colors.dark, 0.9);
    g.lineWidth = 1;
    g.strokeRect(-5, -20, 10, 12);
    g.fillStyle = '#2f2f2f';
    g.fillRect(-7, -19, 3, 10);
    g.fillStyle = angle < Math.PI ? '#5a5a5a' : '#4a4a4a';
    g.beginPath();
    g.arc(0, -24, 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colors.accent;
    g.fillRect(-5, -17, 10, 2);
    // jet flame
    g.fillStyle = 'rgba(255,170,60,0.85)';
    g.beginPath();
    g.moveTo(-4, -8);
    g.lineTo(4, -8);
    g.lineTo(0, -1);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,240,180,0.9)';
    g.beginPath();
    g.moveTo(-2, -8);
    g.lineTo(2, -8);
    g.lineTo(0, -3);
    g.closePath();
    g.fill();
  }

  function unitSpriteCanvas(type, playerColor, facingIdx, steps) {
    var def = Rules.units[type];
    var faction = def.faction === 'any' ? 'allied' : def.faction;
    var colors = palette(faction, playerColor);
    var size = 96;
    var c = Art.canvas(size, size);
    var g = ctxOf(c);
    g.save();
    g.translate(size / 2, size / 2 + 10);
    var angle = (facingIdx / steps) * Math.PI * 2;
    var drawer = unitDrawer(type, colors, angle);
    drawer(g);
    g.restore();
    return c;
  }

  var UNIT_CANVAS = 96;
  var UNIT_ORIGIN_X = UNIT_CANVAS / 2;
  var UNIT_ORIGIN_Y = UNIT_CANVAS / 2 + 10;

  /**
   * Draw a complete unit (hull + turret) at screen position (sx,sy), which is
   * the unit's ground point.
   */
  Art.drawUnit = function (ctx, type, colorId, sx, sy, facing, turret) {
    var def = Rules.units[type];
    var spr = Art.unitSprite(type, colorId, facing);
    ctx.drawImage(spr, Math.round(sx - UNIT_ORIGIN_X), Math.round(sy - UNIT_ORIGIN_Y));
    if (!def || !def.turret) return;
    var s = chassisSpec(type);
    if (!s) return;
    var faction = def.faction === 'any' ? 'allied' : def.faction;
    var colors = palette(faction, Rules.PLAYER_COLORS[colorId]);
    ctx.save();
    ctx.translate(sx, sy);
    drawTankTurret(ctx, s, colors, turret === undefined ? facing : turret);
    ctx.restore();
  };

  Art.unitCanvasMeta = function () {
    return { size: UNIT_CANVAS, ox: UNIT_ORIGIN_X, oy: UNIT_ORIGIN_Y };
  };

  // ---------------------------------------------------------------------
  // Buildings
  // ---------------------------------------------------------------------
  function drawPowerPlant(g, colors, soviet) {
    if (soviet) {
      isoBox(g, 0, 0, 2, 2, 22, 0, colors);
      isoBox(g, 0, 0.55, 1.7, 0.5, 6, 0, METAL_DARK, { topBright: 1.1 });
      isoFrustum(g, -0.35, -0.35, 0.9, 0.9, 0.68, 0.68, 34, 0, METAL);
      isoFrustum(g, 0.45, 0.4, 0.7, 0.7, 0.5, 0.5, 26, 0, METAL);
      var px = projX(0.45, 0.4), py = projY(0.45, 0.4, 34);
      g.fillStyle = 'rgba(120,200,255,0.9)';
      g.beginPath();
      g.arc(px, py, 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#dff4ff';
      g.lineWidth = 1;
      g.stroke();
      topFace(g, 0, 0, 2, 2, 22, 0, function (gg) {
        gg.fillStyle = 'rgba(42,48,52,0.9)';
        gg.fillRect(-0.85, -0.85, 1.7, 1.7);
        gg.fillStyle = colors.accent;
        gg.fillRect(-0.85, -0.85, 0.3, 1.7);
        gg.fillStyle = 'rgba(200,230,255,0.55)';
        gg.fillRect(0.25, -0.7, 0.5, 0.4);
      });
    } else {
      isoBox(g, 0, 0, 2, 2, 20, 0, colors);
      isoFrustum(g, -0.45, -0.2, 0.78, 0.78, 0.6, 0.6, 30, 0, METAL);
      isoFrustum(g, 0.45, -0.2, 0.78, 0.78, 0.6, 0.6, 30, 0, METAL);
      isoBox(g, 0, 0.62, 1.6, 0.44, 10, 0, METAL_DARK, { topBright: 1.1 });
      topFace(g, 0, -0.5, 1.6, 0.6, 20, 0, function (gg) {
        gg.fillStyle = 'rgba(40,50,60,0.9)';
        gg.fillRect(-0.7, -0.24, 1.4, 0.48);
        gg.fillStyle = '#7fd4ff';
        gg.fillRect(-0.6, -0.16, 1.2, 0.32);
      });
      topFace(g, 0, 0.62, 1.6, 0.44, 10, 0, function (gg) {
        gg.fillStyle = colors.accent;
        gg.fillRect(-0.5, -0.14, 1.0, 0.28);
      });
    }
  }

  function drawConyard(g, colors) {
    isoBox(g, 0, 0, 3, 3, 24, 0, colors);
    isoBox(g, -0.75, -0.75, 1.45, 1.45, 18, 0, { base: colors.light, dark: colors.dark });
    isoBox(g, 0.85, 0.75, 1.3, 1.3, 14, 0, METAL_DARK, { topBright: 1.05 });
    isoBox(g, 0.9, -0.9, 0.9, 0.9, 8, 0, METAL, { topBright: 1.1 });
    // crane arm
    var px = projX(-0.75, -0.75), py = projY(-0.75, -0.75, 42);
    g.strokeStyle = '#c8b24a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + 34, py - 16);
    g.stroke();
    g.strokeStyle = '#6b5c1f';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + 30, py - 14);
    g.lineTo(px + 30, py + 6);
    g.stroke();
    topFace(g, 0.15, 0.15, 2.4, 2.4, 24, 0, function (gg) {
      gg.fillStyle = 'rgba(34,38,42,0.9)';
      gg.fillRect(-1.15, -1.15, 2.3, 2.3);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.7, -0.18, 1.4, 0.36);
      gg.fillStyle = 'rgba(140,160,170,0.55)';
      gg.fillRect(-1.05, -1.05, 0.55, 0.45);
      gg.fillRect(0.5, -1.05, 0.55, 0.45);
      gg.fillStyle = 'rgba(200,190,120,0.8)';
      gg.fillRect(-0.2, 0.45, 0.4, 0.6);
    });
  }

  function drawRefinery(g, colors) {
    isoBox(g, -0.5, 0, 2, 2, 20, 0, colors);
    // storage tanks
    isoFrustum(g, 0.78, -0.55, 0.72, 0.72, 0.6, 0.6, 26, 0, METAL);
    isoFrustum(g, 0.78, 0.55, 0.72, 0.72, 0.6, 0.6, 26, 0, METAL);
    // conveyor / dock
    isoBox(g, 0.6, 0.05, 1.5, 0.9, 9, 0, METAL_DARK, { topBright: 1.05 });
    var px = projX(1.2, 0.05), py = projY(1.2, 0.05, 9);
    g.fillStyle = '#d8d24a';
    g.fillRect(px - 7, py - 2, 14, 5);
    topFace(g, -0.5, 0, 2, 2, 20, 0, function (gg) {
      gg.fillStyle = 'rgba(38,44,46,0.9)';
      gg.fillRect(-0.92, -0.92, 1.84, 1.84);
      gg.fillStyle = '#c8a63a';
      gg.beginPath();
      gg.arc(0, 0, 0.46, 0, Math.PI * 2);
      gg.fill();
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.88, -0.88, 0.36, 0.36);
    });
  }

  function drawBarracks(g, colors, soviet) {
    isoBox(g, 0, 0, 2, 2, 16, 0, colors);
    isoBox(g, 0, 0.64, 1.5, 0.5, 7, 0, METAL_DARK, { topBright: 1.05 });
    var px = projX(0, 1.08), py = projY(0, 1.08, 7);
    g.fillStyle = soviet ? '#8a2c22' : '#2c4a8a';
    g.fillRect(px - 9, py - 10, 18, 11);
    g.fillStyle = '#1b1f22';
    g.fillRect(px - 5, py - 5, 10, 5);
    topFace(g, 0, 0, 2, 2, 16, 0, function (gg) {
      gg.fillStyle = 'rgba(46,54,50,0.85)';
      gg.fillRect(-0.88, -0.88, 1.76, 1.76);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.88, -0.88, 0.32, 1.76);
      gg.fillStyle = 'rgba(150,160,150,0.4)';
      gg.fillRect(0.1, -0.6, 0.6, 0.5);
    });
    // flag pole
    px = projX(-0.75, -0.75); py = projY(-0.75, -0.75, 16);
    g.strokeStyle = '#c9c9c9';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, py - 20);
    g.stroke();
    g.fillStyle = colors.accent;
    g.beginPath();
    g.moveTo(px, py - 20);
    g.lineTo(px + 11, py - 16);
    g.lineTo(px, py - 12);
    g.closePath();
    g.fill();
  }

  function drawWarFactory(g, colors) {
    isoBox(g, 0, 0, 3, 2, 19, 0, colors);
    isoBox(g, -0.2, 0.55, 2.3, 0.9, 6, 0, METAL_DARK, { topBright: 1.05 });
    var px = projX(-0.2, 1.05), py = projY(-0.2, 1.05, 6);
    g.fillStyle = '#2b2f33';
    g.fillRect(px - 24, py - 15, 48, 16);
    g.fillStyle = 'rgba(120,140,150,0.35)';
    for (var i = 0; i < 4; i++) g.fillRect(px - 20 + i * 11, py - 13, 2, 13);
    topFace(g, 0, 0, 3, 2, 19, 0, function (gg) {
      gg.fillStyle = 'rgba(42,47,51,0.9)';
      gg.fillRect(-1.32, -0.86, 2.64, 1.72);
      gg.fillStyle = colors.accent;
      gg.fillRect(-1.32, -0.86, 0.42, 1.72);
      gg.fillStyle = 'rgba(180,190,200,0.5)';
      gg.fillRect(0.2, -0.62, 0.95, 0.55);
      gg.fillStyle = 'rgba(120,110,80,0.6)';
      gg.fillRect(-0.5, 0.2, 0.7, 0.5);
    });
  }

  function drawLab(g, colors) {
    isoBox(g, 0, 0, 3, 2, 18, 0, colors);
    isoFrustum(g, 0.45, 0, 1.25, 1.25, 0.72, 0.72, 24, 0, METAL);
    var px = projX(0.45, 0), py = projY(0.45, 0, 42);
    g.strokeStyle = '#dfe8ee';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, py - 18);
    g.stroke();
    g.fillStyle = '#ff5a4a';
    g.fillRect(px - 3, py - 23, 6, 5);
    topFace(g, 0, 0, 3, 2, 18, 0, function (gg) {
      gg.fillStyle = 'rgba(40,46,54,0.9)';
      gg.fillRect(-1.32, -0.86, 2.64, 1.72);
      gg.fillStyle = colors.accent;
      gg.fillRect(-1.32, -0.86, 0.42, 1.72);
      gg.fillStyle = 'rgba(140,200,255,0.5)';
      gg.fillRect(-0.7, -0.55, 0.9, 1.0);
    });
  }

  function drawPillbox(g, colors) {
    isoFrustum(g, 0, 0, 1.0, 1.0, 0.82, 0.82, 10, 0, { base: '#8b9385', dark: '#333a34' });
    isoBox(g, 0, 0, 0.6, 0.6, 5, 0, METAL_DARK, { topBright: 1.1 });
    var px = projX(0, 0), py = projY(0, 0, 15);
    g.fillStyle = '#2b2b2b';
    g.fillRect(px - 3, py - 3, 14, 3);
    g.fillStyle = colors.accent;
    g.fillRect(px - 1, py - 8, 6, 3);
  }

  function drawSentry(g, colors) {
    isoFrustum(g, 0, 0, 1.0, 1.0, 0.8, 0.8, 8, 0, METAL_DARK);
    isoFrustum(g, 0, 0, 0.62, 0.62, 0.46, 0.46, 13, 0, { base: colors.base, dark: colors.dark });
    var px = projX(0, 0), py = projY(0, 0, 20);
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(px - 2, py);
    g.lineTo(px + 18, py - 8);
    g.stroke();
  }

  function drawPatriot(g, colors) {
    isoFrustum(g, 0, 0, 1.0, 1.0, 0.85, 0.85, 8, 0, METAL_DARK);
    isoBox(g, 0, 0, 0.62, 0.62, 9, 0.6, { base: colors.base, dark: colors.dark });
    for (var i = 0; i < 4; i++) {
      var a = Math.PI * (0.25 + i * 0.16);
      var bx = Math.cos(a) * 0.24, by = Math.sin(a) * 0.24;
      isoBox(g, bx, by, 0.32, 0.1, 18, a, { base: '#cfd6d8', dark: '#4a4a4a' }, { topBright: 1.15 });
    }
  }

  function drawFlakCannon(g, colors) {
    isoFrustum(g, 0, 0, 1.0, 1.0, 0.85, 0.85, 9, 0, { base: '#6f675a', dark: '#2e2a24' });
    isoFrustum(g, 0, 0, 0.66, 0.66, 0.5, 0.5, 13, 0, { base: colors.base, dark: colors.dark });
    var px = projX(0, 0), py = projY(0, 0, 23);
    g.strokeStyle = '#33332f';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(px, py + 2);
    g.lineTo(px + 14, py - 16);
    g.stroke();
    g.fillStyle = '#4a4a44';
    g.fillRect(px + 7, py - 22, 6, 10);
  }

  function drawPrismTower(g, colors) {
    isoFrustum(g, 0, 0, 0.95, 0.95, 0.85, 0.85, 8, 0, METAL_DARK);
    isoFrustum(g, 0, 0, 0.7, 0.7, 0.34, 0.34, 28, 0, { base: colors.base, dark: colors.dark });
    var px = projX(0, 0), py = projY(0, 0, 36);
    g.fillStyle = 'rgba(150,225,255,0.9)';
    g.beginPath();
    g.moveTo(px, py - 12);
    g.lineTo(px + 9, py - 3);
    g.lineTo(px, py + 6);
    g.lineTo(px - 9, py - 3);
    g.closePath();
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.stroke();
  }

  function drawTeslaCoil(g, colors) {
    isoFrustum(g, 0, 0, 0.95, 0.95, 0.85, 0.85, 8, 0, { base: '#6f675a', dark: '#2e2a24' });
    isoFrustum(g, 0, 0, 0.5, 0.5, 0.26, 0.26, 30, 0, METAL);
    var px = projX(0, 0), py = projY(0, 0, 38);
    for (var i = 0; i < 3; i++) {
      g.strokeStyle = 'rgba(150,220,255,0.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, py + i * 5, 9 - i * 2, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(200,240,255,0.85)';
    g.beginPath();
    g.arc(px, py - 5, 4.5, 0, Math.PI * 2);
    g.fill();
  }

  // ---- 原版向新增建筑：全部为占位造型，后续可整体替换 ----
  function drawRadar(g, colors, def, sovietAntenna) {
    isoBox(g, 0, 0, 2, 2, 12, 0, colors);
    isoBox(g, 0, 0, 1.2, 1.2, 4, 0, METAL_DARK, { topBright: 1.05 });
    var px = projX(0, 0), py = projY(0, 0, 18);
    if (sovietAntenna) {
      // 苏军雷达站：四根天线杆 + 中间红灯，和盟军的"大锅盖"完全不同
      for (var i = 0; i < 4; i++) {
        var ax = (i % 2 ? 0.45 : -0.45), ay = (i < 2 ? -0.45 : 0.45);
        var gx = projX(ax, ay), gy = projY(ax, ay, 14);
        g.strokeStyle = '#8f989c';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(gx, gy);
        g.lineTo(gx, gy - 22 - (i % 2) * 6);
        g.stroke();
        g.fillStyle = '#c8342a';
        g.beginPath();
        g.arc(gx, gy - 23 - (i % 2) * 6, 2.4, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(200,220,230,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px - 12, py - 8);
      g.lineTo(px + 12, py - 16);
      g.stroke();
    } else {
      // 盟军空军指挥部：地面大雷达盘 + 天线
      g.fillStyle = '#c8d2d6';
      g.beginPath();
      g.ellipse ? g.ellipse(px, py, 22, 10.5, -0.42, 0, Math.PI * 2) : g.arc(px, py, 16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.ellipse ? g.ellipse(px - 4, py - 3, 12, 5.4, -0.42, 0, Math.PI * 2) : g.arc(px, py, 8, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4a545a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px - 18, py + 6);
      g.lineTo(px + 18, py - 8);
      g.stroke();
    }
    topFace(g, 0, 0, 2, 2, 12, 0, function (gg) {
      gg.fillStyle = 'rgba(40,46,52,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, -0.85, 0.3, 1.7);
      gg.fillStyle = 'rgba(160,190,210,0.5)';
      gg.fillRect(0.2, -0.6, 0.45, 1.2);
    });
    void def;
  }

  /** 间谍卫星：细长桅杆 + 顶部卫星盘 + 两侧太阳能板（和雷达站明显不同）。 */
  function drawSatellite(g, colors) {
    isoBox(g, 0, 0, 2, 2, 9, 0, METAL_DARK);
    isoFrustum(g, 0, 0, 0.7, 0.7, 0.42, 0.42, 34, 0, METAL);
    var px = projX(0, 0), py = projY(0, 0, 52);
    g.fillStyle = '#dfe8ee';
    g.beginPath();
    g.ellipse ? g.ellipse(px, py, 11, 5.5, 0.35, 0, Math.PI * 2) : g.arc(px, py, 9, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#5a646a';
    g.lineWidth = 1.5;
    g.stroke();
    // 太阳能板
    g.fillStyle = 'rgba(90,150,220,0.95)';
    g.fillRect(px - 26, py + 4, 18, 9);
    g.fillRect(px + 8, py + 4, 18, 9);
    g.strokeStyle = '#2b3a4c';
    g.lineWidth = 1;
    g.strokeRect(px - 26.5, py + 3.5, 18, 9);
    g.strokeRect(px + 7.5, py + 3.5, 18, 9);
    g.fillStyle = colors.accent;
    g.fillRect(px - 3, py + 14, 6, 4);
    topFace(g, 0, 0, 2, 2, 9, 0, function (gg) {
      gg.fillStyle = 'rgba(34,40,48,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, 0.45, 1.7, 0.3);
    });
  }

  /** 高级电厂：三座冷却塔 + 蓝色变电区，一眼区别于普通电厂。 */
  function drawAdvPower(g, colors) {
    isoBox(g, 0, 0, 2, 2, 16, 0, { base: '#8fa0a6', dark: '#2f383c' });
    isoFrustum(g, -0.55, -0.4, 0.66, 0.66, 0.5, 0.5, 40, 0, METAL);
    isoFrustum(g, 0.4, -0.55, 0.66, 0.66, 0.5, 0.5, 40, 0, METAL);
    isoFrustum(g, -0.15, 0.5, 0.66, 0.66, 0.5, 0.5, 36, 0, METAL);
    // 金色高压变电区（和普通电厂彻底分开）
    isoBox(g, 0.45, 0.45, 0.8, 0.8, 12, 0, { base: '#c8b24a', dark: '#4a3a10' }, { topBright: 1.1 });
    topFace(g, 0, 0, 2, 2, 16, 0, function (gg) {
      gg.fillStyle = 'rgba(34,40,44,0.92)';
      gg.fillRect(-0.9, -0.9, 1.8, 1.8);
      gg.fillStyle = '#d8c05a';
      gg.fillRect(-0.6, 0.3, 1.2, 0.4);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.9, -0.9, 0.34, 1.8);
    });
  }

  function drawGap(g, colors) {
    isoBox(g, 0, 0, 2, 2, 12, 0, colors);
    isoFrustum(g, 0, 0, 1.6, 1.6, 0.5, 0.5, 18, 0, { base: '#9a8fc0', dark: '#3a3550' });
    var px = projX(0, 0), py = projY(0, 0, 26);
    // 视觉干扰波纹：裂缝产生器的标志
    for (var ri = 0; ri < 3; ri++) {
      g.strokeStyle = 'rgba(185,150,255,' + (0.5 - ri * 0.13).toFixed(2) + ')';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse ? g.ellipse(px, py - ri * 5, 21 - ri * 4, 10 - ri * 2, 0, 0, Math.PI * 2)
        : g.arc(px, py, 14 - ri * 3, 0, Math.PI * 2);
      g.stroke();
    }
    topFace(g, 0, 0, 2, 2, 12, 0, function (gg) {
      gg.fillStyle = 'rgba(38,48,56,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, -0.85, 1.7, 0.3);
    });
  }

  function drawChronosphere(g, colors) {
    isoBox(g, 0, 0, 2, 2, 10, 0, colors);
    var px = projX(0, 0), py = projY(0, 0, 22);
    // 巨大的时空环 + 中心球体，标志性极强
    g.strokeStyle = 'rgba(120,210,255,0.95)';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse ? g.ellipse(px, py, 30, 15, 0, 0, Math.PI * 2) : g.arc(px, py, 21, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse ? g.ellipse(px, py, 21, 10.5, 0, 0, Math.PI * 2) : g.arc(px, py, 14, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(205,245,255,0.85)';
    g.beginPath();
    g.arc(px, py, 7, 0, Math.PI * 2);
    g.fill();
    topFace(g, 0, 0, 2, 2, 10, 0, function (gg) {
      gg.fillStyle = 'rgba(34,42,52,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, 0.4, 1.7, 0.3);
    });
  }

  function drawWeather(g, colors) {
    isoBox(g, 0, 0, 2, 2, 12, 0, colors);
    isoFrustum(g, 0, 0, 1.1, 1.1, 0.4, 0.4, 30, 0, METAL);
    var px = projX(0, 0), py = projY(0, 0, 44);
    // 顶部乌云盘
    g.fillStyle = 'rgba(70,86,104,0.92)';
    g.beginPath();
    g.ellipse ? g.ellipse(px, py + 6, 24, 9, 0, 0, Math.PI * 2) : g.arc(px, py + 6, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(200,240,255,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px, py - 12);
    g.lineTo(px - 6, py + 4);
    g.lineTo(px + 4, py - 2);
    g.lineTo(px - 2, py + 14);
    g.stroke();
    topFace(g, 0, 0, 2, 2, 12, 0, function (gg) {
      gg.fillStyle = 'rgba(36,44,54,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, -0.85, 0.3, 1.7);
    });
  }

  function drawNuclear(g, colors) {
    isoBox(g, 0, 0, 2, 2, 14, 0, { base: '#8c9aa0', dark: '#2c3438' });
    isoFrustum(g, 0, 0, 1.6, 1.6, 0.8, 0.8, 16, 0, { base: '#c3ccd0', dark: '#3a4247' });
    var px = projX(0, 0), py = projY(0, 0, 30);
    g.fillStyle = 'rgba(200,255,180,0.35)';
    g.beginPath();
    g.arc(px, py, 7, 0, Math.PI * 2);
    g.fill();
    topFace(g, 0, 0, 2, 2, 14, 0, function (gg) {
      gg.fillStyle = 'rgba(40,50,56,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = '#c8e05a';
      gg.fillRect(-0.3, -0.3, 0.6, 0.6);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, -0.85, 1.7, 0.28);
    });
  }

  function drawIronCurtain(g, colors) {
    isoBox(g, 0, 0, 2, 2, 9, 0, colors);
    isoFrustum(g, -0.55, 0, 0.7, 0.7, 0.5, 0.5, 24, 0, METAL);
    isoFrustum(g, 0.55, 0, 0.7, 0.7, 0.5, 0.5, 24, 0, METAL);
    var p1 = projX(-0.55, 0), p2 = projX(0.55, 0);
    var y = projY(0, 0, 26);
    g.strokeStyle = 'rgba(180,255,240,0.85)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(p1, y);
    g.lineTo(p2, y);
    g.stroke();
    for (var i = 0; i < 5; i++) {
      g.strokeStyle = 'rgba(140,240,220,' + (0.25 + i * 0.1) + ')';
      g.beginPath();
      g.moveTo(p1, y + 3 + i * 3);
      g.lineTo(p2, y + 3 + i * 3);
      g.stroke();
    }
    topFace(g, 0, 0, 2, 2, 9, 0, function (gg) {
      gg.fillStyle = 'rgba(34,42,48,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, 0.45, 1.7, 0.3);
    });
  }

  function drawNuke(g, colors) {
    isoBox(g, 0, 0, 2, 2, 8, 0, colors);
    isoFrustum(g, 0, 0, 1.5, 1.5, 1.3, 1.3, 12, 0, { base: '#9aa4a8', dark: '#333b3f' });
    var px = projX(0, 0), py = projY(0, 0, 20);
    g.fillStyle = '#c8342a';
    g.beginPath();
    g.ellipse ? g.ellipse(px, py, 13, 7, 0, 0, Math.PI * 2) : g.arc(px, py, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8d24a';
    g.beginPath();
    g.ellipse ? g.ellipse(px, py, 5, 3, 0, 0, Math.PI * 2) : g.arc(px, py, 4, 0, Math.PI * 2);
    g.fill();
    topFace(g, 0, 0, 2, 2, 8, 0, function (gg) {
      gg.fillStyle = 'rgba(36,44,48,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, -0.85, 1.7, 0.3);
    });
  }

  function drawPurifier(g, colors) {
    isoBox(g, 0, 0, 2, 2, 13, 0, colors);
    isoFrustum(g, 0.45, 0.45, 0.8, 0.8, 0.6, 0.6, 18, 0, METAL);
    var px = projX(0.45, 0.45), py = projY(0.45, 0.45, 18);
    g.fillStyle = '#d8b24a';
    g.beginPath();
    g.ellipse ? g.ellipse(px, py, 9, 5, 0, 0, Math.PI * 2) : g.arc(px, py, 7, 0, Math.PI * 2);
    g.fill();
    isoBox(g, -0.5, -0.4, 0.5, 0.5, 6, 0, METAL_DARK, { topBright: 1.05 });
    topFace(g, 0, 0, 2, 2, 13, 0, function (gg) {
      gg.fillStyle = 'rgba(38,46,50,0.9)';
      gg.fillRect(-0.85, -0.85, 1.7, 1.7);
      gg.fillStyle = '#c8a63a';
      gg.fillRect(-0.7, -0.7, 0.7, 0.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.85, 0.5, 1.7, 0.3);
    });
  }

  function drawDepot(g, colors) {
    // 平整的维修台 + 吊臂
    groundQuad(g, 0, 0, 3.1, 2.1, 0, 'rgba(60,70,76,0.85)');
    isoBox(g, -0.9, 0, 1.1, 1.9, 7, 0, { base: '#6f7a80', dark: '#2b3236' });
    var px = projX(-0.9, -0.7), py = projY(-0.9, -0.7, 14);
    g.strokeStyle = '#d8c05a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + 26, py - 10);
    g.stroke();
    g.strokeStyle = '#5a4a12';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px + 22, py - 8);
    g.lineTo(px + 22, py + 4);
    g.stroke();
    topFace(g, -0.9, 0, 1.1, 1.9, 7, 0, function (gg) {
      gg.fillStyle = 'rgba(36,44,48,0.9)';
      gg.fillRect(-0.45, -0.85, 0.9, 1.7);
      gg.fillStyle = colors.accent;
      gg.fillRect(-0.45, -0.85, 0.9, 0.3);
    });
  }

  var BUILDING_DRAWERS = {
    conyard: drawConyard,
    allied_power: function (g, c) { drawPowerPlant(g, c, false); },
    soviet_power: function (g, c) { drawPowerPlant(g, c, true); },
    refinery: drawRefinery,
    barracks: function (g, c) { drawBarracks(g, c, false); },
    warfactory: drawWarFactory,
    lab: drawLab,
    allied_pillbox: drawPillbox,
    allied_patriot: drawPatriot,
    allied_prism: drawPrismTower,
    soviet_sentry: drawSentry,
    soviet_flak: drawFlakCannon,
    soviet_tesla: drawTeslaCoil,
    // 原版向新增建筑（占位造型）
    allied_adv_power: drawAdvPower,
    allied_radar: function (g, c) { drawRadar(g, c, null, false); },
    soviet_radar: function (g, c) { drawRadar(g, c, null, true); },
    allied_satellite: drawSatellite,
    allied_gap: drawGap,
    allied_chronosphere: drawChronosphere,
    allied_weather: drawWeather,
    soviet_nuclear: drawNuclear,
    soviet_ironcurtain: drawIronCurtain,
    soviet_nuke: drawNuke,
    ore_purifier: drawPurifier,
    service_depot: drawDepot,
    // 短名（def.art）也注册一份，任何调用方式都能找到
    radar: drawRadar,
    gap: drawGap,
    chronosphere: drawChronosphere,
    weather: drawWeather,
    nuclear: drawNuclear,
    ironcurtain: drawIronCurtain,
    nuke: drawNuke,
    purifier: drawPurifier,
    depot: drawDepot
  };

  Art.buildingSize = function (type) {
    var def = Rules.buildings[type];
    var w = (def.w + def.h) * (TW / 2) + 40;
    var h = (def.w + def.h) * (TH / 2) + 70;
    return { w: w, h: h, ox: w / 2, oy: h - (def.h * TH / 2) - 12 };
  };

  function buildingSpriteCanvas(type, playerColor) {
    var def = Rules.buildings[type];
    var faction = def.faction === 'any' ? (type.indexOf('soviet') === 0 ? 'soviet' : 'allied') : def.faction;
    var colors = palette(faction, playerColor);
    var size = Art.buildingSize(type);
    var c = Art.canvas(size.w, size.h);
    var g = ctxOf(c);
    g.save();
    g.translate(size.ox, size.oy);
    // ground shadow
    groundQuad(g, 0, 0, def.w * 1.06, def.h * 1.06, 0, 'rgba(0,0,0,0.22)');
    // 按完整 id 查找；找不到就用 def.art 兜底（避免加新建筑时漏画）
    var drawer = BUILDING_DRAWERS[type] || (def.art ? BUILDING_DRAWERS[def.art] : null);
    if (drawer) drawer(g, colors, def);
    g.restore();
    return c;
  }

  // ---------------------------------------------------------------------
  // Cache accessors
  // ---------------------------------------------------------------------
  var FACINGS = 16;

  Art.unitSprite = function (type, colorId, facing) {
    var idx = Math.round(U.normalizeAngle(facing || 0) / (Math.PI * 2) * FACINGS) % FACINGS;
    var key = type + '|' + colorId + '|' + idx;
    if (!cache.units[key]) cache.units[key] = unitSpriteCanvas(type, Rules.PLAYER_COLORS[colorId], idx, FACINGS);
    return cache.units[key];
  };

  Art.buildingSprite = function (type, colorId) {
    var key = type + '|' + colorId;
    if (!cache.buildings[key]) cache.buildings[key] = buildingSpriteCanvas(type, Rules.PLAYER_COLORS[colorId]);
    return cache.buildings[key];
  };

  Art.tileSprite = function (terrain, variant) {
    var key = terrain + '|' + (variant % 4);
    if (!cache.tiles[key]) cache.tiles[key] = tileSprite(terrain, variant % 4);
    return cache.tiles[key];
  };

  Art.oreSprite = function (kind, level) {
    var lv = U.clamp(Math.ceil(level), 1, 6);
    var key = kind + '|' + lv;
    if (!cache.ore[key]) cache.ore[key] = oreSprite(kind, lv);
    return cache.ore[key];
  };

  Art.objectSprite = function (kind, variant) {
    var key = kind + '|' + (variant % 3);
    if (!cache.objects[key]) cache.objects[key] = objectSprite(kind, variant % 3);
    return cache.objects[key];
  };

  /**
   * Sidebar icon: the normal sprite drawn small on a dark plate, so that the
   * build bar matches what you actually see on the battlefield.
   */
  Art.iconSprite = function (type, colorId, w, h) {
    w = w || 54; h = h || 38;
    var key = type + '|' + colorId + '|' + w + 'x' + h;
    if (cache.icons[key]) return cache.icons[key];
    var c = Art.canvas(w, h);
    var g = ctxOf(c);
    var def = Rules.get(type);
    if (def.kind === 'building') {
      var src = Art.buildingSprite(type, colorId);
      var scale = Math.min((w - 4) / src.width, (h - 4) / src.height);
      var dw = src.width * scale, dh = src.height * scale;
      g.drawImage(src, 0, 0, src.width, src.height, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      // draw the unit straight into the icon canvas at a fixed 3/4 view
      g.save();
      g.translate(w / 2, h - 4 - 16);
      g.scale(0.72, 0.72);
      Art.drawUnit(g, type, colorId, 0, 0, Math.PI * 0.35, Math.PI * 0.35);
      g.restore();
    }
    cache.icons[key] = c;
    return c;
  };

  Art.clearCache = function () {
    cache = { units: {}, buildings: {}, tiles: {}, ore: {}, objects: {}, icons: {}, flags: {} };
  };
})(globalThis.RA = globalThis.RA || {});
