import React, { useLayoutEffect, useRef, useState } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { at, BEAT, type SceneId } from './timeline';

export type Layout = 'wide' | 'tall';
export const ease = Easing.bezier(0.65, 0, 0.35, 1);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

// 0 → 1 over `beats` starting at a beat in a scene.
export const prog = (frame: number, scene: SceneId, beat: number, beats = 0.5, e = easeOut) =>
  interpolate(frame, [at(scene, beat), at(scene, beat) + beats * BEAT], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });
export const after = (frame: number, scene: SceneId, beat: number) => frame >= at(scene, beat);

// ---------- camera ----------
// A key says: from this beat, frame the element marked data-f={focus} at zoom s.
// focus 'top' frames the top of the page. Positions are measured from the DOM, so the
// same keys work for the desktop and the phone layout.
export type CamKey = { beat: number; focus: string; s: number; dur?: number; ax?: number; ay?: number };

type Rects = Record<string, { x: number; y: number; w: number; h: number }>;

export const Viewport: React.FC<{
  scene: SceneId; w: number; h: number; scale: number; keys: CamKey[];
  children: React.ReactNode; overlay?: React.ReactNode; mobile: boolean;
}> = ({ scene, w, h, scale, keys, children, overlay, mobile }) => {
  const frame = useCurrentFrame();
  const root = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<{ rects: Rects; H: number }>({ rects: {}, H: h });

  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    // Layout offsets ignore transforms, so moving the camera never changes what it measures.
    const rects: Rects = {};
    el.querySelectorAll<HTMLElement>('[data-f]').forEach(n => {
      let x = 0, y = 0, p: HTMLElement | null = n;
      while (p && p !== el) { x += p.offsetLeft; y += p.offsetTop; p = p.offsetParent as HTMLElement | null; }
      rects[n.dataset.f!] = { x: Math.round(x), y: Math.round(y), w: n.offsetWidth, h: n.offsetHeight };
    });
    const next = { rects, H: el.offsetHeight };
    if (JSON.stringify(next) !== JSON.stringify(m)) setM(next);
  });

  const solve = (key: CamKey) => {
    const s = key.s;
    let tx = 0, ty = 0;
    const r = m.rects[key.focus];
    if (key.focus !== 'top' && r) {
      tx = w / 2 - s * (r.x + r.w * (key.ax ?? 0.5));
      ty = h / 2 - s * (r.y + r.h * (key.ay ?? 0.5));
    }
    tx = Math.min(0, Math.max(w - s * w, tx));
    ty = Math.min(0, Math.max(Math.min(0, h - s * m.H), ty));
    return { s, tx, ty };
  };
  let cam = solve(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    const t = interpolate(frame, [at(scene, keys[i].beat), at(scene, keys[i].beat) + (keys[i].dur ?? 1) * BEAT], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    if (t <= 0) break;
    const b = solve(keys[i]);
    cam = { s: cam.s + (b.s - cam.s) * t, tx: cam.tx + (b.tx - cam.tx) * t, ty: cam.ty + (b.ty - cam.ty) * t };
  }

  return (
    <div className={`pg${mobile ? ' m' : ''}`} style={{ position: 'relative', width: w * scale, height: h * scale, overflow: 'hidden', background: '#fff' }}>
      <div ref={root} style={{ position: 'absolute', left: 0, top: 0, width: w, transformOrigin: '0 0', transform: `scale(${scale}) translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` }}>
        {children}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, transformOrigin: '0 0', transform: `scale(${scale})`, pointerEvents: 'none' }}>
        {overlay}
      </div>
    </div>
  );
};

// ---------- interaction ----------
// A visible touch on whatever element it sits in. The parent needs position: relative.
export const Touch: React.FC<{ scene: SceneId; beat: number }> = ({ scene, beat }) => {
  const frame = useCurrentFrame();
  const f = frame - at(scene, beat);
  if (f < -6 || f > 16) return null;
  const press = interpolate(f, [-6, 0, 3], [0, 1, 0.85], { extrapolateRight: 'clamp' });
  const ring = interpolate(f, [0, 16], [0.6, 2.2], { extrapolateLeft: 'clamp' });
  const fade = interpolate(f, [0, 16], [0.9, 0], { extrapolateLeft: 'clamp' });
  return (
    <span style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, zIndex: 5, pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', left: -22, top: -22, width: 44, height: 44, borderRadius: 99, background: 'rgba(216,145,58,.35)', border: '2px solid #d8913a', transform: `scale(${f < 0 ? press : 1 - Math.min(1, f / 14) * 0.15})`, opacity: f < 0 ? press : fade + 0.1 }} />
      {f >= 0 && <span style={{ position: 'absolute', left: -22, top: -22, width: 44, height: 44, borderRadius: 99, border: '2px solid #d8913a', transform: `scale(${ring})`, opacity: fade }} />}
    </span>
  );
};

export const Caret: React.FC<{ on: boolean }> = ({ on }) => {
  const frame = useCurrentFrame();
  if (!on) return null;
  return <span style={{ display: 'inline-block', width: 2, height: '1.1em', marginLeft: 1, verticalAlign: 'text-bottom', background: '#1b3158', opacity: Math.floor(frame / 8) % 2 ? 0.2 : 1 }} />;
};

// The app's own toast, sliding up from the bottom of the screen.
export const Toast: React.FC<{ scene: SceneId; beat: number; until?: number; text: string; mobile: boolean }> = ({ scene, beat, until, text, mobile }) => {
  const frame = useCurrentFrame();
  const inP = prog(frame, scene, beat, 0.4);
  const outP = until === undefined ? 0 : prog(frame, scene, until, 0.4, ease);
  if (inP <= 0 || outP >= 1) return null;
  return (
    <div className="toast show" style={{ position: 'absolute', bottom: mobile ? 28 : 36, left: '50%', transform: `translate(-50%, ${(1 - inP) * 90 + outP * 90}px) scale(${mobile ? 1 : 1.35})`, transformOrigin: '50% 100%', opacity: Math.min(inP, 1 - outP), fontSize: mobile ? 15 : 16, whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
};

// A generic wallet: deliberately not any real wallet's look or name.
export const Wallet: React.FC<{
  scene: SceneId; open: number; tap: number; close: number; mobile: boolean;
  title: string; rows: [string, string][]; action: string;
}> = ({ scene, open, tap, close, mobile, title, rows, action }) => {
  const frame = useCurrentFrame();
  const inP = prog(frame, scene, open, 0.5);
  const outP = prog(frame, scene, close, 0.4, ease);
  if (inP <= 0 || outP >= 1) return null;
  const k = inP * (1 - outP);
  const done = after(frame, scene, tap + 0.25);
  const card = (
    <div style={{
      width: mobile ? '100%' : 440, background: '#fff', borderRadius: mobile ? '22px 22px 0 0' : 20, padding: mobile ? '22px 22px 34px' : 26,
      boxShadow: '0 30px 80px rgba(11,13,18,.35)', fontFamily: 'DM Sans', color: '#1d2433',
      transform: mobile ? `translateY(${(1 - k) * 110}%)` : `translateY(${(1 - k) * 40}px) scale(${1.4 * (0.96 + 0.04 * k)})`, opacity: mobile ? 1 : k,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#3b3f4a,#11131a)', display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 14, height: 11, border: '2px solid #fff', borderRadius: 3 }} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Your wallet</div>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#5b6578', border: '1px solid #e4e7ee', borderRadius: 99, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={11} />trypaygate.xyz
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginBottom: 14 }}>{title}</div>
      <div style={{ border: '1px solid #e4e7ee', borderRadius: 12, marginBottom: 20 }}>
        {rows.map(([a, b], i) => (
          <div key={a} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '11px 14px', borderTop: i ? '1px solid #e4e7ee' : 0, fontSize: 14 }}>
            <span style={{ color: '#8a93a6' }}>{a}</span><span style={{ fontWeight: 500, textAlign: 'right', fontFamily: b.length > 20 ? 'Space Mono' : 'DM Sans', fontSize: b.length > 20 ? 12.5 : 14 }}>{b}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '13px 0', borderRadius: 12, background: '#f1f2f5', fontWeight: 600, fontSize: 15 }}>Reject</div>
        <div style={{ flex: 1, textAlign: 'center', padding: '13px 0', borderRadius: 12, background: done ? '#2f7d55' : '#2b2f38', color: '#fff', fontWeight: 600, fontSize: 15, position: 'relative' }}>
          {done ? '✓ ' + (action === 'Sign' ? 'Signed' : 'Approved') : action}
          <Touch scene={scene} beat={tap} />
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, background: `rgba(11,13,18,${0.42 * k})`, display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      {card}
    </div>
  );
};

export const Lock: React.FC<{ size?: number; color?: string }> = ({ size = 12, color = '#5b6578' }) => (
  <svg width={size} height={size} viewBox="0 0 12 12"><rect x="2" y="5.2" width="8" height="5.8" rx="1.3" fill={color} /><path d="M3.8 5.4V3.9a2.2 2.2 0 0 1 4.4 0v1.5" fill="none" stroke={color} strokeWidth="1.3" /></svg>
);

export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.5" fill="none" stroke="#1b3158" strokeWidth="2.5" /><path d="M24.84 7.16A12.5 12.5 0 0 1 7.16 24.84Z" fill="#1b3158" /></svg>
);

// The app's wordmark: lowercase "paygate" with an amber dot.
export const Wordmark: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.38, color: '#1b3158', fontFamily: 'Space Grotesk', fontWeight: 400, fontSize: size, letterSpacing: -size * 0.03, lineHeight: 1 }}>
    <Logo size={size * 1.15} /><span>paygate<span style={{ color: '#d8913a' }}>.</span></span>
  </div>
);

// ---------- device frames ----------
export const BrowserFrame: React.FC<{ w: number; h: number; url: React.ReactNode; children: React.ReactNode }> = ({ w, h, url, children }) => (
  <div style={{ width: w, height: h, borderRadius: 14, overflow: 'hidden', background: '#fff', boxShadow: '0 40px 100px rgba(27,49,88,.28), 0 0 0 1px rgba(27,49,88,.12)' }}>
    <div style={{ height: 52, background: '#f2f4f8', borderBottom: '1px solid #e4e7ee', display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px' }}>
      <div style={{ display: 'flex', gap: 8 }}>{['#e6e8ee', '#e6e8ee', '#e6e8ee'].map((c, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 99, background: c, border: '1px solid #d5d9e2' }} />)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e4e7ee', borderRadius: 8, padding: '7px 12px', width: 220, fontFamily: 'DM Sans', fontSize: 13, color: '#1d2433' }}>
        <Logo size={14} />PayGate
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e4e7ee', borderRadius: 99, padding: '7px 16px', fontFamily: 'DM Sans', fontSize: 15, color: '#1d2433', maxWidth: 560 }}>
        <Lock size={12} />{url}
      </div>
    </div>
    <div style={{ height: h - 52, overflow: 'hidden' }}>{children}</div>
  </div>
);

export const PhoneFrame: React.FC<{ w: number; h: number; url: React.ReactNode; children: React.ReactNode }> = ({ w, h, url, children }) => {
  const pad = 22, k = (w - pad * 2) / 390;
  return (
    <div style={{ width: w, height: h, borderRadius: 96, background: '#0b0d12', padding: pad, boxShadow: '0 50px 120px rgba(27,49,88,.35)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 76, overflow: 'hidden', background: '#fff', position: 'relative' }}>
        <div style={{ height: 50 * k, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${30 * k}px`, fontFamily: 'DM Sans', fontWeight: 600, fontSize: 15 * k, color: '#0b0d12' }}>
          <span>9:41</span>
          <div style={{ width: 120 * k, height: 32 * k, borderRadius: 99, background: '#0b0d12', marginTop: 4 * k }} />
          <span style={{ display: 'flex', gap: 5 * k, alignItems: 'center' }}><span style={{ width: 22 * k, height: 11 * k, borderRadius: 3 * k, border: `${1.5 * k}px solid #0b0d12`, display: 'inline-block', position: 'relative' }}><span style={{ position: 'absolute', inset: 1.5 * k, background: '#0b0d12', borderRadius: 1.5 * k }} /></span></span>
        </div>
        <div style={{ height: 42 * k, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 * k, background: '#f2f4f8', borderRadius: 12 * k, padding: `${7 * k}px ${16 * k}px`, fontFamily: 'DM Sans', fontSize: 15 * k, color: '#1d2433', width: 350 * k, justifyContent: 'center' }}>
            <Lock size={12 * k} />{url}
          </div>
        </div>
        <div style={{ height: `calc(100% - ${92 * k}px)`, overflow: 'hidden' }}>{children}</div>
      </div>
    </div>
  );
};
