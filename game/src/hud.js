// hud.js — every DOM readout in one place: vitals, ammo, top bar, kill feed,
// banners, interaction prompts and the buy menu. No game logic lives here.

import { WEAPONS, BUY_ITEMS } from './config.js';

const $ = (id) => document.getElementById(id);
const els = {};
let feedTimers = [];

export function initHUD() {
  for (const id of ['hud', 'health', 'armor', 'healthbar', 'money', 'weapon-name', 'ammo', 'ammo-mag', 'ammo-reserve',
    'slots', 'timer', 'rounds-us', 'rounds-them', 'alive-us', 'alive-them', 'feed', 'banner', 'prompt',
    'prompt-text', 'hitmarker', 'crosshair', 'damage-vignette', 'buy', 'buy-grid', 'buy-cash']) {
    els[id] = $(id);
  }
  els.healthbarFill = els.healthbar.querySelector('i');
  els.bannerTitle = els.banner.querySelector('h2');
  els.bannerSub = els.banner.querySelector('p');
  els.promptBar = els.prompt.querySelector('.bar i');
}

export function showHUD(show) { els.hud.hidden = !show; }

export function setVitals(player) {
  els.health.textContent = Math.max(0, Math.ceil(player.hp));
  els.health.classList.toggle('low', player.hp <= 30);
  els.healthbarFill.style.width = `${Math.max(0, player.hp)}%`;
  els.healthbarFill.style.background = player.hp <= 30 ? 'var(--foe)' : 'var(--good)';
  els.armor.textContent = player.armor ? '▣ KEVLAR' : '';
  els.money.textContent = `$${player.money}`;
}

export function setWeapon(player) {
  const w = WEAPONS[player.weapon];
  els['weapon-name'].textContent = w.name;
  els['ammo-mag'].textContent = player.reloading ? '--' : player.mag;
  els['ammo-reserve'].textContent = `/ ${player.reserve}`;
  els.ammo.classList.toggle('empty', player.mag === 0 && !player.reloading);
  const parts = [];
  parts.push(`<span>1 <b>${player.primary ? WEAPONS[player.primary].name.split(' ')[0] : '—'}</b></span>`);
  parts.push(`<span>2 <b>P9</b></span>`);
  parts.push(`<span>3 <b>${player.grenades > 0 ? `Frag ×${player.grenades}` : '—'}</b></span>`);
  els.slots.innerHTML = parts.join('');
}

export function setTimer(seconds, mode) {
  const s = Math.max(0, Math.ceil(seconds));
  els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  els.timer.className = mode === 'bomb' ? 'bomb' : (s <= 10 && mode === 'live' ? 'low' : '');
}

export function setScore(score, actors) {
  els['rounds-us'].textContent = score.us;
  els['rounds-them'].textContent = score.them;
  const pips = (team) => actors.filter((a) => a.team === team)
    .map((a) => `<i class="${a.alive ? '' : 'dead'}"></i>`).join('');
  els['alive-us'].innerHTML = pips('us');
  els['alive-them'].innerHTML = pips('them');
}

export function addFeed(killer, victim, headshot) {
  const div = document.createElement('div');
  div.innerHTML = `<span class="${killer.team}">${killer.name}</span> ▸ ${headshot ? '⌖ ' : ''}<span class="${victim.team}">${victim.name}</span>`;
  els.feed.prepend(div);
  while (els.feed.children.length > 5) els.feed.lastChild.remove();
  const timer = setTimeout(() => { div.style.opacity = '0.35'; }, 4200);
  feedTimers.push(timer);
}

export function clearFeed() { els.feed.innerHTML = ''; feedTimers.forEach(clearTimeout); feedTimers = []; }

export function banner(title, sub, kind) {
  els.banner.hidden = false;
  els.banner.className = kind || '';
  els.bannerTitle.textContent = title;
  els.bannerSub.textContent = sub || '';
}
export function hideBanner() { els.banner.hidden = true; }

export function prompt(text, frac) {
  if (text == null) { els.prompt.hidden = true; return; }
  els.prompt.hidden = false;
  els['prompt-text'].textContent = text;
  els.promptBar.style.width = `${Math.round((frac || 0) * 100)}%`;
}

export function hitmarker(kill) {
  els.hitmarker.classList.add('on');
  els.hitmarker.classList.toggle('kill', !!kill);
  clearTimeout(els.hitmarker._t);
  els.hitmarker._t = setTimeout(() => els.hitmarker.classList.remove('on'), 110);
}

export function hurtFlash() {
  els['damage-vignette'].style.opacity = '1';
  clearTimeout(els['damage-vignette']._t);
  els['damage-vignette']._t = setTimeout(() => { els['damage-vignette'].style.opacity = '0'; }, 130);
}

export function setCrosshairSpread(spread) {
  els.crosshair.classList.toggle('spread', !!spread);
}

// ---- Buy menu ----
export function renderBuyMenu(player, onBuy) {
  els['buy-cash'].textContent = `$${player.money}`;
  els['buy-grid'].innerHTML = '';
  BUY_ITEMS.forEach((item, i) => {
    const price = item.kind === 'weapon' ? WEAPONS[item.key].price : item.price;
    const owned = item.kind === 'weapon' ? player.primary === item.key : (item.key === 'armor' ? player.armor : player.grenades >= 2);
    const btn = document.createElement('button');
    btn.className = 'buy-item';
    btn.disabled = owned || player.money < price;
    btn.innerHTML = `<span><span class="key">${i + 1}</span><span class="nm">${item.label}</span><span class="ds">${owned ? 'Owned' : item.desc}</span></span><span class="pr">$${price}</span>`;
    btn.addEventListener('click', () => onBuy(item));
    els['buy-grid'].appendChild(btn);
  });
}
export function showBuyMenu(show) { els.buy.hidden = !show; }
