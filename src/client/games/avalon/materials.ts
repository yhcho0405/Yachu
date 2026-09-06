import * as THREE from 'three';

/** All motifs are drawn here; no commercial board or role artwork is used. */
export function texture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('원탁 재질을 준비하지 못했습니다.');
  draw(ctx, size);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

export function surfaceTexture(kind: 'wood' | 'stone') {
  return texture((ctx, s) => {
    let seed = 871;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    ctx.fillStyle = kind === 'wood' ? '#645147' : '#444f4e';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 14000; i++) {
      const light = random() > 0.5;
      ctx.fillStyle = light ? 'rgba(249,226,190,.025)' : 'rgba(9,15,16,.045)';
      ctx.fillRect(
        random() * s,
        random() * s,
        kind === 'wood' ? 12 + random() * 80 : 1 + random() * 3,
        1 + random(),
      );
    }
    if (kind === 'wood') {
      for (let i = 0; i < 160; i++) {
        const y = random() * s;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + random() * 16, s * 0.65, y - random() * 18, s, y);
        ctx.strokeStyle = `rgba(18,13,12,${0.04 + random() * 0.06})`;
        ctx.lineWidth = 0.5 + random();
        ctx.stroke();
      }
    }
  }, 512);
}

export function contactTexture() {
  return texture((ctx, s) => {
    const gradient = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gradient.addColorStop(0, 'rgba(8,12,13,.65)');
    gradient.addColorStop(0.45, 'rgba(8,12,13,.29)');
    gradient.addColorStop(1, 'rgba(8,12,13,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, s, s);
  }, 64);
}

export type SymbolKind =
  'crest' | 'crown' | 'team' | 'seal' | 'success' | 'fail' | 'lady' | 'offline' | 'back';

export function symbol(
  ctx: CanvasRenderingContext2D,
  kind: SymbolKind,
  x: number,
  y: number,
  radius: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = radius * 0.12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'crown') {
    ctx.moveTo(-radius, -radius * 0.5);
    ctx.lineTo(-radius * 0.55, radius * 0.6);
    ctx.lineTo(radius * 0.55, radius * 0.6);
    ctx.lineTo(radius, -radius * 0.5);
    ctx.lineTo(radius * 0.35, -0.1 * radius);
    ctx.lineTo(0, -radius * 0.8);
    ctx.lineTo(-radius * 0.35, -0.1 * radius);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'success') {
    ctx.moveTo(-radius * 0.65, 0);
    ctx.lineTo(-radius * 0.1, radius * 0.5);
    ctx.lineTo(radius * 0.75, -radius * 0.55);
    ctx.stroke();
  } else if (kind === 'fail' || kind === 'offline') {
    ctx.moveTo(-radius * 0.55, -radius * 0.55);
    ctx.lineTo(radius * 0.55, radius * 0.55);
    ctx.moveTo(radius * 0.55, -radius * 0.55);
    ctx.lineTo(-radius * 0.55, radius * 0.55);
    ctx.stroke();
    if (kind === 'offline') {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === 'lady') {
    ctx.moveTo(0, -radius);
    ctx.bezierCurveTo(-radius * 1.5, radius * 0.4, -radius * 0.65, radius, 0, radius);
    ctx.bezierCurveTo(radius * 0.65, radius, radius * 1.5, radius * 0.4, 0, -radius);
    ctx.stroke();
  } else if (kind === 'team') {
    for (const offset of [-0.48, 0.48]) {
      ctx.moveTo(offset * radius, -radius * 0.8);
      ctx.lineTo(offset * radius, radius * 0.8);
      ctx.moveTo((offset - 0.25) * radius, radius * 0.25);
      ctx.lineTo((offset + 0.25) * radius, radius * 0.25);
    }
    ctx.stroke();
  } else if (kind === 'seal') {
    ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.35, radius * 0.6);
    ctx.lineTo(-radius * 0.5, radius * 1.1);
    ctx.moveTo(radius * 0.35, radius * 0.6);
    ctx.lineTo(radius * 0.5, radius * 1.1);
    ctx.stroke();
  } else {
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius * 0.8, -radius * 0.5);
    ctx.lineTo(radius * 0.62, radius * 0.42);
    ctx.lineTo(0, radius);
    ctx.lineTo(-radius * 0.62, radius * 0.42);
    ctx.lineTo(-radius * 0.8, -radius * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.52);
    ctx.lineTo(0, radius * 0.48);
    ctx.moveTo(-radius * 0.38, -radius * 0.06);
    ctx.lineTo(radius * 0.38, -radius * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

export function emblemTexture(
  kind: SymbolKind,
  background = '#e9dfc9',
  foreground = '#374a47',
  label?: string,
) {
  return texture((ctx, s) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = foreground;
    ctx.lineWidth = s * 0.014;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    symbol(ctx, kind, s / 2, label ? s * 0.39 : s / 2, s * 0.22);
    if (label) {
      ctx.fillStyle = foreground;
      ctx.font = `600 ${s * 0.2}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, s / 2, s * 0.77);
    }
  });
}

export function cardTexture(kind: 'back' | 'success' | 'fail') {
  return texture((ctx, s) => {
    ctx.fillStyle = kind === 'back' ? '#314d4a' : '#ece2cd';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = kind === 'back' ? '#b9aa82' : kind === 'success' ? '#2b6659' : '#883f3b';
    ctx.lineWidth = s * 0.02;
    ctx.strokeRect(s * 0.07, s * 0.07, s * 0.86, s * 0.86);
    ctx.strokeRect(s * 0.105, s * 0.105, s * 0.79, s * 0.79);
    symbol(ctx, kind, s / 2, s / 2, s * 0.23);
    for (const [x, y] of [
      [0.17, 0.17],
      [0.83, 0.17],
      [0.17, 0.83],
      [0.83, 0.83],
    ]) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, s * 0.013, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  });
}
