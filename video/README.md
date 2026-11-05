# PayGate demo video

A narrated 2:19 product demo at 1920x1080, for YouTube and X, built with [Remotion](https://www.remotion.dev). Every frame is React. The score and interface sounds are synthesized in code, and the narration was generated with Higgsfield (Seed Audio).

It covers the problem, why today's defences fail, who PayGate is for, how it works, a walkthrough of the app, the hijack attack and the evidence and controls.

## Commands

```bash
npm install
node scripts/copy-css.mjs     # copy ../public/style.css into src/app.css (after the app's CSS changes)
node scripts/vo-timing.mjs    # measure narration/*.m4a into src/vo.ts (after replacing narration)
node scripts/make-audio.ts    # mix narration, score and sounds into public/soundtrack.wav
npm run studio                # preview and scrub
npm run render                # out/paygate-demo-1920x1080.mp4
node scripts/review.mjs Wide 0 900 2400   # review stills into review2/
```

## How it fits together

- `src/script.ts` holds the narration text. It is also the subtitle text.
- `narration/*.m4a` are the narration clips, one per scene: pauses tightened, 1.16x tempo (pitch kept), loudness normalized, AAC 192 kbps. The untouched takes are in `vo-raw/` (not committed).
- `src/timeline.ts` is the only source of timing. Each scene lasts as long as its line, rounded up to a beat (120 BPM). Subtitles and explainer animations snap to the pauses measured in each clip. The visuals and `scripts/make-audio.ts` both read it, so voice, picture and sounds cannot drift.
- `src/explain.tsx` contains the explainer scenes. `src/pages.tsx` rebuilds the app's screens with its real class names and copy. `src/app.css` is generated from the app's stylesheet.
- The music ducks about 9 dB under the voice. The final mix is about -16 LUFS.

To change a line: edit `src/script.ts`, regenerate that clip with the same voice, process it like the others (see `vo-raw/`), then run `vo-timing`, `make-audio` and `render`.

## What is real and what is example data

Real, from `docs/attack-demo-log.txt`: the 12 blocked attempts and their reasons, "12 blocked" and "Attacker received 0 NEAR". The only change is the attacker's name, from `attacker.sandbox` to `attacker.near`.

Real copy: all app headings, labels, buttons and toast messages come from `public/app.js` and `public/index.html`. The problem and defences wording follows README.md.

Example data (fictional):

| What | Value |
| --- | --- |
| Owner account | `maya.near` |
| Factory / vault | `vaults.near` / `acme.vaults.near` |
| Payees | `research.near`, `design.near` |
| Opening "agent wallet" | 500 USDC; `research.near`, `data.near`, `contractor.near`, `agent-7.near`, `attacker.near` |
| Currency and balance | USDC, 500 USDC (400 after payments) |
| Limits | 25 USDC automatic, 100 per payment, 250 per day |
| Initial funding | 2 NEAR |
| Jobs | "Competitor pricing report" 20 USDC (`job-7f3a`), "Logo refresh" 80 USDC (`job-9c21`), "API credits top-up" 12 USDC, "Vendor list summary" 15 USDC (`job-d41e`) |
| Job briefs and the delivery text | Written for the video |
| Dollar values | ≈ $20.00, ≈ $80.00, ≈ $12.00 |
| Transaction hashes | `8Hk2…Qe7v`, `4Ft9…xR2m`, `9Wd1…mL5c` (fake) |
| Window reset | 23 h, "Tomorrow, 9:12" |
| Wallet sheet | Generic, not any real wallet |
