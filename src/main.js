/*
 * Bootstrapping, the game loop and glue between simulation, renderer, HUD,
 * input, audio and the menus.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var Sim = RA.Sim;

  var HZ = Rules.TICKS_PER_SEC;
  var root = null;
  var worldCanvas = null;
  var renderer = null;
  var hud = null;
  var input = null;
  var minimap = null;

  var state = null;
  var config = null;
  var view = null;
  var running = false;
  var paused = false;
  var accumulator = 0;
  var lastTime = 0;
  var hudTick = 0;
  var shake = { t: 0, mag: 0 };
  var gameOverTimer = 0;
  var resultsShown = false;
  var reShow = null;               // re-renders whatever menu is currently open
  var settings = {
    volume: 0.6,
    sound: true,
    voice: true,
    voiceVolume: 0.9,
    lang: 'zh',
    edgeScroll: true,
    showHealth: true,
    shake: true,
    scrollSpeed: 700
  };

  /**
   * The view object is created once and then re-used (the input layer keeps a
   * reference to it), so a new match resets its fields instead of replacing it.
   */
  function resetView() {
    if (!view) {
      view = { playerIdx: 0, selected: new Set(), feedback: [], groups: {} };
    }
    view.playerIdx = 0;
    view.selected.clear();
    view.hoverId = 0;
    view.hoverTile = null;
    view.dragRect = null;
    view.cursor = null;
    view.feedback.length = 0;
    view.groups = {};
    view.lastAlertPos = null;
    view.showHealth = settings.showHealth;
    return view;
  }

  // ---------------------------------------------------------------------
  // Settings & URL
  // ---------------------------------------------------------------------
  function loadSettings() {
    try {
      var raw = window.localStorage.getItem('ra-web-settings');
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var k in parsed) settings[k] = parsed[k];
      }
    } catch (e) { /* private mode: ignore */ }
    RA.I18n.setLang(settings.lang === 'en' ? 'en' : 'zh');
    RA.Sfx.init({ volume: settings.volume, enabled: settings.sound !== false });
    RA.Voice.init({
      enabled: settings.voice !== false,
      volume: settings.voiceVolume === undefined ? 0.9 : settings.voiceVolume,
      lang: settings.lang
    });
  }
  function saveSettings() {
    try { window.localStorage.setItem('ra-web-settings', JSON.stringify(settings)); } catch (e) {}
  }

  /**
   * Show an alert in the ticker and speak the matching Chinese line.  When a
   * parametrised text is supplied (e.g. a unit name) the ticker uses it while
   * the voice uses the generic callout.
   */
  function announce(key, cls, params) {
    var spoken = RA.Voice ? RA.Voice.pick(key) : '';
    var shown = params ? RA.I18n.t('alert.' + key, params) : (spoken || RA.I18n.t('alert.' + key));
    if (hud && shown) hud.alert(shown, cls || '');
    if (RA.Voice && spoken) RA.Voice.say(spoken, key);
    return shown;
  }

  /** Remember how to re-draw the current menu (needed after a language switch). */
  function showScreen(builder) {
    reShow = builder;
    builder();
  }

  function applyLanguage(lang) {
    settings.lang = (lang === 'en') ? 'en' : 'zh';
    RA.I18n.setLang(settings.lang);
    RA.Voice.setLang(settings.lang);
    saveSettings();
    if (hud) hud.setLanguage(settings.lang);
    if (reShow) reShow();
  }

  function defaultConfig() {
    return {
      faction: 'allied',
      color: 2,
      difficulty: 'normal',
      size: 'medium',
      opponents: 1,
      enemyFaction: 'soviet',
      credits: 10000,
      startOption: 'standard',
      shortGame: true,
      fog: true,
      seed: null,
      autostart: false
    };
  }

  function configFromUrl() {
    var cfg = defaultConfig();
    var params = new URLSearchParams(window.location.search);
    var any = false;
    function read(key, apply) {
      if (!params.has(key)) return;
      var v = params.get(key);
      apply(v);
      any = true;
    }
    read('faction', function (v) { if (v === 'allied' || v === 'soviet') cfg.faction = v; });
    read('color', function (v) { cfg.color = U.clamp(U.parseInt(v, 2), 0, 7); });
    read('difficulty', function (v) { if (Rules.DIFFICULTIES[v]) cfg.difficulty = v; });
    read('size', function (v) { if (['small', 'medium', 'large'].indexOf(v) >= 0) cfg.size = v; });
    read('opponents', function (v) { cfg.opponents = U.clamp(U.parseInt(v, 1), 1, 3); });
    read('enemy', function (v) {
      if (['allied', 'soviet', 'mixed'].indexOf(v) >= 0) cfg.enemyFaction = v;
    });
    read('credits', function (v) { cfg.credits = U.clamp(U.parseInt(v, 10000), 1000, 100000); });
    read('start', function (v) {
      if (['mcv', 'standard', 'quick'].indexOf(v) >= 0) cfg.startOption = v;
    });
    read('shortgame', function (v) { cfg.shortGame = v !== '0'; });
    read('fog', function (v) { cfg.fog = v !== '0'; });
    read('seed', function (v) {
      var n = U.parseInt(v, NaN);
      cfg.seed = isFinite(n) ? (n >>> 0) : U.hashSeed(v);
    });
    read('autostart', function (v) { cfg.autostart = v !== '0'; });
    if (cfg.autostart) cfg.autostart = true;
    else if (any && params.has('seed')) cfg.autostart = false;
    return cfg;
  }

  function shareUrl(cfg, seed) {
    var params = new URLSearchParams();
    params.set('seed', String(seed));
    params.set('faction', cfg.faction);
    params.set('color', String(cfg.color));
    params.set('difficulty', cfg.difficulty);
    params.set('size', cfg.size);
    params.set('opponents', String(cfg.opponents));
    params.set('enemy', cfg.enemyFaction);
    params.set('credits', String(cfg.credits));
    params.set('start', cfg.startOption);
    params.set('shortgame', cfg.shortGame ? '1' : '0');
    params.set('fog', cfg.fog ? '1' : '0');
    params.set('autostart', '1');
    var base = window.location.origin + window.location.pathname;
    if (base === 'null' || base.indexOf('file://') === 0) return 'file://' + window.location.pathname + '?' + params.toString();
    return base + '?' + params.toString();
  }

  // ---------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------
  function buildPlayers(cfg, seed) {
    var players = [{
      faction: cfg.faction,
      color: cfg.color,
      isAI: false,
      difficulty: cfg.difficulty
    }];
    var rng = U.makeRng(seed ^ 0x1234abcd);
    for (var i = 0; i < cfg.opponents; i++) {
      var faction = cfg.enemyFaction === 'mixed'
        ? (rng() < 0.5 ? 'allied' : 'soviet')
        : cfg.enemyFaction;
      players.push({
        faction: faction,
        color: 1 + i,
        isAI: true,
        difficulty: cfg.difficulty
      });
    }
    return players;
  }

  function startGame(cfg) {
    config = cfg;
    var seed = cfg.seed === null || cfg.seed === undefined
      ? ((Math.random() * 0xffffffff) >>> 0)
      : (cfg.seed >>> 0);
    config.seedUsed = seed;

    var players = buildPlayers(cfg, seed);
    try {
      state = Sim.createGame({
        seed: seed,
        size: cfg.size,
        playerCount: players.length,
        players: players,
        startCredits: cfg.credits,
        startOption: cfg.startOption,
        shortGame: cfg.shortGame,
        fog: cfg.fog,
        difficulty: cfg.difficulty
      });
    } catch (err) {
      homeMenu();
      window.alert('Could not generate that battlefield: ' + err.message);
      return;
    }

    resetView();
    if (!renderer) {
      renderer = RA.Renderer.create(worldCanvas);
    }
    resizeCanvas();
    renderer.camera.zoom = 1;
    var yard = state.buildings.find(function (b) { return b.owner === 0 && b.type === 'conyard'; }) ||
      { cx: state.map.starts[0].x, cy: state.map.starts[0].y };
    renderer.centerOn(state.map, yard.cx, yard.cy);

    hud.setPlayer(0);
    hud.rebuild();
    RA.Screens.clear(root);
    reShow = null;
    running = true;
    paused = false;
    resultsShown = false;
    gameOverTimer = 0;
    accumulator = 0;
    lastTime = performance.now();
    document.getElementById('game').classList.add('in-game');
    RA.Sfx.resume();
    requestAnimationFrame(frame);
  }

  function restartGame() {
    var cfg = JSON.parse(JSON.stringify(config));
    cfg.seed = null;                 // rematch: fresh battlefield
    startGame(cfg);
  }

  function quitToMenu() {
    running = false;
    paused = false;
    document.getElementById('game').classList.remove('in-game');
    if (RA.Voice) RA.Voice.stop();
    showScreen(function () { RA.Screens.mainMenu(root, menuCallbacks()); });
  }

  function resizeCanvas() {
    var viewport = document.getElementById('viewport');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var vw = viewport.clientWidth || viewport.offsetWidth || (window.innerWidth - 232) || 960;
    var vh = viewport.clientHeight || viewport.offsetHeight || window.innerHeight || 600;
    var w = Math.max(320, Math.floor(vw * dpr));
    var h = Math.max(240, Math.floor(vh * dpr));
    if (worldCanvas.width !== w || worldCanvas.height !== h) {
      worldCanvas.width = w;
      worldCanvas.height = h;
    }
    if (renderer) renderer.resize(w, h);
  }

  // ---------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------
  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.25, (now - lastTime) / 1000);
    lastTime = now;
    if (!paused && state && !state.over) {
      accumulator += dt;
      var steps = 0;
      while (accumulator >= 1 / HZ && steps < 8) {
        Sim.step(state);
        accumulator -= 1 / HZ;
        steps++;
      }
      if (accumulator > 1) accumulator = 0;
    }
    processEvents();
    if (input) input.update(paused ? 0 : dt);
    if (state) {
      // screen shake from nearby explosions
      var cam = renderer.camera;
      var savedX = cam.x, savedY = cam.y;
      if (shake.t > 0 && settings.shake !== false) {
        shake.t -= dt;
        var mag = shake.mag * Math.max(0, shake.t);
        cam.x += (Math.random() - 0.5) * mag;
        cam.y += (Math.random() - 0.5) * mag;
      }
      view.showHealth = settings.showHealth;
      renderer.draw(state, view);
      cam.x = savedX; cam.y = savedY;
      hudTick++;
      if (hudTick % 2 === 0) hud.update(state, view, dt * 2);
      if (state.over && !resultsShown) {
        gameOverTimer += dt;
        if (gameOverTimer > 1.8) showResults();
      }
    }
    requestAnimationFrame(frame);
  }

  function showResults() {
    resultsShown = true;
    var win = state.winner === 0;
    RA.Sfx.play(win ? 'victory' : 'defeat');
    var stats = state.players[0].stats;
    showScreen(function () {
      RA.Screens.results(root, {
        win: win,
        stats: stats,
        ticks: state.tick,
        shareUrl: shareUrl(config, config.seedUsed)
      }, {
        onMenu: quitToMenu,
        onRestart: restartGame
      });
    });
    running = false;
  }

  function processEvents() {
    if (!state) return;
    var events = state.events;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'explosion':
          RA.Sfx.play(e.big ? 'bigExplosion' : 'explosion', e.big ? 1.4 : 1);
          if (settings.shake !== false) {
            var d = e.big ? 7 : 3;
            shake.t = 0.32;
            shake.mag = Math.max(shake.mag * 0.5, d);
          }
          break;
        case 'shot':
          RA.Sfx.play(e.big ? 'bigShot' : 'shot');
          break;
        case 'unitReady':
          RA.Sfx.play('unitReady');
          if (e.player === 0) {
            RA.Voice.speak('unitReady');
            hud.alert(RA.I18n.t('alert.unitReady', { name: RA.I18n.nameOf(e.typeId) }), 'good');
          }
          break;
        case 'structureReady':
          RA.Sfx.play('buildingComplete');
          if (e.player === 0) {
            RA.Voice.speak('structureReady');
            hud.alert(RA.I18n.t('alert.structureReady', { name: RA.I18n.nameOf(e.typeId) }), 'good');
          }
          break;
        case 'buildingComplete':
          RA.Sfx.play('buildingComplete');
          if (e.player === 0) {
            RA.Voice.speak('buildingComplete');
            hud.alert(RA.I18n.t('alert.buildingComplete', { name: RA.I18n.nameOf(e.typeId) }), 'good');
          }
          break;
        case 'lowPower':
          RA.Sfx.play('lowPower');
          if (e.player === 0) announce('lowPower', 'warn');
          break;
        case 'buildRefused':
          if (e.player === 0) {
            RA.Sfx.play(/credit/i.test(e.reason) ? 'nofunds' : 'deny');
            hud.alert(RA.I18n.reason(e), 'warn');
            RA.Voice.speak(/credit/i.test(e.reason) ? 'noFunds' : 'deny');
          }
          break;
        case 'sell':
          RA.Sfx.play('sell');
          if (e.player === 0) {
            RA.Voice.speak('sell');
            hud.alert(RA.I18n.t('alert.sell', { refund: U.formatMoney(e.refund) }), '');
          }
          break;
        case 'capture':
          RA.Sfx.play('capture');
          if (e.player === 0) {
            RA.Voice.speak('capture');
            hud.alert(RA.I18n.t('alert.capture'), 'good');
          } else if (e.from === 0) {
            RA.Voice.speak('underAttack');
            hud.alert(RA.I18n.t('alert.capturedByEnemy', { name: RA.I18n.nameOf(e.typeId) }), 'bad');
          }
          break;
        case 'promote':
          RA.Sfx.play('promote');
          if (e.player === 0) {
            RA.Voice.speak('promote');
            hud.alert(RA.I18n.t('alert.promote', { rank: RA.I18n.rankName(e.rank) }), 'good');
          }
          break;
        case 'noRefinery':
          if (e.player === 0) announce('noRefinery', 'warn');
          break;
        case 'noOre':
          if (e.player === 0) announce('noOre', 'warn');
          break;
        case 'unload':
          RA.Sfx.play('unload');
          break;
        case 'underAttack':
          if (e.player === 0) {
            RA.Sfx.play('underAttack');
            announce('underAttack', 'bad');
            view.lastAlertPos = { x: e.x, y: e.y };
          }
          break;
        case 'suddenDeath':
          announce('suddenDeath', 'warn');
          break;
        case 'defeated':
          if (e.player === 0) announce('allStructuresLost', 'bad');
          break;
        case 'aiError':
          if (window.console && console.warn) console.warn('AI error', e.message);
          break;
        default: break;
      }
    }
    events.length = 0;
  }

  // ---------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------
  function menuCallbacks() {
    return {
      onSkirmish: function () {
        var cfg = defaultConfig();
        showScreen(function () {
          RA.Screens.skirmish(root, cfg, {
            onBack: function () { homeMenu(); },
            onStart: function (c) { startGame(c); }
          });
        });
      },
      onHelp: function () {
        showScreen(function () {
          RA.Screens.help(root, { onBack: function () { homeMenu(); } });
        });
      },
      onOptions: function () {
        showScreen(function () { showOptionsScreen(function () { homeMenu(); }); });
      },
      onAbout: function () {
        showScreen(function () {
          RA.Screens.about(root, { onBack: function () { homeMenu(); } });
        });
      }
    };
  }

  function homeMenu() {
    showScreen(function () { RA.Screens.mainMenu(root, menuCallbacks()); });
  }

  function showOptionsScreen(onBack) {
    RA.Screens.options(root, settings, {
      onChange: saveSettings,
      onLanguage: applyLanguage,
      onBack: onBack || homeMenu
    });
  }

  function doPause() {
    if (!running || state.over) return;
    paused = true;
    showPauseMenu();
  }

  function showPauseMenu() {
    showScreen(function () {
      RA.Screens.pause(root, {
        onResume: function () {
          paused = false;
          lastTime = performance.now();
          RA.Screens.clear(root);
          reShow = null;
        },
        onOptions: function () {
          showScreen(function () { showOptionsScreen(function () { showPauseMenu(); }); });
        },
        onRestart: restartGame,
        onQuit: quitToMenu
      });
    });
  }

  function sellSelected() {
    var n = 0;
    view.selected.forEach(function (id) {
      var e = Sim.byId(state, id);
      if (e && e.kind === 'building' && e.owner === 0) {
        Sim.sellBuilding(state, 0, id);
        n++;
      }
    });
    if (!n) hud.alert(RA.I18n.t('alert.selectOwn'), 'warn');
  }

  function repairSelected() {
    var n = 0;
    view.selected.forEach(function (id) {
      var e = Sim.byId(state, id);
      if (e && e.kind === 'building' && e.owner === 0) {
        Sim.toggleRepair(state, 0, id);
        n++;
      }
    });
    if (!n) hud.alert(RA.I18n.t('alert.selectOwn'), 'warn');
  }

  function minimapJump(t) {
    renderer.centerOn(state.map, t.x, t.y);
  }
  function minimapOrder(t) {
    var ids = Array.from(view.selected);
    if (!ids.length) return;
    Sim.issueOrder(state, 0, ids, { type: 'move', x: t.x + 0.5, y: t.y + 0.5 });
    view.feedback.push({ type: 'move', x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 0.7, color: '#8dff9a' });
    RA.Sfx.play('ack');
  }

  // ---------------------------------------------------------------------
  function boot() {
    root = document.getElementById('game');
    worldCanvas = document.getElementById('world');
    RA.Art.init(document);
    RA.Iso.refresh();
    loadSettings();

    hud = RA.Hud.create(root, {
      getState: function () { return state; },
      onSound: function (name, arg) { RA.Sfx.play(name, arg); },
      onRepair: repairSelected,
      onSell: sellSelected,
      onMinimapJump: minimapJump,
      onMinimapOrder: minimapOrder,
      getRenderer: function () { return renderer; }
    });
    // localise the static chrome before the first frame
    var hintBar = document.getElementById('hintBar');
    if (hintBar) hintBar.textContent = RA.I18n.t('hud.hint');
    var menuButton = document.getElementById('btnMenu');
    if (menuButton) menuButton.textContent = RA.I18n.t('hud.menu');

    view = {
      playerIdx: 0, selected: new Set(), hoverId: 0, hoverTile: null,
      dragRect: null, cursor: null, feedback: [], groups: {}, showHealth: settings.showHealth
    };
    resetView();
    input = RA.Input.create({
      canvas: worldCanvas,
      view: view,
      getState: function () { return state; },
      getRenderer: function () { return renderer; },
      settings: settings,
      hud: hud,
      onSound: function (name) { RA.Sfx.play(name); },
      onPause: doPause,
      onSell: sellSelected,
      onRepair: repairSelected,
      onAlert: function (text) { hud.alert(text, ''); },
      onSelectionChanged: function () {}
    });

    window.addEventListener('resize', function () {
      resizeCanvas();
      if (state) renderer.clampCamera(state.map);
    });
    window.addEventListener('blur', function () { if (running && !state.over) doPause(); });
    // Mobile browsers only allow speech after a user gesture.
    window.addEventListener('pointerdown', function () {
      RA.Sfx.resume();
      if (RA.Voice) RA.Voice.unlock();
    });
    var menuBtn = document.getElementById('btnMenu');
    if (menuBtn) menuBtn.addEventListener('click', doPause);

    var cfg = configFromUrl();
    resizeCanvas();

    // Menu background: a static battlefield render so the menu is not empty.
    var splashSeed = 1337;
    var splashPlayers = [{ faction: 'allied', color: 2, isAI: true }, { faction: 'soviet', color: 1, isAI: true }];
    try {
      var splash = Sim.createGame({
        seed: splashSeed, size: 'medium', playerCount: 2,
        players: splashPlayers, startOption: 'quick'
      });
      for (var i = 0; i < 30 * 40; i++) Sim.step(splash);
      renderer = RA.Renderer.create(worldCanvas);
      resizeCanvas();
      var sy = splash.buildings.find(function (b) { return b.owner === 0 && b.type === 'conyard'; });
      renderer.centerOn(splash.map, sy ? sy.cx : 20, sy ? sy.cy : 20);
      var splashView = { playerIdx: 0, selected: new Set(), feedback: [] };
      (function splashLoop() {
        if (state) return;                   // a real match took over
        for (var k = 0; k < 1; k++) Sim.step(splash);
        renderer.draw(splash, splashView);
        requestAnimationFrame(splashLoop);
      })();
    } catch (e) {
      // If anything goes wrong the menu is still usable.
    }

    if (cfg.autostart) startGame(cfg);
    else homeMenu();
  }

  // Handles for tests and for the browser console.
  RA.Game = RA.Game || {};
  RA.Game.debug = {
    state: function () { return state; },
    renderer: function () { return renderer; },
    view: function () { return view; },
    config: function () { return config; },
    settings: function () { return settings; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.RA = globalThis.RA || {});
