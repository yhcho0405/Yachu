import type { GameType } from '../shared/games';

export type MusicScene = 'lobby' | GameType;
export interface MusicTrack {
  src: string;
  duration: number;
  gain: number;
}

// User-provided MP3s are copied unchanged. Playback trims only gain, targeting
// approximately -20 LUFS from the measured integrated loudness (no recompression).
export const MUSIC_TRACKS: Record<MusicScene, readonly [MusicTrack, ...MusicTrack[]]> = {
  lobby: [
    { src: '/music/lobby1.mp3', duration: 241.1335, gain: 0.579429 },
    { src: '/music/lobby2.mp3', duration: 248.2135, gain: 0.504661 },
  ],
  yacht: [
    { src: '/music/yach1.mp3', duration: 248.3735, gain: 0.618728 },
    { src: '/music/yach2.mp3', duration: 197.6935, gain: 0.560402 },
  ],
  tikatuka: [
    { src: '/music/tica1.mp3', duration: 310.0935, gain: 0.570164 },
    { src: '/music/tica2.mp3', duration: 323.7735, gain: 0.49545 },
  ],
  avalon: [{ src: '/music/aval1.mp3', duration: 223.5735, gain: 0.469894 }],
};
