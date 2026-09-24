/*
 * Red Alert Web - battlefield renderer.
 *
 * Draws terrain, structures, units, projectiles, effects, fog of war and the
 * selection overlays on a single 2D canvas.  All art is procedural (art.js).
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var Art = RA.Art;
  var Iso = RA.Iso;
  var Sim = RA.Sim;
  var T = RA.TERRAIN;

  var Renderer = RA.Renderer = {};

  Renderer.create = function (canvas) {
    var ctx = canvas.getContext('2d');
    var camera = { x: 0, y: 0, zoom: 1 };
    var viewW = canvas.width, viewH = canvas.height;
    var drawables = [];

    function screenToWorld(sx, sy) {
      return { x: sx / camera.zoom + camera.x, y: sy / camera.zoom + camera.y };
    }
    function worldToScreen(wx, wy) {
      return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
    }
    function tileAtScreen(sx, sy) {
      var w = screenToWorld(sx, sy);
      return Iso.tileAt(w.x, w.y);
    }

    function clampCamera(map) {
      var b = Iso.mapBounds(map);
      var minX = b.minX + viewW * 0.25 / camera.zoom;
      var maxX = b.maxX - viewW * 0.75 / camera.zoom;
      var minY = b.minY - viewH * 0.25 / camera.zoom;
      var maxY = b.maxY - viewH * 0.75 / camera.zoom;
      camera.x = U.clamp(camera.x, minX, Math.max(minX, maxX));
      camera.y = U.clamp(camera.y, minY, Math.max(minY, maxY));
    }

    function centerOn(map, tileX, tileY) {
      camera.x = Iso.sx(tileX, tileY) - viewW / (2 * camera.zoom);
      camera.y = Iso.sy(tileX, tileY) - viewH / (2 * camera.zoom);
      clampCamera(map);
    }

    function visibleRange(map) {
      var tl = tileAtScreen(0, 0);
      var tr = tileAtScreen(viewW, 0);
      var bl = tileAtScreen(0, viewH);
      var br = tileAtScreen(viewW, viewH);
      var minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x)) - 2;
      var maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x)) + 2;
      var minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y)) - 2;
      var maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y)) + 2;
      return {
        x0: U.clamp(minX, 0, map.w - 1),
        x1: U.clamp(maxX, 0, map.w - 1),
        y0: U.clamp(minY, 0, map.h - 1),
        y1: U.clamp(maxY, 0, map.h - 1)
      };
    }

    function drawTerrain(state) {
      var map = state.map;
      var r = visibleRange(map);
      for (var y = r.y0; y <= r.y1; y++) {
        for (var x = r.x0; x <= r.x1; x++) {
          var i = y * map.w + x;
          var spr = Art.tileSprite(map.terrain[i], (x * 7 + y * 13) % 4);
          var sx = Iso.sx(x, y) - Art.TILE_W / 2;
          var sy = Iso.sy(x, y);
          ctx.drawImage(spr, Math.round(sx), Math.round(sy));
          var ore = map.ore[i];
          if (ore > 0) {
            var lvl = U.clamp(Math.ceil(ore / 50), 1, 6);
            ctx.drawImage(Art.oreSprite(map.oreKind[i] || 1, lvl), Math.round(sx), Math.round(sy));
          }
        }
      }
    }

    function drawGroundDecals(state) {
      var r = visibleRange(state.map);
      for (var k = 0; k < state.decals.length; k++) {
        var d = state.decals[k];
        if (d.x < r.x0 - 2 || d.x > r.x1 + 2 || d.y < r.y0 - 2 || d.y > r.y1 + 2) continue;
        var sx = Iso.sx(d.x, d.y), sy = Iso.sy(d.x, d.y);
        if (d.type === 'scorch') {
          ctx.save();
          ctx.globalAlpha = 0.34;
          Art.groundQuad(ctx, d.x, d.y, 0.95, 0.95, 0, '#241d16');
          ctx.restore();
        } else {
          ctx.save();
          Art.groundQuad(ctx, d.x, d.y, 1.2, 1.0, d.angle || 0, 'rgba(0,0,0,0.3)');
          ctx.translate(sx, sy);
          ctx.fillStyle = '#3a352e';
          ctx.fillRect(-10, -7, 20, 12);
          ctx.fillStyle = '#26231e';
          ctx.fillRect(-7, -11, 5, 5);
          ctx.fillRect(2, -11, 5, 5);
          ctx.strokeStyle = '#1a1815';
          ctx.lineWidth = 1;
          ctx.strokeRect(-10, -7, 20, 12);
          ctx.restore();
        }
      }
    }

    function collectDrawables(state, r) {
      drawables.length = 0;
      var map = state.map;
      var i, e;
      for (var y = r.y0; y <= r.y1; y++) {
        for (var x = r.x0; x <= r.x1; x++) {
          var t = map.terrain[y * map.w + x];
          if (t === T.TREE || t === T.CLIFF) {
            drawables.push({ depth: x + y, kind: 'object', x: x, y: y, t: t, v: (x * 3 + y) % 3 });
          }
        }
      }
      for (i = 0; i < state.buildings.length; i++) {
        e = state.buildings[i];
        if (e.dead) continue;
        if (e.x + e.w < r.x0 - 3 || e.x > r.x1 + 3 || e.y + e.h < r.y0 - 3 || e.y > r.y1 + 3) continue;
        drawables.push({ depth: e.cx + e.cy + 0.001, kind: 'building', e: e });
      }
      for (i = 0; i < state.units.length; i++) {
        e = state.units[i];
        if (e.dead) continue;
        if (e.x < r.x0 - 2 || e.x > r.x1 + 2 || e.y < r.y0 - 2 || e.y > r.y1 + 2) continue;
        drawables.push({ depth: e.x + e.y, kind: 'unit', e: e });
      }
      drawables.sort(function (a, b) { return a.depth - b.depth; });
      return drawables;
    }

    function drawObject(d) {
      var spr = Art.objectSprite(d.t === T.TREE ? 'tree' : 'cliff', d.v);
      var sx = Iso.sx(d.x, d.y);
      var sy = Iso.sy(d.x, d.y);
      ctx.drawImage(spr, Math.round(sx - spr.width / 2), Math.round(sy + Art.TILE_H / 2 - spr.height + 4));
    }

    // -------------------------------------------------------------------
    // Structures and units
    // -------------------------------------------------------------------
    function drawFlag(tx, ty, color) {
      var sx = Iso.sx(tx, ty), sy = Iso.sy(tx, ty);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - 16);
      ctx.stroke();
      ctx.fillStyle = color.hex;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 16);
      ctx.lineTo(sx + 9, sy - 13);
      ctx.lineTo(sx, sy - 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawBuilding(e, state, view) {
      var player = state.players[e.owner];
      var spr = Art.buildingSprite(e.type, player.colorId);
      var size = Art.buildingSize(e.type);
      var sx = Math.round(Iso.sx(e.cx, e.cy) - size.ox);
      var sy = Math.round(Iso.sy(e.cx, e.cy) - size.oy);

      if (view && view.selected && view.selected.has(e.id)) {
        ctx.save();
        ctx.globalAlpha = 0.8;
        Art.groundQuad(ctx, e.cx - 0.5, e.cy - 0.5, e.w + 0.3, e.h + 0.3, 0, 'rgba(80,255,120,0.35)');
        ctx.restore();
      }
      if (!e.complete) {
        var prog = 1 - U.clamp(e.buildTicks / e.buildTotal, 0, 1);
        var srcH = Math.max(2, Math.round(spr.height * prog));
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * prog;
        ctx.drawImage(spr, 0, spr.height - srcH, spr.width, srcH,
          sx, sy + spr.height - srcH, spr.width, srcH);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = 'rgba(210,200,150,0.75)';
        ctx.lineWidth = 1;
        for (var k = 0; k <= 3; k++) {
          var bx = sx + (spr.width / 4) * k;
          ctx.beginPath();
          ctx.moveTo(bx, sy + spr.height);
          ctx.lineTo(bx, sy + spr.height - srcH - 6);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.drawImage(spr, sx, sy);
      }

      var hpFrac = U.clamp(e.hp / e.maxHp, 0, 1);
      if (hpFrac < 0.8) {
        var ticks = state.tick;
        var puffs = hpFrac < 0.4 ? 4 : 2;
        for (var p = 0; p < puffs; p++) {
          var seed = (e.id * 31 + p * 17) % 100 / 100;
          var life = ((ticks * 0.6 + p * 40 + seed * 60) % 40);
          var px = sx + spr.width * (0.3 + seed * 0.4) + Math.sin(ticks * 0.05 + p) * 3;
          var py = sy + spr.height * 0.4 - life;
          ctx.save();
          ctx.globalAlpha = Math.max(0.06, 0.4 * (1 - life / 40));
          ctx.fillStyle = '#4a4a4a';
          ctx.beginPath();
          ctx.arc(px, py, 4 + p + life * 0.05, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        if (hpFrac < 0.4) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.45 + 0.3 * Math.sin(ticks * 0.3 + e.id);
          ctx.fillStyle = '#ff8a2a';
          ctx.beginPath();
          ctx.arc(sx + spr.width * 0.5, sy + spr.height * 0.62, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      if (e.flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.flash / 4 * 0.4;
        ctx.fillStyle = '#ffb060';
        ctx.beginPath();
        ctx.arc(sx + spr.width / 2, sy + spr.height * 0.65, spr.width * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (e.repairing) {
        ctx.save();
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(state.tick * 0.25);
        ctx.strokeStyle = '#7cff9a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx + spr.width / 2, sy + spr.height * 0.5, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (view && view.playerIdx === e.owner && e.rally) drawFlag(e.rally.x, e.rally.y, player.color);
    }

    function drawUnit(e, state, view) {
      var player = state.players[e.owner];
      var sx = Iso.sx(e.x, e.y);
      var sy = Iso.sy(e.x, e.y) - (e.def.flying ? (e.def.altitude || 1.6) * Art.TILE_H * 0.55 : 0);
      var rad = (e.def.radius || 0.3) * 3.6;
      if (view && view.selected && view.selected.has(e.id)) {
        ctx.save();
        Art.groundQuad(ctx, e.x, e.y, rad, rad, 0, 'rgba(70,235,110,0.45)');
        ctx.restore();
      }
      if (view && view.hoverId === e.id) {
        ctx.save();
        Art.groundQuad(ctx, e.x, e.y, rad, rad, 0, 'rgba(255,255,255,0.22)');
        ctx.restore();
      }
      if (e.def.flying) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        Art.groundQuad(ctx, e.x, e.y, 0.8, 0.8, 0, '#000000');
        ctx.restore();
      }
      if (e.def.capacity && e.cargo > 0) {
        ctx.save();
        ctx.fillStyle = e.cargoKind === 2 ? '#e8d24a' : '#c8a63a';
        ctx.fillRect(sx - 7, sy - 20, 14 * U.clamp(e.cargo / e.def.capacity, 0, 1), 3);
        ctx.strokeStyle = '#12140f';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - 7, sy - 20, 14, 3);
        ctx.restore();
      }
      Art.drawUnit(ctx, e.type, player.colorId, sx, sy, e.facing, e.turret);
      if (e.rank > 0) {
        ctx.save();
        ctx.fillStyle = e.rank === 2 ? '#ffd85e' : '#d0e4ff';
        for (var k = 0; k < e.rank; k++) {
          ctx.beginPath();
          ctx.moveTo(sx - 4 + k * 6, sy - 24);
          ctx.lineTo(sx + 2 + k * 6, sy - 24);
          ctx.lineTo(sx - 1 + k * 6, sy - 19);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      if (e.flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.flash / 4 * 0.45;
        ctx.fillStyle = '#ffb060';
        ctx.beginPath();
        ctx.arc(sx, sy - 8, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (e.state === 'harvesting' || e.state === 'docking') {
        var pulse = 0.35 + 0.35 * Math.sin(state.tick * 0.25);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = e.state === 'docking' ? '#8fe0ff' : '#ffd85e';
        ctx.beginPath();
        ctx.arc(sx, sy - 26, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function drawHealthBar(e) {
      var frac = U.clamp(e.hp / e.maxHp, 0, 1);
      if (frac >= 0.999 || frac <= 0) return;
      var p = Sim.entityPoint(e);
      var sx = Iso.sx(p.x, p.y);
      var sy = Iso.sy(p.x, p.y);
      var top = e.kind === 'building'
        ? sy - Art.buildingSize(e.type).oy * 0.55 - 10
        : sy - 30;
      var w = e.kind === 'building' ? 34 : 20;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(sx - w / 2 - 1, top - 1, w + 2, 5);
      ctx.fillStyle = frac > 0.6 ? '#4ce05a' : (frac > 0.3 ? '#e8d24a' : '#e04a3a');
      ctx.fillRect(sx - w / 2, top, w * frac, 3);
    }

    // -------------------------------------------------------------------
    // Projectiles and effects
    // -------------------------------------------------------------------
    function drawProjectiles(state) {
      for (var i = 0; i < state.projectiles.length; i++) {
        var pr = state.projectiles[i];
        if (pr.dead) continue;
        var sx = Iso.sx(pr.x, pr.y);
        var sy = Iso.sy(pr.x, pr.y) - 8;
        if (pr.type === 'rocket') {
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = '#d8d8d8';
          ctx.beginPath();
          ctx.arc(sx - 5, sy + 2, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx - 11, sy + 4, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = '#eeeeee';
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#ffe8a0';
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function drawEffects(state) {
      for (var i = 0; i < state.effects.length; i++) {
        var e = state.effects[i];
        var p = U.clamp(e.t / e.life, 0, 1);
        var sx = Iso.sx(e.x, e.y), sy = Iso.sy(e.x, e.y);
        if (e.type === 'explosion') {
          var size = (e.data && e.data.size) || 4;
          var r = size * (0.35 + p * 1.15);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.9;
          ctx.fillStyle = p < 0.35 ? '#fff2b0' : (p < 0.7 ? '#ffa63a' : '#a03a12');
          ctx.beginPath();
          ctx.arc(sx, sy - 4, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = (1 - p) * 0.5;
          ctx.fillStyle = '#ff7a20';
          ctx.beginPath();
          ctx.arc(sx, sy - 4, r * 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.save();
          ctx.globalAlpha = (1 - p) * 0.8;
          ctx.fillStyle = '#5a4a38';
          for (var d = 0; d < 6; d++) {
            var a = (d / 6) * Math.PI * 2 + e.x;
            var dd = r * (0.8 + p * 1.5);
            ctx.fillRect(sx + Math.cos(a) * dd, sy - 4 + Math.sin(a) * dd * 0.5 - p * 12, 2, 2);
          }
          ctx.restore();
        } else if (e.type === 'muzzle') {
          var s2 = (e.data && e.data.size) || 1;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.95;
          ctx.fillStyle = '#fff0b0';
          ctx.beginPath();
          ctx.arc(sx, sy - 10, 4.5 * s2 * (1 - p * 0.5), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (e.type === 'tracer') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.9;
          ctx.strokeStyle = '#fff0a0';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 10);
          ctx.lineTo(Iso.sx(e.data.x2, e.data.y2), Iso.sy(e.data.x2, e.data.y2) - 10);
          ctx.stroke();
          ctx.restore();
        } else if (e.type === 'beam') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = 'rgba(120,220,255,0.9)';
          ctx.lineWidth = 4 * (1 - p * 0.4);
          ctx.beginPath();
          ctx.moveTo(sx, sy - 12);
          ctx.lineTo(Iso.sx(e.data.x2, e.data.y2), Iso.sy(e.data.x2, e.data.y2) - 10);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        } else if (e.type === 'tesla') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = 'rgba(200,240,255,0.95)';
          ctx.lineWidth = 2.5;
          var x0 = sx, y0 = sy - 26;
          var x1 = Iso.sx(e.data.x2, e.data.y2), y1 = Iso.sy(e.data.x2, e.data.y2) - 8;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          var segs = 7;
          for (var s3 = 1; s3 <= segs; s3++) {
            var t2 = s3 / segs;
            var jitter = (s3 === segs) ? 0 : (((s3 * 37 + (e.data.seed || 0)) % 11) - 5) * 2.2;
            ctx.lineTo(U.lerp(x0, x1, t2) + jitter, U.lerp(y0, y1, t2) + jitter * 0.4);
          }
          ctx.stroke();
          ctx.restore();
        } else if (e.type === 'flakburst') {
          ctx.save();
          ctx.globalAlpha = (1 - p) * 0.7;
          ctx.fillStyle = '#4a4a4a';
          for (var f = 0; f < 4; f++) {
            var fa = f * 1.7;
            ctx.beginPath();
            ctx.arc(sx + Math.cos(fa) * p * 14, sy - 14 + Math.sin(fa) * p * 8, 3.5 * (1 - p * 0.5), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else if (e.type === 'impact') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.85;
          ctx.fillStyle = '#ffd070';
          ctx.beginPath();
          ctx.arc(sx, sy - 6, 3 + p * 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (e.type === 'capture') {
          ctx.save();
          ctx.globalAlpha = (1 - p) * 0.85;
          ctx.strokeStyle = '#7cff9a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy - 6, 8 + p * 34, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (e.type === 'promote') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = '#ffd85e';
          for (var c = 0; c < 3; c++) {
            var yy = sy - 16 - p * 24 - c * 6;
            ctx.beginPath();
            ctx.moveTo(sx - 4, yy);
            ctx.lineTo(sx + 4, yy);
            ctx.lineTo(sx, yy + 5);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        } else if (e.type === 'harvest') {
          ctx.save();
          ctx.globalAlpha = (1 - p) * 0.85;
          ctx.fillStyle = (e.data && e.data.kind === 2) ? '#e8d24a' : '#c8a63a';
          for (var h = 0; h < 3; h++) {
            var ha = h * 2.1 + e.x;
            ctx.fillRect(sx + Math.cos(ha) * 9, sy - 6 - p * 14 + Math.sin(ha) * 4, 3, 3);
          }
          ctx.restore();
        }
      }
    }

    function drawFog(state, playerIdx) {
      if (!state.fog) return;
      var player = state.players[playerIdx];
      var map = state.map;
      var r = visibleRange(map);
      var hw = Art.TILE_W / 2, hh = Art.TILE_H / 2;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#05080c';
      ctx.beginPath();
      var any = false, x, y, i, sx, sy;
      for (y = r.y0; y <= r.y1; y++) {
        for (x = r.x0; x <= r.x1; x++) {
          i = y * map.w + x;
          if (player.visibility.explored[i] && !player.visibility.visible[i]) {
            sx = Iso.sx(x, y); sy = Iso.sy(x, y);
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + hw, sy + hh);
            ctx.lineTo(sx, sy + Art.TILE_H);
            ctx.lineTo(sx - hw, sy + hh);
            ctx.closePath();
            any = true;
          }
        }
      }
      if (any) ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#030507';
      ctx.beginPath();
      any = false;
      for (y = r.y0; y <= r.y1; y++) {
        for (x = r.x0; x <= r.x1; x++) {
          i = y * map.w + x;
          if (!player.visibility.explored[i]) {
            sx = Iso.sx(x, y); sy = Iso.sy(x, y);
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + hw, sy + hh);
            ctx.lineTo(sx, sy + Art.TILE_H);
            ctx.lineTo(sx - hw, sy + hh);
            ctx.closePath();
            any = true;
          }
        }
      }
      if (any) ctx.fill();
      ctx.restore();
    }

    // -------------------------------------------------------------------
    // Overlays (placement ghost, feedback, cursor)
    // -------------------------------------------------------------------
    function drawPlacementGhost(state, view) {
      var p = state.players[view.playerIdx];
      if (!p || !p.placing || !view.hoverTile) return;
      var def = Rules.get(p.placing.typeId);
      if (!def) return;
      var t = view.hoverTile;
      var check = Sim.canPlace(state, view.playerIdx, def.id, t.x, t.y);
      Art.groundQuad(ctx, t.x + def.w / 2, t.y + def.h / 2, def.w, def.h, 0,
        check.ok ? 'rgba(90,255,120,0.35)' : 'rgba(255,70,60,0.35)');
      ctx.save();
      ctx.strokeStyle = check.ok ? '#8dff9a' : '#ff6a5a';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(Iso.sx(t.x, t.y), Iso.sy(t.x, t.y));
      ctx.lineTo(Iso.sx(t.x + def.w, t.y), Iso.sy(t.x + def.w, t.y));
      ctx.lineTo(Iso.sx(t.x + def.w, t.y + def.h), Iso.sy(t.x + def.w, t.y + def.h));
      ctx.lineTo(Iso.sx(t.x, t.y + def.h), Iso.sy(t.x, t.y + def.h));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      var spr = Art.buildingSprite(def.id, p.colorId);
      var size = Art.buildingSize(def.id);
      var sx = Math.round(Iso.sx(t.x + def.w / 2, t.y + def.h / 2) - size.ox);
      var sy = Math.round(Iso.sy(t.x + def.w / 2, t.y + def.h / 2) - size.oy);
      ctx.save();
      ctx.globalAlpha = check.ok ? 0.8 : 0.45;
      ctx.drawImage(spr, sx, sy);
      ctx.restore();
    }

    function drawCommandFeedback(view) {
      if (!view || !view.feedback) return;
      for (var i = 0; i < view.feedback.length; i++) {
        var f = view.feedback[i];
        var a = U.clamp(1 - f.t / f.life, 0, 1);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = f.color || '#8dff9a';
        ctx.lineWidth = 2;
        var sx = Iso.sx(f.x, f.y), sy = Iso.sy(f.x, f.y);
        if (f.type === 'move') {
          var sz = 6 + (1 - a) * 8;
          ctx.beginPath();
          ctx.moveTo(sx - sz, sy - sz * 0.5);
          ctx.lineTo(sx + sz, sy - sz * 0.5);
          ctx.moveTo(sx, sy - sz);
          ctx.lineTo(sx, sy + sz * 0.5);
          ctx.stroke();
        } else if (f.type === 'attack' || f.type === 'deploy') {
          var r2 = 10 + (1 - a) * 12;
          ctx.beginPath();
          ctx.arc(sx, sy - 6, r2, 0, Math.PI * 2);
          ctx.stroke();
          if (f.type === 'attack') {
            ctx.beginPath();
            ctx.moveTo(sx - r2 - 4, sy - 6);
            ctx.lineTo(sx + r2 + 4, sy - 6);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    function drawWaypointLines(state, view) {
      if (!view || !view.selected || !view.selected.size) return;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#9dffb0';
      ctx.lineWidth = 1;
      for (var i = 0; i < state.units.length; i++) {
        var u = state.units[i];
        if (u.dead || !view.selected.has(u.id) || !u.path) continue;
        ctx.beginPath();
        ctx.moveTo(Iso.sx(u.x, u.y), Iso.sy(u.x, u.y));
        for (var k = Math.max(0, u.pathIdx); k < u.path.length; k++) {
          ctx.lineTo(Iso.sx(u.path[k].x, u.path[k].y), Iso.sy(u.path[k].x, u.path[k].y));
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawCursor(view) {
      if (!view || !view.cursor) return;
      var c = view.cursor;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = c.color || '#e0f4ff';
      ctx.fillStyle = c.color || '#e0f4ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + 11, c.y + 12);
      ctx.lineTo(c.x + 4, c.y + 12);
      ctx.lineTo(c.x + 4, c.y + 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (c.mode && c.mode !== 'move') {
        ctx.beginPath();
        ctx.arc(c.x + 16, c.y + 16, 11, 0, Math.PI * 2);
        ctx.stroke();
        if (c.mode === 'attack') {
          ctx.beginPath();
          ctx.moveTo(c.x + 8, c.y + 16);
          ctx.lineTo(c.x + 24, c.y + 16);
          ctx.moveTo(c.x + 16, c.y + 8);
          ctx.lineTo(c.x + 16, c.y + 24);
          ctx.stroke();
        } else if (c.mode === 'no') {
          ctx.beginPath();
          ctx.moveTo(c.x + 9, c.y + 9);
          ctx.lineTo(c.x + 23, c.y + 23);
          ctx.moveTo(c.x + 23, c.y + 9);
          ctx.lineTo(c.x + 9, c.y + 23);
          ctx.stroke();
        } else if (c.mode === 'harvest') {
          ctx.beginPath();
          ctx.moveTo(c.x + 10, c.y + 22);
          ctx.lineTo(c.x + 22, c.y + 10);
          ctx.moveTo(c.x + 18, c.y + 10);
          ctx.lineTo(c.x + 22, c.y + 10);
          ctx.lineTo(c.x + 22, c.y + 14);
          ctx.stroke();
        } else if (c.mode === 'capture') {
          ctx.beginPath();
          ctx.moveTo(c.x + 16, c.y + 9);
          ctx.lineTo(c.x + 16, c.y + 23);
          ctx.moveTo(c.x + 9, c.y + 16);
          ctx.lineTo(c.x + 23, c.y + 16);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // -------------------------------------------------------------------
    // Main draw
    // -------------------------------------------------------------------
    function draw(state, view) {
      view = view || {};
      var playerIdx = view.playerIdx === undefined ? 0 : view.playerIdx;
      if (!view.selected) view.selected = new Set();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04060a';
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.save();
      ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);

      var r = visibleRange(state.map);
      drawTerrain(state);
      drawGroundDecals(state);
      var list = collectDrawables(state, r);
      var i;
      for (i = 0; i < list.length; i++) {
        var d = list[i];
        if (state.fog && d.kind !== 'object') {
          var pt = d.kind === 'building' ? { x: d.e.cx, y: d.e.cy } : { x: d.e.x, y: d.e.y };
          if (d.e.owner !== playerIdx && !Sim.visibleAt(state, playerIdx, pt.x, pt.y)) continue;
        }
        if (d.kind === 'object') drawObject(d);
        else if (d.kind === 'building') drawBuilding(d.e, state, view);
        else drawUnit(d.e, state, view);
      }
      drawProjectiles(state);
      drawEffects(state);
      drawWaypointLines(state, view);
      drawCommandFeedback(view);
      drawFog(state, playerIdx);

      // health bars are drawn above the fog so they stay readable
      for (i = 0; i < state.buildings.length; i++) {
        var b = state.buildings[i];
        if (b.dead) continue;
        if (b.owner !== playerIdx && !Sim.visibleAt(state, playerIdx, b.cx, b.cy)) continue;
        if (view.showHealth === false && b.owner !== playerIdx) continue;
        drawHealthBar(b);
      }
      for (i = 0; i < state.units.length; i++) {
        var u = state.units[i];
        if (u.dead) continue;
        if (u.owner !== playerIdx && !Sim.visibleAt(state, playerIdx, u.x, u.y)) continue;
        if (u.owner === playerIdx || view.showHealth === false) drawHealthBar(u);
      }
      drawPlacementGhost(state, view);
      ctx.restore();

      if (view.dragRect && view.dragRect.w > 3 && view.dragRect.h > 3) {
        ctx.save();
        ctx.strokeStyle = '#8dff9a';
        ctx.lineWidth = 1;
        if (ctx.setLineDash) ctx.setLineDash([4, 3]);
        ctx.strokeRect(view.dragRect.x, view.dragRect.y, view.dragRect.w, view.dragRect.h);
        ctx.fillStyle = 'rgba(120,255,150,0.12)';
        ctx.fillRect(view.dragRect.x, view.dragRect.y, view.dragRect.w, view.dragRect.h);
        ctx.restore();
      }
      drawCursor(view);
    }

    return {
      canvas: canvas,
      camera: camera,
      draw: draw,
      centerOn: centerOn,
      clampCamera: clampCamera,
      screenToWorld: screenToWorld,
      worldToScreen: worldToScreen,
      tileAtScreen: tileAtScreen,
      visibleRange: visibleRange,
      resize: function (w, h) { viewW = w; viewH = h; },
      zoomBy: function (f, map, focusX, focusY) {
        var fx = focusX === undefined ? viewW / 2 : focusX;
        var fy = focusY === undefined ? viewH / 2 : focusY;
        var before = screenToWorld(fx, fy);
        camera.zoom = U.clamp(camera.zoom * f, 0.5, 1.6);
        var after = screenToWorld(fx, fy);
        camera.x += before.x - after.x;
        camera.y += before.y - after.y;
        clampCamera(map);
      }
    };
  };

  /** Cursor mode for the mouse (used by the input layer). */
  Renderer.cursorFor = function (state, playerIdx, tile) {
    if (!tile) return 'move';
    var p = state.players[playerIdx];
    if (p.placing) {
      return Sim.canPlace(state, playerIdx, p.placing.typeId, tile.x, tile.y).ok ? 'place' : 'no';
    }
    return 'move';
  };
})(globalThis.RA = globalThis.RA || {});
