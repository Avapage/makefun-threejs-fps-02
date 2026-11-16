// combat.js — hitscan shooting, damage falloff, tracers, impacts, grenades,
// and the first-person weapon view model. Shared by the player and the bots.

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { segmentBlocked } from './world.js';
import { SFX } from './audio.js';

const _v = new THREE.Vector3();
const _o = new THREE.Vector3();

// ---- FX pools (allocated once, reused: nothing new in the hot loop) ----
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    for (let i = 0; i < 40; i++) {
      const line = new THREE.Line(tGeo.clone(), new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.sparks = [];
    const sGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({ color: 0xffc46b }));
      m.visible = false;
      scene.add(m);
      this.sparks.push({ m, vel: new THREE.Vector3(), life: 0 });
    }
    this.flash = new THREE.PointLight(0xffb45e, 0, 9, 1.8);
    scene.add(this.flash);
    this.flashT = 0;
    this.tracerIdx = 0; this.sparkIdx = 0;
  }
  tracer(from, to) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z; p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.opacity = 0.75;
    t.life = 0.05;
  }
  burst(pos, color, n = 5, speed = 2.4) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.sparkIdx++ % this.sparks.length];
      s.m.visible = true;
      s.m.material.color.setHex(color);
      s.m.position.copy(pos);
      s.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed);
      s.life = 0.28 + Math.random() * 0.15;
    }
  }
  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 14;
    this.flashT = 0.045;
  }
  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.material.opacity = 0; }
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        s.vel.y -= 6 * dt;
        s.m.position.addScaledVector(s.vel, dt);
        if (s.life <= 0 || s.m.position.y < 0.02) { s.life = 0; s.m.visible = false; }
      }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }
}

// Ray vs one actor's hit volumes. Actor origin is at the feet.
// Returns {t, part} or null. Parts: 'head' | 'body' | 'leg'.
function rayActor(ox, oy, oz, dx, dy, dz, a) {
  const crouch = a.crouching ? 0.32 : 0;
  const zones = [
    { part: 'head', y: 1.58 - crouch, r: 0.21 },
    { part: 'body', y: 1.08 - crouch, r: 0.44 },
    { part: 'leg', y: 0.45, r: 0.38 },
  ];
  let best = null;
  for (const zn of zones) {
    const cx = a.pos.x - ox, cy = zn.y + a.pos.y - oy, cz = a.pos.z - oz;
    const tca = cx * dx + cy * dy + cz * dz;
    if (tca < 0) continue;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const r2 = zn.r * zn.r;
    if (d2 > r2) continue;
    const t = tca - Math.sqrt(r2 - d2);
    if (t > 0 && (!best || t < best.t)) best = { t, part: zn.part };
  }
  return best;
}

// Fire one trigger pull for `shooter` (player or bot). aimDir is a unit Vector3
// the shooter is aiming along BEFORE spread. Returns true if a shot was fired.
export function fireWeapon(game, shooter, aimDir, now) {
  const w = WEAPONS[shooter.weapon];
  if (shooter.reloading || now < shooter.nextShotAt || !shooter.alive) return false;
  if (shooter.mag <= 0) {
    if (shooter.isPlayer) SFX.dryFire();
    shooter.nextShotAt = now + 0.3;
    startReload(game, shooter, now);
    return false;
  }
  shooter.mag--;
  shooter.nextShotAt = now + 60 / w.rpm;
  shooter.lastShotAt = now;
  game.noise.push({ x: shooter.pos.x, z: shooter.pos.z, r: 26, team: shooter.team, t: now });

  const eye = shooter.eyePos(_o);
  const moving = shooter.speed2d > 0.6;
  let spread = w.spread + (moving ? w.moveSpread : 0) + (shooter.airborne ? 0.06 : 0);
  if (shooter.crouching) spread *= 0.7;
  if (shooter.scoped) spread *= 0.25;

  const distToPlayer = game.player?.alive ? shooter.pos.distanceTo(game.player.pos) : 0;
  SFX.shot(shooter.weapon, shooter.isPlayer ? 0 : distToPlayer);
  game.fx.muzzle(_v.copy(eye).addScaledVector(aimDir, 0.7));

  for (let p = 0; p < w.pellets; p++) {
    const dir = new THREE.Vector3(
      aimDir.x + (Math.random() - 0.5) * 2 * spread,
      aimDir.y + (Math.random() - 0.5) * 2 * spread,
      aimDir.z + (Math.random() - 0.5) * 2 * spread,
    ).normalize();
    // wall distance
    const ex = eye.x + dir.x * w.range, ey = eye.y + dir.y * w.range, ez = eye.z + dir.z * w.range;
    const wallT = segmentBlocked(eye.x, eye.y, eye.z, ex, ey, ez);
    const maxT = wallT === Infinity ? 1 : wallT;
    const maxDist = w.range * maxT;
    // nearest actor hit
    let hitA = null, hitPart = null, hitDist = Infinity;
    for (const a of game.actors) {
      if (a === shooter || !a.alive || a.team === shooter.team) continue;
      const hit = rayActor(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, a);
      if (hit && hit.t < hitDist && hit.t <= maxDist) { hitA = a; hitPart = hit.part; hitDist = hit.t; }
    }
    const endDist = hitA ? hitDist : maxDist;
    const end = new THREE.Vector3(eye.x + dir.x * endDist, eye.y + dir.y * endDist, eye.z + dir.z * endDist);
    game.fx.tracer(_v.copy(eye).addScaledVector(dir, 0.6), end);
    if (hitA) {
      let dmg = w.damage;
      const fallStart = w.falloff;
      if (hitDist > fallStart) dmg *= Math.max(0.35, 1 - (hitDist - fallStart) / (fallStart * 2.4) * 0.65);
      if (hitPart === 'head') dmg *= w.headMult;
      if (hitPart === 'leg') dmg *= 0.6;
      game.fx.burst(end, 0xd84a3a, hitPart === 'head' ? 8 : 5);
      game.damage(hitA, dmg, shooter, hitPart);
    } else if (wallT !== Infinity) {
      game.fx.burst(end, 0xffc46b, 3, 1.6);
    }
  }
  if (shooter.mag === 0) startReload(game, shooter, now);
  return true;
}

export function startReload(game, shooter, now) {
  const w = WEAPONS[shooter.weapon];
  if (shooter.reloading || shooter.mag >= w.mag || shooter.reserve <= 0) return;
  shooter.reloading = true;
  shooter.reloadEndAt = now + w.reloadMs / 1000;
  if (shooter.isPlayer) SFX.reloadStart();
}

export function finishReloads(game, now) {
  for (const a of game.actors) {
    if (!a.reloading || now < a.reloadEndAt) continue;
    const w = WEAPONS[a.weapon];
    const take = Math.min(w.mag - a.mag, a.reserve);
    a.mag += take; a.reserve -= take;
    a.reloading = false;
    if (a.isPlayer) SFX.reloadEnd();
  }
}

// ---- Grenades ----
export class Grenade {
  constructor(scene, from, dir, team, owner) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x44502e, roughness: 0.6 }),
    );
    this.mesh.position.copy(from);
    scene.add(this.mesh);
    this.vel = dir.clone().multiplyScalar(15);
    this.vel.y += 4.5;
    this.team = team; this.owner = owner;
    this.fuse = 1.5;
    this.alive = true;
  }
  update(game, dt) {
    if (!this.alive) return;
    this.fuse -= dt;
    this.vel.y -= 14 * dt;
    const p = this.mesh.position;
    p.addScaledVector(this.vel, dt);
    if (p.y < 0.09) { p.y = 0.09; this.vel.y *= -0.35; this.vel.x *= 0.8; this.vel.z *= 0.8; }
    p.x = Math.max(-37.6, Math.min(37.6, p.x));
    p.z = Math.max(-29.6, Math.min(29.6, p.z));
    if (this.fuse <= 0) {
      this.alive = false;
      this.mesh.visible = false;
      const d0 = game.player?.alive ? p.distanceTo(game.player.pos) : 20;
      SFX.grenade(d0);
      game.fx.burst(p, 0xff9a3c, 22, 5.5);
      game.fx.muzzle(p);
      for (const a of game.actors) {
        if (!a.alive) continue;
        const d = a.pos.distanceTo(p);
        if (d > 5.2) continue;
        const blocked = segmentBlocked(p.x, 0.8, p.z, a.pos.x, 1.0, a.pos.z);
        if (blocked !== Infinity && blocked < 0.98) continue;
        const dmg = 92 * Math.max(0, 1 - d / 5.2);
        if (dmg > 2) game.damage(a, dmg, this.owner, 'body');
      }
    }
  }
}

// ---- First-person view model ----
export class ViewModel {
  constructor(camera) {
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.5, metalness: 0.4 });
    this.accentMat = new THREE.MeshStandardMaterial({ color: 0xf2a33c, roughness: 0.5 });
    this.build('p9');
    this.group.position.set(0.24, -0.22, -0.45);
    camera.add(this.group);
    this.recoil = 0;
    this.bobT = 0;
    this.reloadDip = 0;
  }
  build(weaponKey) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    const add = (sx, sy, sz, x, y, z, mat = this.bodyMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };
    // receiver + barrel + grip + magazine, sized per weapon class
    const long = weaponKey === 'longbow' || weaponKey === 'deadeye';
    const smg = weaponKey === 'kestrel';
    add(0.07, 0.1, long ? 0.52 : 0.34, 0, 0, -0.1);                    // receiver
    add(0.035, 0.035, long ? 0.4 : 0.2, 0, 0.02, long ? -0.55 : -0.32); // barrel
    add(0.05, 0.14, 0.06, 0, -0.1, 0.05);                              // grip
    add(0.045, 0.16, 0.07, 0, -0.11, smg ? -0.12 : -0.05);             // magazine
    if (long) add(0.05, 0.06, 0.2, 0, 0.09, -0.12, this.accentMat);   // sight rail
    if (weaponKey === 'deadeye') add(0.045, 0.07, 0.16, 0, 0.11, -0.14); // scope tube
    if (weaponKey === 'boomstick') add(0.06, 0.05, 0.3, 0, -0.03, -0.3, this.accentMat); // pump
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, long ? -0.78 : -0.45);
    this.group.add(this.muzzle);
  }
  update(dt, speed2d, reloading) {
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.bobT += dt * (2 + speed2d * 1.6);
    const bob = Math.min(speed2d / 4.6, 1) * 0.012;
    this.reloadDip += ((reloading ? 0.5 : 0) - this.reloadDip) * Math.min(1, dt * 8);
    this.group.position.set(
      0.24 + Math.sin(this.bobT) * bob,
      -0.22 + Math.abs(Math.cos(this.bobT)) * bob - this.reloadDip * 0.12,
      -0.45 + this.recoil * 0.09,
    );
    this.group.rotation.x = this.recoil * 0.7 - this.reloadDip * 0.5;
  }
  kick(amount) { this.recoil = Math.min(0.6, this.recoil + amount * 6); }
}
