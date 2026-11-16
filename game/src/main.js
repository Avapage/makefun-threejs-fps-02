// main.js — Yardline's match brain: boot, input, the fixed-step simulation,
// the round state machine (buy → live → planted → end), the economy, the
// team director that gives the bots their plans, and the render loop.

import * as THREE from 'three';
import { WEAPONS, BUY_ITEMS, RULES } from './config.js';
import { buildWorld, SITES, NAV } from './world.js';
import { Bot, Player, buildHumanoid, poseHumanoid, botName } from './actors.js';
import { FX, fireWeapon, startReload, finishReloads, Grenade, ViewModel } from './combat.js';
import * as HUD from './hud.js';
import { initAudio, SFX } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);
buildWorld(scene);

const bombMesh = new THREE.Group();
{
  const boxM = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5 }));
  boxM.position.y = 0.12;
  const lampM = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2 }));
  lampM.position.set(0.12, 0.27, 0);
  bombMesh.add(boxM, lampM);
  bombMesh.visible = false;
  bombMesh.userData.lamp = lampM;
  scene.add(bombMesh);
}

// ---------- game state ----------
const game = {
  scene, camera, fx: new FX(scene),
  actors: [], player: null, noise: [], grenades: [],
  phase: 'menu', phaseT: 0, roundT: 0, round: 0,
  score: { us: 0, them: 0 },
  time: 0, attackSite: 'A', carrier: null,
  bomb: { planted: false, site: null, x: 0, z: 0, t: 0, beepT: 0 },
  plantProgress: 0, defuseProgress: 0, defuseChannel: false,
  intel: null, directorT: 0, over: false,
};
window.__game = game;

const player = new Player();
player.money = RULES.startMoney;
player.primary = null;
game.player = player;
game.actors.push(player);

const botsUs = [], botsThem = [];
for (let i = 0; i < 4; i++) { const b = new Bot('us', botName('us', i), 0.45 + Math.random() * 0.3); botsUs.push(b); game.actors.push(b); }
for (let i = 0; i < 5; i++) { const b = new Bot('them', botName('them', i), 0.4 + Math.random() * 0.35); botsThem.push(b); game.actors.push(b); }
for (const a of game.actors) {
  if (a.isPlayer) continue;
  a.group = buildHumanoid(a.team);
  scene.add(a.group);
  a.money = RULES.startMoney;
  a.primary = null;
}

// ---------- damage & kills ----------
game.damage = (victim, dmg, attacker, part) => {
  if (!victim.alive || game.phase !== 'live') return;
  let mult = 1;
  if (victim.armor) mult = part === 'head' ? 0.75 : 0.45;
  dmg = Math.max(1, Math.round(dmg * mult));
  victim.hp -= dmg;
  if (victim.isPlayer) { HUD.hurtFlash(); SFX.hurt(); shake(0.12); }
  if (attacker && attacker.isPlayer && victim.alive) { SFX.hit(part === 'head'); HUD.hitmarker(false); }
  if (victim.hp <= 0) game.kill(victim, attacker, part);
};

game.kill = (victim, attacker, part) => {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.reloading = false;
  if (victim.group) poseHumanoid(victim, 0);
  if (attacker && attacker !== victim) {
    attacker.kills++;
    attacker.money = Math.min(RULES.maxMoney, attacker.money + RULES.killReward);
    if (attacker.isPlayer) { SFX.kill(); HUD.hitmarker(true); }
  }
  HUD.addFeed(attacker || victim, victim, part === 'head');
  if (victim === game.carrier) {
    // the charge passes to the nearest living Ravager
    let best = null, bd = Infinity;
    for (const b of botsThem) if (b.alive) { const d = b.pos.distanceTo(victim.pos); if (d < bd) { bd = d; best = b; } }
    game.carrier = best;
    if (best) { best.role = 'carrier'; assignAttackerPlan(best); }
  }
  if (victim.isPlayer) onPlayerDeath();
  HUD.setScore(game.score, game.actors);
};

// ---------- economy ----------
function autoBuy(bot) {
  if (!bot.primary && bot.money >= WEAPONS.longbow.price) { bot.money -= WEAPONS.longbow.price; bot.primary = 'longbow'; }
  else if (!bot.primary && bot.money >= WEAPONS.kestrel.price && game.round > 1) { bot.money -= WEAPONS.kestrel.price; bot.primary = 'kestrel'; }
  else if (!bot.primary && bot.money >= WEAPONS.boomstick.price && game.round > 2 && Math.random() < 0.25) { bot.money -= WEAPONS.boomstick.price; bot.primary = 'boomstick'; }
  if (!bot.armor && bot.money >= 650 && Math.random() < 0.85) { bot.money -= 650; bot.armor = true; }
  bot.weapon = bot.primary || 'p9';
  if (bot._lastWeapon !== bot.weapon) { bot.giveWeapon(bot.weapon); bot._lastWeapon = bot.weapon; }
}

function playerBuy(item) {
  const price = item.kind === 'weapon' ? WEAPONS[item.key].price : item.price;
  if (player.money < price) { SFX.denied(); return; }
  if (item.kind === 'weapon') {
    if (player.primary === item.key) return;
    player.money -= price;
    player.primary = item.key;
    player.giveWeapon(item.key);
    viewModel.build(item.key);
  } else if (item.key === 'armor') {
    if (player.armor) return;
    player.money -= price; player.armor = true;
  } else if (item.key === 'grenade') {
    if (player.grenades >= 2) return;
    player.money -= price; player.grenades++;
  }
  SFX.buy();
  HUD.renderBuyMenu(player, playerBuy);
  HUD.setVitals(player);
  HUD.setWeapon(player);
}

// ---------- round flow ----------
const US_SPAWNS = [[-34, -4], [-34, 4], [-35.5, -9], [-35.5, 9]];
const THEM_SPAWNS = [[34, -8], [34, -4], [34, 0], [34, 4], [34, 8]];

function place(a, x, z, yaw) {
  a.pos.set(x, 0, z);
  a.vel.set(0, 0, 0);
  a.yaw = yaw; a.pitch = 0;
  a.hp = 100; a.alive = true;
  a.reloading = false; a.nextShotAt = 0; a.speed2d = 0;
  a.crouching = false;
  if (a.group) { a.group.rotation.set(0, yaw, 0); poseHumanoid(a, 0); }
}

function startRound() {
  game.round++;
  game.phase = 'buy';
  game.phaseT = RULES.buySeconds;
  game.roundT = RULES.roundSeconds;
  game.bomb.planted = false;
  game.plantProgress = 0; game.defuseProgress = 0;
  game.intel = null;
  bombMesh.visible = false;
  game.grenades.forEach((g) => { g.alive = false; g.mesh.visible = false; });
  game.grenades.length = 0;
  game.attackSite = Math.random() < 0.5 ? 'A' : 'B';
  HUD.clearFeed();
  HUD.hideBanner();

  // the dead lose their kit; survivors keep theirs
  for (const a of game.actors) {
    if (a._diedLastRound) { a.primary = null; a.armor = false; a.grenades = 0; a._diedLastRound = false; }
  }
  place(player, -33, 0, -Math.PI / 2);
  player.weapon = player.primary || 'p9';
  player.mag = player._magCache?.[player.weapon] ?? WEAPONS[player.weapon].mag;
  player.reserve = player._resCache?.[player.weapon] ?? WEAPONS[player.weapon].reserve;
  if (!player.primary) { player.mag = WEAPONS.p9.mag; player.reserve = WEAPONS.p9.reserve; }
  player.reloading = false;
  viewModel.build(player.weapon);
  player.scoped = false;

  botsUs.forEach((b, i) => {
    place(b, US_SPAWNS[i][0], US_SPAWNS[i][1], -Math.PI / 2);
    b.path = []; b.mode = 'hold'; b.target = null; b.lastSeen = null;
    autoBuy(b);
  });
  botsThem.forEach((b, i) => {
    place(b, THEM_SPAWNS[i][0], THEM_SPAWNS[i][1], Math.PI / 2);
    b.path = []; b.mode = 'hold'; b.target = null; b.lastSeen = null;
    b.role = 'rifle';
    autoBuy(b);
  });
  game.carrier = botsThem[0];
  game.carrier.role = 'carrier';

  HUD.setScore(game.score, game.actors);
  HUD.setVitals(player);
  HUD.setWeapon(player);
  HUD.renderBuyMenu(player, playerBuy);
  HUD.showBuyMenu(true);
  buyOpen = true;
  document.exitPointerLock?.();
  HUD.banner(`Round ${game.round}`, 'Buy phase — the Ravagers will hit Site A or Site B. Spend well.', '');
  setTimeout(() => { if (game.phase === 'buy') HUD.hideBanner(); }, 2600);
}

function assignDefenderPlans() {
  const A = game.attackSite; // defenders do not know; they split 2/2 with set holds
  const holds = [
    { node: 1, yaw: -Math.PI / 2 }, { node: 3, yaw: -Math.PI / 2 },
    { node: 4, yaw: -Math.PI / 2 }, { node: 6, yaw: -Math.PI / 2 },
  ];
  botsUs.forEach((b, i) => {
    if (!b.alive) return;
    b.holdYaw = holds[i].yaw;
    b.setPathTo(holds[i].node, game);
  });
}

function assignAttackerPlan(bot) {
  const site = game.attackSite;
  const centre = site === 'A' ? 1 : 4;
  const door = site === 'A' ? 3 : 6;
  const idx = botsThem.indexOf(bot);
  if (bot.role === 'carrier') { bot.setPathTo(centre, game); return; }
  if (idx === 2) {
    // connector route, node by node
    const chain = site === 'A' ? [25, 16, 15, 13, 17, 19, door] : [25, 16, 15, 14, 18, 22, door];
    bot.path = chain; bot.pathIdx = 0; bot.objective = door; bot.mode = 'advance';
    return;
  }
  if (idx === 4) {
    const chain = site === 'A' ? [25, 16, 15, 13, 17] : [25, 16, 15, 14, 18];
    bot.path = chain; bot.pathIdx = 0; bot.objective = chain[chain.length - 1]; bot.mode = 'advance';
    bot.holdYaw = Math.PI / 2;
    return;
  }
  bot.setPathTo(idx === 3 ? (site === 'A' ? 19 : 22) : door, game);
}

function assignAttackerPlans() { for (const b of botsThem) if (b.alive) assignAttackerPlan(b); }

function startLive() {
  game.phase = 'live';
  HUD.showBuyMenu(false);
  buyOpen = false;
  assignDefenderPlans();
  assignAttackerPlans();
  HUD.hideBanner();
  lockPointer();
}

function endRound(winner, reason) {
  if (game.phase === 'roundEnd' || game.phase === 'matchEnd') return;
  game.phase = 'roundEnd';
  game.phaseT = RULES.endSeconds;
  game.score[winner]++;
  const reward = winner === 'us' ? RULES.winReward : RULES.lossReward;
  const rewardThem = winner === 'them' ? RULES.winReward : RULES.lossReward;
  for (const a of game.actors) {
    a.money = Math.min(RULES.maxMoney, a.money + (a.team === 'us' ? reward : rewardThem));
    a._diedLastRound = !a.alive;
  }
  const titles = {
    elim: winner === 'us' ? 'RAVAGERS ELIMINATED' : 'WARDENS ELIMINATED',
    time: 'TIME EXPIRED',
    bomb: 'CHARGE DETONATED',
    defuse: 'CHARGE DEFUSED',
  };
  HUD.banner(winner === 'us' ? 'ROUND WON' : 'ROUND LOST', titles[reason] || '', winner === 'us' ? 'win' : 'lose');
  if (winner === 'us') SFX.roundWin(); else SFX.roundLose();
  HUD.setScore(game.score, game.actors);
  HUD.setVitals(player);
  document.exitPointerLock?.();
}

function endMatch() {
  game.phase = 'matchEnd';
  game.over = true;
  const won = game.score.us > game.score.them;
  HUD.banner(won ? 'MATCH WON' : 'MATCH LOST', `Final score ${game.score.us} — ${game.score.them}`, won ? 'win' : 'lose');
  const overlay = document.getElementById('overlay');
  overlay.hidden = false;
  overlay.querySelector('h1').innerHTML = won ? 'DEPOT HELD' : 'DEPOT LOST';
  overlay.querySelector('p').textContent = `Final score: Wardens ${game.score.us} — Ravagers ${game.score.them}. You finished with ${player.kills} kills and ${player.deaths} deaths.`;
  document.getElementById('play').textContent = 'Play again';
}

// ---------- director: plans, plant/defuse, rotations ----------
function director(dt) {
  game.directorT -= dt;
  const now = game.time;
  // plant channel
  const c = game.carrier;
  if (!game.bomb.planted && game.phase === 'live' && c && c.alive && c.team === 'them') {
    const site = SITES[game.attackSite];
    const inSite = Math.hypot(c.pos.x - site.x, c.pos.z - site.z) < site.r;
    const spotted = c.visibleEnemies(game, now).length > 0;
    if (inSite && !spotted && c.mode !== 'plant') { c.mode = 'plant'; c.holdYaw = -Math.PI / 2; }
    if (c.mode === 'plant') {
      if (!inSite) { c.mode = 'advance'; game.plantProgress = 0; }
      else {
        game.plantProgress += dt / (RULES.plantMs / 1000);
        if (game.plantProgress >= 1) doPlant(site);
      }
    }
  }
  // defuse channels (bots + player handled in step)
  if (game.bomb.planted && game.phase === 'live') {
    let channeling = game.defuseChannel;
    for (const b of botsUs) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - game.bomb.x, b.pos.z - game.bomb.z);
      if (b.mode === 'defuse') { channeling = true; continue; }
      if (d < 3.2 && !b.target && b.mode === 'hold') { b.dest = { x: game.bomb.x, z: game.bomb.z }; b.path = []; b.mode = 'advance'; }
      if (d < 1.7 && !b.target) { b.mode = 'defuse'; b.dest = null; channeling = true; }
    }
    if (channeling) {
      game.defuseProgress += dt / (RULES.defuseMs / 1000);
      if (game.defuseProgress >= 1) { SFX.defuseDone(); endRound('us', 'defuse'); }
    } else {
      game.defuseProgress = Math.max(0, game.defuseProgress - dt * 0.5);
    }
  }
  if (game.directorT > 0) return;
  game.directorT = 0.4;
  if (game.phase !== 'live') return;

  if (game.bomb.planted) {
    const centre = game.bomb.site === 'A' ? 1 : 4;
    for (const b of botsUs) {
      if (!b.alive || b.mode === 'defuse') continue;
      const dSite = Math.hypot(b.pos.x - game.bomb.x, b.pos.z - game.bomb.z);
      if (dSite > 3 && b.mode !== 'engage') b.setPathTo(centre, game);
    }
    for (const b of botsThem) {
      if (!b.alive) continue;
      const dSite = Math.hypot(b.pos.x - game.bomb.x, b.pos.z - game.bomb.z);
      if (dSite > 9 && b.mode !== 'engage') b.setPathTo(centre, game);
    }
  } else {
    // first contact intel: a defender who sees Ravagers near a site pulls one rotator
    for (const b of botsUs) {
      if (b.alive && b.target) {
        const nearSite = Math.abs(b.pos.x - SITES.A.x) + Math.abs(b.pos.z - SITES.A.z) < Math.abs(b.pos.x - SITES.B.x) + Math.abs(b.pos.z - SITES.B.z) ? 'A' : 'B';
        if (!game.intel) game.intel = { site: nearSite, t: now };
      }
    }
    if (game.intel && now - game.intel.t > 5) {
      const other = game.intel.site === 'A' ? [4, 6] : [1, 3];
      const centre = game.intel.site === 'A' ? 1 : 4;
      for (const b of botsUs) {
        if (!b.alive || b.mode === 'engage') continue;
        const atOther = other.some((n) => Math.hypot(b.pos.x - NAV[n].x, b.pos.z - NAV[n].z) < 4);
        if (atOther) { b.setPathTo(centre, game); game.intel = { site: game.intel.site, t: now + 9999 }; break; }
      }
    }
  }
}

function doPlant(site) {
  game.bomb.planted = true;
  game.bomb.site = game.attackSite;
  game.bomb.x = game.carrier.pos.x;
  game.bomb.z = game.carrier.pos.z;
  game.bomb.t = RULES.bombSeconds;
  game.bomb.beepT = 0;
  game.plantProgress = 0;
  bombMesh.position.set(game.bomb.x, 0, game.bomb.z);
  bombMesh.visible = true;
  for (const b of botsThem) b.money = Math.min(RULES.maxMoney, b.money + RULES.plantBonus);
  game.carrier.mode = 'hold';
  game.carrier.holdYaw = -Math.PI / 2;
  SFX.plant();
  HUD.banner('CHARGE PLANTED', `${site.name} — defuse it or eliminate them all`, 'lose');
  setTimeout(() => HUD.hideBanner(), 2200);
}

// ---------- player death ----------
let deathCamY = 1.62;
function onPlayerDeath() {
  deathCamY = 1.62;
  document.exitPointerLock?.();
  HUD.banner('YOU ARE DOWN', 'Your team fights on — watch the round out', 'lose');
  setTimeout(() => { if (game.phase === 'live') HUD.hideBanner(); }, 2400);
}

// ---------- input ----------
const input = { f: 0, b: 0, l: 0, r: 0, walk: 0, crouch: 0, jump: 0 };
let lookDX = 0, lookDY = 0, triggerHeld = false, triggerPressed = false;
let buyOpen = false, locked = false, shakeT = 0;
function shake(v) { shakeT = Math.max(shakeT, v); }

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (buyOpen && game.phase === 'buy') {
    const n = parseInt(k, 10);
    if (n >= 1 && n <= BUY_ITEMS.length) { playerBuy(BUY_ITEMS[n - 1]); return; }
    if (k === 'b' || k === 'escape') { HUD.showBuyMenu(false); buyOpen = false; lockPointer(); return; }
  }
  switch (k) {
    case 'w': case 'arrowup': input.f = 1; break;
    case 's': case 'arrowdown': input.b = 1; break;
    case 'a': case 'arrowleft': input.l = 1; break;
    case 'd': case 'arrowright': input.r = 1; break;
    case 'shift': input.walk = 1; break;
    case 'control': case 'c': input.crouch = 1; e.preventDefault(); break;
    case ' ': input.jump = 1; e.preventDefault(); break;
    case 'r': if (game.phase === 'live' && player.alive) startReload(game, player, game.time); break;
    case 'b': if (game.phase === 'buy') { buyOpen = true; HUD.showBuyMenu(true); document.exitPointerLock?.(); } break;
    case '1': switchWeapon(player.primary || null, 1); break;
    case '2': switchWeapon('p9', 2); break;
    case '3': case 'g': throwGrenade(); break;
    case 'e': input.defuse = 1; break;
  }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  switch (k) {
    case 'w': case 'arrowup': input.f = 0; break;
    case 's': case 'arrowdown': input.b = 0; break;
    case 'a': case 'arrowleft': input.l = 0; break;
    case 'd': case 'arrowright': input.r = 0; break;
    case 'shift': input.walk = 0; break;
    case 'control': case 'c': input.crouch = 0; break;
    case ' ': input.jump = 0; break;
    case 'e': input.defuse = 0; break;
  }
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  lookDX += e.movementX * 0.0021;
  lookDY += e.movementY * 0.0021;
});
addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) { triggerHeld = true; triggerPressed = true; }
  if (e.button === 2) player.scoped = player.weapon === 'deadeye';
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) triggerHeld = false;
  if (e.button === 2) player.scoped = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; });
function lockPointer() {
  if (SHOT) return;
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* pointer lock is best-effort; the click handler retries on canvas click */ }
}

function switchWeapon(key, slot) {
  if (game.phase !== 'live' || !player.alive) return;
  if (slot === 1 && !key) return;
  if (player.weapon === key) return;
  player._magCache = player._magCache || {};
  player._resCache = player._resCache || {};
  player._magCache[player.weapon] = player.mag;
  player._resCache[player.weapon] = player.reserve;
  player.weapon = key;
  player.mag = player._magCache[key] ?? WEAPONS[key].mag;
  player.reserve = player._resCache[key] ?? WEAPONS[key].reserve;
  player.reloading = false;
  player.scoped = false;
  viewModel.build(key);
  HUD.setWeapon(player);
}
function throwGrenade() {
  if (game.phase !== 'live' || !player.alive || player.grenades <= 0) return;
  if (game.time - (player._lastThrow || -9) < 0.6) return;
  player._lastThrow = game.time;
  player.grenades--;
  const eye = player.eyePos(new THREE.Vector3());
  const dir = player.aimDir(new THREE.Vector3());
  game.grenades.push(new Grenade(scene, eye, dir, 'us', player));
  HUD.setWeapon(player);
}

// ---------- fixed-step simulation ----------
const SIM_DT = 1 / 60;
function step(dt) {
  game.time += dt;
  const now = game.time;
  finishReloads(game, now);
  game.noise = game.noise.filter((n) => now - n.t < 1);

  if (game.phase === 'buy') {
    game.phaseT -= dt;
    HUD.setTimer(game.phaseT, 'buy');
    if (game.phaseT <= 0) startLive();
    return;
  }
  if (game.phase === 'roundEnd') {
    game.phaseT -= dt;
    updateActors(dt, true);
    if (game.phaseT <= 0) {
      if (game.score.us >= RULES.roundsToWin || game.score.them >= RULES.roundsToWin || game.round >= RULES.maxRounds) endMatch();
      else startRound();
    }
    return;
  }
  if (game.phase !== 'live') return;

  // player
  game.defuseChannel = false;
  if (player.alive) {
    player.update(dt, input, lookDX, lookDY);
    const w = WEAPONS[player.weapon];
    const wantFire = w.auto ? triggerHeld : triggerPressed;
    if (wantFire && (locked || SHOT)) {
      const dir = player.aimDir(new THREE.Vector3());
      if (fireWeapon(game, player, dir, now)) {
        viewModel.kick(w.kick);
        player.pitch += w.kick * (0.6 + Math.random() * 0.4);
        player.yaw += (Math.random() - 0.5) * w.kick * 0.5;
        HUD.setWeapon(player);
      }
    }
    // defuse prompt + channel
    if (game.bomb.planted) {
      const d = Math.hypot(player.pos.x - game.bomb.x, player.pos.z - game.bomb.z);
      if (d < 2.3 && input.defuse) {
        game.defuseChannel = true;
        HUD.prompt('Defusing the charge…', game.defuseProgress);
      } else if (d < 2.3) {
        HUD.prompt('Hold E to defuse', game.defuseProgress);
      } else {
        HUD.prompt(null, 0);
      }
    }
  }
  triggerPressed = false;
  lookDX = 0; lookDY = 0;

  updateActors(dt, false);
  director(dt);

  // timers & win checks
  const usAlive = game.actors.some((a) => a.team === 'us' && a.alive);
  const themAlive = game.actors.some((a) => a.team === 'them' && a.alive);
  if (!themAlive && !game.bomb.planted) return endRound('us', 'elim');
  if (!usAlive) return endRound('them', game.bomb.planted ? 'bomb' : 'elim');
  if (game.bomb.planted) {
    game.bomb.t -= dt;
    game.bomb.beepT -= dt;
    const interval = game.bomb.t < 10 ? 0.28 : game.bomb.t < 25 ? 0.55 : 0.9;
    if (game.bomb.beepT <= 0) { game.bomb.beepT = interval; SFX.beep(game.bomb.t < 5); bombMesh.userData.lamp.material.emissiveIntensity = 3; }
    bombMesh.userData.lamp.material.emissiveIntensity = Math.max(0.4, bombMesh.userData.lamp.material.emissiveIntensity - dt * 6);
    HUD.setTimer(game.bomb.t, 'bomb');
    if (game.bomb.t <= 0) {
      SFX.explosion();
      game.fx.burst(bombMesh.position, 0xff9a3c, 30, 7);
      shake(0.7);
      bombMesh.visible = false;
      return endRound('them', 'bomb');
    }
  } else {
    game.roundT -= dt;
    HUD.setTimer(game.roundT, 'live');
    if (game.roundT <= 0) return endRound('us', 'time');
  }
  HUD.setVitals(player);
  HUD.setWeapon(player);
  HUD.setScore(game.score, game.actors);
  HUD.setCrosshairSpread(player.speed2d > 0.6 || game.time - player.lastShotAt < 0.25);
}

function updateActors(dt, frozen) {
  for (const a of game.actors) {
    if (a.isPlayer) continue;
    if (!frozen) a.update(game, dt, game.time);
    else if (a.group) poseHumanoid(a, a.walkPhase || 0);
  }
  for (const g of game.grenades) g.update(game, dt);
}

// ---------- view model & camera ----------
const viewModel = new ViewModel(camera);

// ---------- boot / menu / shot modes ----------
HUD.initHUD();
const overlay = document.getElementById('overlay');
document.getElementById('how').addEventListener('click', () => {
  const k = document.getElementById('keys-list');
  k.hidden = !k.hidden;
});
document.getElementById('play').addEventListener('click', () => {
  initAudio();
  overlay.hidden = true;
  HUD.showHUD(true);
  if (game.over) { game.score.us = 0; game.score.them = 0; game.round = 0; game.over = false; for (const a of game.actors) { a.money = RULES.startMoney; a.primary = null; a.armor = false; a.grenades = 0; a.kills = 0; a.deaths = 0; } }
  startRound();
});
renderer.domElement.addEventListener('click', () => {
  if ((game.phase === 'live') && !buyOpen && !locked) lockPointer();
});

function setupShot(kind) {
  if (kind === 'menu') {
    // the real title screen: overlay visible over the orbiting map view
    HUD.showHUD(false);
    game.frozen = false;
    return;
  }
  overlay.hidden = true;
  HUD.showHUD(true);
  game.score.us = 3; game.score.them = 2;
  startRound();
  startLive();
  if (kind === 'play') {
    player.giveWeapon('longbow'); player.primary = 'longbow'; player.weapon = 'longbow';
    viewModel.build('longbow');
    player.money = 3400; player.hp = 82; player.mag = 24;
    // east yard lane, looking west toward the mid gate with a Ravager in the open
    place(player, 21, -4.5, Math.PI / 2 + 0.18);
    player.pitch = 0.01;
    const foe = botsThem[0];
    place(foe, 9, -2.5, -Math.PI / 2);
    foe.mode = 'hold';
    place(botsThem[1], 14, -14, Math.PI / 2);
    place(botsUs[0], 15, 3.5, Math.PI / 2);
    HUD.addFeed(botsUs[0], botsThem[4], false);
    HUD.addFeed(player, botsThem[3], true);
    botsThem[4].alive = false; botsThem[3].alive = false;
    poseHumanoid(botsThem[4], 0); poseHumanoid(botsThem[3], 0);
  } else if (kind === 'buy') {
    game.phase = 'buy'; game.phaseT = 9;
    player.money = 4750;
    HUD.renderBuyMenu(player, playerBuy);
    HUD.showBuyMenu(true);
    place(player, -33, 0, -Math.PI / 2);
  } else if (kind === 'bomb') {
    game.attackSite = 'A';
    doPlant(SITES.A);
    game.bomb.t = 23;
    bombMesh.position.set(-19, 0, -15.5);
    game.bomb.x = -19; game.bomb.z = -15.5;
    place(player, -16.4, -13.4, Math.PI * 0.78);
    player.hp = 64;
    const foe = botsThem[1];
    place(foe, -13.5, -19.5, Math.PI * 0.8);
    foe.mode = 'hold';
    game.defuseProgress = 0.45;
    HUD.prompt('Defusing the charge…', 0.45);
  }
  HUD.setScore(game.score, game.actors);
  HUD.setVitals(player);
  HUD.setWeapon(player);
  game.frozen = true;
}

// ---------- main loop ----------
let last = performance.now(), acc = 0, frames = 0;
function loop(t) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  if (!game.frozen) {
    acc += dt;
    while (acc >= SIM_DT) { step(SIM_DT); acc -= SIM_DT; }
  }
  game.fx.update(dt);
  // camera
  if (game.phase === 'menu' || SHOT === 'menu') {
    viewModel.group.visible = false;
    const a = t * 0.00004;
    camera.position.set(Math.cos(a) * 30, 17, Math.sin(a) * 30);
    camera.lookAt(-6, 0, 0);
    camera.fov = 60; camera.updateProjectionMatrix();
  } else if (player.alive) {
    const eye = player.eyeHeight();
    camera.position.set(player.pos.x, player.pos.y + eye + Math.sin(player.bobPhase) * 0.028 * Math.min(1, player.speed2d / 4), player.pos.z);
    shakeT = Math.max(0, shakeT - dt * 1.4);
    camera.rotation.set(player.pitch + (Math.random() - 0.5) * shakeT * 0.05, player.yaw + (Math.random() - 0.5) * shakeT * 0.05, 0);
    const targetFov = player.scoped ? 26 : 72;
    if (Math.abs(camera.fov - targetFov) > 0.5) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
    viewModel.group.visible = !player.scoped;
    viewModel.update(dt, player.speed2d, player.reloading);
  } else {
    deathCamY = Math.max(0.45, deathCamY - dt * 1.6);
    camera.position.set(player.pos.x, player.pos.y + deathCamY, player.pos.z);
    camera.rotation.set(-0.25, player.yaw, 0.35);
    viewModel.group.visible = false;
  }
  renderer.render(scene, camera);
  frames++;
  if (frames === 40) window.__shotReady = true;
}

if (SHOT) setupShot(SHOT);
requestAnimationFrame(loop);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
