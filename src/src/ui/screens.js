/*
 * All the full-screen menus: main menu, skirmish setup, options, help,
 * the pause menu and the after-action report.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var Screens = RA.Screens = {};
  var T = function (key, params) { return RA.I18n.t(key, params); };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function overlay(root, cls) {
    var o = root.querySelector('#overlay');
    o.innerHTML = '';
    o.className = 'overlay show ' + (cls || '');
    return o;
  }

  Screens.clear = function (root) {
    var o = root.querySelector('#overlay');
    o.className = 'overlay';
    o.innerHTML = '';
  };

  function button(label, cls, onClick, action) {
    var b = el('button', 'btn ' + (cls || ''), label);
    if (action) b.dataset.action = action;
    b.addEventListener('click', function (ev) { onClick(ev, b); });
    return b;
  }

  // ---------------------------------------------------------------------
  // Main menu
  // ---------------------------------------------------------------------
  Screens.mainMenu = function (root, opts) {
    var o = overlay(root, 'mainmenu');
    var panel = el('div', 'menuPanel');
    panel.appendChild(el('h1', 'gameTitle', 'RED ALERT<span>WEB</span>'));
    panel.appendChild(el('p', 'subtitle', T('menu.subtitle')));
    var menu = el('div', 'menuButtons');
    menu.appendChild(button(T('menu.skirmish'), 'primary', function () { opts.onSkirmish(); }, 'skirmish'));
    menu.appendChild(button(T('menu.help'), '', function () { opts.onHelp(); }, 'help'));
    menu.appendChild(button(T('menu.options'), '', function () { opts.onOptions(); }, 'options'));
    menu.appendChild(button(T('menu.about'), '', function () { opts.onAbout(); }, 'about'));
    panel.appendChild(menu);
    panel.appendChild(el('p', 'footer', T('menu.footer')));
    o.appendChild(panel);
  };

  // ---------------------------------------------------------------------
  // Skirmish setup
  // ---------------------------------------------------------------------
  Screens.skirmish = function (root, config, opts) {
    var o = overlay(root, 'skirmish');
    var panel = el('div', 'menuPanel wide');
    panel.appendChild(el('h2', 'screenTitle', T('skirmish.title')));

    var cols = el('div', 'cols');
    var left = el('div', 'col');
    var right = el('div', 'col');

    // faction
    left.appendChild(el('h3', null, T('skirmish.yourFaction')));
    var facRow = el('div', 'btnRow');
    ['allied', 'soviet'].forEach(function (f) {
      var b = button(RA.I18n.factionName(f),
        config.faction === f ? 'toggle active' : 'toggle',
        function () { config.faction = f; Screens.skirmish(root, config, opts); },
        'faction-' + f);
      b.title = RA.I18n.factionBlurb(f);
      facRow.appendChild(b);
    });
    left.appendChild(facRow);
    left.appendChild(el('p', 'hint', RA.I18n.factionBlurb(config.faction)));

    left.appendChild(el('h3', null, T('skirmish.color')));
    var colorRow = el('div', 'swatches');
    Rules.PLAYER_COLORS.forEach(function (c, i) {
      var s = el('button', 'swatch' + (config.color === i ? ' active' : ''));
      s.style.background = c.hex;
      s.title = RA.I18n.colorName(i);
      s.addEventListener('click', function () { config.color = i; Screens.skirmish(root, config, opts); });
      colorRow.appendChild(s);
    });
    left.appendChild(colorRow);

    left.appendChild(el('h3', null, T('skirmish.opponents')));
    var oppRow = el('div', 'btnRow');
    [1, 2, 3].forEach(function (n) {
      oppRow.appendChild(button(T('skirmish.opponentsN', { n: n }),
        config.opponents === n ? 'toggle active' : 'toggle',
        function () { config.opponents = n; Screens.skirmish(root, config, opts); },
        'opponents-' + n));
    });
    left.appendChild(oppRow);

    left.appendChild(el('h3', null, T('skirmish.difficulty')));
    var diffRow = el('div', 'btnRow');
    ['easy', 'normal', 'hard'].forEach(function (d) {
      diffRow.appendChild(button(RA.I18n.difficultyName(d),
        config.difficulty === d ? 'toggle active' : 'toggle',
        function () { config.difficulty = d; Screens.skirmish(root, config, opts); },
        'difficulty-' + d));
    });
    left.appendChild(diffRow);
    left.appendChild(el('p', 'hint', T('hint.difficulty')));

    left.appendChild(el('h3', null, T('skirmish.theirFaction')));
    var enemyFac = el('div', 'btnRow');
    ['allied', 'soviet', 'mixed'].forEach(function (f) {
      enemyFac.appendChild(button(RA.I18n.factionName(f),
        config.enemyFaction === f ? 'toggle active' : 'toggle',
        function () { config.enemyFaction = f; Screens.skirmish(root, config, opts); },
        'enemy-' + f));
    });
    left.appendChild(enemyFac);
    left.appendChild(el('p', 'hint', T('hint.enemyFaction')));

    // map / rules
    right.appendChild(el('h3', null, T('skirmish.battlefield')));
    var sizeRow = el('div', 'btnRow');
    ['small', 'medium', 'large'].forEach(function (sz) {
      sizeRow.appendChild(button(RA.I18n.sizeLabel(sz), config.size === sz ? 'toggle active' : 'toggle',
        function () { config.size = sz; Screens.skirmish(root, config, opts); }, 'size-' + sz));
    });
    right.appendChild(sizeRow);

    right.appendChild(el('h3', null, T('skirmish.startBase')));
    var startRow = el('div', 'btnRow col');
    Rules.START_OPTIONS.forEach(function (s) {
      startRow.appendChild(button(RA.I18n.startLabel(s), config.startOption === s ? 'toggle active wide' : 'toggle wide',
        function () { config.startOption = s; Screens.skirmish(root, config, opts); }, 'start-' + s));
    });
    right.appendChild(startRow);

    right.appendChild(el('h3', null, T('skirmish.startCredits')));
    var crRow = el('div', 'btnRow');
    [5000, 10000, 20000].forEach(function (c) {
      crRow.appendChild(button('$' + c, config.credits === c ? 'toggle active' : 'toggle',
        function () { config.credits = c; Screens.skirmish(root, config, opts); }));
    });
    right.appendChild(crRow);

    right.appendChild(el('h3', null, T('skirmish.rules')));
    var ruleRow = el('div', 'btnRow');
    ruleRow.appendChild(button(T('skirmish.shortGame') + ': ' + (config.shortGame ? T('common.on') : T('common.off')),
      config.shortGame ? 'toggle active' : 'toggle',
      function () { config.shortGame = !config.shortGame; Screens.skirmish(root, config, opts); }, 'toggle-short'));
    ruleRow.appendChild(button(T('skirmish.fog') + ': ' + (config.fog ? T('common.on') : T('common.off')),
      config.fog ? 'toggle active' : 'toggle',
      function () { config.fog = !config.fog; Screens.skirmish(root, config, opts); }, 'toggle-fog'));
    right.appendChild(ruleRow);
    right.appendChild(el('p', 'hint', T('hint.rules')));

    right.appendChild(el('h3', null, T('skirmish.seed')));
    var seedRow = el('div', 'btnRow');
    var seedInput = el('input', 'seedInput');
    seedInput.type = 'text';
    seedInput.value = config.seed === null ? T('common.random') : String(config.seed);
    seedInput.addEventListener('change', function () {
      var v = seedInput.value.trim();
      config.seed = (v === '' || v === 'random' || v === T('common.random')) ? null : U.hashSeed(v);
    });
    seedRow.appendChild(seedInput);
    seedRow.appendChild(button(T('skirmish.randomise'), 'toggle', function () {
      config.seed = null;
      seedInput.value = T('common.random');
    }, 'randomise'));
    right.appendChild(seedRow);
    right.appendChild(el('p', 'hint', T('hint.seed')));

    cols.appendChild(left);
    cols.appendChild(right);
    panel.appendChild(cols);

    var actions = el('div', 'menuButtons row');
    actions.appendChild(button(T('common.back'), '', function () { opts.onBack(); }, 'back'));
    actions.appendChild(button(T('common.start'), 'primary', function () { opts.onStart(config); }, 'start'));
    panel.appendChild(actions);
    o.appendChild(panel);
  };

  // ---------------------------------------------------------------------
  // Options
  // ---------------------------------------------------------------------
  Screens.options = function (root, settings, opts) {
    var o = overlay(root, 'options');
    var panel = el('div', 'menuPanel');
    panel.appendChild(el('h2', 'screenTitle', T('options.title')));
    var list = el('div', 'optList');

    function slider(label, value, min, max, step, onChange) {
      var row = el('label', 'optRow');
      row.appendChild(el('span', 'optLabel', label));
      var input = el('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step; input.value = value;
      var out = el('span', 'optValue', String(value));
      input.addEventListener('input', function () {
        out.textContent = input.value;
        onChange(Number(input.value));
      });
      row.appendChild(input);
      row.appendChild(out);
      return row;
    }
    function toggle(label, value, onChange) {
      var row = el('label', 'optRow');
      row.appendChild(el('span', 'optLabel', label));
      var b = button(value ? T('common.on') : T('common.off'), value ? 'toggle active' : 'toggle', function () {
        value = !value;
        b.textContent = value ? T('common.on') : T('common.off');
        b.className = value ? 'toggle active' : 'toggle';
        onChange(value);
      });
      row.appendChild(b);
      return row;
    }

    // language first: it changes every label on this screen
    var langRow = el('label', 'optRow');
    langRow.appendChild(el('span', 'optLabel', T('options.language')));
    var langBox = el('div', 'btnRow');
    ['zh', 'en'].forEach(function (l) {
      langBox.appendChild(button(l === 'zh' ? '中文' : 'English',
        RA.I18n.lang === l ? 'toggle active' : 'toggle',
        function () {
          RA.I18n.setLang(l);
          settings.lang = l;
          RA.Voice.setLang(l);
          opts.onChange(settings);
          if (opts.onLanguage) opts.onLanguage(l);
        }, 'lang-' + l));
    });
    langRow.appendChild(langBox);
    list.appendChild(langRow);

    list.appendChild(slider(T('options.sound'), Math.round(settings.volume * 100), 0, 100, 5, function (v) {
      settings.volume = v / 100;
      RA.Sfx.setVolume(settings.volume);
      opts.onChange(settings);
    }));
    list.appendChild(toggle(T('options.soundOn'), settings.sound !== false, function (v) {
      settings.sound = v;
      RA.Sfx.setEnabled(v);
      opts.onChange(settings);
    }));
    list.appendChild(toggle(T('options.voice'), settings.voice !== false, function (v) {
      settings.voice = v;
      RA.Voice.setEnabled(v);
      opts.onChange(settings);
      if (v) RA.Voice.speak('unitReady', { force: true });
    }));
    list.appendChild(slider(T('options.voiceVolume'), Math.round((settings.voiceVolume === undefined ? 0.9 : settings.voiceVolume) * 100),
      0, 100, 5, function (v) {
        settings.voiceVolume = v / 100;
        RA.Voice.setVolume(settings.voiceVolume);
        opts.onChange(settings);
        RA.Voice.speak('unitReady', { force: true });
      }));
    var testRow = el('label', 'optRow');
    testRow.appendChild(el('span', 'optLabel', ''));
    testRow.appendChild(button(T('options.voiceTest'), 'toggle', function () {
      RA.Voice.speak('underAttack', { force: true });
    }, 'voice-test'));
    list.appendChild(testRow);
    if (!RA.Voice.hasChineseVoice()) {
      list.appendChild(el('p', 'hint warn', T('options.voiceMissing')));
    }
    list.appendChild(toggle(T('options.edge'), settings.edgeScroll !== false, function (v) {
      settings.edgeScroll = v;
      opts.onChange(settings);
    }));
    list.appendChild(toggle(T('options.health'), settings.showHealth !== false, function (v) {
      settings.showHealth = v;
      opts.onChange(settings);
    }));
    list.appendChild(toggle(T('options.shake'), settings.shake !== false, function (v) {
      settings.shake = v;
      opts.onChange(settings);
    }));
    list.appendChild(slider(T('options.scroll'), settings.scrollSpeed || 700, 300, 1400, 50, function (v) {
      settings.scrollSpeed = v;
      opts.onChange(settings);
    }));
    panel.appendChild(list);
    var actions = el('div', 'menuButtons row');
    actions.appendChild(button(T('common.back'), 'primary', function () { opts.onBack(); }, 'back'));
    panel.appendChild(actions);
    o.appendChild(panel);
  };

  // ---------------------------------------------------------------------
  // Help
  // ---------------------------------------------------------------------
  Screens.help = function (root, opts) {
    var o = overlay(root, 'help');
    var panel = el('div', 'menuPanel wide');
    panel.appendChild(el('h2', 'screenTitle', T('help.title')));
    var cols = el('div', 'cols');
    var a = el('div', 'col');
    a.appendChild(el('h3', null, T('help.controls')));
    a.appendChild(el('div', 'helpTable', RA.I18n.arr('help.rows').map(function (r) {
      return '<div class="helpRow"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>';
    }).join('')));
    var b = el('div', 'col');
    b.appendChild(el('h3', null, T('help.economy')));
    b.appendChild(el('div', 'helpTable', RA.I18n.arr('help.economyRows').map(function (r) {
      return '<div class="helpRow"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>';
    }).join('')));
    b.appendChild(el('h3', null, T('help.units')));
    var rows = '';
    ['allied', 'soviet'].forEach(function (f) {
      var list = Rules.roster(f);
      rows += '<div class="helpSmall">' + RA.I18n.factionName(f) + ': ' +
        list.infantry.concat(list.vehicles).map(function (d) {
          return RA.I18n.defName(d) + ' ($' + d.cost + ')';
        }).join('、') +
        '</div>';
    });
    b.appendChild(el('div', 'helpTable', rows));
    cols.appendChild(a);
    cols.appendChild(b);
    panel.appendChild(cols);
    var actions = el('div', 'menuButtons row');
    actions.appendChild(button(T('common.back'), 'primary', function () { opts.onBack(); }, 'back'));
    panel.appendChild(actions);
    o.appendChild(panel);
  };

  Screens.about = function (root, opts) {
    var o = overlay(root, 'about');
    var panel = el('div', 'menuPanel');
    panel.appendChild(el('h2', 'screenTitle', 'ABOUT'));
    panel.appendChild(el('div', 'aboutBody', RA.I18n.arr('about.rows').join('')));
    var actions = el('div', 'menuButtons row');
    actions.appendChild(button(T('common.back'), 'primary', function () { opts.onBack(); }, 'back'));
    panel.appendChild(actions);
    o.appendChild(panel);
  };

  // ---------------------------------------------------------------------
  // Pause & results
  // ---------------------------------------------------------------------
  Screens.pause = function (root, opts) {
    var o = overlay(root, 'pause');
    var panel = el('div', 'menuPanel');
    panel.appendChild(el('h2', 'screenTitle', T('common.paused')));
    var menu = el('div', 'menuButtons');
    menu.appendChild(button(T('common.resume'), 'primary', function () { opts.onResume(); }, 'resume'));
    menu.appendChild(button(T('menu.options'), '', function () { opts.onOptions(); }, 'options'));
    menu.appendChild(button(T('common.restart'), '', function () { opts.onRestart(); }, 'restart'));
    menu.appendChild(button(T('common.quit'), '', function () { opts.onQuit(); }, 'quit'));
    panel.appendChild(menu);
    o.appendChild(panel);
  };

  Screens.results = function (root, result, opts) {
    var o = overlay(root, 'results ' + (result.win ? 'win' : 'lose'));
    var panel = el('div', 'menuPanel wide');
    panel.appendChild(el('h2', 'screenTitle', result.win ? T('common.win') : T('common.lose')));
    var st = result.stats;
    var grid = el('div', 'statGrid');
    var rows = [
      [T('results.time'), U.formatTime(result.ticks, Rules.TICKS_PER_SEC)],
      [T('results.unitsBuilt'), st.unitsBuilt],
      [T('results.unitsLost'), st.unitsLost],
      [T('results.kills'), st.kills],
      [T('results.buildingsBuilt'), st.buildingsBuilt],
      [T('results.structuresLost'), st.structuresLost],
      [T('results.ore'), U.formatMoney(st.oreHarvested)],
      [T('results.credits'), U.formatMoney(st.creditsEarned)],
      [T('results.peak'), st.peakArmy]
    ];
    rows.forEach(function (r) {
      grid.appendChild(el('div', 'statKey', r[0]));
      grid.appendChild(el('div', 'statVal', String(r[1])));
    });
    panel.appendChild(grid);
    if (result.shareUrl) {
      var share = el('div', 'shareBox');
      share.appendChild(el('span', null, T('results.share')));
      var input = el('input', 'shareInput');
      input.value = result.shareUrl;
      input.readOnly = true;
      input.addEventListener('click', function () { input.select(); });
      share.appendChild(input);
      panel.appendChild(share);
    }
    var menu = el('div', 'menuButtons row');
    menu.appendChild(button(T('common.menu'), '', function () { opts.onMenu(); }, 'menu'));
    menu.appendChild(button(T('common.rematch'), 'primary', function () { opts.onRestart(); }, 'rematch'));
    panel.appendChild(menu);
    o.appendChild(panel);
  };

  Screens.loading = function (root, text) {
    var o = overlay(root, 'loading');
    var panel = el('div', 'menuPanel small');
    panel.appendChild(el('h2', 'screenTitle', T('skirmish.battlefield') + '...'));
    panel.appendChild(el('p', 'hint', text || ''));
    o.appendChild(panel);
  };
})(globalThis.RA = globalThis.RA || {});
