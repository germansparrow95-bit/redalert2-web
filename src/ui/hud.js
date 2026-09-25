/*
 * The command sidebar: credits, power grid, build tabs, build buttons,
 * selection readout, radar and the alert ticker.  Pure DOM + CSS chrome,
 * populated from the simulation.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var Sim = RA.Sim;
  var T = function (key, params) { return RA.I18n.t(key, params); };

  var HUD = RA.Hud = {};

  HUD.create = function (root, opts) {
    opts = opts || {};
      var el = {
      credits: root.querySelector('#credits'),
      powerBar: root.querySelector('#powerBar i'),
      powerText: root.querySelector('#powerText'),
      tabs: root.querySelector('#tabs'),
      grid: root.querySelector('#buildGrid'),
      selection: root.querySelector('#selectionInfo'),
      alerts: root.querySelector('#alerts'),
      tooltip: root.querySelector('#tooltip'),
      minimap: root.querySelector('#minimap'),
      repair: root.querySelector('#btnRepair'),
      sell: root.querySelector('#btnSell'),
      timer: root.querySelector('#gameTimer'),
      faction: root.querySelector('#factionLabel'),
      superPanel: root.querySelector('#superPanel')
    };
    el.hint = root.querySelector('#hintBar');
    el.btnMenu = root.querySelector('#btnMenu');

    var state = null;
    var playerIdx = 0;
    var tab = 'structures';
    var buttons = {};
    var displayCredits = 0;
    var alerts = [];
    var minimap = null;
    var swButtons = {};
    var swSignature = '';        // 超级武器面板的内容指纹，只有变化时才重建
    var selSignature = '';
    var lastCreditsText = '';
    var lastPowerSig = '';
    var lastTimerText = '';
    var btnState = {};           // 每个建造按钮上次的 DOM 状态，避免每帧写 DOM

    /** Always work with the current game state (it changes between matches). */
    function sync() {
      if (opts.getState) state = opts.getState();
    }

    function buildTabs() {
      el.tabs.innerHTML = '';
      Rules.TAB_ORDER.forEach(function (t, i) {
        var b = document.createElement('button');
        b.className = 'tab';
        b.dataset.tab = t;
        b.innerHTML = '<span class="tabKey">' + (i + 1) + '</span>' + RA.I18n.tabName(t);
        b.title = RA.I18n.tabName(t);
        b.addEventListener('click', function () { setTab(t); });
        el.tabs.appendChild(b);
      });
    }

    function setTab(t) {
      tab = t;
      var nodes = el.tabs.querySelectorAll('.tab');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle('active', nodes[i].dataset.tab === t);
      }
      buildGrid();
    }

    function buildGrid() {
      sync();
      if (!state) return;
      var p = state.players[playerIdx];
      var roster = Rules.roster(p.faction);
      var list = roster[tab] || [];
      el.grid.innerHTML = '';
      buttons = {};
      list.forEach(function (def) {
        if (def.id === 'conyard') return;      // never rebuilt once placed
        var b = document.createElement('button');
        b.className = 'buildItem';
        b.dataset.type = def.id;
        var icon = document.createElement('canvas');
        icon.width = 56; icon.height = 40;
        icon.className = 'icon';
        var src = RA.Art.iconSprite(def.id, p.colorId, 56, 40);
        icon.getContext('2d').drawImage(src, 0, 0);
        b.appendChild(icon);
        var cost = document.createElement('span');
        cost.className = 'cost';
        cost.textContent = '$' + def.cost;
        b.appendChild(cost);
        var name = document.createElement('span');
        name.className = 'bname';
        name.textContent = RA.I18n.defName(def);
        b.appendChild(name);
        b.title = RA.I18n.defName(def) + '  $' + def.cost;
        var prog = document.createElement('div');
        prog.className = 'progress';
        var inner = document.createElement('i');
        prog.appendChild(inner);
        b.appendChild(prog);
        b.addEventListener('click', function () { onBuildClick(def); });
        b.addEventListener('contextmenu', function (ev) {
          ev.preventDefault();
          if (Sim.queueState(state, playerIdx, def.id)) {
            Sim.cancelBuild(state, playerIdx, def.id);
            if (opts.onSound) opts.onSound('cancel');
          }
        });
        b.addEventListener('mouseenter', function () { showTooltip(def, b); });
        b.addEventListener('mouseleave', hideTooltip);
        el.grid.appendChild(b);
        buttons[def.id] = { node: b, def: def, progress: inner, icon: icon };
      });
    }

    function onBuildClick(def) {
      sync();
      if (!state) return;
      var p = state.players[playerIdx];
      var qs = Sim.queueState(state, playerIdx, def.id);
      if (qs && qs.item.ready) {
        if (p.placing && p.placing.typeId === def.id) Sim.cancelPlacement(state, playerIdx);
        else Sim.beginPlacement(state, playerIdx, def.id);
        if (opts.onSound) opts.onSound('click');
        return;
      }
      var check = Sim.canBuild(state, playerIdx, def.id);
      if (!check.ok) {
        if (check.soft) {
          addAlert(T('alert.insufficientFunds'), 'warn');
          if (RA.Voice) RA.Voice.speak('noFunds');
          if (opts.onSound) opts.onSound('nofunds');
        } else {
          addAlert(RA.I18n.reason(check), 'warn');
          if (opts.onSound) opts.onSound('deny');
        }
        return;
      }
      if (Sim.queueBuild(state, playerIdx, def.id)) {
        if (opts.onSound) opts.onSound('click');
      }
    }

    function showTooltip(def, node) {
      sync();
      if (!el.tooltip) return;
      var needs = Rules.prereqOf(def);
      var owned = {};
      for (var i = 0; i < state.buildings.length; i++) {
        var b = state.buildings[i];
        if (b.dead || b.owner !== playerIdx) continue;
        (b.def.tags || []).forEach(function (t) { owned[t] = true; });
      }
      var missing = needs.filter(function (n) { return !owned[n]; }).map(Sim.prereqName);
      var missingZh = needs.filter(function (n) { return !owned[n]; }).map(function (n) {
        return RA.I18n.prereqName(n);
      });
      var needList = RA.I18n.lang === 'zh' ? missingZh : missing;
      el.tooltip.innerHTML =
        '<b>' + RA.I18n.defName(def) + '</b><span class="cost">$' + def.cost + '</span>' +
        '<p>' + RA.I18n.defDesc(def) + '</p>' +
        (needList.length ? '<p class="warn">' + T('hud.requires') + ': ' + needList.join('、') + '</p>' : '') +
        (def.power ? '<p class="dim">' + T('hud.power') + ': ' + (def.power > 0 ? '+' : '') + def.power + '</p>' : '');
      el.tooltip.classList.add('show');
      var r = node.getBoundingClientRect();
      el.tooltip.style.left = Math.max(8, r.left - 268) + 'px';
      el.tooltip.style.top = Math.max(8, Math.min(window.innerHeight - 140, r.top - 10)) + 'px';
    }
    function hideTooltip() {
      if (el.tooltip) el.tooltip.classList.remove('show');
    }

    function addAlert(text, cls) {
      alerts.push({ text: text, cls: cls || '', t: 0, life: 4, node: null });
      while (alerts.length > 5) alerts.shift();
      renderAlerts();
    }
    HUD.addAlert = addAlert;

    function renderAlerts() {
      if (!el.alerts) return;
      el.alerts.innerHTML = '';
      alerts.forEach(function (a) {
        var d = document.createElement('div');
        d.className = 'alert ' + a.cls;
        d.textContent = a.text;
        el.alerts.appendChild(d);
        a.node = d;
      });
    }

    function updateAlerts(dt) {
      var changed = false;
      for (var i = alerts.length - 1; i >= 0; i--) {
        var a = alerts[i];
        a.t += dt;
        if (a.t > a.life) { alerts.splice(i, 1); changed = true; }
        else if (a.node) a.node.style.opacity = String(U.clamp((a.life - a.t) / 1.2, 0, 1));
      }
      if (changed) renderAlerts();
    }

    function update(stateRef, view, dt) {
      state = stateRef;
      sync();
      if (!minimap && el.minimap) {
        minimap = RA.Minimap.create(el.minimap, state, playerIdx);
        HUD.minimap = minimap;
      }
      var p = state.players[playerIdx];

      // credits roll towards the real value
      var target = p.credits;
      if (Math.abs(displayCredits - target) < 1) displayCredits = target;
      else displayCredits += (target - displayCredits) * Math.min(1, dt * 6);
      var creditText = U.formatMoney(displayCredits);
      if (creditText !== lastCreditsText) { el.credits.textContent = creditText; lastCreditsText = creditText; }
      el.credits.classList.toggle('low', p.credits < 100);

      // power
      var produced = p.power.produced, consumed = p.power.consumed;
      var frac = produced <= 0 ? 0 : U.clamp(consumed / produced, 0, 1);
      var net = produced - consumed;
      var powerSig = Math.round(frac * 100) + '|' + net + '|' + (p.power.low ? 1 : 0);
      if (powerSig !== lastPowerSig) {
        lastPowerSig = powerSig;
        el.powerBar.style.width = (frac * 100).toFixed(0) + '%';
        el.powerBar.parentNode.classList.toggle('overload', p.power.low);
        el.powerText.textContent = (net >= 0 ? '+' : '') + net;
        el.powerText.classList.toggle('bad', net < 0);
      }

      // build buttons
      for (var id in buttons) {
        var b = buttons[id];
        var qs = Sim.queueState(state, playerIdx, id);
        var check = Sim.canBuild(state, playerIdx, id);
        var node = b.node;
        var pct = qs && !qs.item.ready
          ? (U.clamp(qs.item.progress / b.def.buildTime, 0, 1) * 100).toFixed(0) : '0';
        var st = (check.ok ? 'k' : 'l') + (check.ok && p.credits < b.def.cost && !qs ? 'u' : '') +
          (qs ? (qs.item.ready ? 'R' : 'B') : '-') +
          (p.placing && p.placing.typeId === id ? 'P' : '') + pct;
        if (btnState[id] === st) continue;
        btnState[id] = st;
        node.classList.toggle('locked', !check.ok && !qs);
        node.classList.toggle('unaffordable', check.ok && p.credits < b.def.cost && !qs);
        node.classList.toggle('building', !!qs && !qs.item.ready);
        node.classList.toggle('ready', !!qs && qs.item.ready);
        node.classList.toggle('placing', !!(p.placing && p.placing.typeId === id));
        if (qs && !qs.item.ready) {
          b.progress.style.width = pct + '%';
          node.classList.add('showProgress');
        } else {
          b.progress.style.width = '0%';
          node.classList.remove('showProgress');
        }
      }

      updateSelection(state, view);
      updateAlerts(dt);

      if (el.timer) {
        var timerText = U.formatTime(state.tick, Rules.TICKS_PER_SEC);
        if (timerText !== lastTimerText) { el.timer.textContent = timerText; lastTimerText = timerText; }
      }
      updateSuperPanel(state, view);
      if (el.faction) {
        el.faction.textContent = RA.I18n.factionName(p.faction);
      }
      if (el.hint) el.hint.textContent = T('hud.hint');
      if (el.btnMenu) el.btnMenu.textContent = T('hud.menu');
      if (el.repair) el.repair.innerHTML = T('hud.repair') + ' <span>R</span>';
      if (el.sell) el.sell.innerHTML = T('hud.sell') + ' <span>Del</span>';
      var creditsLabel = root.querySelector('.creditsPanel .label');
      if (creditsLabel) creditsLabel.textContent = T('hud.credits');
      var powerLabel = root.querySelector('.powerRow .label');
      if (powerLabel) powerLabel.textContent = T('hud.power');
      if (minimap) minimap.draw(state, { renderer: opts.getRenderer ? opts.getRenderer() : null });
      if (el.repair) el.repair.disabled = !hasSelectedBuilding(state, view);
      if (el.sell) el.sell.disabled = !hasSelectedBuilding(state, view);
    }

    /** 超级武器按钮：显示充能进度，充能完毕可以点击瞄准。 */
    function updateSuperPanel(state, view) {
      if (!el.superPanel) return;
      var list = Sim.superList(state, playerIdx);
      // 内容指纹：只有"有哪些超级武器 / 是否就绪 / 瞄准中"变化时才重建 DOM，
      // 其余时间只改百分比文字和进度条宽度（原来每帧重建 DOM + 新建 canvas，很卡）
      var sig = '';
      for (var si = 0; si < list.length; si++) {
        sig += list[si].key + (list[si].ready ? '1' : '0') + (view && view.armingSuper &&
          view.armingSuper.key === list[si].key ? 'A' : '') + '|';
      }
      if (sig !== swSignature) {
        swSignature = sig;
        el.superPanel.innerHTML = '';
        swButtons = {};
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var b = document.createElement('button');
          b.className = 'swBtn' + (s.ready ? ' ready' : '') +
            (view && view.armingSuper && view.armingSuper.key === s.key ? ' aiming' : '');
          b.dataset.swKey = s.key;
          b.title = T('sw.' + s.key) + ' - ' + s.desc;
          var icon = document.createElement('canvas');
          icon.width = 40; icon.height = 30;
          icon.className = 'swIcon';
          var src = RA.Art.iconSprite(s.buildingType, state.players[playerIdx].colorId, 40, 30);
          icon.getContext('2d').drawImage(src, 0, 0);
          b.appendChild(icon);
          var text = document.createElement('span');
          text.className = 'swText';
          var nm = document.createElement('span');
          nm.className = 'swName';
          nm.textContent = T('sw.' + s.key);
          var pct = document.createElement('span');
          pct.className = 'swPct';
          text.appendChild(nm);
          text.appendChild(pct);
          b.appendChild(text);
          var bar = document.createElement('div');
          bar.className = 'swBar';
          var fill = document.createElement('i');
          bar.appendChild(fill);
          b.appendChild(bar);
          b.addEventListener('click', (function (key) {
            return function () { if (opts.onSuperClick) opts.onSuperClick(key); };
          })(s.key));
          el.superPanel.appendChild(b);
          swButtons[s.key] = { node: b, pct: pct, bar: fill, lastText: '', lastWidth: -1 };
        }
      }
      // 只更新进度（变化很慢，写 DOM 的代价很低）
      for (var k = 0; k < list.length; k++) {
        var s2 = list[k];
        var ref = swButtons[s2.key];
        if (!ref) continue;
        var text2 = s2.ready ? T('sw.ready') : Math.floor(s2.charge / s2.max * 100) + '%';
        if (text2 !== ref.lastText) { ref.pct.textContent = text2; ref.lastText = text2; }
        var w = Math.round(U.clamp(s2.charge / s2.max, 0, 1) * 100);
        if (w !== ref.lastWidth) { ref.bar.style.width = w + '%'; ref.lastWidth = w; }
      }
    }

    function hasSelectedBuilding(state, view) {
      if (!view || !view.selected) return false;
      var found = false;
      view.selected.forEach(function (id) {
        var e = Sim.byId(state, id);
        if (e && e.kind === 'building' && e.owner === playerIdx) found = true;
      });
      return found;
    }

    function updateSelection(state, view) {
      if (!el.selection) return;
      var ids = view && view.selected ? Array.from(view.selected) : [];
      var units = [], buildings = [];
      ids.forEach(function (id) {
        var e = Sim.byId(state, id);
        if (!e) return;
        if (e.kind === 'unit') units.push(e); else buildings.push(e);
      });
      if (!units.length && !buildings.length) {
        if (selSignature !== 'empty') {
          selSignature = 'empty';
          el.selection.innerHTML = '<div class="selEmpty">' + T('hud.noSelection') + '</div>';
        }
        return;
      }
      // 选择面板的内容指纹：血量/载矿/修理状态没变就不重写 innerHTML
      var selSig = ids.join(',') + '|';
      for (var si = 0; si < units.length; si++) {
        selSig += units[si].id + ':' + Math.round(units[si].hp) + ':' + Math.round(units[si].cargo) +
          ':' + units[si].rank + ';';
      }
      for (si = 0; si < buildings.length; si++) {
        selSig += buildings[si].id + ':' + Math.round(buildings[si].hp) + ':' +
          (buildings[si].repairing ? 1 : 0) + ';';
      }
      if (selSig === selSignature) return;
      selSignature = selSig;
      var html = '';
      if (buildings.length === 1) {
        var b = buildings[0];
        html += '<div class="selTitle">' + RA.I18n.defName(b.def) + '</div>' +
          '<div class="selHp"><i style="width:' + (U.clamp(b.hp / b.maxHp, 0, 1) * 100).toFixed(0) + '%"></i></div>' +
          '<div class="selMeta">' + Math.round(b.hp) + ' / ' + Math.round(b.maxHp) + ' ' + T('hud.hp') +
          (b.repairing ? ' &middot; ' + T('hud.repairing') : '') + '</div>';
      } else if (units.length === 1) {
        var u = units[0];
        html += '<div class="selTitle">' + RA.I18n.defName(u.def) +
          (u.rank > 0 ? ' <span class="rank">' + RA.I18n.rankName(u.rank) + '</span>' : '') + '</div>' +
          '<div class="selHp"><i style="width:' + (U.clamp(u.hp / u.maxHp, 0, 1) * 100).toFixed(0) + '%"></i></div>' +
          '<div class="selMeta">' + Math.round(u.hp) + ' / ' + Math.round(u.maxHp) + ' ' + T('hud.hp') + '</div>';
        if (u.def.capacity) {
          html += '<div class="selMeta">' + T('hud.oreLoad') + ': ' + Math.round(u.cargo) + ' / ' + u.def.capacity + '</div>';
        }
        var w = Sim.primaryWeapon(u);
        if (w) {
          html += '<div class="selMeta dim">' + RA.I18n.weaponName(w) + ': ' + w.damage + ' ' + T('hud.damage') + ' / ' +
            w.range.toFixed(1) + ' ' + T('hud.tiles') + '</div>';
        }
      } else {
        var counts = {};
        units.concat(buildings).forEach(function (e) {
          counts[e.type] = (counts[e.type] || 0) + 1;
        });
        var parts = Object.keys(counts).map(function (t) {
          return counts[t] + ' × ' + RA.I18n.defName(Rules.get(t));
        });
        html += '<div class="selTitle">' + T('hud.selectedUnits', { n: units.length }) + '</div>';
        html += '<div class="selMeta">' + parts.slice(0, 3).join(', ') + '</div>';
      }
      el.selection.innerHTML = html;
    }

    buildTabs();
    setTab(tab);

    if (el.repair) {
      el.repair.addEventListener('click', function () { opts.onRepair && opts.onRepair(); });
    }
    if (el.sell) {
      el.sell.addEventListener('click', function () { opts.onSell && opts.onSell(); });
    }
    if (el.minimap) {
      var dragging = false;
      var handleMini = function (ev, isOrder) {
        var r = el.minimap.getBoundingClientRect();
        var t = minimap.clickToTile(
          (ev.clientX - r.left) * (el.minimap.width / r.width),
          (ev.clientY - r.top) * (el.minimap.height / r.height));
        if (isOrder) opts.onMinimapOrder && opts.onMinimapOrder(t);
        else opts.onMinimapJump && opts.onMinimapJump(t);
      };
      el.minimap.addEventListener('mousedown', function (ev) {
        if (ev.button === 0) { dragging = true; handleMini(ev, false); }
        else if (ev.button === 2) { ev.preventDefault(); handleMini(ev, true); }
      });
      window.addEventListener('mousemove', function (ev) { if (dragging) handleMini(ev, false); });
      window.addEventListener('mouseup', function () { dragging = false; });
      el.minimap.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    }

    return {
      update: update,
      setPlayer: function (idx) {
        playerIdx = idx;
        sync();
        buildGrid();
        if (minimap) minimap = RA.Minimap.create(el.minimap, state, playerIdx);
      },
      setTab: setTab,
      /** Re-render every piece of chrome after a language change. */
      setLanguage: function (lang) {
        RA.I18n.setLang(lang);
        sync();
        buildTabs();
        setTab(tab);
        if (el.hint) el.hint.textContent = T('hud.hint');
      },
      cycleTab: function (dir) {
        var i = Rules.TAB_ORDER.indexOf(tab);
        i = (i + dir + Rules.TAB_ORDER.length) % Rules.TAB_ORDER.length;
        setTab(Rules.TAB_ORDER[i]);
      },
      getTab: function () { return tab; },
      alert: addAlert,
      rebuild: buildGrid,
      getMinimap: function () { return minimap; }
    };
  };
})(globalThis.RA = globalThis.RA || {});
