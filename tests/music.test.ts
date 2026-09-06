import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMusic, type Music } from '../src/client/music';
import { MUSIC_TRACKS } from '../src/client/music-tracks';

class Parameter {
  value = 1;
  deferAutomation = false;
  calls: { method: string; value: number; time: number }[] = [];
  cancelScheduledValues(time: number) {
    this.calls.push({ method: 'cancel', value: this.value, time });
  }
  setValueAtTime(value: number, time: number) {
    if (!this.deferAutomation) this.value = value;
    this.calls.push({ method: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    if (!this.deferAutomation) this.value = value;
    this.calls.push({ method: 'linear', value, time });
  }
  setTargetAtTime(value: number, time: number) {
    if (!this.deferAutomation) this.value = value;
    this.calls.push({ method: 'target', value, time });
  }
}
class Node {
  connections: Node[] = [];
  disconnected = false;
  connect(node: Node) {
    this.connections.push(node);
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Gain extends Node {
  gain = new Parameter();
}
class Context {
  static instances: Context[] = [];
  static rejectResume = false;
  static deferResume = false;
  static deferSuspend = false;
  static pendingResume: (() => void)[] = [];
  static pendingSuspend: (() => void)[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new Node();
  gains: Gain[] = [];
  sources: { media: Media; node: Node }[] = [];
  clock = 0;
  started = Date.now();
  constructor() {
    Context.instances.push(this);
  }
  get currentTime() {
    return this.clock + (this.state === 'running' ? (Date.now() - this.started) / 1000 : 0);
  }
  createGain() {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createMediaElementSource(media: Media) {
    const node = new Node();
    this.sources.push({ media, node });
    return node;
  }
  async resume() {
    if (Context.rejectResume) throw Error('resume blocked');
    if (Context.deferResume) {
      Context.deferResume = false;
      await new Promise<void>((resolve) => Context.pendingResume.push(resolve));
    }
    if (this.state !== 'running') {
      this.started = Date.now();
      this.state = 'running';
    }
  }
  async suspend() {
    if (Context.deferSuspend) {
      Context.deferSuspend = false;
      await new Promise<void>((resolve) => Context.pendingSuspend.push(resolve));
    }
    this.clock = this.currentTime;
    this.state = 'suspended';
  }
  async close() {
    this.clock = this.currentTime;
    this.state = 'closed';
  }
}
type Deferred = { resolve: () => void; reject: () => void };
class Media extends EventTarget {
  static instances: Media[] = [];
  static attempts: string[] = [];
  static deferred: Deferred[] = [];
  static deferNext = false;
  static rejectNext = false;
  src = '';
  preload = 'none';
  loop = false;
  error: object | null = null;
  duration = 240;
  ended = false;
  paused = true;
  position = 0;
  started = Date.now();
  generation = 0;
  constructor() {
    super();
    Media.instances.push(this);
  }
  get currentTime() {
    return this.position + (this.paused ? 0 : (Date.now() - this.started) / 1000);
  }
  set currentTime(value: number) {
    this.position = value;
    this.started = Date.now();
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  load() {
    this.generation++;
    this.currentTime = 0;
    this.ended = false;
    this.error = null;
  }
  play(): Promise<void> {
    Media.attempts.push(this.src);
    const generation = this.generation;
    const playing = () => {
      if (generation === this.generation) {
        this.paused = false;
        this.started = Date.now();
      }
    };
    if (Media.rejectNext) {
      Media.rejectNext = false;
      return Promise.reject(Error('NotAllowedError'));
    }
    if (Media.deferNext) {
      Media.deferNext = false;
      return new Promise((resolve, reject) =>
        Media.deferred.push({
          resolve: () => {
            playing();
            resolve();
          },
          reject: () => reject(Error('network')),
        }),
      );
    }
    playing();
    return Promise.resolve();
  }
  pause() {
    this.position = this.currentTime;
    this.paused = true;
  }
}
class Document extends EventTarget {
  hidden = false;
}
let doc: Document, players: Music[];
const tracks = () => Media.attempts.filter((src) => src.startsWith('/music/'));
const engine = () => {
  const player = createMusic();
  players.push(player);
  return player;
};
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const active = () =>
  Media.instances.find((media) => !media.paused && media.src.startsWith('/music/'))!;
const master = () => Context.instances[0].gains[0].gain;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-06T00:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0.1);
  Context.instances = [];
  Context.rejectResume = false;
  Context.deferResume = false;
  Context.deferSuspend = false;
  Context.pendingResume = [];
  Context.pendingSuspend = [];
  Media.instances = [];
  Media.attempts = [];
  Media.deferred = [];
  Media.deferNext = false;
  Media.rejectNext = false;
  players = [];
  doc = new Document();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Audio', Media);
  vi.stubGlobal('AudioContext', Context);
  let id = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:primer-${++id}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  players.forEach((player) => player.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared streamed music', () => {
  it('crossfades the single Avalon track back into itself without selecting a missing second file', async () => {
    vi.mocked(Math.random).mockReturnValue(0.9);
    const player = engine();
    player.setScene('avalon');
    await player.unlock();
    await flush(1600);
    expect(tracks()).toEqual(['/music/aval1.mp3']);
    const first = active();
    first.currentTime = first.duration - 1;
    await flush(100);
    expect(tracks()).toEqual(['/music/aval1.mp3', '/music/aval1.mp3']);
    await flush(1600);
    expect(first.paused).toBe(true);
    expect(active().src).toBe('/music/aval1.mp3');
    expect(Media.instances).toHaveLength(2);
  });
  it('creates nothing before a gesture, primes exactly two persistent elements, and normalizes separately from volume', async () => {
    const player = engine();
    player.setScene('yacht');
    player.setSettings({ muted: false, music: 0.3 });
    expect(Context.instances).toHaveLength(0);
    expect(Media.instances).toHaveLength(0);
    const unlocking = player.unlock();
    expect(Media.attempts).toEqual(['blob:primer-1', 'blob:primer-2']);
    await unlocking;
    await flush();
    expect(Context.instances).toHaveLength(1);
    expect(Media.instances).toHaveLength(2);
    expect(Context.instances[0].sources).toHaveLength(2);
    expect(tracks()).toEqual(['/music/yach1.mp3']);
    expect(master().value).toBe(0.3);
    const playing = active(),
      source = Context.instances[0].sources.find((s) => s.media === playing)!;
    expect((source.node.connections[0] as Gain).gain.value).toBe(MUSIC_TRACKS.yacht[0].gain);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    await player.unlock();
    await flush();
    expect(tracks()).toHaveLength(1);
    expect(Context.instances[0].sources).toHaveLength(2);
  });

  it('randomizes each first scene and alternates both at boundaries and on later re-entry', async () => {
    vi.mocked(Math.random).mockReturnValueOnce(0.8).mockReturnValueOnce(0.1);
    const player = engine();
    await player.unlock();
    await flush(1600);
    expect(tracks()).toEqual(['/music/lobby2.mp3']);
    const first = active();
    first.currentTime = first.duration - 9;
    await flush(100);
    expect(tracks()).toHaveLength(1);
    expect(Media.instances.some((m) => m.src === '/music/lobby1.mp3' && m.paused)).toBe(true);
    first.currentTime = first.duration - 1.3;
    await flush(100);
    expect(tracks()).toEqual(['/music/lobby2.mp3', '/music/lobby1.mp3']);
    await flush(1600);
    player.setScene('yacht');
    await flush(1600);
    player.setScene('lobby');
    await flush(1600);
    expect(tracks()).toEqual([
      '/music/lobby2.mp3',
      '/music/lobby1.mp3',
      '/music/yach1.mp3',
      '/music/lobby2.mp3',
    ]);
    expect(Media.instances).toHaveLength(2);
  });

  it('does not consume the selected index on blocked unlock or rejected playback', async () => {
    const player = engine();
    Context.rejectResume = true;
    await player.unlock();
    await flush();
    expect(tracks()).toEqual([]);
    Context.rejectResume = false;
    Media.rejectNext = true;
    await player.unlock();
    await flush();
    expect(tracks()).toEqual(['/music/lobby1.mp3']);
    await player.unlock();
    await flush();
    expect(tracks()).toEqual(['/music/lobby1.mp3', '/music/lobby1.mp3']);
    await flush(1600);
    player.setScene('yacht');
    await flush(1600);
    player.setScene('lobby');
    await flush(1600);
    expect(tracks().at(-1)).toBe('/music/lobby2.mp3');
  });

  it('ignores stale play resolutions after a scene change without pausing the replacement or advancing its predecessor', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    Media.deferNext = true;
    player.setScene('yacht');
    await flush();
    expect(Media.deferred).toHaveLength(1);
    player.setScene('tikatuka');
    await flush();
    Media.deferred[0].resolve();
    await flush(1600);
    expect(active().src).toBe('/music/tica1.mp3');
    player.setScene('yacht');
    await flush(1600);
    expect(tracks()).toEqual([
      '/music/lobby1.mp3',
      '/music/yach1.mp3',
      '/music/tica1.mp3',
      '/music/yach1.mp3',
    ]);
  });

  it('retargets rapid transitions from the current envelope and never reuses a still-audible slot', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    player.setScene('yacht');
    await flush(400);
    const outgoing = Media.instances.find((m) => m.src === '/music/lobby1.mp3')!;
    const source = Context.instances[0].sources.find((s) => s.media === outgoing)!;
    const envelope = (source.node.connections[0] as Gain).connections[0] as Gain;
    player.setScene('tikatuka');
    await flush();
    const from = envelope.gain.calls.filter((c) => c.method === 'set').at(-1)!.value;
    expect(from).toBeGreaterThan(0.6);
    expect(from).toBeLessThan(0.9);
    expect(outgoing.src).toBe('/music/lobby1.mp3');
    await flush(250);
    expect(tracks().at(-1)).toBe('/music/tica1.mp3');
    expect(Media.instances).toHaveLength(2);
  });

  it('pauses hidden or muted tracks at exact zero and resumes their position without consuming the next choice', async () => {
    const player = engine();
    await player.unlock();
    await flush(2000);
    const media = active();
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    const position = media.currentTime;
    expect(media.paused).toBe(true);
    expect(master().value).toBe(0);
    await flush(10000);
    expect(media.currentTime).toBe(position);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(media.src).toBe('/music/lobby1.mp3');
    expect(media.paused).toBe(false);
    player.setSettings({ muted: true, music: 0.4 });
    await flush(110);
    const mutedPosition = media.currentTime;
    expect(master().value).toBe(0);
    await flush(10000);
    expect(media.currentTime).toBe(mutedPosition);
    player.setSettings({ muted: false, music: 0.4 });
    await flush();
    expect(media.paused).toBe(false);
    expect(master().value).toBe(0.4);
    expect(tracks().every((src) => src === '/music/lobby1.mp3')).toBe(true);
    player.setScene('yacht');
    await flush(1600);
    player.setScene('lobby');
    await flush(1600);
    expect(tracks().at(-1)).toBe('/music/lobby2.mp3');
  });

  it('retains the outgoing stream when the incoming file fails and retries the same index', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    Media.rejectNext = true;
    player.setScene('yacht');
    await flush();
    expect(active().src).toBe('/music/lobby1.mp3');
    await flush(1500);
    expect(tracks().slice(-2)).toEqual(['/music/yach1.mp3', '/music/yach1.mp3']);
    await flush(1600);
    expect(active().src).toBe('/music/yach1.mp3');
  });

  it('releases sources, timers, blobs and context even when a primer promise resolves after disposal', async () => {
    const player = engine();
    Media.deferNext = true;
    const unlock = player.unlock();
    expect(Media.deferred).toHaveLength(1);
    player.dispose();
    Media.deferred[0].resolve();
    await unlock;
    await flush(10000);
    expect(Context.instances[0].state).toBe('closed');
    expect(Context.instances[0].sources.every((s) => s.node.disconnected)).toBe(true);
    expect(Media.instances.every((m) => m.paused && m.src === '')).toBe(true);
    expect(tracks()).toEqual([]);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await player.unlock();
    await flush(1000);
    expect(Context.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('returns to suspension when visibility changes during a delayed context resume', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    Context.deferResume = true;
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(Context.pendingResume).toHaveLength(1);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    Context.pendingResume[0]();
    await flush();
    expect(Context.instances[0].state).toBe('suspended');
    expect(master().value).toBe(0);
    expect(Media.instances.every((m) => m.paused)).toBe(true);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(Context.instances[0].state).toBe('running');
    expect(active().src).toBe('/music/lobby1.mp3');
  });

  it('waits for an old mute suspension before resuming an immediate unmute', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    Context.deferSuspend = true;
    player.setSettings({ muted: true, music: 0.2 });
    await flush(110);
    expect(Context.pendingSuspend).toHaveLength(1);
    player.setSettings({ muted: false, music: 0.2 });
    await flush();
    expect(Media.instances.every((m) => m.paused)).toBe(true);
    Context.pendingSuspend[0]();
    await flush();
    expect(Context.instances[0].state).toBe('running');
    expect(active().src).toBe('/music/lobby1.mp3');
    expect(master().value).toBe(0.2);
  });

  it('keeps preload failures out of the playlist and uses the same successor on retry', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    const current = active();
    current.currentTime = current.duration - 9;
    await flush(100);
    const upcoming = Media.instances.find((m) => m !== current)!;
    expect(upcoming.src).toBe('/music/lobby2.mp3');
    upcoming.error = { code: 2 };
    upcoming.dispatchEvent(new Event('error'));
    await flush();
    expect(current.paused).toBe(false);
    expect(tracks()).toEqual(['/music/lobby1.mp3']);
    await flush(1600);
    expect(upcoming.src).toBe('/music/lobby2.mp3');
    current.currentTime = current.duration - 1;
    await flush(100);
    expect(tracks()).toEqual(['/music/lobby1.mp3', '/music/lobby2.mp3']);
  });

  it('does not skip early when ordinary gestures occur after the next track was preloaded', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    const current = active();
    current.currentTime = current.duration - 9;
    await flush(100);
    expect(Media.instances.some((m) => m.src === '/music/lobby2.mp3' && m.paused)).toBe(true);
    for (let gesture = 0; gesture < 4; gesture++) {
      await player.unlock();
      await flush(100);
    }
    expect(tracks()).toEqual(['/music/lobby1.mp3']);
    expect(current.paused).toBe(false);
    current.currentTime = current.duration - 1;
    await player.unlock();
    await flush();
    expect(tracks()).toEqual(['/music/lobby1.mp3', '/music/lobby2.mp3']);
  });

  it('pins intrinsic master zero even if suspension occurs before the next automation render quantum', async () => {
    const player = engine();
    await player.unlock();
    await flush(1600);
    const parameter = master();
    expect(parameter.value).toBeGreaterThan(0);
    parameter.deferAutomation = true;
    player.setSettings({ muted: true, music: 0.12 });
    await player.unlock();
    await flush(110);
    expect(Context.instances[0].state).toBe('suspended');
    expect(parameter.value).toBe(0);
    expect(Media.instances.every((m) => m.paused)).toBe(true);
  });
});
