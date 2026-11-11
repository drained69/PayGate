// The single source of timing. Visuals (src/) and the soundtrack (scripts/make-audio.ts) both
// read this file. Every scene lasts as long as its narration line (src/vo.ts, measured from the
// real clips), rounded up to a whole beat so each cut lands on the beat.
// 120 BPM at 30 fps: one beat is 15 frames, one bar is 60 frames.
import { LINES, type LineId } from './script.ts';
import { VO } from './vo.ts';

export const FPS = 30;
export const BPM = 120;
export const BEAT = (FPS * 60) / BPM;
export const BAR = BEAT * 4;

export type SceneId = LineId;
const LEAD = 4, TAIL = 5; // frames of air before and after each line
const HOLD: Partial<Record<SceneId, number>> = { end: 60 }; // extra frames to let a moment land

export const SCENES: { id: SceneId; frames: number }[] = LINES.map(l => {
  const voice = Math.ceil(VO[l.id].dur * FPS);
  return { id: l.id, frames: Math.ceil((LEAD + voice + TAIL + (HOLD[l.id] ?? 0)) / BEAT) * BEAT };
});

export const sceneStart = (id: SceneId): number => {
  let f = 0;
  for (const s of SCENES) { if (s.id === id) return f; f += s.frames; }
  throw new Error(`unknown scene ${id}`);
};
export const sceneLength = (id: SceneId): number => SCENES.find(s => s.id === id)!.frames;
export const TOTAL = SCENES.reduce((n, s) => n + s.frames, 0);
export const voStart = (id: SceneId): number => sceneStart(id) + LEAD;

// Product scenes were choreographed on a fixed number of beats. Their cues are stretched to
// the scene's real length, so the action keeps pace with the narration.
const DESIGN: Partial<Record<SceneId, number>> = { signin: 12, vault: 16, job: 12, pay: 12, approve: 12, attack: 24, evidence: 24, end: 16 };

// Beat positions inside each scene (in designed beats).
export const T = {
  signin: { typeUrl: [0.5, 2.5], enter: 2.75, landing: 3, tapSignIn: 5, wallet: 5.5, tapSign: 8, walletOut: 8.5, toast: 9 },
  vault: { typeName: [1, 2], tapUsdc: 2.75, typeAuto: [3.75, 4.25], typeMax: [4.75, 5.5], typeDaily: [6, 6.75], typePayees: [7.25, 9.75], tapCreate: 10.5, wallet: 11, tapApprove: 12.5, walletOut: 13, toast: 13.25, overview: 13.5 },
  job: { tapNew: 1, dialog: 1.5, typeTitle: [2, 3.5], typeBrief: [3.75, 6.25], tapPayee: 7, typeBudget: [7.75, 8.5], tapCreate: 9, toast: 9.5 },
  pay: { tapRun: 1, delivered: 3, tapReview: 5, dialog: 5.5, tapPay: 8.5, paid: 9.5 },
  approve: { held: 0, tapReview: 3, dialog: 3.5, tapApprove: 6, wallet: 6.5, tapSign: 9, walletOut: 9.5, toast: 10 },
  attack: { brief: 0, highlight: 2, hijack: 5, firstRow: 6, rows: 12, result: 18.5, zero: 20.5 },
  evidence: { page: 0, tapVerify: 4, verified: 4.75, controls: 10.5, tapFreeze: 13, wallet: 13.5, tapSign: 15.5, walletOut: 16, toast: 16.25 },
  end: { logo: 0, line: 2.5, cta: 5, features: 8 },
} as const;

// Absolute frame of a (designed) beat inside a scene.
export const at = (id: SceneId, beat: number): number => {
  const scale = DESIGN[id] ? sceneLength(id) / (DESIGN[id]! * BEAT) : 1;
  return sceneStart(id) + Math.round(beat * BEAT * scale);
};
// Length in frames of `beats` designed beats in a scene.
export const span = (id: SceneId, beats: number): number => Math.round(beats * BEAT * (DESIGN[id] ? sceneLength(id) / (DESIGN[id]! * BEAT) : 1));

// ---------- narration: sentences and subtitles ----------
// A line is cut into pieces; each boundary is placed where the speaker actually pauses,
// found near where the text says it should be.
const placePieces = (id: SceneId, pieces: string[]): number[] => {
  const { dur, gaps } = VO[id];
  const total = pieces.join(' ').length;
  const starts = [0];
  let chars = 0, used = -1;
  for (let i = 1; i < pieces.length; i++) {
    chars += pieces[i - 1].length + 1;
    const guess = (chars / total) * dur;
    let best = -1, bestD = 1.6;
    gaps.forEach(([a, b], k) => { const d = Math.abs((a + b) / 2 - guess); if (k > used && d < bestD) { best = k; bestD = d; } });
    if (best >= 0) { used = best; starts.push(gaps[best][1] - 0.05); } else starts.push(Math.max(starts[i - 1] + 0.4, guess));
  }
  return starts.map(t => voStart(id) + Math.round(t * FPS));
};

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/);
// Subtitle chunks: whole sentences, with long ones split at a comma or colon near the middle.
const chunk = (s: string): string[] => {
  if (s.length <= 62) return [s];
  const mid = s.length / 2;
  let cut = -1;
  for (const m of s.matchAll(/[,:] /g)) if (cut < 0 || Math.abs(m.index! - mid) < Math.abs(cut - mid)) cut = m.index!;
  if (cut < 12 || cut > s.length - 12) return [s];
  return [...chunk(s.slice(0, cut + 1)), ...chunk(s.slice(cut + 2))];
};

export const SENTENCES: Record<string, number[]> = {};
export const CHUNKS: Record<string, number[]> = {};
export const SUBS: { from: number; to: number; text: string }[] = [];
for (const l of LINES) {
  const sentences = sentencesOf(l.text);
  SENTENCES[l.id] = placePieces(l.id, sentences);
  const pieces = sentences.flatMap(chunk);
  const starts = placePieces(l.id, pieces);
  CHUNKS[l.id] = starts;
  const end = voStart(l.id) + Math.round(VO[l.id].dur * FPS) + 6;
  pieces.forEach((text, i) => SUBS.push({ from: starts[i], to: i + 1 < pieces.length ? starts[i + 1] : end, text }));
}
// Frame where sentence `i` of a scene's line begins.
export const said = (id: SceneId, i: number): number => SENTENCES[id][Math.min(i, SENTENCES[id].length - 1)];
// Frame where subtitle chunk `i` of a scene's line begins (finer than sentences).
export const chunkAt = (id: SceneId, i: number): number => CHUNKS[id][Math.min(i, CHUNKS[id].length - 1)];

// ---------- typing ----------
export type Sfx = 'tap' | 'key' | 'sign' | 'send' | 'toast' | 'deny' | 'whoosh' | 'success' | 'alarm' | 'impact' | 'drain';
export type Typing = { scene: SceneId; range: readonly [number, number]; text: string };

export const TYPING: Typing[] = [
  { scene: 'signin', range: T.signin.typeUrl, text: 'trypaygate.xyz' },
  { scene: 'vault', range: T.vault.typeName, text: 'acme' },
  { scene: 'vault', range: T.vault.typeAuto, text: '25' },
  { scene: 'vault', range: T.vault.typeMax, text: '100' },
  { scene: 'vault', range: T.vault.typeDaily, text: '250' },
  { scene: 'vault', range: T.vault.typePayees, text: 'research.testnet, design.testnet' },
  { scene: 'job', range: T.job.typeTitle, text: 'Competitor pricing report' },
  { scene: 'job', range: T.job.typeBrief, text: 'Compare pricing for five rivals. One page, sources linked.' },
  { scene: 'job', range: T.job.typeBudget, text: '20' },
];

export const typed = (frame: number, t: Typing): string => {
  const a = at(t.scene, t.range[0]), b = at(t.scene, t.range[1]);
  const n = Math.round(Math.max(0, Math.min(1, (frame - a) / (b - a))) * t.text.length);
  return t.text.slice(0, n);
};
export const typingFor = (scene: SceneId, text: string): Typing => TYPING.find(t => t.scene === scene && t.text === text)!;

// ---------- interface sounds, derived from the same cues as the visuals ----------
export const cues = (): { frame: number; sfx: Sfx }[] => {
  const c: { frame: number; sfx: Sfx }[] = [];
  const add = (id: SceneId, beat: number, sfx: Sfx) => c.push({ frame: at(id, beat), sfx });
  const on = (frame: number, sfx: Sfx) => c.push({ frame, sfx });
  for (const t of TYPING) {
    const a = at(t.scene, t.range[0]), b = at(t.scene, t.range[1]);
    for (let i = 0; i < t.text.length; i++) if (t.text[i] !== ' ') c.push({ frame: Math.round(a + ((b - a) * (i + 1)) / t.text.length), sfx: 'key' });
  }
  // problem, defences, intro, audience, how it works
  on(said('hook', 1) - 6, 'alarm'); on(said('hook', 2) + 20, 'drain');
  for (let i = 1; i <= 3; i++) on(said('fail', i), 'deny');
  on(sceneStart('intro'), 'whoosh'); on(said('intro', 0) + 30, 'success');
  for (let i = 0; i < 3; i++) on(sceneStart('who') + 20 + i * 12, 'toast');
  on(said('how', 0) + 10, 'sign'); on(said('how', 1), 'tap'); on(said('how', 2), 'whoosh'); on(said('how', 3), 'alarm');
  // product
  add('signin', T.signin.enter, 'tap'); add('signin', T.signin.tapSignIn, 'tap'); add('signin', T.signin.wallet, 'whoosh');
  add('signin', T.signin.tapSign, 'sign'); add('signin', T.signin.toast, 'toast');
  add('vault', T.vault.tapUsdc, 'tap'); add('vault', T.vault.tapCreate, 'tap'); add('vault', T.vault.wallet, 'whoosh');
  add('vault', T.vault.tapApprove, 'sign'); add('vault', T.vault.toast, 'success');
  add('job', T.job.tapNew, 'tap'); add('job', T.job.dialog, 'whoosh'); add('job', T.job.tapPayee, 'tap');
  add('job', T.job.tapCreate, 'tap'); add('job', T.job.toast, 'toast');
  add('pay', T.pay.tapRun, 'tap'); add('pay', T.pay.delivered, 'toast'); add('pay', T.pay.tapReview, 'tap');
  add('pay', T.pay.dialog, 'whoosh'); add('pay', T.pay.tapPay, 'tap'); add('pay', T.pay.paid, 'send');
  add('approve', T.approve.held, 'alarm'); add('approve', T.approve.tapReview, 'tap'); add('approve', T.approve.dialog, 'whoosh');
  add('approve', T.approve.tapApprove, 'tap'); add('approve', T.approve.wallet, 'whoosh'); add('approve', T.approve.tapSign, 'sign');
  add('approve', T.approve.toast, 'success');
  add('attack', T.attack.highlight, 'alarm'); add('attack', T.attack.hijack, 'whoosh');
  for (let i = 0; i < T.attack.rows; i++) add('attack', T.attack.firstRow + i, 'deny');
  add('attack', T.attack.result, 'impact'); add('attack', T.attack.zero, 'success');
  add('evidence', T.evidence.tapVerify, 'tap'); add('evidence', T.evidence.verified, 'success'); add('evidence', T.evidence.controls, 'whoosh');
  add('evidence', T.evidence.tapFreeze, 'tap'); add('evidence', T.evidence.wallet, 'whoosh'); add('evidence', T.evidence.tapSign, 'sign'); add('evidence', T.evidence.toast, 'toast');
  add('end', T.end.logo, 'whoosh');
  return c.sort((x, y) => x.frame - y.frame);
};
