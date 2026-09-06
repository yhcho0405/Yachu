import * as THREE from 'three';

export function paintedTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('보드 재질을 준비하지 못했습니다.');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function woodTexture(): THREE.CanvasTexture {
  return paintedTexture((ctx, s) => {
    ctx.fillStyle = '#b58b5a';
    ctx.fillRect(0, 0, s, s);
    let seed = 619;
    const noise = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 9500; i++) {
      ctx.fillStyle = noise() > 0.5 ? 'rgba(255,231,190,.025)' : 'rgba(63,31,10,.033)';
      ctx.fillRect(noise() * s, noise() * s, 8 + noise() * 80, 0.4 + noise());
    }
    for (let i = 0; i < 130; i++) {
      const y = noise() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.28, y - noise() * 14, s * 0.62, y + noise() * 15, s, y);
      ctx.strokeStyle = `rgba(65,37,13,${0.025 + noise() * 0.055})`;
      ctx.lineWidth = 0.4 + noise();
      ctx.stroke();
    }
  }, 512);
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

/** Own ivory microtexture, recessed pips and six-face shield edge markings. */
export function diceMaterials(shield: boolean, opponent: boolean): THREE.MeshStandardMaterial[] {
  return [3, 4, 1, 6, 2, 5].map((value) => {
    const map = paintedTexture((ctx, s) => {
      ctx.fillStyle = '#f4ecdb';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2200; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(113,90,58,.028)' : 'rgba(255,255,255,.09)';
        ctx.fillRect((i * 73.319) % s, (i * 47.13) % s, 1, 1);
      }
      if (shield) {
        ctx.strokeStyle = '#8a6a34';
        ctx.lineWidth = s * 0.026;
        ctx.beginPath();
        ctx.roundRect(s * 0.067, s * 0.067, s * 0.866, s * 0.866, s * 0.06);
        ctx.stroke();
        // Four small shield silhouettes remain legible independently of color and face value.
        for (const [u, v] of [
          [0.15, 0.15],
          [0.85, 0.15],
          [0.15, 0.85],
          [0.85, 0.85],
        ]) {
          const x = u * s,
            y = v * s,
            w = s * 0.039;
          ctx.beginPath();
          ctx.moveTo(x - w, y - w);
          ctx.lineTo(x + w, y - w);
          ctx.lineTo(x + w, y);
          ctx.quadraticCurveTo(x + w, y + w, x, y + w * 1.35);
          ctx.quadraticCurveTo(x - w, y + w, x - w, y);
          ctx.closePath();
          ctx.fillStyle = '#826134';
          ctx.fill();
        }
      }
      for (const [u, v] of PIPS[value]) {
        const x = s / 2 + u * s * 0.232,
          y = s / 2 + v * s * 0.232,
          r = s * 0.083;
        const gradient = ctx.createRadialGradient(x, y - 1, r * 0.2, x, y, r * 1.1);
        gradient.addColorStop(0, opponent ? '#532c26' : '#163c32');
        gradient.addColorStop(0.77, opponent ? '#663a30' : '#21493c');
        gradient.addColorStop(0.9, '#7c7967');
        gradient.addColorStop(1, '#f4ecdb');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const bump = paintedTexture((ctx, s) => {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(0, 0, s, s);
      for (const [u, v] of PIPS[value]) {
        const x = s / 2 + u * s * 0.232,
          y = s / 2 + v * s * 0.232;
        const g = ctx.createRadialGradient(x, y, s * 0.047, x, y, s * 0.085);
        g.addColorStop(0, '#303030');
        g.addColorStop(0.65, '#444444');
        g.addColorStop(1, '#eeeeee');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.085, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 128);
    bump.colorSpace = THREE.NoColorSpace;
    return new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 0.023,
      roughness: shield ? 0.32 : 0.4,
      metalness: 0,
      envMapIntensity: 0.42,
    });
  });
}

export function shadowTexture(): THREE.CanvasTexture {
  return paintedTexture((ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.14, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, 'rgba(24,16,8,.5)');
    g.addColorStop(0.5, 'rgba(24,16,8,.19)');
    g.addColorStop(1, 'rgba(24,16,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 64);
}
