import { useEffect, useState } from 'react';

export interface Settings {
  muted: boolean;
  sfx: number;
  music: number;
  reducedMotion: boolean;
}
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('atelier.settings') || '{}') as Partial<Settings>;
    return {
      muted: saved.muted ?? false,
      sfx: saved.sfx ?? 0.55,
      music: saved.music ?? 0.12,
      reducedMotion: saved.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  } catch {
    return {
      muted: false,
      sfx: 0.55,
      music: 0.12,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    try {
      localStorage.setItem('atelier.settings', JSON.stringify(settings));
    } catch {
      /* Optional browser storage. */
    }
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
  }, [settings]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = (event: MediaQueryListEvent) => {
      if (event.matches) setSettings((value) => ({ ...value, reducedMotion: true }));
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return [settings, setSettings] as const;
}
