// Writes public/soundtrack.wav: the narration (narration/), an original score and the interface
// sounds, all mixed here. The score is synthesized, so there is nothing to license. Every event is
// placed from src/timeline.ts, and the music ducks under the voice.
// Run: node scripts/make-audio.ts
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { LINES } from '../src/script.ts';
import { BAR, BEAT, FPS, SCENES, TOTAL, at, cues, sceneStart, T, voStart, type SceneId, type Sfx } from '../src/timeline.ts';

const SR = 48000;
const LEN = Math.ceil((TOTAL / FPS) * SR);
const L = new Float32Array(LEN), R = new Float32Array(LEN);     // music
const SL = new Float32Array(LEN), SR2 = new Float32Array(LEN);  // interface sounds
const VL = new Float32Array(LEN), VR = new Float32Array(LEN);   // voice
const sec = (frames: number) => frames / FPS;
const beatSec = sec(BEAT), barSec = sec(BAR);
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

let busL = L, busR = R;
function add(t0: number, dur: number, gain: number, pan: number, fn: (t: number) => number) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    const j = s0 + i; if (j < 0 || j >= LEN) continue;
    const v = fn(i / SR);
    busL[j] += v * gl; busR[j] += v * gr;
  }
}
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

// ---------- instruments ----------
function pad(t0: number, dur: number, notes: number[], gain: number, bright = 1) {
  for (const [k, n] of notes.entries()) {
    const f = midi(n);
    add(t0, dur + 0.6, gain / notes.length, (k / Math.max(1, notes.length - 1)) * 0.8 - 0.4, t => {
      const a = Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (dur + 0.6 - t) / 0.6));
      return a * (Math.sin(2 * Math.PI * f * t) + 0.3 * bright * Math.sin(2 * Math.PI * f * 2.003 * t) + 0.12 * bright * Math.sin(2 * Math.PI * f * 3.01 * t)) * (0.85 + 0.15 * Math.sin(Math.PI * t));
    });
  }
}
function pluck(t0: number, n: number, gain: number, pan: number, decay = 0.25) {
  const f = midi(n);
  add(t0, decay * 5, gain, pan, t => env(t, 0.004, decay) * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.08)));
}
function kick(t0: number, gain: number) {
  let ph = 0;
  add(t0, 0.45, gain, 0, t => { const f = 45 + 110 * Math.exp(-t / 0.035); ph += (2 * Math.PI * f) / SR; return Math.sin(ph) * env(t, 0.002, 0.12); });
}
function hat(t0: number, gain: number, pan = 0.25) {
  let hp = 0, prev = 0;
  add(t0, 0.06, gain, pan, () => { const x = rand(); hp = 0.85 * (hp + x - prev); prev = x; return hp; });
}
function bass(t0: number, dur: number, n: number, gain: number) {
  const f = midi(n);
  add(t0, dur, gain, 0, t => Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.05) * (Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t)));
}
function drone(t0: number, dur: number, n: number, gain: number) {
  const f = midi(n);
  let lp = 0;
  add(t0, dur, gain, 0, t => {
    const saw = ((f * t) % 1) * 2 - 1 + (((f * 1.007 * t) % 1) * 2 - 1);
    lp += (0.02 + 0.03 * (t / dur)) * (saw - lp);
    return lp * Math.min(1, t / 0.5) * Math.min(1, (dur - t) / 0.3);
  });
}
function riser(t0: number, dur: number, gain: number) {
  let lp = 0;
  add(t0, dur, gain, 0, t => { lp += (0.01 + 0.25 * (t / dur) ** 2) * (rand() - lp); return lp * (t / dur) ** 2; });
}

// ---------- score: one mood per scene ----------
type Mood = 'uneasy' | 'lift' | 'calm' | 'groove' | 'tense' | 'bright' | 'resolve';
const MOOD: Record<SceneId, Mood> = { hook: 'uneasy', fail: 'uneasy', intro: 'lift', who: 'calm', how: 'calm', signin: 'groove', vault: 'groove', job: 'groove', pay: 'groove', approve: 'groove', attack: 'tense', evidence: 'bright', end: 'resolve' };
const moodAt = (t: number): Mood => { let m: Mood = 'uneasy'; for (const s of SCENES) if (t >= sec(sceneStart(s.id)) - 1e-6) m = MOOD[s.id]; return m; };

const CHORDS: Record<Mood, number[][]> = {
  uneasy: [[57, 60, 64], [53, 57, 60], [57, 60, 64], [52, 55, 59]],
  lift: [[53, 57, 60, 65], [55, 59, 62, 67], [48, 52, 55, 60, 64], [48, 52, 55, 60, 64]],
  calm: [[57, 60, 64, 67, 71], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 64]],
  groove: [[57, 60, 64, 67, 71], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 64]],
  tense: [[57, 58, 64], [57, 58, 64], [57, 58, 63], [57, 58, 64]],
  bright: [[53, 57, 60, 65, 69], [55, 59, 62, 67, 71], [48, 52, 55, 60, 64], [57, 60, 64, 67]],
  resolve: [[53, 57, 60, 65, 69], [55, 59, 62, 67, 71], [48, 52, 55, 60, 64, 67], [48, 52, 55, 60, 64, 67]],
};
const ROOT: Record<Mood, number[]> = { uneasy: [45, 41, 45, 40], lift: [41, 43, 36, 36], calm: [45, 41, 36, 43], groove: [45, 41, 36, 43], tense: [33, 33, 33, 33], bright: [41, 43, 36, 45], resolve: [41, 43, 36, 36] };

const end = sec(TOTAL);
const attackResult = sec(at('attack', T.attack.result));
for (let bar = 0, t = 0; t < end - 0.01; bar++, t += barSec) {
  const m = moodAt(t + 0.01), i = bar % 4;
  const last = t + barSec >= end - 0.01;
  const len = last ? end - t : barSec;
  if (m === 'tense' && t < attackResult) {
    drone(t, Math.min(barSec, attackResult - t), 33, 0.2);
    pad(t, Math.min(barSec, attackResult - t), CHORDS.tense[i], 0.06, 0.4);
  } else {
    const ch = CHORDS[m === 'tense' ? 'calm' : m][i];
    pad(t, len, ch.map(n => n + 12), m === 'uneasy' ? 0.08 : 0.1, m === 'bright' || m === 'resolve' || m === 'lift' ? 1.2 : 1);
    bass(t, m === 'uneasy' ? barSec * 0.9 : beatSec * 1.6, ROOT[m === 'tense' ? 'calm' : m][i], m === 'uneasy' ? 0.1 : 0.14);
  }
  for (let b = 0; b < 4; b++) {
    const tb = t + b * beatSec, mb = moodAt(tb + 0.001);
    const ch = CHORDS[mb][i];
    if (mb === 'uneasy') { if (b % 2 === 0) kick(tb, 0.22); hat(tb + beatSec / 2, 0.025); }
    if (mb === 'calm') { hat(tb + beatSec / 2, 0.03); pluck(tb, ch[(b * 2) % ch.length] + 24, 0.035, b % 2 ? 0.35 : -0.35, 0.2); }
    if (mb === 'groove' || mb === 'bright') {
      kick(tb, b % 2 === 0 ? 0.34 : 0.18); hat(tb + beatSec / 2, 0.05);
      for (let s = 0; s < 2; s++) pluck(tb + (s * beatSec) / 2, ch[(b * 2 + s) * 3 % ch.length] + 24, 0.04, s ? 0.35 : -0.35, 0.12);
    }
    if (mb === 'tense' && tb < attackResult) { kick(tb, 0.45); kick(tb + 0.16, 0.2); for (let s = 1; s < 4; s++) hat(tb + (s * beatSec) / 4, 0.03, -0.2); }
    if (mb === 'resolve' && !last) { pluck(tb, ch[b % ch.length] + 24, 0.04, b % 2 ? 0.4 : -0.4, 0.4); }
  }
}
// Transitions: a riser into the reveal and into the attack result, a hit when PayGate appears.
riser(sec(sceneStart('intro')) - 1.5, 1.5, 0.18);
riser(attackResult - 2 * beatSec, 2 * beatSec, 0.2);
pad(attackResult, sec(sceneStart('evidence')) - attackResult, [57, 60, 64, 69], 0.1);

// ---------- interface sounds ----------
busL = SL; busR = SR2;
const SFX: Record<Sfx, (t: number) => void> = {
  tap: t => { add(t, 0.05, 0.2, 0.1, x => Math.sin(2 * Math.PI * 1800 * x) * env(x, 0.001, 0.008)); add(t, 0.03, 0.1, 0.1, x => rand() * env(x, 0.0005, 0.004)); },
  key: t => { const f = 2600 + 900 * rand(); add(t, 0.03, 0.06, 0.2 * rand(), x => (Math.sin(2 * Math.PI * f * x) * 0.5 + rand() * 0.5) * env(x, 0.0005, 0.006)); },
  sign: t => { pluck(t, 88, 0.14, 0, 0.2); pluck(t + 0.09, 93, 0.14, 0, 0.35); },
  send: t => { riser(t - 0.2, 0.25, 0.1); pluck(t, 84, 0.12, -0.2, 0.25); pluck(t + 0.07, 88, 0.12, 0, 0.25); pluck(t + 0.14, 91, 0.14, 0.2, 0.45); },
  toast: t => { add(t, 0.25, 0.12, 0, x => Math.sin(2 * Math.PI * 1320 * x) * env(x, 0.002, 0.05)); },
  deny: t => {
    let ph = 0;
    add(t, 0.35, 0.5, 0, x => { const f = 38 + 70 * Math.exp(-x / 0.03); ph += (2 * Math.PI * f) / SR; return Math.sin(ph) * env(x, 0.001, 0.09); });
    add(t, 0.12, 0.1, 0, x => (((110 * x) % 1) * 2 - 1) * env(x, 0.001, 0.04));
  },
  whoosh: t => { let lp = 0; add(t - 0.12, 0.35, 0.15, 0, x => { lp += (0.02 + 0.2 * Math.sin((Math.PI * x) / 0.35)) * (rand() - lp); return lp * Math.sin((Math.PI * x) / 0.35); }); },
  success: t => { pluck(t, 84, 0.1, -0.3, 0.3); pluck(t + 0.08, 88, 0.1, 0, 0.3); pluck(t + 0.16, 91, 0.11, 0.3, 0.6); },
  alarm: t => { pluck(t, 81, 0.1, -0.2, 0.15); pluck(t + 0.14, 82, 0.1, 0.2, 0.2); },
  impact: t => { kick(t, 0.8); let lp = 0; add(t, 1.2, 0.22, 0, () => { lp += 0.05 * (rand() - lp); return lp; }); },
  drain: t => { let ph = 0; add(t, 1.3, 0.22, 0, x => { const f = 700 * Math.exp(-x * 1.8) + 60; ph += (2 * Math.PI * f) / SR; return Math.sin(ph) * Math.min(1, x / 0.02) * Math.max(0, 1 - x / 1.3); }); },
};
for (const c of cues()) SFX[c.sfx](sec(c.frame));

// ---------- narration ----------
// Decodes a narration clip to 48 kHz stereo with ffmpeg.
function decode(path: string): [Float32Array, Float32Array] {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${path}: ${r.stderr}`);
  const b = r.stdout, frames = b.length / 4, l = new Float32Array(frames), rr = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { l[i] = b.readInt16LE(i * 4) / 32768; rr[i] = b.readInt16LE(i * 4 + 2) / 32768; }
  return [l, rr];
}
for (const line of LINES) {
  const [l, r] = decode(new URL(`../narration/${line.id}.m4a`, import.meta.url).pathname);
  const s0 = Math.round(sec(voStart(line.id)) * SR);
  for (let i = 0; i < l.length && s0 + i < LEN; i++) { VL[s0 + i] += l[i]; VR[s0 + i] += r[i]; }
}

// ---------- mix: duck music under the voice, then master ----------
// The voice envelope (fast attack, slow release) pulls the music down by about 9 dB while it speaks.
let envV = 0;
const atk = Math.exp(-1 / (0.01 * SR)), rel = Math.exp(-1 / (0.45 * SR));
const out = Buffer.alloc(44 + LEN * 4);
const MUSIC = 0.55, DUCK = 0.35, SFXG = 0.8;
const fadeFrom = LEN - SR * 1.2;
let peak = 0;
const mixL = new Float32Array(LEN), mixR = new Float32Array(LEN);
for (let i = 0; i < LEN; i++) {
  const v = Math.max(Math.abs(VL[i]), Math.abs(VR[i]));
  envV = v > envV ? atk * envV + (1 - atk) * v : rel * envV + (1 - rel) * v;
  const duck = 1 - (1 - DUCK) * Math.min(1, envV / 0.04);
  const fade = i > fadeFrom ? 1 - (i - fadeFrom) / (LEN - fadeFrom) : 1;
  mixL[i] = (L[i] * MUSIC * duck + SL[i] * SFXG) * fade + VL[i];
  mixR[i] = (R[i] * MUSIC * duck + SR2[i] * SFXG) * fade + VR[i];
  peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
}
// Gentle limiter: only peaks above 0.9 are softened.
const soft = (x: number) => (Math.abs(x) < 0.9 ? x : Math.sign(x) * (0.9 + 0.09 * Math.tanh((Math.abs(x) - 0.9) / 0.09)));
for (let i = 0; i < LEN; i++) {
  out.writeInt16LE(Math.round(soft(mixL[i]) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(soft(mixR[i]) * 32767), 46 + i * 4);
}
out.write('RIFF', 0); out.writeUInt32LE(36 + LEN * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(LEN * 4, 40);
writeFileSync(new URL('../public/soundtrack.wav', import.meta.url), out);
console.log(`wrote public/soundtrack.wav (${(LEN / SR).toFixed(1)} s, ${LINES.length} narration lines, ${cues().length} interface sounds, raw peak ${peak.toFixed(2)})`);
