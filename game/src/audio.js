// audio.js — all sound is synthesised with WebAudio: no assets, no network.
// One shared context, tiny helper envelopes, and a positional-ish volume by distance.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

function env(node, t0, a, peak, d) {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.exponentialRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function noiseBuffer() {
  const len = ctx.sampleRate * 0.5;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
let sharedNoise = null;

// vol scales with distance for world sounds; pan is -1..1 rough stereo offset.
function playNoise({ dur = 0.15, freq = 1200, q = 0.8, peak = 0.5, vol = 1, type = 'lowpass' }) {
  if (!ctx) return;
  if (!sharedNoise) sharedNoise = noiseBuffer();
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t0, 0.004, peak * vol, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.1);
}

function playTone({ freq = 440, freqEnd = null, dur = 0.12, peak = 0.25, vol = 1, type = 'square' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  const g = ctx.createGain();
  env(g, t0, 0.005, peak * vol, dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.1);
}

const distVol = (d) => Math.max(0, Math.min(1, 14 / (d + 6)));

export const SFX = {
  shot(weaponKey, dist = 0) {
    const v = distVol(dist);
    if (v <= 0.01) return;
    if (weaponKey === 'deadeye') { playNoise({ dur: 0.32, freq: 900, peak: 0.8, vol: v }); playTone({ freq: 160, freqEnd: 50, dur: 0.25, peak: 0.5, vol: v, type: 'sine' }); }
    else if (weaponKey === 'boomstick') { playNoise({ dur: 0.26, freq: 700, peak: 0.85, vol: v }); playTone({ freq: 120, freqEnd: 45, dur: 0.2, peak: 0.5, vol: v, type: 'sine' }); }
    else if (weaponKey === 'kestrel') playNoise({ dur: 0.1, freq: 1800, peak: 0.4, vol: v, type: 'bandpass' });
    else playNoise({ dur: 0.14, freq: 1400, peak: 0.55, vol: v, type: 'bandpass' });
  },
  dryFire() { playTone({ freq: 1900, dur: 0.03, peak: 0.12, type: 'square' }); },
  reloadStart() { playTone({ freq: 700, dur: 0.05, peak: 0.15 }); },
  reloadEnd() { playTone({ freq: 1000, dur: 0.05, peak: 0.18 }); setTimeout(() => playTone({ freq: 1400, dur: 0.05, peak: 0.18 }), 70); },
  hit(head) { playTone({ freq: head ? 2100 : 1500, dur: 0.05, peak: 0.22 }); },
  kill() { playTone({ freq: 880, dur: 0.09, peak: 0.22, type: 'triangle' }); setTimeout(() => playTone({ freq: 1320, dur: 0.12, peak: 0.22, type: 'triangle' }), 80); },
  hurt() { playNoise({ dur: 0.12, freq: 500, peak: 0.35 }); },
  step(dist = 0) { playNoise({ dur: 0.05, freq: 400, peak: 0.1, vol: distVol(dist) }); },
  grenade(dist = 0) {
    const v = distVol(dist); if (v <= 0.01) return;
    playNoise({ dur: 0.55, freq: 300, peak: 1.0, vol: v });
    playTone({ freq: 90, freqEnd: 30, dur: 0.5, peak: 0.8, vol: v, type: 'sine' });
  },
  explosion() {
    playNoise({ dur: 1.1, freq: 220, peak: 1.0 });
    playTone({ freq: 70, freqEnd: 24, dur: 1.0, peak: 0.9, type: 'sine' });
  },
  beep(final = false) { playTone({ freq: final ? 1760 : 1180, dur: final ? 0.22 : 0.07, peak: 0.2, type: 'sine' }); },
  plant() { playTone({ freq: 660, dur: 0.08, peak: 0.2 }); setTimeout(() => playTone({ freq: 990, dur: 0.08, peak: 0.2 }), 110); },
  defuseDone() { playTone({ freq: 990, dur: 0.08, peak: 0.2 }); setTimeout(() => playTone({ freq: 1480, dur: 0.14, peak: 0.2 }), 110); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => playTone({ freq: f, dur: 0.16, peak: 0.2, type: 'triangle' }), i * 110)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => playTone({ freq: f, dur: 0.18, peak: 0.2, type: 'triangle' }), i * 120)); },
  buy() { playTone({ freq: 1560, dur: 0.05, peak: 0.15 }); setTimeout(() => playTone({ freq: 2093, dur: 0.07, peak: 0.15 }), 60); },
  denied() { playTone({ freq: 220, dur: 0.1, peak: 0.18, type: 'sawtooth' }); },
};
