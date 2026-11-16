// world.js — Depot Nine: an original two-site depot map.
// Builds the three.js geometry, the AABB collider list used by movement and
// bullet blocking, the waypoint graph the bots path on, and the site zones.

import * as THREE from 'three';
import { PALETTE } from './config.js';

// Wall boxes: [cx, cz, sizeX, sizeZ, height]
const WALLS = [
  // perimeter
  [-38.5, 0, 1, 62, 6], [38.5, 0, 1, 62, 6], [0, -31, 78, 1, 6], [0, 31, 78, 1, 6],
  // mid dividers (z = -8 and z = +8), east part, connector gap at x in [2,6]
  [-5.5, -8, 15, 1.2, 4], [22, -8, 32, 1.2, 4],
  [-5.5, 8, 15, 1.2, 4], [22, 8, 32, 1.2, 4],
  // west hall / site dividers, door gaps at x in [-24,-20]
  [-26, -8, 4, 1.2, 4], [-16.5, -8, 7, 1.2, 4],
  [-26, 8, 4, 1.2, 4], [-16.5, 8, 7, 1.2, 4],
  // base / west divider (x = -28): site doors at z in [-18,-14] and [14,18], mid door at z in [-2,2]
  [-28, -24, 1.2, 12, 4], [-28, -11, 1.2, 6, 4], [-28, -5, 1.2, 6, 4], [-28, 5, 1.2, 6, 4], [-28, 11, 1.2, 6, 4], [-28, 24, 1.2, 12, 4],
  // west / mid divider (x = -13): site doors at z in [-19,-13] and [13,19], mid door at z in [-2,2]
  [-13, -24.5, 1.2, 11, 4], [-13, -10.5, 1.2, 5, 4], [-13, -5, 1.2, 6, 4], [-13, 5, 1.2, 6, 4], [-13, 10.5, 1.2, 5, 4], [-13, 24.5, 1.2, 11, 4],
];

// Solid cover boxes (crates / containers): [cx, cz, sizeX, sizeZ, height, paletteKey]
const COVER = [
  [0, 0, 6, 4, 3, 'containerB'],
  [-6, 3.5, 3, 3, 2, 'crate'], [6, -3.5, 3, 3, 2, 'crate'],
  // site A cover
  [-20, -16, 3, 3, 2.2, 'crate'], [-16, -21, 2, 4, 1.6, 'crateDark'], [-24, -12.5, 4, 2, 1.6, 'containerA'],
  // site B cover
  [-20, 16, 3, 3, 2.2, 'crate'], [-16, 21, 2, 4, 1.6, 'crateDark'], [-24, 12.5, 4, 2, 1.6, 'containerA'],
  // east yard containers (offset from the long lanes so the lanes stay walkable)
  [20, -12.5, 6, 2.5, 2.6, 'containerA'], [26, -4, 2.5, 6, 2.6, 'containerC'],
  [20, 12.5, 6, 2.5, 2.6, 'containerB'], [26, 6, 2.5, 5, 2.6, 'containerC'],
  [18, 0, 3, 3, 2, 'crateDark'],
  [30, -23, 4, 2, 1.6, 'crate'], [30, 23, 4, 2, 1.6, 'crate'],
  // hall cover
  [-20, 3, 2.5, 2.5, 1.6, 'crate'], [-20, -3.5, 2.5, 2.5, 1.6, 'crate'],
];

export const SITES = {
  A: { name: 'Site A', x: -20, z: -17, r: 6.5, color: PALETTE.siteA },
  B: { name: 'Site B', x: -20, z: 17, r: 6.5, color: PALETTE.siteB },
};

// Waypoint graph: [x, z, ...neighbourIds]
const NODE_DEFS = [
  [-34, 0],        // 0  warden base
  [-20, -20.5],    // 1  site A centre (beside the centre crate)
  [-24, -17],      // 2  A base-door side
  [-15.5, -17],    // 3  A east-door side
  [-20, 20.5],     // 4  site B centre (beside the centre crate)
  [-24, 17],       // 5  B base-door side
  [-15.5, 17],     // 6  B east-door side
  [-20, 0],        // 7  west hall
  [-22, -5],       // 8  hall north
  [-22, 5],        // 9  hall south
  [-30, -16],      // 10 base A door inside
  [-30, 16],       // 11 base B door inside
  [-8, 0],         // 12 mid west
  [0, -5],         // 13 mid north
  [0, 5],          // 14 mid south
  [8, 0],          // 15 mid east
  [12.5, -4.5],    // 16 mid gate (south of the yard crate, so the east lane clears it)
  [4, -11.5],      // 17 A connector
  [4, 11.5],       // 18 B connector
  [2, -16],        // 19 A long west
  [16, -16],       // 20 A long mid
  [28, -16],       // 21 A long east
  [2, 16],         // 22 B long west
  [16, 16],        // 23 B long mid
  [28, 16],        // 24 B long east
  [24, 0],         // 25 east yard
  [34, 0],         // 26 ravager spawn
  [-34, -8],       // 27 base north hold
  [-34, 8],        // 28 base south hold
  [4, -6.5],       // 29 A connector mouth (the z=-8 wall's only gap is x in [2,6])
  [4, 6.5],        // 30 B connector mouth
];
const EDGES = [
  [0, 7], [0, 10], [0, 11], [0, 27], [0, 28],
  [10, 2], [11, 5], [27, 10], [28, 11],
  [2, 1], [1, 3], [5, 4], [4, 6],
  [7, 8], [7, 9], [7, 12], [8, 2], [9, 5],
  [12, 13], [12, 14], [13, 15], [14, 15], [15, 16], [16, 25], [14, 16],
  [13, 29], [29, 17], [15, 29], [14, 30], [30, 18], [15, 30],
  [17, 19], [18, 22],
  [19, 3], [19, 20], [20, 21],
  [22, 6], [22, 23], [23, 24],
  [25, 26],
];

export const NAV = NODE_DEFS.map(([x, z]) => ({ x, z, near: [] }));
for (const [a, b] of EDGES) { NAV[a].near.push(b); NAV[b].near.push(a); }

// BFS shortest path between node ids; returns array of node ids including both ends.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of NAV[cur].near) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let p = cur;
        while (p !== -1) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(n);
    }
  }
  return [from];
}

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NAV.length; i++) {
    const d = (NAV[i].x - x) ** 2 + (NAV[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// All colliders as {minX, maxX, minZ, maxZ, top} — top is the box height (for bullet tests).
export const COLLIDERS = [];
for (const [cx, cz, sx, sz, h] of WALLS) COLLIDERS.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, top: h });
for (const [cx, cz, sx, sz, h] of COVER) COLLIDERS.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, top: h });

// Push a circle (x, z, r) out of every collider; returns corrected [x, z].
export function collideCircle(x, z, r) {
  for (const c of COLLIDERS) {
    if (c.top < 0.9) continue; // low cover never blocks movement (nothing that low today, kept for safety)
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r; z = nz + (dz / d) * r;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const pl = x - c.minX, pr = c.maxX - x, pt = z - c.minZ, pb = c.maxZ - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
      else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
    }
  }
  return [x, z];
}

// Segment vs colliders in 3D (y is height). Returns the smallest t in [0,1] where the
// segment enters a box whose top is above the segment's height there, or Infinity.
export function segmentBlocked(x0, y0, z0, x1, y1, z1) {
  let best = Infinity;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  for (const c of COLLIDERS) {
    // slab test in XZ
    let tmin = 0, tmax = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < c.minX || x0 > c.maxX) continue; }
    else {
      let t1 = (c.minX - x0) / dx, t2 = (c.maxX - x0) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < c.minZ || z0 > c.maxZ) continue; }
    else {
      let t1 = (c.minZ - z0) / dz, t2 = (c.maxZ - z0) / dz;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    const yAt = y0 + dy * tmin;
    if (yAt <= c.top) best = Math.min(best, tmin);
  }
  return best;
}

export function hasLOS(ax, ay, az, bx, by, bz) {
  return segmentBlocked(ax, ay, az, bx, by, bz) === Infinity;
}

function canvasTexture(draw, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 130);

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5c4f38, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b3, 2.0);
  sun.position.set(30, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  const groundMat = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(78, 62), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // painted yard lines: site circles + lane stripes via one canvas texture overlay
  const paint = canvasTexture((g, w, h) => {
    g.clearRect(0, 0, w, h);
    const px = (x) => ((x + 39) / 78) * w, pz = (z) => ((z + 31) / 62) * h;
    g.strokeStyle = 'rgba(236,231,218,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(px(-13), pz(0)); g.lineTo(px(38), pz(0)); g.stroke();
    for (const s of [SITES.A, SITES.B]) {
      g.strokeStyle = s === SITES.A ? '#f2a33c' : '#57b7e8';
      g.lineWidth = 5;
      g.beginPath(); g.arc(px(s.x), pz(s.z), (s.r / 78) * w, 0, Math.PI * 2); g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = `bold ${Math.round(h * 0.09)}px system-ui`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s === SITES.A ? 'A' : 'B', px(s.x), pz(s.z));
    }
  }, 1024, 816);
  const paintMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(78, 62),
    new THREE.MeshBasicMaterial({ map: paint, transparent: true, depthWrite: false }),
  );
  paintMesh.rotation.x = -Math.PI / 2;
  paintMesh.position.y = 0.02;
  scene.add(paintMesh);

  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTrim, roughness: 0.9 });
  const boxGeoCache = new Map();
  const box = (sx, sy, sz) => {
    const k = `${sx},${sy},${sz}`;
    if (!boxGeoCache.has(k)) boxGeoCache.set(k, new THREE.BoxGeometry(sx, sy, sz));
    return boxGeoCache.get(k);
  };
  const addBox = (cx, cz, sx, sz, h, mat) => {
    const m = new THREE.Mesh(box(sx, h, sz), mat);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  for (const [cx, cz, sx, sz, h] of WALLS) {
    addBox(cx, cz, sx, sz, h, wallMat);
    addBox(cx, cz, sx + 0.15, sz + 0.15, 0.25, trimMat).position.y = h + 0.12;
  }
  const coverMats = {};
  for (const key of ['containerA', 'containerB', 'containerC', 'crate', 'crateDark']) {
    coverMats[key] = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness: 0.85 });
  }
  for (const [cx, cz, sx, sz, h, key] of COVER) addBox(cx, cz, sx, sz, h, coverMats[key]);

  // site marker pylons (glow posts at site corners so the objective reads at a glance)
  const pylonGeo = new THREE.BoxGeometry(0.3, 3.4, 0.3);
  for (const s of [SITES.A, SITES.B]) {
    const mat = new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 0.7 });
    for (const [ox, oz] of [[-s.r, -s.r], [s.r, -s.r], [-s.r, s.r], [s.r, s.r]]) {
      const p = new THREE.Mesh(pylonGeo, mat);
      p.position.set(s.x + ox * 0.7, 1.7, s.z + oz * 0.7);
      scene.add(p);
    }
  }
  return { sun };
}
