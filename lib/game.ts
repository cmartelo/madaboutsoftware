export type GameMode = 'sprint' | 'endless' | 'classic';
export const FIXED_TICK = 0.05;
export const ROUND_LENGTH = 10;
export type Phase = 'ready' | 'playing' | 'paused' | 'over';
export type Item = {
  id: number;
  lane: number;
  z: number;
  kind: 'signal' | 'noise' | 'shield';
  value?: number;
};
export type Event = {
  lane: number;
  kind: Item['kind'] | 'pulse' | 'miss' | 'streak' | 'round';
  text: string;
  tier?: number;
};
export const MODES: Record<
  GameMode,
  { name: string; duration: number; description: string }
> = {
  sprint: {
    name: 'Sprint',
    duration: 60,
    description: '60 seconds. Build your combo. Make every signal count.',
  },
  endless: {
    name: 'Endless',
    duration: Infinity,
    description: 'No finish line. Survive as the network gets faster.',
  },
  classic: {
    name: 'Classic',
    duration: 30,
    description: 'The original rules. 30 seconds. Pure instinct.',
  },
};
export type Run = {
  mode: GameMode;
  phase: Phase;
  lane: number;
  score: number;
  lives: number;
  elapsed: number;
  spawn: number;
  items: Item[];
  nextId: number;
  beat: number;
  pathLane: number;
  pathDirection: number;
  combo: number;
  maxCombo: number;
  collected: number;
  missed: number;
  hits: number;
  energy: number;
  shield: boolean;
  invincible: number;
  pulses: number;
};
export const createRun = (mode: GameMode = 'sprint'): Run => ({
  mode,
  phase: 'ready',
  lane: 1,
  score: 0,
  lives: 3,
  elapsed: 0,
  spawn: 0,
  items: [],
  nextId: 0,
  beat: 0,
  pathLane: 1,
  pathDirection: 1,
  combo: 0,
  maxCombo: 0,
  collected: 0,
  missed: 0,
  hits: 0,
  energy: 0,
  shield: false,
  invincible: 0,
  pulses: 0,
});
export const multiplier = (r: Run) =>
  r.mode === 'classic' ? 1 : Math.min(5, 1 + Math.floor(r.combo / 5));
export const sector = (r: Run) =>
  r.mode === 'classic'
    ? 1
    : 1 +
      Math.floor(
        Math.min(r.elapsed, MODES[r.mode].duration - 0.001) / ROUND_LENGTH,
      );
export const ROUND_THEMES = [
  {
    color: '#c2ff59',
    floor: '#122016',
  },
  {
    color: '#ffbc75',
    floor: '#281c15',
  },
  {
    color: '#75dcff',
    floor: '#10232c',
  },
  {
    color: '#c6a0ff',
    floor: '#20162d',
  },
];
export const roundTheme = (r: Run) => ROUND_THEMES[Math.min(3, sector(r) - 1)];
export const move = (r: Run, direction: number) => {
  if (r.phase === 'playing')
    r.lane = Math.max(0, Math.min(2, r.lane + Math.sign(direction)));
};
export function pulse(r: Run): Event[] {
  if (r.phase !== 'playing' || r.mode === 'classic' || r.energy < 100)
    return [];
  r.energy = 0;
  r.pulses++;
  r.invincible = Math.max(r.invincible, 0.65);
  r.items = r.items.filter((item) => item.kind !== 'noise');
  return [{ lane: r.lane, kind: 'pulse', text: 'NOISE CLEARED' }];
}
export function step(
  r: Run,
  delta: number,
  random: () => number = Math.random,
): Event[] {
  if (r.phase !== 'playing') return [];
  const dt = Math.max(
    0,
    Math.min(delta, 0.05, MODES[r.mode].duration - r.elapsed),
  );
  const events: Event[] = [];
  const previousRound = sector(r);
  r.elapsed += dt;
  if (sector(r) !== previousRound) {
    r.beat = 0;
    events.push({ lane: r.lane, kind: 'round', text: `ROUND ${sector(r)}` });
  }
  r.spawn += dt;
  r.invincible = Math.max(0, r.invincible - dt);
  const difficulty = Math.min(10, sector(r));
  const interval =
    r.mode === 'classic' ? 0.62 : Math.max(0.32, 0.76 - difficulty * 0.045);
  if (r.spawn >= interval) {
    r.spawn -= interval;
    const lane = Math.floor(random() * 3);
    const roll = random();
    if (r.mode !== 'classic') {
      const pathCadence = difficulty === 1 ? 3 : 2;
      const previousPathLane = r.pathLane;
      if (r.beat % pathCadence === 0) {
        if (r.pathLane === 2) r.pathDirection = -1;
        if (r.pathLane === 0) r.pathDirection = 1;
        r.pathLane += r.pathDirection;
      }
      const advancedDifficulty = difficulty >= 3;
      const gateCadence = difficulty >= 4 ? 3 : 4;
      const gate =
        advancedDifficulty && r.beat % gateCadence === gateCadence - 1;
      const moved = previousPathLane !== r.pathLane;
      const value = !advancedDifficulty
        ? 100
        : gate
          ? difficulty >= 4
            ? 200
            : 150
          : moved
            ? 125
            : 100;
      r.items.push({
        id: r.nextId++,
        lane: r.pathLane,
        z: 0,
        kind: roll > 0.95 ? 'shield' : 'signal',
        value,
      });
      if (gate) {
        for (let other = 0; other < 3; other++) {
          if (other !== r.pathLane)
            r.items.push({ id: r.nextId++, lane: other, z: 0, kind: 'noise' });
        }
      } else if (r.beat % (difficulty === 1 ? 3 : 2) === 1) {
        const hazardLane = (r.pathLane + (lane % 2) + 1) % 3;
        r.items.push({ id: r.nextId++, lane: hazardLane, z: 0, kind: 'noise' });
      }
      r.beat++;
    } else {
      r.items.push({
        id: r.nextId++,
        lane,
        z: 0,
        kind: roll < 0.34 ? 'noise' : 'signal',
      });
    }
  }
  const speed =
    r.mode === 'classic'
      ? 0.42 + r.elapsed * 0.004
      : Math.min(0.92, 0.4 + difficulty * 0.035);
  for (const item of r.items) {
    item.z += dt * speed;
    if (item.z < 0.91) continue;
    if (item.lane === r.lane) {
      if (item.kind === 'signal') {
        const previousMultiplier = multiplier(r);
        r.combo++;
        r.maxCombo = Math.max(r.maxCombo, r.combo);
        r.collected++;
        const points = (item.value ?? 100) * multiplier(r);
        r.score += points;
        if (r.mode !== 'classic') r.energy = Math.min(100, r.energy + 10);
        events.push({ lane: item.lane, kind: 'signal', text: `+${points}` });
        if (multiplier(r) > previousMultiplier)
          events.push({
            lane: item.lane,
            kind: 'streak',
            text: multiplier(r) === 5 ? 'MAX POWER' : 'STREAK UP',
            tier: multiplier(r),
          });
      } else if (item.kind === 'shield') {
        r.shield = true;
        events.push({ lane: item.lane, kind: 'shield', text: 'SHIELD ONLINE' });
      } else if (r.invincible <= 0) {
        if (r.shield) {
          r.shield = false;
          events.push({ lane: item.lane, kind: 'shield', text: 'HIT BLOCKED' });
        } else {
          r.lives--;
          r.hits++;
          r.combo = 0;
          events.push({ lane: item.lane, kind: 'noise', text: 'SIGNAL LOST' });
        }
        r.invincible = r.mode === 'classic' ? 0 : 0.75;
      }
    } else if (item.kind === 'signal') {
      r.missed++;
      r.combo = 0;
      events.push({ lane: item.lane, kind: 'miss', text: 'MISSED' });
    }
    item.z = 2;
    if (r.lives <= 0) break;
  }
  r.items = r.items.filter((item) => item.z < 2);
  if (r.lives <= 0 || r.elapsed >= MODES[r.mode].duration) r.phase = 'over';
  return events;
}
