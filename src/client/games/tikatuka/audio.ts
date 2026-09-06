export type TikatukaSoundEvent =
  | 'roll'
  | 'impact'
  | 'place'
  | 'shield'
  | 'attack'
  | 'remove'
  | 'bonus'
  | 'reroll'
  | 'choose'
  | 'lead'
  | 'turn'
  | 'hold'
  | 'declare'
  | 'finish'
  | 'select';
export interface AudioSettings {
  muted: boolean;
  sfx: number;
  music: number;
}
export interface TikatukaAudio {
  unlock(): Promise<void>;
  setSettings(settings: AudioSettings): void;
  play(event: TikatukaSoundEvent, intensity?: number): void;
  dispose(): void;
}

const bounded = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const pitch = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Original procedural foley and a quiet, original D-minor sixteen-bar music loop. */
export function createTikatukaAudio(): TikatukaAudio {
  let context: AudioContext | undefined;
  let master: GainNode | undefined, effects: GainNode | undefined, music: GainNode | undefined;
  let noise: AudioBuffer | undefined;
  let settings: AudioSettings = { muted: false, sfx: 0.65, music: 0.18 };
  let musicTimer: ReturnType<typeof setTimeout> | undefined;
  let nextMusic = 0,
    bar = 0,
    disposed = false;
  const voices = new Set<AudioScheduledSourceNode>();
  const musicVoices = new Set<AudioScheduledSourceNode>();
  const lastEvent = new Map<TikatukaSoundEvent, number>();

  function connectVoice(
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
    destination: AudioNode,
    isMusic = false,
  ) {
    voices.add(source);
    if (isMusic) musicVoices.add(source);
    let previous: AudioNode = source;
    for (const node of nodes) {
      previous.connect(node);
      previous = node;
    }
    previous.connect(destination);
    source.onended = () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
      voices.delete(source);
      musicVoices.delete(source);
    };
  }
  function tone(
    frequency: number,
    time: number,
    length: number,
    amplitude: number,
    type: OscillatorType = 'sine',
    isMusic = false,
    endFrequency?: number,
  ) {
    if (!context || !effects || !music || voices.size >= 40) return;
    const source = context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, time);
    if (endFrequency)
      source.frequency.exponentialRampToValueAtTime(endFrequency, time + Math.min(length, 0.13));
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(amplitude, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    connectVoice(source, [gain], isMusic ? music : effects, isMusic);
    source.start(time);
    source.stop(time + length + 0.01);
  }
  function noiseHit(time: number, strength: number, frequency = 1350, duration = 0.07) {
    if (!context || !effects || !noise || voices.size >= 40) return;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(strength, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    connectVoice(source, [filter, gain], effects);
    source.start(time, Math.random() * 0.4, duration + 0.01);
  }
  function stopMusic() {
    if (musicTimer) clearTimeout(musicTimer);
    musicTimer = undefined;
    for (const voice of musicVoices) {
      try {
        voice.stop();
      } catch {
        /* already stopped */
      }
    }
    musicVoices.clear();
    nextMusic = 0;
  }
  function scheduleMusic() {
    if (
      !context ||
      context.state !== 'running' ||
      settings.muted ||
      settings.music <= 0 ||
      document.hidden ||
      disposed
    )
      return;
    const beat = 60 / 74;
    const melody = [
      [74, 77, 81, 77],
      [70, 74, 77, 74],
      [67, 70, 74, 77],
      [69, 73, 76, 73],
    ];
    const bass = [50, 46, 43, 45];
    if (!nextMusic || nextMusic < context.currentTime) nextMusic = context.currentTime + 0.1;
    while (nextMusic < context.currentTime + 3) {
      const chord = bar % 4;
      tone(pitch(bass[chord]), nextMusic, beat * 3.7, 0.072, 'sine', true);
      melody[chord].forEach((note, i) => {
        const start = nextMusic + i * beat + (i % 2 ? 0.06 : 0);
        tone(pitch(note), start, 1.55, 0.058, 'sine', true);
        tone(pitch(note) * 2.002, start, 0.3, 0.009, 'sine', true);
      });
      nextMusic += beat * 4;
      bar++;
    }
    musicTimer = setTimeout(scheduleMusic, 1300);
  }
  function applySettings() {
    if (!context || !master || !effects || !music) return;
    const t = context.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : 0.65, t, 0.035);
    effects.gain.setTargetAtTime(settings.sfx, t, 0.035);
    music.gain.setTargetAtTime(settings.music, t, 0.12);
    if (settings.muted || settings.music <= 0) stopMusic();
    else if (!musicTimer && context.state === 'running' && !document.hidden) scheduleMusic();
  }
  async function unlock() {
    if (disposed || document.hidden) return;
    try {
      if (!context) {
        context = new AudioContext();
        master = context.createGain();
        effects = context.createGain();
        music = context.createGain();
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 12;
        compressor.ratio.value = 10;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;
        const limiter = context.createWaveShaper();
        const curve = new Float32Array(4096);
        for (let i = 0; i < curve.length; i++) {
          const x = (i * 2) / (curve.length - 1) - 1;
          curve[i] = Math.tanh(x * 1.25) * 0.78;
        }
        limiter.curve = curve;
        limiter.oversample = '2x';
        effects.connect(master);
        music.connect(master);
        master.connect(compressor);
        compressor.connect(limiter);
        limiter.connect(context.destination);
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.8;
      }
      await context.resume();
      applySettings();
    } catch {
      /* Audio is optional when a browser refuses its first gesture; the next gesture retries. */
    }
  }
  function play(event: TikatukaSoundEvent, intensity = 0.6) {
    if (
      !context ||
      context.state !== 'running' ||
      settings.muted ||
      settings.sfx <= 0 ||
      document.hidden ||
      disposed
    )
      return;
    const t = context.currentTime;
    const minGap = event === 'impact' || event === 'remove' ? 0.028 : 0.05;
    if (t - (lastEvent.get(event) ?? -Infinity) < minGap) return;
    lastEvent.set(event, t);
    const strength = bounded(intensity),
      variation = 0.92 + Math.random() * 0.16;
    switch (event) {
      case 'roll':
        for (let i = 0; i < 3; i++)
          noiseHit(t + i * 0.036, 0.12, (1100 + i * 230) * variation, 0.055);
        tone(140, t, 0.12, 0.075, 'sine', false, 76);
        break;
      case 'impact':
        noiseHit(
          t,
          0.12 + strength * 0.18,
          (850 + strength * 1250) * variation,
          0.035 + strength * 0.045,
        );
        tone((185 + strength * 65) * variation, t, 0.1, 0.12 * strength, 'sine', false, 80);
        noiseHit(t + 0.014, strength * 0.12, 2700 * variation, 0.025);
        break;
      case 'place':
        noiseHit(t, 0.17 * strength, 1700 * variation, 0.038);
        tone(240 * variation, t, 0.075, 0.08 * strength, 'sine', false, 160);
        break;
      case 'attack':
        noiseHit(t, 0.25 * strength, 2900 * variation, 0.055);
        noiseHit(t + 0.018, 0.13 * strength, 3800 * variation, 0.035);
        tone(430 * variation, t, 0.1, 0.13 * strength, 'triangle', false, 170);
        break;
      case 'remove':
        noiseHit(t, 0.09 * strength, 2300 * variation, 0.045);
        tone(480 * variation, t, 0.075, 0.045 * strength, 'sine', false, 240);
        break;
      case 'shield':
        noiseHit(t, 0.08, 1600 * variation, 0.035);
        [74, 81].forEach((note, i) => tone(pitch(note), t + i * 0.045, 0.23, 0.04));
        break;
      case 'bonus':
        [74, 77, 81].forEach((note, i) => tone(pitch(note), t + i * 0.07, 0.35, 0.045));
        break;
      case 'reroll':
        noiseHit(t, 0.085, 1450 * variation, 0.08);
        tone(360 * variation, t, 0.1, 0.065, 'sine', false, 590);
        break;
      case 'choose':
        noiseHit(t, 0.06, 1200 * variation, 0.028);
        tone(620 * variation, t, 0.075, 0.06);
        break;
      case 'hold':
        tone(392, t, 0.18, 0.045);
        tone(294, t + 0.06, 0.2, 0.04);
        break;
      case 'declare':
        [62, 69, 74].forEach((note, i) => tone(pitch(note), t + i * 0.075, 0.34, 0.05));
        break;
      case 'select':
        tone(520 * variation, t, 0.065, 0.055, 'sine');
        break;
      case 'lead':
        noiseHit(t, 0.08, 1450, 0.04);
        [72, 76, 79].forEach((note, i) => tone(pitch(note), t + i * 0.052, 0.25, 0.055));
        break;
      case 'turn':
        [67, 72].forEach((note, i) => tone(pitch(note), t + i * 0.12, 0.28, 0.04));
        break;
      case 'finish':
        [60, 64, 67, 72, 76, 79].forEach((note, i) =>
          tone(pitch(note), t + i * 0.095, 0.85, 0.055),
        );
        break;
    }
  }
  function visibility() {
    if (!context) return;
    if (document.hidden) {
      stopMusic();
      for (const voice of voices) {
        try {
          voice.stop();
        } catch {
          /* already stopped */
        }
      }
      void context.suspend().catch(() => {});
    } else {
      lastEvent.clear();
      // Resume existing audio only; no game event is replayed after reconnect or tab recovery.
      void context
        .resume()
        .then(applySettings)
        .catch(() => {});
    }
  }
  document.addEventListener('visibilitychange', visibility);
  return {
    unlock,
    setSettings(next) {
      settings = { muted: next.muted, sfx: bounded(next.sfx), music: bounded(next.music) };
      applySettings();
    },
    play,
    dispose() {
      disposed = true;
      stopMusic();
      document.removeEventListener('visibilitychange', visibility);
      for (const voice of voices) {
        try {
          voice.stop();
        } catch {
          /* already stopped */
        }
      }
      voices.clear();
      lastEvent.clear();
      if (context) void context.close().catch(() => {});
      noise = undefined;
    },
  };
}
