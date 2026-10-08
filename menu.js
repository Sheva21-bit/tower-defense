/*
 * menu.js — main menu + navigation (title, Play / faction pick, Settings, How to Play).
 * Standalone: needs only config.js (for faction names/colours). Never touches game.js internals.
 *
 * Contract with the game (see MENU.md):
 *   - Start:  if window.Game.start exists, the menu calls Game.start({ side, enemy, auto, stage }).
 *             Otherwise it falls back to reloading index.html with ?side=…&auto=1&play=1.
 *   - Back:   the game calls Menu.show() (optionally Menu.show('settings')) to return to the menu.
 *   - Skip:   ?play=1 or ?nomenu=1 in the URL starts straight into the game (no menu).
 *
 * Text lives in MENU_TEXT below so story copy can be swapped in without touching the logic.
 * Art is optional: any missing image falls back to a plain styled placeholder.
 */
(function () {
  'use strict';
  const C = typeof CONFIG !== 'undefined' ? CONFIG : { FACTIONS: {}, PLAYER_FACTION: 'valkyrie', ENEMY_FACTION: 'deva' };

  // ---- Editable copy (story/title text can replace these) ----
  const MENU_TEXT = {
    title: C.GAME_TITLE || 'Tower Defense',
    subtitle: 'Prototype',
    tagline: 'The Crown of Dawn is breaking. Valkyrie or Deva, hold the line.',
    howTo: [
      { h: 'The war', p: 'The Crown of Dawn holds back the dark beneath the world, and it is cracking. The Valkyries swore to guard it. The Deva, the angels who made it, have come to take it back. Their squads meet on a single lane between two towers.' },
      { h: 'Goal', p: 'Destroy the enemy tower before they destroy yours. Units walk the lane and fight whatever they meet.' },
      { h: 'Spawning', p: 'Each unit costs action points (AP). You start with 3 AP and gain 1 every second. Desktop: keys 1–9 or click a portrait. Phone: tap a portrait.' },
      { h: 'Rarity', p: 'Common (1 star), SR (2 stars) and SSR (3 stars). Only 3 Commons can be alive at once per side.' },
      { h: 'Classes', p: 'Strikers (sword) hit hard up close, Defenders (shield) soak damage, Rangers (bow) attack from range.' },
      { h: 'Abilities', p: 'SR and SSR units have an ability. When a unit shows the cyan spark, click or tap it to cast (Shift+1–9 on desktop). Turn on Auto in Settings to cast automatically.' },
      { h: 'Unit info', p: 'Right-click a portrait (desktop) or press and hold it (phone) to read a unit\'s stats and ability.' },
      { h: 'Other keys', p: 'A auto-cast · N damage numbers · F swap sides · R restart · G debug grid.' },
    ],
  };

  // Face art per faction for the side-pick cards (falls back to a lettered swatch if missing).
  const FACTION_ART = {
    valkyrie: 'assets/portraits/valkyrie_dia_bust.png',
    deva: 'assets/portraits/deva_raven_bust.png',
    elf: 'assets/portraits/elf_striker_bust.png',
    darkelf: 'assets/portraits/darkelf_striker_bust.png',
  };
  const TITLE_ART = { left: FACTION_ART.valkyrie, right: FACTION_ART.deva, bg: 'assets/bg_stage1.png' };
  const STAGES = [{ id: 1, name: 'Stage 1', desc: 'The first lane.' }]; // campaign stages drop in here later

  // ---- Saved preferences (localStorage; the damage-numbers key is shared with game.js) ----
  const KEYS = { side: 'td.menu.side', auto: 'td.autoCast', nums: 'td.showDamageNumbers', sound: 'td.sound' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* storage blocked: session only */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const params = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); } })();
  // Playable sides in the menu (other factions stay defined in config.js for later).
  const PLAYABLE = ['valkyrie', 'deva'];
  const factionIds = PLAYABLE.filter((id) => C.FACTIONS && C.FACTIONS[id]);
  const validSide = (s) => factionIds.includes(s);
  const prefs = {
    side: validSide(params.get('side')) ? params.get('side') : (validSide(store.get(KEYS.side)) ? store.get(KEYS.side) : C.PLAYER_FACTION),
    auto: params.has('auto') ? params.get('auto') === '1' : store.get(KEYS.auto, '0') === '1',
    nums: store.get(KEYS.nums, C.SHOW_DAMAGE_NUMBERS === false ? '0' : '1') === '1',
    sound: store.get(KEYS.sound, '1') === '1',
    stage: 1,
  };
  /** Who the player fights for a given side, matching game.js's ?side= rule (swap if you pick the enemy). */
  function opponentOf(side) {
    return side === C.ENEMY_FACTION ? C.PLAYER_FACTION : C.ENEMY_FACTION;
  }

  // ---- DOM helpers (all text goes through textContent; no innerHTML with data) ----
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === 'style') Object.assign(n.style, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  function img(src, cls, fallback) {
    const i = el('img', { src, class: cls, alt: '', draggable: 'false' });
    i.addEventListener('error', () => { if (fallback) i.replaceWith(fallback()); else i.remove(); }, { once: true });
    return i;
  }
  const btn = (label, onClick, extra) => el('button', Object.assign({ type: 'button', class: 'tdm-btn', on: { click: onClick } }, extra || {}), label);

  // ---- Screens ----
  let root, panel, current = null;
  const stack = [];   // navigation history (title is always at the bottom)
  const screens = {
    title() {
      return el('div', { class: 'tdm-screen tdm-title' },
        el('h1', { class: 'tdm-logo' }, MENU_TEXT.title, el('small', null, MENU_TEXT.subtitle)),
        el('p', { class: 'tdm-tagline' }, MENU_TEXT.tagline),
        el('div', { class: 'tdm-col' },
          paused ? btn('Resume', resume, { class: 'tdm-btn primary', 'data-autofocus': '' }) : null,
          btn(paused ? 'New battle' : 'Play', () => go('play'), paused ? null : { class: 'tdm-btn primary', 'data-autofocus': '' }),
          btn('How to Play', () => go('howto')),
          btn('Settings', () => go('settings'))));
    },
    play() {
      const vs = el('p', { class: 'tdm-vs' });
      const cards = el('div', { class: 'tdm-cards', role: 'radiogroup', 'aria-label': 'Choose your side' });
      const refresh = () => {
        for (const c of cards.children) {
          const on = c.dataset.side === prefs.side;
          c.classList.toggle('selected', on);
          c.setAttribute('aria-checked', on ? 'true' : 'false');
          c.tabIndex = on ? 0 : -1;
        }
        vs.textContent = `You: ${fname(prefs.side)}  vs  ${fname(opponentOf(prefs.side))}`;
      };
      for (const id of factionIds) {
        const f = C.FACTIONS[id];
        const swatch = () => el('span', { class: 'tdm-face ph', style: { background: f.colors ? f.colors[0] : '#334' } }, f.name.charAt(0));
        cards.append(el('button', {
          type: 'button', class: 'tdm-card', role: 'radio', 'data-side': id,
          style: { '--f1': (f.colors || [])[0] || '#334', '--f2': (f.colors || [])[1] || '#556' },
          on: { click: () => { prefs.side = id; store.set(KEYS.side, id); refresh(); },
                dblclick: () => startGame() },
        }, FACTION_ART[id] ? img(FACTION_ART[id], 'tdm-face', swatch) : swatch(), el('span', { class: 'tdm-fname' }, f.name)));
      }
      // Arrow keys move between faction cards (radio-group behaviour).
      cards.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        const i = (factionIds.indexOf(prefs.side) + d + factionIds.length) % factionIds.length;
        prefs.side = factionIds[i]; store.set(KEYS.side, prefs.side); refresh();
        cards.children[i].focus();
      });
      refresh();
      const stageSel = STAGES.length > 1 ? el('label', { class: 'tdm-row' }, 'Stage ',
        el('select', { on: { change: (e) => { prefs.stage = +e.target.value; } } },
          STAGES.map((s) => el('option', { value: s.id, selected: s.id === prefs.stage }, s.name)))) : null;
      return el('div', { class: 'tdm-screen' },
        el('h2', null, 'Choose your side'), cards, vs, stageSel,
        toggle('Auto-cast abilities', 'auto', 'Your units cast their abilities on their own.'),
        el('div', { class: 'tdm-row tdm-actions' },
          btn('Back', back),
          btn('Start battle', startGame, { class: 'tdm-btn primary', 'data-autofocus': '' })));
    },
    settings() {
      return el('div', { class: 'tdm-screen' },
        el('h2', null, 'Settings'),
        toggle('Auto-cast abilities', 'auto', 'Default for new battles. Toggle in-game with A or the AUTO button.'),
        toggle('Damage numbers', 'nums', 'Floating numbers over units that get hit. In-game: N or the 123 button.'),
        toggle('Sound', 'sound', 'No sound in the game yet; this setting is saved for when it arrives.', true),
        el('div', { class: 'tdm-row tdm-actions' },
          btn('Back', back, { 'data-autofocus': '' }),
          btn('Reset settings', resetPrefs, { class: 'tdm-btn danger' })));
    },
    howto() {
      return el('div', { class: 'tdm-screen tdm-howto' },
        el('h2', null, 'How to Play'),
        el('div', { class: 'tdm-scroll', tabindex: '0' },
          MENU_TEXT.howTo.map((s) => el('section', null, el('h3', null, s.h), el('p', null, s.p)))),
        el('div', { class: 'tdm-row tdm-actions' }, btn('Back', back, { 'data-autofocus': '' })));
    },
  };
  const fname = (id) => (C.FACTIONS[id] && C.FACTIONS[id].name) || id;

  function toggle(label, key, hint, disabled) {
    const input = el('input', { type: 'checkbox', role: 'switch', disabled: !!disabled });
    input.checked = !!prefs[key];
    input.addEventListener('change', () => { prefs[key] = input.checked; savePref(key); });
    return el('label', { class: 'tdm-toggle' + (disabled ? ' disabled' : '') },
      input, el('span', { class: 'tdm-switch', 'aria-hidden': 'true' }),
      el('span', { class: 'tdm-tlabel' }, label, hint ? el('small', null, hint) : null));
  }
  function savePref(key) {
    if (key === 'auto') store.set(KEYS.auto, prefs.auto ? '1' : '0');
    if (key === 'nums') {
      store.set(KEYS.nums, prefs.nums ? '1' : '0');
      // Live game already loaded? keep it in sync.
      if (window.TD && typeof window.TD.setShowDamageNumbers === 'function') window.TD.setShowDamageNumbers(prefs.nums);
    }
    if (key === 'sound') store.set(KEYS.sound, prefs.sound ? '1' : '0');
  }
  function resetPrefs() {
    Object.values(KEYS).forEach(store.del);
    prefs.side = C.PLAYER_FACTION; prefs.auto = false; prefs.nums = C.SHOW_DAMAGE_NUMBERS !== false; prefs.sound = true;
    savePref('nums');
    render('settings');
  }

  // ---- Navigation ----
  function render(name) {
    current = name;
    panel.replaceChildren(screens[name]());
    root.dataset.screen = name;
    const f = panel.querySelector('[data-autofocus]') || panel.querySelector('button, input, select');
    if (f) f.focus({ preventScroll: true });
  }
  function go(name) {
    stack.push(current);
    render(name);
    try { history.pushState({ tdMenu: name }, ''); } catch (e) { /* ignore */ }
  }
  function back() {
    if (!stack.length) return;
    // Let the browser's history drive it so phone back buttons and our Back stay in step.
    try { if (history.state && history.state.tdMenu) { history.back(); return; } } catch (e) { /* ignore */ }
    render(stack.pop());
  }
  window.addEventListener('popstate', () => {
    if (!isOpen() || !stack.length) return;
    render(stack.pop());
  });

  function onKey(e) {
    if (!isOpen()) return;
    e.stopPropagation(); // the game's hotkeys (1-9, R, F…) must not fire under the menu
    if (e.key === 'Escape' || (e.key === 'Backspace' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) {
      e.preventDefault();
      if (!stack.length && paused) resume(); else back();
      return;
    }
    // Up/Down move focus through the screen's controls (Tab still works as normal).
    const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (d && !e.target.closest('.tdm-cards, select')) {
      const items = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select')].filter((n) => n.offsetParent);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[(i + d + items.length) % items.length].focus();
    }
  }

  // ---- Start / show / hide ----
  const startHandlers = [];
  function startGame() {
    const opts = { side: prefs.side, enemy: opponentOf(prefs.side), auto: prefs.auto, stage: prefs.stage };
    store.set(KEYS.side, opts.side);
    for (const fn of startHandlers) { try { fn(opts); } catch (e) { console.error('[menu] start handler failed', e); } }
    if (window.Game && typeof window.Game.start === 'function') {
      paused = false;
      hide();
      window.Game.start(opts);
      return;
    }
    // Fallback until the game exposes Game.start: reload the game page with the chosen options.
    const url = new URL(location.href);
    const curSide = url.searchParams.get('side') || C.PLAYER_FACTION;
    const curAuto = url.searchParams.get('auto') === '1';
    if (curSide === opts.side && curAuto === opts.auto && document.getElementById('stage')) { hide(); return; }
    url.searchParams.set('side', opts.side);
    if (opts.auto) url.searchParams.set('auto', '1'); else url.searchParams.delete('auto');
    url.searchParams.set('play', '1');
    if (!document.getElementById('stage')) url.pathname = url.pathname.replace(/[^/]*$/, 'index.html');
    location.assign(url.toString());
  }
  let paused = false;   // true when the menu was opened over a running match (Resume shows on the title)
  function resume() {
    paused = false;
    hide();
    if (window.Game && typeof window.Game.resume === 'function') window.Game.resume();
  }
  function isOpen() { return !!root && !root.hidden; }
  function show(screen) {
    build();
    stack.length = 0;
    paused = !!(window.Game && typeof window.Game.pause === 'function' && window.Game.started);
    if (paused) window.Game.pause();
    root.hidden = false;
    document.documentElement.classList.add('tdm-open');
    render('title');
    if (screen && screen !== 'title' && screens[screen]) go(screen);
  }
  function hide() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove('tdm-open');
    stack.length = 0;
  }

  function build() {
    if (root) return;
    root = el('div', { id: 'td-menu', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Main menu', hidden: true });
    const art = el('div', { class: 'tdm-art', 'aria-hidden': 'true' },
      img(TITLE_ART.bg, 'tdm-bg'), img(TITLE_ART.left, 'tdm-hero left'), img(TITLE_ART.right, 'tdm-hero right'));
    panel = el('div', { class: 'tdm-panel' });
    root.append(art, panel);
    document.body.append(root);
    document.addEventListener('keydown', onKey, true); // capture: runs before the game's key handler
  }

  window.Menu = {
    show, hide, back, resume, go: (s) => { if (!isOpen()) show(s); else go(s); },
    get open() { return isOpen(); },
    get screen() { return current; },
    get prefs() { return Object.assign({}, prefs); },
    onStart(fn) { if (typeof fn === 'function') startHandlers.push(fn); },
    start: startGame,
    text: MENU_TEXT,
    stages: STAGES,
  };

  const skip = params.get('play') === '1' || params.get('nomenu') === '1';
  const boot = () => { if (!skip) show(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
