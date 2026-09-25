/*
 * Mouse & keyboard control: selection, orders, placement, camera and the
 * classic hotkeys (control groups, tabs, stop/guard/scatter, ...).
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Sim = RA.Sim;
  var Rules = RA.Rules;

  var Input = RA.Input = {};

  Input.create = function (opts) {
    var canvas = opts.canvas;
    var view = opts.view;
    var getState = opts.getState;
    var getRenderer = opts.getRenderer;
    var settings = opts.settings;
    var hud = opts.hud;

    var mouse = { x: 0, y: 0, inside: false };
    var dragging = false;
    var dragStart = null;
    var panning = false;
    var panLast = null;
    var keys = {};
    var lastClickTime = -1e9;   // the very first click is never a double click

    // 用 CSS 矢量光标代替"画在 canvas 里的光标"：由合成器绘制，永远跟手
    var CURSOR_SVG = {
      move: "<path d='M4 2 L4 19 L9 14 L12 21 L15 20 L12 13 L18 13 Z' fill='%23f2f8ff' stroke='%23101820' stroke-width='1.2'/>",
      attack: "<circle cx='12' cy='12' r='7.5' fill='none' stroke='%23ff5a4a' stroke-width='2'/><path d='M12 2 L12 7 M12 17 L12 22 M2 12 L7 12 M17 12 L22 12' stroke='%23ff5a4a' stroke-width='2'/>",
      harvest: "<circle cx='12' cy='12' r='7.5' fill='none' stroke='%23ffd85e' stroke-width='2'/><path d='M7 17 L17 7 M14 7 L17 7 L17 10' stroke='%23ffd85e' stroke-width='2' fill='none'/>",
      capture: "<circle cx='12' cy='12' r='7.5' fill='none' stroke='%237cff9a' stroke-width='2'/><path d='M8 12 L16 12 M12 8 L12 16' stroke='%237cff9a' stroke-width='2'/>",
      place: "<circle cx='12' cy='12' r='7' fill='none' stroke='%239dffb0' stroke-width='2'/><path d='M8 12 L16 12 M12 8 L12 16' stroke='%239dffb0' stroke-width='2'/>",
      deploy: "<circle cx='12' cy='12' r='7.5' fill='none' stroke='%23ffb84a' stroke-width='2'/><path d='M12 4 L12 20 M4 12 L20 12' stroke='%23ffb84a' stroke-width='2'/>",
      no: "<circle cx='12' cy='12' r='7.5' fill='none' stroke='%23ff6a5a' stroke-width='2'/><path d='M7 7 L17 17 M17 7 L7 17' stroke='%23ff6a5a' stroke-width='2'/>"
    };
    var lastCursorMode = '';
    function cursorCss(mode) {
      var art = CURSOR_SVG[mode] || CURSOR_SVG.move;
      var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" + art + "</svg>";
      return 'url("data:image/svg+xml;charset=utf8,' + svg.replace(/ /g, '%20') + '") 4 2, crosshair';
    }
    function setCursor(mode) {
      if (mode === lastCursorMode) return;
      lastCursorMode = mode;
      canvas.style.cursor = cursorCss(mode);
    }
    var attackMoveArmed = false;
    var edgeSpeed = 0;

    function state() { return getState(); }
    function renderer() { return getRenderer(); }
    function player() { return state().players[0]; }

    function localPos(ev) {
      var r = canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) * (canvas.width / r.width),
        y: (ev.clientY - r.top) * (canvas.height / r.height)
      };
    }

    /** Entity under a screen point (units win over buildings). */
    function entityAt(sx, sy, playerIdx) {
      var st = state();
      var rendererRef = renderer();
      var best = null, bestD = 1e9;
      var i, e, p, s;
      for (i = 0; i < st.units.length; i++) {
        e = st.units[i];
        if (e.dead) continue;
        s = rendererRef.worldToScreen(RA.Iso.sx(e.x, e.y), RA.Iso.sy(e.x, e.y) - 6);
        var d = U.dist(s.x, s.y, sx, sy);
        if (d < 22 && d < bestD) { bestD = d; best = e; }
      }
      if (best) return best;
      var tile = rendererRef.tileAtScreen(sx, sy);
      for (i = 0; i < st.buildings.length; i++) {
        e = st.buildings[i];
        if (e.dead) continue;
        if (tile.x >= e.x && tile.x < e.x + e.w && tile.y >= e.y && tile.y < e.y + e.h) return e;
      }
      void p; void playerIdx;
      return null;
    }

    function selectedIds() { return Array.from(view.selected); }

    function setSelection(ids, additive) {
      if (!additive) view.selected.clear();
      ids.forEach(function (id) { view.selected.add(id); });
      if (opts.onSelectionChanged) opts.onSelectionChanged();
    }

    function selectGroupOf(unit) {
      // double-click: select every unit of the same type currently on screen
      var st = state();
      var r = renderer();
      var ids = [];
      var box = r.visibleRange(st.map);
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (u.dead || u.owner !== 0 || u.type !== unit.type) continue;
        if (u.x < box.x0 || u.x > box.x1 || u.y < box.y0 || u.y > box.y1) continue;
        ids.push(u.id);
      }
      setSelection(ids, false);
    }

    function issueOrderAt(sx, sy, additive) {
      var st = state();
      var target = entityAt(sx, sy, 0);
      var tile = renderer().tileAtScreen(sx, sy);
      var ids = selectedIds();
      if (!ids.length) return;
      if (attackMoveArmed) {
        attackMoveArmed = false;
        Sim.issueOrder(st, 0, ids, { type: 'attackMove', x: tile.fx, y: tile.fy });
        addFeedback('move', tile.fx, tile.fy, '#ffb84a');
        reply(ids, 'attackMove');
        return;
      }
      var orderType = target && target.owner !== 0 ? 'attack' : null;
      Sim.contextOrder(st, 0, ids, tile.fx, tile.fy, target ? target.id : 0);
      if (orderType === 'attack') {
        var p = Sim.entityPoint(target);
        addFeedback('attack', p.x, p.y, '#ff6a5a');
        reply(ids, 'attack');
      } else {
        addFeedback('move', tile.fx, tile.fy, '#8dff9a');
        reply(ids, 'move');
      }
      void additive;
    }

    /** Chinese voice acknowledgement from the units that were just ordered. */
    function reply(ids, command) {
      if (RA.Voice) RA.Voice.unitReply(state(), ids, command);
      if (opts.onSound) opts.onSound(command === 'attack' ? 'ackAttack' : 'ack');
    }

    /** 超级武器瞄准：点第一下（传送仪选起点），点第二下（选终点）。 */
    function fireArmedSuper(tile) {
      var st = state();
      var arm = view.armingSuper;
      if (!arm) return;
      if (arm.key === 'chronosphere' && arm.phase === 0) {
        arm.source = { x: tile.fx, y: tile.fy };
        arm.phase = 1;
        if (opts.onAlert) opts.onAlert(RA.I18n.t('alert.aimTarget'));
        addFeedback('deploy', tile.fx, tile.fy, '#8fe0ff');
        return;
      }
      var res = Sim.fireSuper(st, 0, arm.key,
        arm.source ? arm.source.x : tile.fx,
        arm.source ? arm.source.y : tile.fy,
        tile.fx, tile.fy);
      if (res.ok) {
        addFeedback('deploy', tile.fx, tile.fy, '#ffb84a');
        if (opts.onSound) opts.onSound('ackAttack');
      } else {
        if (opts.onSound) opts.onSound('deny');
        if (opts.onAlert) opts.onAlert(res.reason || RA.I18n.t('reason.unavailable'));
      }
      view.armingSuper = null;
    }

    function addFeedback(type, x, y, color) {
      view.feedback.push({ type: type, x: x, y: y, t: 0, life: 0.7, color: color });
      if (view.feedback.length > 12) view.feedback.shift();
    }
    Input.addFeedback = addFeedback;

    function tryPlace(tile) {
      var st = state();
      var p = st.players[0];
      if (!p.placing) return false;
      var res = Sim.placeBuilding(st, 0, p.placing.typeId, tile.x, tile.y);
      if (res.ok) {
        if (RA.Voice) RA.Voice.speak('place');
        if (opts.onSound) opts.onSound('place');
        hud && hud.rebuild();
        return true;
      }
      if (opts.onSound) opts.onSound('deny');
      if (RA.Voice) RA.Voice.speak('deny', { force: true });
      hud && hud.alert(RA.I18n.reason(res) || RA.I18n.t('alert.cannotBuild'), 'warn');
      return true;
    }

    // ------------------------------------------------------------------
    // Mouse
    // ------------------------------------------------------------------
    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    canvas.addEventListener('mousedown', function (ev) {
      var p = localPos(ev);
      mouse.x = p.x; mouse.y = p.y;
      var st = state();
      if (ev.button === 0) {
        // 超级武器瞄准中：左键确定目标点
        if (view.armingSuper) {
          fireArmedSuper(renderer().tileAtScreen(p.x, p.y));
          return;
        }
        if (st.players[0].placing) {
          var t = renderer().tileAtScreen(p.x, p.y);
          tryPlace(t);
          return;
        }
        var now = performance.now();
        var target = entityAt(p.x, p.y, 0);
        if (target && now - lastClickTime < 320 && target.kind === 'unit' && target.owner === 0) {
          selectGroupOf(target);
          lastClickTime = 0;
          return;
        }
        lastClickTime = now;
        dragging = true;
        dragStart = { x: p.x, y: p.y };
        view.dragRect = { x: p.x, y: p.y, w: 0, h: 0 };
      } else if (ev.button === 1) {
        panning = true;
        panLast = { x: ev.clientX, y: ev.clientY };
        ev.preventDefault();
      }
    });

    window.addEventListener('mousemove', function (ev) {
      if (panning && panLast) {
        var cam = renderer().camera;
        cam.x -= (ev.clientX - panLast.x) / cam.zoom;
        cam.y -= (ev.clientY - panLast.y) / cam.zoom;
        renderer().clampCamera(state().map);
        panLast = { x: ev.clientX, y: ev.clientY };
      }
    });

    canvas.addEventListener('mousemove', function (ev) {
      var p = localPos(ev);
      mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
      view.cursor = { x: p.x, y: p.y };
      var t = renderer().tileAtScreen(p.x, p.y);
      view.hoverTile = t;
      var st = state();
      var hovered = entityAt(p.x, p.y, 0);
      view.hoverId = hovered ? hovered.id : 0;
      // cursor mode
      var mode = 'move';
      var color = '#dff4ff';
      if (view.armingSuper) {
        mode = 'deploy';
        color = '#ffb84a';
      } else if (st.players[0].placing) {
        var chk = Sim.canPlace(st, 0, st.players[0].placing.typeId, t.x, t.y);
        mode = chk.ok ? 'place' : 'no';
        color = chk.ok ? '#9dffb0' : '#ff7a6a';
      } else if (attackMoveArmed) {
        mode = 'attack';
        color = '#ffb84a';
      } else if (hovered && hovered.owner !== 0) {
        mode = 'attack';
        color = '#ff8a7a';
      } else if (hovered && hovered.owner === 0 && hovered.type === 'refinery' &&
        selectedIds().some(function (id) {
          var u = Sim.byId(st, id);
          return u && u.def.capacity;
        })) {
        mode = 'harvest';
        color = '#ffd85e';
      } else if (hovered && hovered.owner !== 0 && hovered.kind === 'building' &&
        selectedIds().some(function (id) {
          var u = Sim.byId(st, id);
          return u && u.def.abilities && u.def.abilities.indexOf('capture') >= 0;
        })) {
        mode = 'capture';
        color = '#9dffb0';
      } else if (st.map.oreAt(t.x, t.y) > 0) {
        mode = 'harvest';
        color = '#ffd85e';
      }
      view.cursor.mode = mode;
      view.cursor.color = color;
      setCursor(mode);
      if (dragging && dragStart) {
        view.dragRect = {
          x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y),
          w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y)
        };
      }
    });

    canvas.addEventListener('mouseleave', function () {
      mouse.inside = false;
      view.cursor = null;
      view.hoverTile = null;
      view.hoverId = 0;
    });

    canvas.addEventListener('mouseup', function (ev) {
      if (ev.button !== 0) return;
      var p = localPos(ev);
      if (!dragging) return;
      dragging = false;
      var rect = view.dragRect;
      view.dragRect = null;
      var st = state();
      if (rect && (rect.w > 8 || rect.h > 8)) {
        var r = renderer();
        var ids = [];
        for (var i = 0; i < st.units.length; i++) {
          var u = st.units[i];
          if (u.dead || u.owner !== 0) continue;
          var s = r.worldToScreen(RA.Iso.sx(u.x, u.y), RA.Iso.sy(u.x, u.y));
          if (s.x >= rect.x && s.x <= rect.x + rect.w && s.y >= rect.y && s.y <= rect.y + rect.h) ids.push(u.id);
        }
        setSelection(ids, ev.shiftKey);
        if (opts.onSound && ids.length) opts.onSound('select');
        return;
      }
      var target = entityAt(p.x, p.y, 0);
      if (target) {
        setSelection([target.id], ev.shiftKey);
        if (opts.onSound) opts.onSound('select');
      } else if (!ev.shiftKey) {
        view.selected.clear();
      }
    });

    canvas.addEventListener('mousedown', function (ev) {
      if (ev.button === 2) {
        var p = localPos(ev);
        var st = state();
        if (st.players[0].placing) {
          Sim.cancelPlacement(st, 0);
          if (opts.onSound) opts.onSound('cancel');
          return;
        }
        if (attackMoveArmed) { attackMoveArmed = false; return; }
        issueOrderAt(p.x, p.y, ev.shiftKey);
      }
    });

    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = localPos(ev);
      renderer().zoomBy(ev.deltaY < 0 ? 1.12 : 0.9, state().map, p.x, p.y);
    }, { passive: false });

    // ------------------------------------------------------------------
    // Keyboard
    // ------------------------------------------------------------------
    view.groups = view.groups || {};

    window.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      keys[ev.key.toLowerCase()] = true;
      var st = state();
      var k = ev.key.toLowerCase();
      var cam = renderer().camera;
      var speed = 420 / cam.zoom;
      var handled = true;

      if (ev.key === 'Escape') {
        if (view.armingSuper) view.armingSuper = null;
        else if (st.players[0].placing) Sim.cancelPlacement(st, 0);
        else if (attackMoveArmed) attackMoveArmed = false;
        else opts.onPause && opts.onPause();
      } else if (k >= '1' && k <= '9') {
        var idx = k;
        if (ev.ctrlKey) {
          view.groups[idx] = selectedIds();
          opts.onAlert && opts.onAlert(RA.I18n.t('alert.groupSet', { n: idx, count: view.groups[idx].length }));
        } else {
          var ids = (view.groups[idx] || []).filter(function (id) { return !!Sim.byId(st, id); });
          if (ids.length) {
            setSelection(ids, false);
            var first = Sim.byId(st, ids[0]);
            if (first && ev.altKey) {
              var pt = Sim.entityPoint(first);
              renderer().centerOn(st.map, pt.x, pt.y);
            }
          }
        }
      } else if (k === 'q') hud && hud.cycleTab(-1);
      else if (k === 'e') hud && hud.cycleTab(1);
      else if (k === 'h' || k === 'home') {
        var base = ownBuilding(st, 'conyard') || ownBuilding(st, null);
        if (base) renderer().centerOn(st.map, base.cx, base.cy);
      } else if (k === 's') {
        Sim.issueOrder(st, 0, selectedIds(), { type: 'stop' });
        reply(selectedIds(), 'stop');
      } else if (k === 'g') {
        Sim.issueOrder(st, 0, selectedIds(), { type: 'guard' });
        reply(selectedIds(), 'guard');
      } else if (k === 'x') {
        Sim.issueOrder(st, 0, selectedIds(), { type: 'scatter' });
        reply(selectedIds(), 'scatter');
      }
      else if (k === 'a' && !ev.ctrlKey) { attackMoveArmed = true; }
      else if (k === 'r') opts.onRepair && opts.onRepair();
      else if (ev.key === 'Delete') opts.onSell && opts.onSell();
      else if (k === ' ') {
        if (view.lastAlertPos) renderer().centerOn(st.map, view.lastAlertPos.x, view.lastAlertPos.y);
      } else if (ev.key === 'ArrowLeft' || k === 'arrowleft') cam.x -= speed * 0.4;
      else if (ev.key === 'ArrowRight' || k === 'arrowright') cam.x += speed * 0.4;
      else if (ev.key === 'ArrowUp' || k === 'arrowup') cam.y -= speed * 0.4;
      else if (ev.key === 'ArrowDown' || k === 'arrowdown') cam.y += speed * 0.4;
      else if (k === '+') renderer().zoomBy(1.1, st.map);
      else if (k === '-') renderer().zoomBy(0.9, st.map);
      else handled = false;
      if (handled) {
        if (k.indexOf('arrow') === 0 || k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') {
          renderer().clampCamera(st.map);
        }
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', function (ev) { keys[ev.key.toLowerCase()] = false; });
    window.addEventListener('blur', function () { keys = {}; dragging = false; panning = false; });

    function ownBuilding(st, type) {
      for (var i = 0; i < st.buildings.length; i++) {
        var b = st.buildings[i];
        if (b.dead || b.owner !== 0) continue;
        if (type && b.type !== type) continue;
        return b;
      }
      return null;
    }

    function update(dt) {
      var st = state();
      var cam = renderer().camera;
      var margin = 24;
      var speed = (settings ? settings.scrollSpeed : 700) / cam.zoom;
      if (settings && settings.edgeScroll !== false && mouse.inside && !panning) {
        var dx = 0, dy = 0;
        if (mouse.x < margin) dx = -1;
        else if (mouse.x > canvas.width - margin) dx = 1;
        if (mouse.y < margin) dy = -1;
        else if (mouse.y > canvas.height - margin) dy = 1;
        if (dx || dy) {
          cam.x += dx * speed * dt;
          cam.y += dy * speed * dt;
          renderer().clampCamera(st.map);
        }
      }
      var ks = speed * dt * 1.2;
      if (keys['arrowup']) cam.y -= ks;
      if (keys['arrowleft']) cam.x -= ks;
      if (keys['arrowright']) cam.x += ks;
      if (keys['arrowdown']) cam.y += ks;
      renderer().clampCamera(st.map);
      // feedback lifetime
      for (var i = view.feedback.length - 1; i >= 0; i--) {
        var f = view.feedback[i];
        f.t += dt;
        if (f.t >= f.life) view.feedback.splice(i, 1);
      }
      edgeSpeed = 0;
      void edgeSpeed;
    }

    return {
      update: update,
      isAttackMoveArmed: function () { return attackMoveArmed; },
      setAttackMoveArmed: function (v) { attackMoveArmed = v; },
      mouse: mouse
    };
  };
})(globalThis.RA = globalThis.RA || {});
