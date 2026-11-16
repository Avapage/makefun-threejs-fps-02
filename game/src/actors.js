// actors.js — the shared Actor (body, health, weapon state), the low-poly
// humanoid models, the first-person player controller, and the bot brain:
// waypoint pathing, vision/hearing perception, burst-fire engagements,
// site holds, rotations, planting and defusing.

import * as THREE from 'three';
import { PALETTE, WEAPONS } from './config.js';
import { NAV, findPath, nearestNode, collideCircle, hasLOS } from './world.js';
import { fireWeapon, startReload } from './combat.js';
import { SFX } from './audio.js';

let nextId = 1;

export class Actor {
  constructor(team, name) {
    this.id = nextId++;
    this.team = team; // 'us' | 'them'
    this.name = name;
    this.isPlayer = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.armor = false;
    this.alive = true;
    this.crouching = false;
    this.airborne = false;
    this.scoped = false;
    this.speed2d = 0;
    this.weapon = 'p9';
    this.mag = WEAPONS.p9.mag;
    this.reserve = WEAPONS.p9.reserve;
    this.reloading = false;
    this.reloadEndAt = 0;
    this.nextShotAt = 0;
    this.lastShotAt = -99;
    this.kills = 0;
    this.deaths = 0;
    this.money = 0;
    this.grenades = 0;
    this.group = null;
  }
  eyeHeight() { return this.crouching ? 1.18 : 1.62; }
  eyePos(out) { return out.set(this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z); }
  giveWeapon(key) {
    this.weapon = key;
    this.mag = WEAPONS[key].mag;
    this.reserve = WEAPONS[key].reserve;
    this.reloading = false;
  }
}

const _mat = (color, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
const _box = (sx, sy, sz, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

// A stylised soldier: boots, legs, vest torso, head with cap, gun in hand.
// Head is its own mesh so screenshots read the silhouette; hit tests are analytic.
export function buildHumanoid(team) {
  const g = new THREE.Group();
  const main = team === 'us' ? PALETTE.friend : PALETTE.foe;
  const dark = team === 'us' ? PALETTE.friendDark : PALETTE.foeDark;
  const matMain = _mat(main), matDark = _mat(dark), matSkin = _mat(PALETTE.skin), matDarkGear = _mat(PALETTE.dark);
  const legL = _box(0.17, 0.78, 0.2, matDarkGear, -0.13, 0.39, 0);
  const legR = _box(0.17, 0.78, 0.2, matDarkGear, 0.13, 0.39, 0);
  const torso = _box(0.52, 0.62, 0.28, matMain, 0, 1.1, 0);
  const vest = _box(0.56, 0.4, 0.34, matDark, 0, 1.08, 0);
  const armL = _box(0.13, 0.55, 0.15, matDark, -0.34, 1.12, 0.05);
  const armR = _box(0.13, 0.55, 0.15, matDark, 0.34, 1.12, 0.05);
  armL.rotation.x = -0.7; armR.rotation.x = -0.9;
  const head = _box(0.3, 0.3, 0.3, matSkin, 0, 1.6, 0);
  const cap = _box(0.34, 0.09, 0.34, matMain, 0, 1.78, 0);
  const gun = _box(0.07, 0.12, 0.62, matDarkGear, 0.3, 1.18, 0.42);
  g.add(legL, legR, torso, vest, armL, armR, head, cap, gun);
  g.userData.parts = { legL, legR, torso, head, gun };
  return g;
}

export function poseHumanoid(actor, walkPhase) {
  const g = actor.group;
  if (!g) return;
  g.position.copy(actor.pos);
  g.rotation.y = actor.yaw;
  if (!actor.alive) {
    g.rotation.x = -Math.PI / 2 * 0.92;
    g.position.y = actor.pos.y + 0.25;
    return;
  }
  g.rotation.x = 0;
  const p = g.userData.parts;
  const swing = actor.speed2d > 0.3 ? Math.sin(walkPhase) * 0.5 : 0;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  const crouchDip = actor.crouching ? 0.3 : 0;
  p.torso.position.y = 1.1 - crouchDip;
  p.head.position.y = 1.6 - crouchDip;
  g.position.y = actor.pos.y - crouchDip * 0.4;
}

// ---------------- Player ----------------
export class Player extends Actor {
  constructor() {
    super('us', 'You');
    this.isPlayer = true;
    this.vy = 0;
    this.bobPhase = 0;
    this.stepTimer = 0;
  }
  // input: {f, b, l, r, walk, crouch, jump} booleans; lookDX/lookDY in radians.
  update(dt, input, lookDX, lookDY) {
    if (!this.alive) return;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - lookDY));
    this.yaw -= lookDX;
    this.crouching = input.crouch;
    const targetSpeed = this.crouching ? 1.7 : input.walk ? 2.3 : 4.6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = 0, mz = 0;
    if (input.f) { mx -= sin; mz -= cos; }
    if (input.b) { mx += sin; mz += cos; }
    if (input.l) { mx -= cos; mz += sin; }
    if (input.r) { mx += cos; mz -= sin; }
    const len = Math.hypot(mx, mz) || 1;
    mx = (mx / len) * targetSpeed; mz = (mz / len) * targetSpeed;
    const accel = this.airborne ? 1.2 : 10;
    this.vel.x += (mx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (mz - this.vel.z) * Math.min(1, accel * dt);
    if (input.jump && !this.airborne) { this.vy = 4.4; this.airborne = true; }
    if (this.airborne) {
      this.vy -= 12.5 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.airborne = false; }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const [cx, cz] = collideCircle(this.pos.x, this.pos.z, 0.42);
    this.pos.x = cx; this.pos.z = cz;
    this.speed2d = Math.hypot(this.vel.x, this.vel.z);
    this.bobPhase += dt * this.speed2d * 1.9;
    if (this.speed2d > 1 && !this.airborne) {
      this.stepTimer -= dt * this.speed2d;
      if (this.stepTimer <= 0) { this.stepTimer = 2.6; SFX.step(0); }
    }
  }
  aimDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }
}

// ---------------- Bots ----------------
const BOT_NAMES_US = ['Vex', 'Ondo', 'Pell', 'Mara'];
const BOT_NAMES_THEM = ['Rusk', 'Hale', 'Ivo', 'Senn', 'Darga'];
export const botName = (team, i) => (team === 'us' ? BOT_NAMES_US[i] : BOT_NAMES_THEM[i]);

export class Bot extends Actor {
  constructor(team, name, skill) {
    super(team, name);
    this.skill = skill; // 0..1 — reaction, aim, burst discipline
    this.path = [];
    this.pathIdx = 0;
    this.dest = null;         // {x, z} final destination
    this.holdYaw = 0;         // direction to watch while holding
    this.mode = 'advance';    // advance | hold | plant | defuse | engage
    this.target = null;       // visible enemy actor
    this.lastSeen = null;     // {x, z, t}
    this.seenSince = 0;       // how long the current target has been visible
    this.nextThink = Math.random() * 0.15;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.strafeDir = 0;
    this.strafeUntil = 0;
    this.walkPhase = Math.random() * 6;
    this.role = 'rifle';
    this.objective = null;    // node id the bot is heading for
    this.repathAt = 0;
  }

  setPathTo(nodeId, game) {
    const from = nearestNode(this.pos.x, this.pos.z);
    this.path = findPath(from, nodeId);
    this.pathIdx = 0;
    this.objective = nodeId;
    this.mode = 'advance';
  }

  visibleEnemies(game, now) {
    const out = [];
    const eye = this.eyePos(new THREE.Vector3());
    for (const e of game.actors) {
      if (e.team === this.team || !e.alive) continue;
      const d = this.pos.distanceTo(e.pos);
      if (d > 62) continue;
      const chestY = e.pos.y + 1.1;
      if (!hasLOS(eye.x, eye.y, eye.z, e.pos.x, chestY, e.pos.z)) continue;
      // field of view, unless very close or the enemy just fired
      const ang = Math.abs(angleDiff(this.yaw, Math.atan2(-(e.pos.x - this.pos.x), -(e.pos.z - this.pos.z))));
      const heard = now - e.lastShotAt < 0.5 && d < 30;
      if (ang < 1.85 || d < 7 || heard) out.push({ e, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  think(game, now) {
    const vis = this.visibleEnemies(game, now);
    if (vis.length) {
      const { e } = vis[0];
      if (this.target !== e) { this.target = e; this.seenSince = 0; }
      this.lastSeen = { x: e.pos.x, z: e.pos.z, t: now };
    } else if (this.target && now - (this.lastSeen?.t ?? -99) > 2.2) {
      this.target = null;
    }
    // noise: fresh enemy gunfire pulls attention (and defenders start rotating)
    for (const n of game.noise) {
      if (n.team !== this.team && now - n.t < 0.6) {
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        if (d < n.r && !this.target) this.lastSeen = { x: n.x, z: n.z, t: now };
      }
    }
    if (this.mode !== 'plant' && this.mode !== 'defuse') {
      if (this.target) this.mode = 'engage';
      else if (this.mode === 'engage') this.mode = this.path.length ? 'advance' : 'hold';
    }
  }

  update(game, dt, now) {
    if (!this.alive) return;
    this.walkPhase += dt * this.speed2d * 1.9;
    if (now >= this.nextThink) {
      this.nextThink = now + 0.12;
      this.think(game, now);
    }
    let moveX = 0, moveZ = 0, speed = 4.35;
    let wantYaw = this.yaw;

    if (this.mode === 'engage' && (this.target || this.lastSeen)) {
      const tx = this.target ? this.target.pos.x : this.lastSeen.x;
      const tz = this.target ? this.target.pos.z : this.lastSeen.z;
      wantYaw = Math.atan2(-(tx - this.pos.x), -(tz - this.pos.z));
      const dist = Math.hypot(tx - this.pos.x, tz - this.pos.z);
      if (this.target) {
        this.seenSince += dt;
        this.combat(game, now, dist);
        // close the distance on a stale duel; strafe while the fight is fresh
        if (dist > 13) { moveX = tx - this.pos.x; moveZ = tz - this.pos.z; speed = 3.4; }
        else if (now < this.strafeUntil) { moveX = Math.cos(this.yaw) * this.strafeDir; moveZ = -Math.sin(this.yaw) * this.strafeDir; speed = 2.2; }
      } else if (now - this.lastSeen.t < 2.2 && dist > 2.5) {
        moveX = tx - this.pos.x; moveZ = tz - this.pos.z; speed = 3.6;
      }
    } else if (this.mode === 'advance') {
      const wp = this.currentWaypoint();
      if (wp) {
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.8) this.pathIdx++;
        else { moveX = dx; moveZ = dz; wantYaw = Math.atan2(-dx, -dz); }
      } else if (this.dest) {
        const dx = this.dest.x - this.pos.x, dz = this.dest.z - this.pos.z;
        if (Math.hypot(dx, dz) > 0.5) { moveX = dx; moveZ = dz; wantYaw = Math.atan2(-dx, -dz); }
        else { this.mode = 'hold'; this.dest = null; }
      } else this.mode = 'hold';
      // defenders walk the last stretch so they arrive quiet and settled
      if (this.team === 'us' && this.path.length - this.pathIdx <= 1) speed = 2.4;
    } else if (this.mode === 'hold') {
      wantYaw = this.holdYaw + Math.sin(now * 0.35 + this.id * 2.1) * 0.35;
      this.crouching = this.team === 'us' && (this.id % 2 === 0);
    } else if (this.mode === 'plant' || this.mode === 'defuse') {
      // channelled by main; stand still, watch the likeliest entry
      wantYaw = this.holdYaw;
      this.crouching = this.mode === 'defuse';
    }

    // smooth turning (bots do not snap)
    const dy = angleDiff(this.yaw, wantYaw);
    const turnRate = this.mode === 'engage' ? 10 : 5.5;
    this.yaw += THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);

    const ml = Math.hypot(moveX, moveZ);
    if (ml > 0.01) {
      this.vel.x = (moveX / ml) * speed;
      this.vel.z = (moveZ / ml) * speed;
    } else {
      this.vel.x = 0; this.vel.z = 0;
    }
    // separation so bots do not stack into one silhouette
    for (const o of game.actors) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.vel.x += (dx / d) * (0.8 - d) * 3;
        this.vel.z += (dz / d) * (0.8 - d) * 3;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const [cx, cz] = collideCircle(this.pos.x, this.pos.z, 0.42);
    this.pos.x = cx; this.pos.z = cz;
    this.speed2d = Math.hypot(this.vel.x, this.vel.z);
    poseHumanoid(this, this.walkPhase);
  }

  currentWaypoint() {
    while (this.pathIdx < this.path.length) {
      const n = NAV[this.path[this.pathIdx]];
      if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 0.8 || this.pathIdx === this.path.length - 1) return n;
      this.pathIdx++;
    }
    return null;
  }

  combat(game, now, dist) {
    const e = this.target;
    if (!e || !e.alive) return;
    if (this.reloading) return;
    if (this.mag <= 0) { startReload(game, this, now); return; }
    // reaction time: first shot only after the target has been seen a beat
    const reaction = 0.42 - this.skill * 0.2;
    if (this.seenSince < reaction) return;
    if (now < this.burstPauseUntil) return;
    // aim: settle improves the longer the target is tracked; movement spoils it
    const settle = Math.min(1, this.seenSince / 1.1);
    const err = (1 - settle) * 0.055 + (1 - this.skill) * 0.028 + (e.speed2d > 1 ? 0.016 : 0);
    const aimY = (this.skill > 0.55 && Math.random() < 0.3) ? 1.56 : 1.12;
    const dir = new THREE.Vector3(
      e.pos.x - this.pos.x + (Math.random() - 0.5) * 2 * err * dist,
      (e.pos.y + aimY) - (this.pos.y + this.eyeHeight()) + (Math.random() - 0.5) * 2 * err * dist,
      e.pos.z - this.pos.z + (Math.random() - 0.5) * 2 * err * dist,
    ).normalize();
    if (this.burstLeft <= 0) {
      const w = WEAPONS[this.weapon];
      this.burstLeft = w.auto ? 2 + Math.floor(Math.random() * 3 + this.skill * 2) : 1;
    }
    if (fireWeapon(game, this, dir, now)) {
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstPauseUntil = now + 0.28 + Math.random() * 0.4 * (1.2 - this.skill);
        if (Math.random() < 0.4) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = now + 0.5 + Math.random() * 0.5; }
        if (this.mag <= Math.floor(WEAPONS[this.weapon].mag * 0.3)) startReload(game, this, now);
      }
    }
  }
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
