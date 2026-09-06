import { expect, type BrowserContext, type Page } from '@playwright/test';

type AudioRecord = {
  context: AudioContext;
  media: HTMLMediaElement[];
  gains: GainNode[];
};
type AudioProbeWindow = Window & { __atelierAudioRecords?: AudioRecord[] };

export async function observeAudio(context: BrowserContext) {
  // Observe native resource ownership without replacing playback or the application's music API.
  await context.addInitScript(() => {
    const observed = window as AudioProbeWindow;
    observed.__atelierAudioRecords = [];
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      readonly record: AudioRecord;
      constructor(options?: AudioContextOptions) {
        super(options);
        this.record = { context: this, media: [], gains: [] };
        observed.__atelierAudioRecords!.push(this.record);
      }
      createMediaElementSource(media: HTMLMediaElement) {
        const source = super.createMediaElementSource(media);
        this.record.media.push(media);
        return source;
      }
      createGain() {
        const gain = super.createGain();
        this.record.gains.push(gain);
        return gain;
      }
    };
  });
}

export async function audioResources(page: Page) {
  return page.evaluate(() =>
    ((window as AudioProbeWindow).__atelierAudioRecords ?? []).map((record, id) => ({
      id,
      state: record.context.state,
      gains: record.gains.map((gain) => gain.gain.value),
      media: record.media.map((media) => ({
        src: media.currentSrc ? new URL(media.currentSrc).pathname : '',
        paused: media.paused,
        ended: media.ended,
        currentTime: media.currentTime,
        duration: Number.isFinite(media.duration) ? media.duration : null,
        error: media.error?.code ?? null,
      })),
    })),
  );
}

export async function expectOnlySharedMusic(page: Page) {
  await expect
    .poll(async () => {
      const resources = await audioResources(page);
      const music = resources.filter((record) => record.media.length > 0);
      const effects = resources.filter((record) => record.media.length === 0);
      return (
        music.length === 1 &&
        music[0].media.length === 2 &&
        music[0].state !== 'closed' &&
        effects.every((record) => record.state === 'closed')
      );
    })
    .toBe(true);
}
