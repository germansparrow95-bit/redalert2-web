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
      case 'grizzly': return { len: 1.05, wid: 0.86, hull: 13, turretLen: 0.5, turretWid: 0.46, barrel: 0.5, barrels: 1 };
      case 'rhino': return { len: 1.18, wid: 0.94, hull: 16, turretLen: 0.6, turretWid: 0.56, barrel: 0.56, barrels: 1 };
      case 'apoc': return { len: 1.4, wid: 1.05, hull: 19, turretLen: 0.72, turretWid: 0.68, barrel: 0.6, barrels: 2, missiles: true };
      case 'prismtank': return { len: 1.1, wid: 0.86, hull: 13, turretLen: 0.44, turretWid: 0.54, barrel: 0.18, barrels: 1, prism: true };
      default: return null;
    }
  }

  function drawTankHull(ctx, s, colors, facing) {
    drawTracks(ctx, s.len, s.wid, s.hull * 0.55, colors);
    isoBox(ctx, 0, 0, s.len, s.wid * 0.86, s.hull, facing, colors, { topBright: 1.12 });
    isoBox(ctx, s.len * 0.42, 0, s.len * 0.16, s.wid * 0.8, s.hull * 0.75, facing,
      { base: colors.light || colors.base, dark: colors.dark }, { topBright: 0.98 });
  }

  function drawTankTurret(ctx, s, colors, angle) {
    var h = s.hull * 0.55;
    isoBox(ctx, 0, 0, s.turretLen, s.turretWid, h, angle, { base: colors.base, dark: colors.dark }, { topBright: 1.18 });
    for (var b = 0; b < s.barrels; b++) {
      var off = (s.barrels === 1) ? 0 : (b === 0 ? -0.09 : 0.09);
      var bx = Math.cos(angle) * (s.turretLen * 0.62 + s.barrel * 0.5) - Math.sin(angle) * off;
      var by = Math.sin(angle) * (s.turretLen * 0.62 + s.barrel * 0.5) + Math.cos(angle) * off;
      isoBox(ctx, bx, by, s.barrel, 0.11, h * 1.2, angle,
        { base: colors.dark, dark: '#20211f' }, { stroke: false, topBright: 1.1 });
    }
    if (s.prism) {
      var px = projX(0, 0), py = projY(0, 0, h);
      ctx.fillStyle = 'rgba(150,220,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(px, py - 13);
      ctx.lineTo(px + 7, py - 5);
      ctx.lineTo(px, py + 2);
      ctx.lineTo(px - 7, py - 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(230,250,255,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
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
        return function (g) { drawInfantry(g, type, colors, angle); };
      case 'rocketeer':
        return function (g) { drawRocketeer(g, colors, angle); };
      default:
        return function (g) {
          isoBox(g, 0, 0, 0.9, 0.8, 10, angle, colors);
        };
    }
  }

  function drawInfantry(g, type, colors, angle) {
    var body = type === 'engineer' ? '#d8d2c0' : (type === 'conscript' ? '#7a5a44' : (type === 'guardian' ? '#5d6b5a' : '#66745f'));
    var helmet = type === 'conscript' ? '#5d4a3a' : '#4a5a4a';
    var swing = Math.sin(angle * 3) * 0.6;
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.moveTo(-7, 2);
    g.lineTo(3, -2);
    g.lineTo(7, 2);
    g.lineTo(-3, 6);
    g.closePath();
    g.fill();
    // legs
    g.fillStyle = shade(body, 0.72);
    var legX = Math.cos(angle) * 2, legY = Math.sin(angle) * 1.2;
    g.fillRect(-4 + legX, -8 + legY, 3, 9);
    g.fillRect(1 - legX, -8 - legY, 3, 9);
    // torso
    g.fillStyle = body;
    g.fillRect(-5, -17, 9, 10);
    g.strokeStyle = shade(colors.dark, 0.9);
    g.lineWidth = 1;
    g.strokeRect(-5, -17, 9, 10);
    // head + helmet
    g.fillStyle = '#d7b291';
    g.beginPath();
    g.arc(0, -21, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = helmet;
    g.beginPath();
    g.arc(0, -22, 4.4, Math.PI, Math.PI * 2);
    g.fill();
    // weapon pointing at `angle`
    var wx = Math.cos(angle) * 9, wy = Math.sin(angle) * 12;
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -13);
    g.lineTo(wx, -13 + wy * 0.5);
    g.stroke();
    if (type === 'guardian') {
      g.strokeStyle = '#4a4a4a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(wx * 0.7, -17 + wy * 0.4);
      g.lineTo(wx * 1.2, -17 + wy * 0.6);
      g.stroke();
    }
    if (type === 'flak') {
      g.fillStyle = '#3d3d3d';
      g.fillRect(wx - 2, -16 + wy * 0.5, 5, 6);
    }
    g.fillStyle = colors.accent;
    g.fillRect(-5, -14, 2, 4);
    void swing;
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
    soviet_tesla: drawTeslaCoil
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
    var drawer = BUILDING_DRAWERS[type];
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
