'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { FrameClock, interpolate } from '@/lib/frame-clock';
import {
  createRun,
  FIXED_TICK,
  MODES,
  move,
  multiplier,
  roundTheme,
  step,
  type Event,
  type GameMode,
  type Run,
} from '@/lib/game';

type Burst = Event & { age: number };
const DEFAULT_MODE: GameMode = 'classic';
const activePhase = (run: Run) =>
  run.phase === 'playing' || run.phase === 'paused';

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null),
    board = useRef<HTMLDivElement>(null),
    run = useRef(createRun(DEFAULT_MODE)),
    clock = useRef(new FrameClock(FIXED_TICK));
  const touch = useRef<number | null>(null),
    bursts = useRef<Burst[]>([]),
    audio = useRef<AudioContext | null>(null),
    soundRef = useRef(true);
  const [hud, setHud] = useState<Run>(() => createRun(DEFAULT_MODE)),
    [sound, setSound] = useState(true);

  const publish = () => setHud({ ...run.current, items: [] });
  const unlock = () => {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    } catch {}
  };
  const playSound = (kind: Event['kind']) => {
    const a = audio.current;
    if (!soundRef.current || !a || a.state !== 'running' || kind === 'miss')
      return;
    const frequencies =
      kind === 'noise'
        ? [130, 65]
        : kind === 'streak'
          ? [660, 880, 1100, 1320]
          : kind === 'pulse'
            ? [220, 440, 880]
            : kind === 'shield'
              ? [440, 660, 880]
              : [660 + multiplier(run.current) * 110, 990];
    frequencies.forEach((frequency, i) => {
      const oscillator = a.createOscillator(),
        gain = a.createGain(),
        time = a.currentTime + i * 0.045;
      oscillator.type = kind === 'noise' ? 'sawtooth' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, time);
      gain.gain.setValueAtTime(0.055, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
      oscillator.connect(gain);
      gain.connect(a.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.14);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  };
  const emit = (events: Event[]) => {
    for (const event of events) {
      if (event.kind !== 'round') bursts.current.push({ ...event, age: 0 });
      playSound(event.kind);
    }
  };
  const start = () => {
    clock.current.reset();
    unlock();
    run.current = createRun(DEFAULT_MODE);
    run.current.phase = 'playing';
    bursts.current = [];
    publish();
    board.current?.focus({ preventScroll: true });
  };
  const steer = (direction: number) => move(run.current, direction);
  const pause = () => {
    clock.current.reset();
    const current = run.current;
    if (current.phase === 'playing') current.phase = 'paused';
    else if (current.phase === 'paused') {
      unlock();
      current.phase = 'playing';
      board.current?.focus({ preventScroll: true });
    }
    publish();
  };
  const toggleSound = () => {
    soundRef.current = !soundRef.current;
    setSound(soundRef.current);
    unlock();
    try {
      localStorage.setItem('signalrun.sound', String(soundRef.current));
    } catch {}
  };

  useEffect(() => {
    try {
      const stored =
        localStorage.getItem('signalrun.sound') ??
        localStorage.getItem('signal-run-sound');
      soundRef.current = stored !== 'false';
      setSound(soundRef.current);
    } catch {}
    return () => {
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: {
              name: string;
              description: string;
              inputSchema: object;
              annotations: object;
              execute: (input: unknown) => unknown;
            },
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const startFromTool = (input: unknown) => {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw new Error('Expected an empty object');
      flushSync(() => {
        start();
      });
      return {
        mode: DEFAULT_MODE,
        phase: run.current.phase,
        score: run.current.score,
        lives: run.current.lives,
      };
    };
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'start_signalrun',
            description:
              'Start or restart the visible SignalRun classic teaser.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
            execute: startFromTool,
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
      void Promise.resolve(
        context.registerTool(
          {
            name: 'start_signal_run',
            description:
              'Start or restart the visible Signal Run classic teaser.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
            execute: startFromTool,
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let frame = 0,
      last = 0,
      update = 0,
      smoothLane = 1,
      previousRun = run.current,
      previousElapsed = 0;
    const previousPositions = new Map<number, number>(),
      reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const draw = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      const current = run.current,
        before = current.phase;
      if (current !== previousRun) {
        previousRun = current;
        previousPositions.clear();
        previousElapsed = current.elapsed;
        smoothLane = current.lane;
      }
      const { steps, alpha } = clock.current.advance(
        now,
        current.phase === 'playing',
      );
      const events: Event[] = [];
      for (let tick = 0; tick < steps && current.phase === 'playing'; tick++) {
        previousPositions.clear();
        for (const item of current.items)
          previousPositions.set(item.id, item.z);
        previousElapsed = current.elapsed;
        events.push(...step(current, FIXED_TICK));
      }
      emit(events);
      update += dt;
      if (
        (current.phase === 'playing' && update > 0.1) ||
        before !== current.phase ||
        events.length
      ) {
        publish();
        update = 0;
      }
      const renderAlpha = current.phase === 'playing' ? alpha : 1,
        renderElapsed = interpolate(
          previousElapsed,
          current.elapsed,
          renderAlpha,
        ),
        w = c.clientWidth,
        h = c.clientHeight,
        dpr = Math.min(devicePixelRatio || 1, 2);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const point = (x: number, z: number) => ({
        x: w / 2 + x * (w * 0.07 + z * w * 0.41),
        y: h * 0.1 + z * z * h * 0.83,
      });
      const theme = roundTheme(current),
        tier = multiplier(current),
        gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, '#111b26');
      gradient.addColorStop(0.6, '#0a1118');
      gradient.addColorStop(1, theme.floor);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      const impact = bursts.current.find(
        (b) => (b.kind === 'noise' || b.kind === 'streak') && b.age < 0.22,
      );
      if (impact && !reduced.matches)
        ctx.translate(
          Math.sin(impact.age * 130) *
            (impact.tier === 5 ? 6 : 3) *
            (1 - impact.age / 0.22),
          Math.cos(impact.age * 100) * 2,
        );
      ctx.lineWidth = 1;
      for (let i = -5; i <= 5; i++) {
        const a = point(i / 3, 0),
          b = point(i / 3, 1.1);
        ctx.strokeStyle =
          i === -3 || i === 3 ? `${theme.color}90` : '#80939820';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let i = 0; i < 18; i++) {
        const z = (i / 18 + (reduced.matches ? 0 : renderElapsed * 0.19)) % 1,
          a = point(-1.7, z),
          b = point(1.7, z);
        ctx.strokeStyle = '#80a6ad20';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const items =
        current.phase === 'ready'
          ? [
              { id: 0, lane: 0, z: 0.64, kind: 'signal' as const },
              { id: 1, lane: 2, z: 0.48, kind: 'noise' as const },
              { id: 2, lane: 1, z: 0.26, kind: 'shield' as const },
            ]
          : current.items;
      for (const item of items) {
        const z =
          current.phase === 'ready'
            ? item.z
            : interpolate(
                previousPositions.get(item.id) ?? 0,
                item.z,
                renderAlpha,
              );
        const p = point(((item.lane - 1) * 2) / 3, z),
          size = 5 + z * 19;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle =
          item.kind === 'signal'
            ? '#c2ff59'
            : item.kind === 'noise'
              ? '#ff718f'
              : '#75dcff';
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = reduced.matches ? 0 : 16;
        if (item.kind === 'signal') {
          ctx.rotate(Math.PI / 4);
          ctx.strokeRect(-size / 2, -size / 2, size, size);
          ctx.fillStyle = '#c2ff5920';
          ctx.fillRect(-size / 2, -size / 2, size, size);
        } else if (item.kind === 'noise') {
          ctx.beginPath();
          ctx.moveTo(-size / 2, -size / 2);
          ctx.lineTo(size / 2, size / 2);
          ctx.moveTo(size / 2, -size / 2);
          ctx.lineTo(-size / 2, size / 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, size / 1.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#75dcff';
          ctx.fillRect(-3, -3, 6, 6);
        }
        ctx.restore();
      }
      smoothLane = reduced.matches
        ? current.lane
        : smoothLane + (current.lane - smoothLane) * Math.min(1, dt * 22);
      const player = point(((smoothLane - 1) * 2) / 3, 0.92);
      if (tier > 1 && activePhase(current)) {
        ctx.save();
        ctx.strokeStyle = theme.color;
        ctx.shadowColor = theme.color;
        ctx.shadowBlur = reduced.matches ? 0 : tier * 5;
        ctx.lineWidth = tier * 2;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(player.x, player.y + 12);
        ctx.lineTo(player.x, Math.min(h, player.y + 24 + tier * 12));
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.fillStyle = '#c2ff59';
      ctx.shadowColor = '#c2ff59';
      ctx.shadowBlur = reduced.matches ? 0 : 18 + tier * 6;
      if (current.invincible > 0 && !reduced.matches)
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(now / 50));
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(21, 16);
      ctx.lineTo(0, 7);
      ctx.lineTo(-21, 16);
      ctx.closePath();
      ctx.fill();
      if (current.shield) {
        ctx.strokeStyle = '#75dcff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 33, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      for (const burst of bursts.current) {
        if (current.phase !== 'paused') burst.age += dt;
        const p = point(((burst.lane - 1) * 2) / 3, 0.91),
          color =
            burst.kind === 'noise'
              ? '#ff718f'
              : burst.kind === 'shield' || burst.kind === 'pulse'
                ? '#75dcff'
                : '#c2ff59';
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - burst.age / 0.85);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        if (!reduced.matches && burst.kind !== 'miss') {
          ctx.beginPath();
          ctx.arc(
            p.x,
            p.y,
            10 +
              burst.age *
                (burst.kind === 'pulse'
                  ? w
                  : burst.kind === 'streak'
                    ? 140 + (burst.tier ?? 2) * 35
                    : 100),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          burst.text,
          p.x,
          p.y -
            (burst.kind === 'streak' ? 90 : 42) -
            (reduced.matches ? 0 : burst.age * 40),
        );
        ctx.restore();
      }
      bursts.current = bursts.current.filter((b) => b.age < 0.85);
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const hide = () => {
      clock.current.reset();
      if (run.current.phase === 'playing') {
        run.current.phase = 'paused';
        publish();
      }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  const active = hud.phase === 'playing' || hud.phase === 'paused',
    duration = MODES[hud.mode].duration,
    time =
      duration === Infinity
        ? `${Math.floor(hud.elapsed)}s`
        : `${Math.max(0, Math.ceil(duration - hud.elapsed))}s`;

  return (
    <main id="top">
      <header className="nav">
        <Link href="/" aria-label="MadAboutSoftware home">
          <Image
            src="/logo.png"
            alt="MadAboutSoftware"
            width={235}
            height={72}
          />
        </Link>
        <nav>
          <a href="#games">Our games ↗</a>
          <a
            href="https://linkedin.com/in/crmp"
            target="_blank"
            rel="noreferrer"
          >
            Let’s talk ↗
          </a>
        </nav>
      </header>
      <section className="hero">
        <div className="intro">
          <p className="eyebrow">
            <i /> INDEPENDENT MINDS. PLAYFUL WORLDS.
          </p>
          <h1>
            Seriously
            <br />
            mad about
            <br />
            <em>play.</em>
          </h1>
          <p className="lede">
            Sharp product intuition.
            <br />
            An obsession with a great game.
            <br />
            That’s MadAboutSoftware.
          </p>
          <a className="text-link" href="#games">
            Discover our games <span>↓</span>
          </a>
          <div className="side-note">PRODUCT THINKING × GAME MAKING</div>
        </div>
        {/* The canvas game is a keyboard-operated application, with native buttons as alternatives. */}
        {/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          className="arcade"
          ref={board}
          tabIndex={0}
          role="application"
          aria-label="Signal Run game. Move with left and right arrows or A and D. P or Escape pauses."
          onKeyDown={(e) => {
            const key = e.key.toLowerCase();
            if (
              (e.target as HTMLElement).tagName === 'BUTTON' &&
              (key === ' ' || key === 'enter')
            )
              return;
            if (
              [
                'arrowleft',
                'arrowright',
                'a',
                'd',
                'p',
                'escape',
              ].includes(key)
            )
              e.preventDefault();
            if (key === 'arrowleft' || key === 'a') steer(-1);
            if (key === 'arrowright' || key === 'd') steer(1);
            if (e.repeat) return;
            if (key === 'p' || key === 'escape') pause();
          }}
          onPointerDown={(e) => {
            touch.current = e.clientX;
          }}
          onPointerUp={(e) => {
            if (touch.current === null) return;
            const distance = e.clientX - touch.current;
            if (Math.abs(distance) > 22) steer(Math.sign(distance));
            touch.current = null;
          }}
          onPointerCancel={() => {
            touch.current = null;
          }}
        >
          <div className="game-top">
            <span>
              <i /> LAB / 001
            </span>
            <span>CLASSIC MODE</span>
          </div>
          <div className="game-title">
            <h2>
              SIGNAL
              <br />
              <span>RUN</span>
            </h2>
            <p>
              Catch signal.
              <br />
              Dodge noise.
            </p>
          </div>
          <div className="hud">
            <div>
              SCORE<strong>{String(hud.score).padStart(6, '0')}</strong>
            </div>
            <div>
              TIME<strong>{time}</strong>
            </div>
            <div>
              LIVES
              <strong>
                {'●'.repeat(hud.lives)}
                {'○'.repeat(3 - hud.lives)}
              </strong>
            </div>
          </div>
          <canvas
            ref={canvas}
            aria-label="Three lane playfield. Catch green diamonds and avoid pink crosses."
          />
          {hud.phase !== 'playing' && (
            <div
              className={`game-overlay ${
                hud.phase === 'ready' ? 'initial' : ''
              }`}
            >
              {hud.phase === 'ready' && (
                <p className="game-hint">{MODES[DEFAULT_MODE].description}</p>
              )}
              {hud.phase === 'over' && (
                <>
                  <p className="eyebrow">
                    {hud.lives > 0 ? 'TRANSMISSION COMPLETE' : 'OUT OF SIGNAL'}
                  </p>
                  <h3>
                    {hud.score.toLocaleString()} <small>PTS</small>
                  </h3>
                  <p>
                    Best streak {hud.maxCombo}. Signals caught {hud.collected}.
                  </p>
                </>
              )}
              {hud.phase === 'paused' && <h3>Take a breath.</h3>}
              <button
                className="play-button"
                onClick={() => (hud.phase === 'paused' ? pause() : start())}
              >
                {hud.phase === 'ready'
                  ? 'START RUN'
                  : hud.phase === 'paused'
                    ? 'RESUME RUN'
                    : 'RUN IT BACK'}{' '}
                <span>↗</span>
              </button>
              {hud.phase === 'ready' && (
                <p className="game-hint">
                  Catch ◇ · Avoid × · Three lives. Make them count.
                </p>
              )}
            </div>
          )}
          <div className="game-bottom">
            <div className="controls">
              <button
                aria-label="Move left"
                disabled={hud.phase !== 'playing'}
                onClick={() => steer(-1)}
              >
                ←
              </button>
              <button
                aria-label="Move right"
                disabled={hud.phase !== 'playing'}
                onClick={() => steer(1)}
              >
                →
              </button>
              <span>ARROWS / A D / SWIPE</span>
            </div>
            <button
              className="pause sound-toggle"
              aria-label="8-bit sound"
              aria-pressed={sound}
              onClick={toggleSound}
            >
              {sound ? '♪ ON' : '♪ OFF'}
            </button>
            <button className="pause" disabled={!active} onClick={pause}>
              {hud.phase === 'paused' ? 'RESUME' : 'PAUSE Ⅱ'}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {hud.phase === 'over'
              ? `Run finished. Score ${hud.score}.`
              : hud.phase === 'paused'
                ? 'Game paused.'
                : ''}
          </p>
        </div>
        {/* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      </section>
      <div className="ticker">
        <span>BUILT ON INSTINCT.</span>
        <b>✳</b>
        <span>MADE TO BE PLAYED.</span>
        <b>✳</b>
        <span>TUNED FOR MOBILE.</span>
      </div>
      <section id="games" className="games">
        <div className="section-heading">
          <p className="eyebrow">01 / THE GAMES</p>
          <h2>
            Find your next
            <br />
            <em>rabbit hole.</em>
          </h2>
          <p>
            Different worlds.
            <br />
            The same obsession with play.
          </p>
        </div>
        <div className="game-cards">
          <a
            className="portfolio skipper"
            href="https://skippers.gg"
            target="_blank"
            rel="noreferrer"
          >
            <div className="card-meta">
              MADABOUTSOFTWARE / 01 <span>↗</span>
            </div>
            <div className="wordmark">
              Skippers<span>↗</span>
            </div>
            <div className="card-footer">
              <span>Explore the game</span>
              <span>SKIPPERS.GG ↗</span>
            </div>
          </a>
          <a
            className="portfolio lore"
            href="https://lorebound.gg"
            target="_blank"
            rel="noreferrer"
          >
            <div className="card-meta">
              MADABOUTSOFTWARE / 02 <span>↗</span>
            </div>
            <div className="wordmark">
              Lorebound<span>✳</span>
            </div>
            <div className="card-footer">
              <span>Enter the world</span>
              <span>LOREBOUND.GG ↗</span>
            </div>
          </a>
          <a
            className="portfolio signalrun"
            href="https://signalrun.gg"
            target="_blank"
            rel="noreferrer"
          >
            <div className="card-meta">
              MADABOUTSOFTWARE / 03 <span>↗</span>
            </div>
            <div className="wordmark">
              SignalRun<span>ϟ</span>
            </div>
            <div className="card-footer">
              <span>Catch the signal</span>
              <span>SIGNALRUN.GG ↗</span>
            </div>
          </a>
        </div>
      </section>
      <section className="about">
        <p className="eyebrow">02 / BEHIND THE PLAY</p>
        <div>
          <h2>
            A game is a product.
            <br />
            <span>
              A great one makes
              <br />
              you feel something.
            </span>
          </h2>
          <p>
            MadAboutSoftware is an independent mobile gaming studio and product
            management advisory. Behind it: a veteran product manager who has
            built software used by tens of thousands of small businesses and
            enterprise software users.
          </p>
          <p>
            That experience shapes every game—and every product conversation.
          </p>
          <a
            className="text-link"
            href="https://linkedin.com/in/crmp"
            target="_blank"
            rel="noreferrer"
          >
            Meet the mind behind the games ↗
          </a>
        </div>
      </section>
      <footer>
        <p>
          Have a good feeling
          <br />
          about this?{' '}
          <a
            href="https://linkedin.com/in/crmp"
            target="_blank"
            rel="noreferrer"
          >
            Let’s talk ↗
          </a>
        </p>
        <div>
          <span>© {new Date().getFullYear()} MadAboutSoftware</span>
          <span>GREAT PRODUCTS. SERIOUS PLAY.</span>
          <a href="#top">BACK TO TOP ↑</a>
        </div>
      </footer>
    </main>
  );
}
