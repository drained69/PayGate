import React from 'react';
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from 'remotion';
import './fonts';
import './app.css';
import { Eyebrow, Fail, Hook, How, Intro, Who } from './explain';
import { BrowserFrame, ease, easeOut, Logo, prog, Viewport, Wordmark } from './kit';
import { ATTACKS, AttackConsole, approve, attackBrief, evidence, job, pay, signin, vault, type SceneView } from './pages';
import { at, BEAT, SCENES, sceneLength, sceneStart, SUBS, T, type SceneId } from './timeline';

const INK = '#1b3158', AMBER = '#d8913a';

// Chapter markers beside the product. The narration and subtitles carry the detail.
const CAPTIONS: Partial<Record<SceneId, [string, string, string]>> = {
  signin: ['01', 'Sign in', 'Sign in with NEAR'],
  vault: ['02', 'Vault', 'One transaction creates your vault'],
  job: ['03', 'Jobs', 'Give the agent work'],
  pay: ['04', 'Pay', 'Small payments go out alone'],
  approve: ['05', 'Approve', 'Larger ones wait for your wallet'],
  attack: ['06', 'Attack', 'Hijacked? Still blocked.'],
  evidence: ['07', 'Evidence', 'Receipts, and a freeze button'],
};
const PRODUCT: Partial<Record<SceneId, (c: { frame: number; mobile: boolean }) => SceneView>> = { signin, vault, job, pay, approve, attack: attackBrief, evidence };

// 1920x1080 layout. The bottom band (y > 940) is kept clear for subtitles.
const DEVICE = { x: 700, y: 70, w: 1120, h: 850 };

const Stage: React.FC<{ children: React.ReactNode; strong?: boolean }> = ({ children, strong }) => (
  <AbsoluteFill style={{ background: strong ? 'linear-gradient(180deg,#bcd9f4 0%,#e3edf9 55%,#f8e7d8 100%)' : 'linear-gradient(160deg,#e3edf9 0%,#f7f8fb 45%,#fbf1e4 100%)' }}>
    <AbsoluteFill style={{ opacity: strong ? 0.35 : 0.25, backgroundImage: 'radial-gradient(#ffffff 0.9px, transparent 0.9px)', backgroundSize: '4px 4px' }} />
    {children}
  </AbsoluteFill>
);

const Caption: React.FC<{ scene: SceneId }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const c = CAPTIONS[scene]; if (!c) return null;
  const start = sceneStart(scene), end = start + sceneLength(scene);
  const inP = interpolate(frame, [start, start + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  const outP = interpolate(frame, [end - 8, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const [num, label, head] = c;
  return (
    <div style={{ position: 'absolute', left: 100, top: 0, width: 540, height: 940, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 30}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <span style={{ fontFamily: 'Space Mono', fontSize: 28, color: AMBER, fontWeight: 700 }}>{num}</span>
        <span style={{ height: 1, width: 40, background: '#c9cfdb' }} />
        <Eyebrow size={22}>{label}</Eyebrow>
      </div>
      <div style={{ fontFamily: 'Space Grotesk', fontWeight: 300, color: INK, fontSize: 70, letterSpacing: -2.5, lineHeight: 1.04, marginTop: 26 }}>{head}</div>
    </div>
  );
};

const Device: React.FC<{ scene: SceneId; view: SceneView }> = ({ scene, view }) => {
  const frame = useCurrentFrame();
  const start = sceneStart(scene);
  const settle = interpolate(frame, [start, start + BEAT * 1.25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  const dim = scene === 'attack' ? prog(frame, 'attack', T.attack.hijack, 0.5) : 0;
  const k = DEVICE.w / 1280, vh = (DEVICE.h - 52) / k;
  return (
    <div style={{ position: 'absolute', left: DEVICE.x, top: DEVICE.y, transform: `scale(${0.94 + 0.06 * settle}) translateY(${(1 - settle) * 24}px)`, transformOrigin: '50% 30%', filter: dim ? `brightness(${1 - 0.5 * dim}) blur(${dim * 4}px)` : undefined }}>
      <BrowserFrame w={DEVICE.w} h={DEVICE.h} url={view.url}>
        <Viewport key={scene} scene={scene} w={1280} h={vh} scale={k} keys={view.keys.wide} overlay={view.overlay} mobile={false}>{view.content}</Viewport>
      </BrowserFrame>
    </div>
  );
};

// Burned-in subtitles: X autoplays muted.
const Subtitles: React.FC = () => {
  const frame = useCurrentFrame();
  const sub = SUBS.find(s => frame >= s.from && frame < s.to);
  if (!sub || frame >= sceneStart('end')) return null;
  const k = interpolate(frame, [sub.from, sub.from + 5], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1500, textAlign: 'center', fontFamily: 'DM Sans', fontWeight: 500, fontSize: 40, lineHeight: 1.3, color: '#fff', background: 'rgba(11,13,18,.82)', borderRadius: 14, padding: '12px 28px', opacity: k }}>
        {sub.text}
      </div>
    </div>
  );
};

const UrlPill: React.FC<{ size: number; dark?: boolean }> = ({ size, dark }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.5, fontFamily: 'Space Mono', fontSize: size, fontWeight: 700, color: dark ? '#fff' : INK, background: dark ? '#0b0d12' : 'rgba(255,255,255,.75)', border: dark ? 0 : '1px solid #c9cfdb', borderRadius: 999, padding: `${size * 0.55}px ${size * 1.1}px` }}>
    <Logo size={size * 1.1} />trypaygate.xyz
  </div>
);
const BlockedStack: React.FC = () => (
  <div style={{ width: 700, transform: 'rotate(-4deg)' }}>
    {ATTACKS.slice(0, 3).map(([what, why], i) => (
      <div key={i} style={{ background: '#0b0d12', borderRadius: 15, padding: '20px 24px', marginTop: i ? -11 : 0, marginLeft: i * 37, display: 'flex', alignItems: 'center', gap: 18, boxShadow: '0 24px 60px rgba(11,13,18,.3)', position: 'relative', zIndex: 3 - i }}>
        <span style={{ fontFamily: 'Space Mono', fontWeight: 700, fontSize: 16, letterSpacing: 1.5, color: '#fff', background: '#b9412c', padding: '5px 11px', borderRadius: 6 }}>BLOCKED</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: 23, color: '#e8ecf3' }}>{what}</span>
          <span style={{ fontFamily: 'Space Mono', fontSize: 15, color: '#8a93a6' }}>{why}</span>
        </div>
      </div>
    ))}
  </div>
);

// Frame 0 is a finished cover (the thumbnail). It hands over to the problem after a second.
const COVER_OUT = 26;
const Cover: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [COVER_OUT - 10, COVER_OUT + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  if (out >= 1) return null;
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.04})` }}>
      <Stage strong>
        <div style={{ position: 'absolute', left: 120, top: 150, width: 980 }}>
          <Wordmark size={46} />
          <div style={{ marginTop: 64 }}><Eyebrow size={19}>Live on NEAR testnet</Eyebrow></div>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 300, color: INK, fontSize: 104, letterSpacing: -4, lineHeight: 1.0, marginTop: 24 }}>Give your AI agent a budget it can't overspend.</div>
          <div style={{ marginTop: 48 }}><UrlPill size={28} /></div>
        </div>
        <div style={{ position: 'absolute', left: 1130, top: 440 }}><BlockedStack /></div>
      </Stage>
    </AbsoluteFill>
  );
};

const End: React.FC = () => {
  const frame = useCurrentFrame();
  const a = prog(frame, 'end', T.end.logo, 0.6), b = prog(frame, 'end', T.end.line, 0.6), c = prog(frame, 'end', T.end.cta, 0.6), d = prog(frame, 'end', T.end.features, 0.6);
  const up = (p: number) => ({ opacity: p, transform: `translateY(${(1 - p) * 30}px)` });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={up(a)}><Wordmark size={64} /></div>
      <div style={{ ...up(b), fontFamily: 'Space Grotesk', fontWeight: 300, color: INK, fontSize: 124, letterSpacing: -4.5, lineHeight: 1, marginTop: 56 }}>Agent budgets,<br />enforced.</div>
      <div style={{ ...up(c), marginTop: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <Eyebrow size={21} color={INK}>Live on NEAR testnet · open source</Eyebrow>
        <UrlPill size={40} dark />
      </div>
      <div style={{ ...up(d), marginTop: 46, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14, maxWidth: 1500 }}>
        {['Agent API over REST and MCP', 'Work on NEAR AI Cloud', 'Slack, Discord and Telegram alerts', 'Gas relayer (NEP-366)', 'Close the vault, get your NEAR back'].map(f => (
          <span key={f} style={{ fontFamily: 'Space Mono', fontSize: 20, color: INK, background: 'rgba(255,255,255,.8)', border: '1px solid #c9cfdb', borderRadius: 99, padding: '10px 20px' }}>{f}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const EXPLAIN: Partial<Record<SceneId, React.FC>> = { hook: Hook, fail: Fail, intro: Intro, who: Who, how: How };

export const PayGateVideo: React.FC = () => {
  const frame = useCurrentFrame();
  let scene: SceneId = SCENES[0].id;
  for (const s of SCENES) if (frame >= sceneStart(s.id)) scene = s.id;

  let body: React.ReactNode;
  const Explain = EXPLAIN[scene];
  if (scene === 'end') body = <Stage strong><End /></Stage>;
  else if (Explain) {
    const start = sceneStart(scene), end = start + sceneLength(scene);
    const k = interpolate(frame, [start, start + 10, end - 6, end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    body = <Stage strong={scene === 'intro'}><AbsoluteFill style={{ opacity: scene === 'hook' ? 1 : k }}><Explain /></AbsoluteFill></Stage>;
  } else {
    const view = PRODUCT[scene]!({ frame, mobile: false });
    body = (
      <Stage>
        <Caption scene={scene} />
        <Device scene={scene} view={view} />
        {scene === 'attack' && frame >= at('attack', T.attack.hijack) && (
          <div style={{ position: 'absolute', left: DEVICE.x, top: DEVICE.y }}><AttackConsole w={DEVICE.w} h={DEVICE.h} layout="wide" /></div>
        )}
      </Stage>
    );
  }
  return (
    <AbsoluteFill style={{ background: '#f7f8fb' }}>
      {body}
      {scene === 'hook' && <Cover />}
      <Subtitles />
      <Audio src={staticFile('soundtrack.wav')} />
    </AbsoluteFill>
  );
};
