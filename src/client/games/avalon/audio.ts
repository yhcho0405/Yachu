export type AvalonSoundEvent =
  | 'select'
  | 'leader'
  | 'submit'
  | 'vote'
  | 'rejected'
  | 'quest-success'
  | 'quest-failure'
  | 'lady'
  | 'finish'
  | 'message';
export interface AvalonAudioSettings {
  muted: boolean;
  sfx: number;
  music?: number;
}
export interface AvalonAudio {
  unlock(): Promise<void>;
  setSettings(settings: AvalonAudioSettings): void;
  play(event: AvalonSoundEvent, intensity?: number): void;
  dispose(): void;
}
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Original bounded foley only. The app's separate shared music engine owns BGM. */
export function createAvalonAudio(): AvalonAudio {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let noise: AudioBuffer | undefined;
  let disposed = false;
  let settings: AvalonAudioSettings = { muted: false, sfx: 0.65 };
  const voices = new Set<AudioScheduledSourceNode>();
  const nodes = new Set<AudioNode>();
  const lastPlayed = new Map<AvalonSoundEvent, number>();

  function voice(source: AudioScheduledSourceNode, chain: AudioNode[]) {
    if (!master) return;
    voices.add(source);
    let previous: AudioNode = source;
    for (const node of chain) {
      previous.connect(node);
      previous = node;
    }
    previous.connect(master);
    source.onended = () => {
      source.disconnect();
      chain.forEach((node) => node.disconnect());
      voices.delete(source);
    };
  }
  function tone(
    frequency: number,
    time: number,
    duration: number,
    amplitude: number,
    endFrequency = frequency,
  ) {
    if (!context || voices.size >= 32) return;
    const source = context.createOscillator();
    source.type = 'sine';
    source.frequency.setValueAtTime(frequency, time);
    source.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    voice(source, [envelope]);
    source.start(time);
    source.stop(time + duration + 0.02);
  }
  function tap(time: number, amplitude: number, frequency: number, duration = 0.075) {
    if (!context || !noise || voices.size >= 32) return;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 1.2;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    voice(source, [filter, envelope]);
    source.start(time, Math.random() * 0.3, duration + 0.01);
  }
  function apply() {
    if (!context || !master) return;
    master.gain.setTargetAtTime(
      settings.muted ? 0 : clamp(settings.sfx) * 0.6,
      context.currentTime,
      0.025,
    );
  }
  async function unlock() {
    if (disposed || document.hidden) return;
    try {
      if (!context) {
        context = new AudioContext();
        master = context.createGain();
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -15;
        compressor.knee.value = 12;
        compressor.ratio.value = 10;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.13;
        const limiter = context.createWaveShaper();
        const curve = new Float32Array(4096);
        for (let i = 0; i < curve.length; i++)
          curve[i] = Math.tanh(((i * 2) / (curve.length - 1) - 1) * 1.3) * 0.7;
        limiter.curve = curve;
        limiter.oversample = '2x';
        master.connect(compressor);
        compressor.connect(limiter);
        limiter.connect(context.destination);
        [master, compressor, limiter].forEach((node) => nodes.add(node));
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 1.6 - 0.8;
        master.gain.value = settings.muted ? 0 : clamp(settings.sfx) * 0.6;
      }
      await context.resume();
      if (disposed || document.hidden) {
        await context.suspend();
        return;
      }
      apply();
    } catch {
      /* Optional audio retries on the next trusted gesture. */
    }
  }
  function play(event: AvalonSoundEvent, intensity = 0.65) {
    if (
      !context ||
      context.state !== 'running' ||
      disposed ||
      document.hidden ||
      settings.muted ||
      settings.sfx <= 0
    )
      return;
    const time = context.currentTime;
    const interval =
      event === 'message' ? 1 : event === 'submit' ? 0.22 : event === 'select' ? 0.055 : 0.15;
    if (time - (lastPlayed.get(event) ?? -Infinity) < interval) return;
    lastPlayed.set(event, time);
    const strength = 0.45 + clamp(intensity) * 0.55;
    const variation = 0.97 + Math.random() * 0.06;
    if (event === 'select') {
      tap(time, 0.16 * strength, 1050 * variation, 0.035);
      tone(330, time, 0.085, 0.065 * strength);
    } else if (event === 'leader') {
      tap(time, 0.11, 1800);
      tone(440, time, 0.32, 0.12);
      tone(660, time + 0.065, 0.34, 0.055);
    } else if (event === 'submit') {
      tap(time, 0.22 * strength, 680 * variation, 0.065);
      tone(135, time, 0.1, 0.07, 95);
    } else if (event === 'vote') {
      for (let i = 0; i < 3; i++) tap(time + i * 0.045, 0.1, 2300 + i * 170, 0.04);
      tone(392, time + 0.08, 0.2, 0.08);
    } else if (event === 'rejected') {
      tone(220, time, 0.25, 0.14, 165);
      tap(time + 0.08, 0.17, 560, 0.12);
    } else if (event === 'quest-success') {
      [392, 494, 587].forEach((f, i) => tone(f, time + i * 0.09, 0.65, 0.075));
    } else if (event === 'quest-failure') {
      tap(time, 0.24, 450, 0.25);
      tone(147, time, 0.65, 0.13, 98);
      tone(155, time + 0.06, 0.4, 0.045, 104);
    } else if (event === 'lady') {
      [523, 784, 1047].forEach((f, i) => tone(f, time + i * 0.08, 0.6, 0.045));
    } else if (event === 'finish') {
      [294, 392, 494, 587].forEach((f, i) => tone(f, time + i * 0.11, 0.85, 0.07));
    } else if (event === 'message') tone(659, time, 0.1, 0.035);
  }
  function stopVoices() {
    for (const source of voices) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
    }
    voices.clear();
  }
  function visibility() {
    if (document.hidden) {
      stopVoices();
      if (context?.state === 'running') void context.suspend().catch(() => {});
    } else if (context && !disposed) void unlock();
  }
  document.addEventListener('visibilitychange', visibility);
  return {
    unlock,
    setSettings(value) {
      settings = { muted: value.muted, sfx: clamp(value.sfx) };
      apply();
      if (settings.muted || settings.sfx === 0) stopVoices();
    },
    play,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      stopVoices();
      nodes.forEach((node) => node.disconnect());
      nodes.clear();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      noise = undefined;
    },
  };
}
