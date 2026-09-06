import { MUSIC_TRACKS, type MusicScene, type MusicTrack } from './music-tracks';

export interface Music {
  setScene(scene: MusicScene): void;
  setSettings(settings: { muted: boolean; music: number }): void;
  unlock(): Promise<void>;
  dispose(): void;
}

const FADE_SECONDS = 1.5;
const PRELOAD_SECONDS = 10;
const bounded = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
type Envelope = { from: number; to: number; start: number; end: number };
type Slot = {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  normalization: GainNode;
  gain: GainNode;
  envelope: Envelope;
  status: 'empty' | 'priming' | 'prepared' | 'starting' | 'playing';
  scene?: MusicScene;
  track?: MusicTrack;
  index: 0 | 1;
  visit: number;
  token: number;
  retiring: boolean;
  nextRequested: boolean;
  resumePending: boolean;
  primed: boolean;
  primeUrl?: string;
  ended: () => void;
  error: () => void;
};

/** Two reusable streaming decks; playlist positions advance only on successful playback. */
export function createMusic(): Music {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  const slots: Slot[] = [];
  const nextIndex = new Map<MusicScene, 0 | 1>();
  let wanted: MusicScene = 'lobby',
    visit = 0;
  let foreground: Slot | undefined;
  let settings = { muted: false, music: 0.12 };
  let unlocked = false,
    disposed = false,
    paused = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let muteTimer: ReturnType<typeof setTimeout> | undefined;
  let waking: Promise<void> | undefined;
  let suspending: Promise<void> | undefined;
  let retryAt = 0,
    failures = 0;
  const audible = () => !disposed && !document.hidden && !settings.muted && settings.music > 0;

  function level(slot: Slot, now = context?.currentTime ?? 0): number {
    const e = slot.envelope;
    if (now >= e.end) return e.to;
    if (now <= e.start) return e.from;
    return e.from + ((e.to - e.from) * (now - e.start)) / (e.end - e.start);
  }
  function ramp(slot: Slot, target: number, seconds: number) {
    if (!context) return;
    const now = context.currentTime,
      from = level(slot, now);
    slot.gain.gain.cancelScheduledValues(now);
    slot.gain.gain.setValueAtTime(from, now);
    slot.gain.gain.linearRampToValueAtTime(target, now + seconds);
    slot.envelope = { from, to: target, start: now, end: now + seconds };
  }
  function stopTimer() {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }
  function clearMuteTimer() {
    if (muteTimer) clearTimeout(muteTimer);
    muteTimer = undefined;
  }
  function reset(slot: Slot) {
    slot.token++;
    slot.audio.pause();
    slot.audio.removeAttribute('src');
    slot.audio.preload = 'none';
    slot.audio.load();
    if (slot.primeUrl) {
      URL.revokeObjectURL(slot.primeUrl);
      slot.primeUrl = undefined;
    }
    slot.status = 'empty';
    slot.track = undefined;
    slot.scene = undefined;
    slot.retiring = false;
    slot.nextRequested = false;
    slot.resumePending = false;
    ramp(slot, 0, 0);
    if (foreground === slot)
      foreground = slots.find((s) => s !== slot && s.status === 'playing' && !s.retiring);
  }
  function failed(slot: Slot) {
    if (disposed || slot.status === 'empty') return;
    reset(slot);
    failures++;
    retryAt = Date.now() + Math.min(30000, 1500 * 2 ** Math.min(failures - 1, 4));
    // A failed incoming stream must not mute the still usable outgoing deck.
    const survivor = slots.find((s) => s.status === 'playing');
    if (survivor) {
      survivor.retiring = false;
      foreground = survivor;
      ramp(survivor, 1, 0.2);
    }
    schedule();
  }
  function createContext() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    for (let i = 0; i < 2; i++) {
      const audio = new Audio();
      audio.preload = 'none';
      audio.loop = false;
      const source = context.createMediaElementSource(audio);
      const normalization = context.createGain(),
        gain = context.createGain();
      gain.gain.value = 0;
      source.connect(normalization);
      normalization.connect(gain);
      gain.connect(master);
      const slot: Slot = {
        audio,
        source,
        normalization,
        gain,
        envelope: { from: 0, to: 0, start: 0, end: 0 },
        status: 'empty',
        index: 0,
        visit: -1,
        token: 0,
        retiring: false,
        nextRequested: false,
        resumePending: false,
        primed: false,
        ended() {},
        error() {},
      };
      slot.ended = () => {
        if (foreground === slot && slot.status === 'playing') {
          slot.nextRequested = true;
          schedule(true);
        }
      };
      slot.error = () => {
        if (audio.error && slot.status !== 'empty') failed(slot);
      };
      audio.addEventListener('ended', slot.ended);
      audio.addEventListener('error', slot.error);
      slots.push(slot);
    }
  }
  function prime(slot: Slot): Promise<void> | undefined {
    if (slot.primed || slot.status !== 'empty') return;
    // A 40ms silent PCM WAV authorizes each reusable element from the gesture.
    // Blob URLs satisfy media-src 'self' blob: and require no network download.
    const samples = 320,
      bytes = new Uint8Array(44 + samples * 2),
      view = new DataView(bytes.buffer);
    const ascii = (at: number, text: string) =>
      [...text].forEach((letter, i) => view.setUint8(at + i, letter.charCodeAt(0)));
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples * 2, true);
    slot.status = 'priming';
    const token = ++slot.token;
    slot.primeUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    slot.audio.src = slot.primeUrl;
    slot.audio.preload = 'auto';
    slot.audio.load();
    let playing: Promise<void>;
    try {
      playing = slot.audio.play();
    } catch {
      reset(slot);
      return Promise.resolve();
    }
    return playing.then(
      () => {
        if (disposed || slot.token !== token) return;
        slot.primed = true;
        reset(slot);
        schedule(true);
      },
      () => {
        if (!disposed && slot.token === token) reset(slot);
      },
    );
  }
  function indexFor(scene: MusicScene): 0 | 1 {
    let index = nextIndex.get(scene);
    if (index === undefined) {
      index = MUSIC_TRACKS[scene].length === 1 || Math.random() < 0.5 ? 0 : 1;
      nextIndex.set(scene, index);
    }
    return index;
  }
  function prepare(slot: Slot, scene: MusicScene, index: 0 | 1) {
    const track = MUSIC_TRACKS[scene][index];
    slot.token++;
    slot.scene = scene;
    slot.index = index;
    slot.visit = visit;
    slot.track = track;
    slot.status = 'prepared';
    slot.retiring = false;
    slot.nextRequested = false;
    slot.normalization.gain.value = track.gain;
    ramp(slot, 0, 0);
    slot.audio.preload = 'auto';
    slot.audio.src = track.src;
    slot.audio.load();
  }
  function start(slot: Slot, gestureReady?: Promise<void>) {
    if (
      slot.status !== 'prepared' ||
      !audible() ||
      (!gestureReady && paused) ||
      !context ||
      (!gestureReady && context.state !== 'running')
    )
      return;
    slot.status = 'starting';
    const token = slot.token,
      selectedVisit = visit,
      selectedScene = wanted;
    let result: Promise<void>;
    try {
      result = slot.audio.play();
    } catch {
      failed(slot);
      return;
    }
    void Promise.all([result, gestureReady]).then(
      () => {
        if (disposed || slot.token !== token) return;
        if (selectedVisit !== visit || selectedScene !== wanted) {
          reset(slot);
          schedule(true);
          return;
        }
        if (!audible() || paused || context?.state !== 'running') {
          slot.audio.pause();
          slot.status = 'prepared';
          return;
        }
        slot.status = 'playing';
        foreground = slot;
        failures = 0;
        retryAt = 0;
        nextIndex.set(
          selectedScene,
          MUSIC_TRACKS[selectedScene].length === 1 ? 0 : slot.index === 0 ? 1 : 0,
        );
        ramp(slot, 1, FADE_SECONDS);
        for (const other of slots)
          if (other !== slot && other.status === 'playing') {
            other.retiring = true;
            ramp(other, 0, FADE_SECONDS);
          }
        schedule(true);
      },
      () => {
        if (!disposed && slot.token === token) failed(slot);
      },
    );
  }
  function remaining(slot: Slot) {
    const duration =
      Number.isFinite(slot.audio.duration) && slot.audio.duration > 0
        ? slot.audio.duration
        : (slot.track?.duration ?? Infinity);
    return duration - slot.audio.currentTime;
  }
  function freeSlot(): Slot | undefined {
    const free = slots.find((s) => s.status === 'empty');
    if (free) return free;
    const retiring = slots.find((s) => s.retiring);
    if (retiring) {
      if (retiring.envelope.end - (context?.currentTime ?? 0) > 0.12) ramp(retiring, 0, 0.12);
      return undefined;
    }
    // A third requested situation waits for a very short ramp of the quieter deck.
    // Never reuse an audible element or reset a ramp to an assumed zero/one gain.
    const quieter = [...slots]
      .filter((s) => s.status === 'playing')
      .sort((a, b) => level(a) * (a.track?.gain ?? 1) - level(b) * (b.track?.gain ?? 1))[0];
    if (!quieter) return undefined;
    quieter.retiring = true;
    ramp(quieter, 0, 0.12);
    const survivor = slots.find((s) => s !== quieter && s.status === 'playing');
    if (survivor) {
      survivor.retiring = false;
      foreground = survivor;
      ramp(survivor, 1, 0.3);
    }
    return undefined;
  }
  function tick() {
    timer = undefined;
    if (!context || paused || !audible()) return;
    for (const slot of slots)
      if (slot.retiring && context.currentTime >= slot.envelope.end) reset(slot);
    for (const slot of slots)
      if (
        (slot.status === 'prepared' || slot.status === 'starting') &&
        (slot.scene !== wanted || slot.visit !== visit)
      )
        reset(slot);
    if (Date.now() >= retryAt) {
      const current =
        foreground?.scene === wanted &&
        foreground.visit === visit &&
        foreground.status === 'playing'
          ? foreground
          : undefined;
      const change = !current || current.nextRequested || remaining(current) <= FADE_SECONDS;
      let pending = slots.find(
        (s) =>
          (s.status === 'prepared' || s.status === 'starting') &&
          s.scene === wanted &&
          s.visit === visit,
      );
      if (change) {
        if (!pending) {
          const slot = freeSlot();
          if (slot) {
            prepare(slot, wanted, indexFor(wanted));
            pending = slot;
          }
        }
        if (pending?.status === 'prepared') start(pending);
      } else if (remaining(current) <= PRELOAD_SECONDS && !pending) {
        // Preload only one imminent successor; do not fetch the six-track catalog.
        const slot = slots.find((s) => s.status === 'empty');
        if (slot) prepare(slot, wanted, indexFor(wanted));
      }
    }
    schedule();
  }
  function schedule(immediate = false) {
    if (disposed || paused || !audible()) return;
    if (immediate) stopTimer();
    if (!timer) timer = setTimeout(tick, immediate ? 0 : 100);
  }
  function pauseNow() {
    paused = true;
    stopTimer();
    clearMuteTimer();
    for (const slot of slots) slot.audio.pause();
    if (context && context.state !== 'closed') {
      // A scheduled zero may not reach a render quantum before suspend resolves.
      // Clear its automation and pin the intrinsic value as well as stopping media.
      master!.gain.cancelScheduledValues(0);
      master!.gain.value = 0;
      const suspension = context
        .suspend()
        .then(() => {
          if (suspending === suspension) suspending = undefined;
          // A rapid unhide/unmute can race the asynchronous suspension.
          if (audible() && unlocked) void wake();
        })
        .catch(() => {
          if (suspending === suspension) suspending = undefined;
        });
      suspending = suspension;
    }
  }
  function resumeSlot(slot: Slot) {
    if (slot.status !== 'playing' || !slot.audio.paused || slot.audio.ended || slot.resumePending)
      return;
    const token = slot.token;
    slot.resumePending = true;
    let result: Promise<void>;
    try {
      result = slot.audio.play();
    } catch {
      slot.resumePending = false;
      return;
    }
    void result.then(
      () => {
        if (slot.token !== token || disposed) return;
        slot.resumePending = false;
        if (!audible() || paused) slot.audio.pause();
      },
      () => {
        if (slot.token === token) slot.resumePending = false;
      },
    );
  }
  async function wake() {
    if (!context || !unlocked || !audible()) return;
    if (waking) return waking;
    waking = (async () => {
      try {
        if (suspending) await suspending;
        if (!audible()) return;
        if (context!.state !== 'running') await context!.resume();
        if (!audible()) {
          pauseNow();
          return;
        }
        if (context!.state !== 'running') return;
        paused = false;
        for (const slot of slots) resumeSlot(slot);
        master!.gain.setTargetAtTime(settings.music, context!.currentTime, 0.06);
        schedule(true);
      } catch {
        /* A subsequent trusted gesture retries browser playback policy. */
      }
    })();
    try {
      await waking;
    } finally {
      waking = undefined;
    }
  }
  function visibility() {
    if (document.hidden) pauseNow();
    else if (audible()) void wake();
  }
  document.addEventListener('visibilitychange', visibility);
  return {
    setScene(scene) {
      if (disposed || scene === wanted) return;
      wanted = scene;
      visit++;
      retryAt = 0;
      failures = 0;
      // Loading or preloaded streams are silent; abort obsolete requests immediately.
      for (const slot of slots)
        if (slot.status === 'prepared' || slot.status === 'starting') reset(slot);
      schedule(true);
    },
    setSettings(next) {
      settings = { muted: !!next.muted, music: bounded(next.music) };
      if (disposed || !context) return;
      clearMuteTimer();
      if (!audible()) {
        master!.gain.setTargetAtTime(0, context.currentTime, 0.012);
        if (document.hidden || paused) pauseNow();
        else muteTimer = setTimeout(pauseNow, 100);
      } else void wake();
    },
    async unlock() {
      if (disposed || document.hidden) return;
      try {
        createContext();
        // Invoke permission-sensitive operations directly, before the first await.
        const resumed = context!.state === 'running' ? Promise.resolve() : context!.resume();
        const ready = resumed.then(() => {
          if (!disposed && audible() && context!.state === 'running') {
            unlocked = true;
            paused = false;
          }
        });
        const priming = slots.map(prime).filter((promise): promise is Promise<void> => !!promise);
        const prepared = slots.find(
          (slot) => slot.status === 'prepared' && slot.scene === wanted && slot.visit === visit,
        );
        const current =
          foreground?.scene === wanted &&
          foreground.visit === visit &&
          foreground.status === 'playing'
            ? foreground
            : undefined;
        // Ordinary clicks must not turn ten-second preloading into an early skip.
        if (prepared && (!current || current.nextRequested || remaining(current) <= FADE_SECONDS))
          start(prepared, ready);
        await ready;
        await Promise.all(priming);
        if (disposed) return;
        unlocked = context!.state === 'running';
        retryAt = 0;
        if (audible()) await wake();
        else pauseNow();
      } catch {
        /* No playlist index is consumed by a failed gesture/unlock. */
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      paused = true;
      stopTimer();
      clearMuteTimer();
      document.removeEventListener('visibilitychange', visibility);
      for (const slot of slots) {
        reset(slot);
        slot.audio.removeEventListener('ended', slot.ended);
        slot.audio.removeEventListener('error', slot.error);
        slot.source.disconnect();
        slot.normalization.disconnect();
        slot.gain.disconnect();
      }
      slots.length = 0;
      master?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      nextIndex.clear();
      foreground = undefined;
    },
  };
}
