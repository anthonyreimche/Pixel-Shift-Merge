// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// RawTherapee's Gaussian blur for sigma past 1.15 or in place
// (rtengine/gauss.cc, gaussHorizontalSse / gaussVerticalSse): the
// Young-van Vliet recursive filter with Triggs-Sdika boundaries, run along
// rows then columns. gauss.cc: Copyright (c) 2004-2010 Gabor Horvath,
// GPL-3.0-or-later.

interface Coefficients {
  B: number;
  b1: number;
  b2: number;
  b3: number;
  M: number[][];
}

function coefficients(sigma: number): Coefficients {
  const q = sigma < 2.5 ? 3.97156 - 4.14554 * Math.sqrt(1 - 0.26891 * sigma) : 0.98711 * sigma - 0.9633;
  const b0 = 1.57825 + 2.44413 * q + 1.4281 * q * q + 0.422205 * q * q * q;
  let b1 = 2.44413 * q + 2.85619 * q * q + 1.26661 * q * q * q;
  let b2 = -1.4281 * q * q - 1.26661 * q * q * q;
  let b3 = 0.422205 * q * q * q;
  const B = 1 - (b1 + b2 + b3) / b0;
  b1 /= b0;
  b2 /= b0;
  b3 /= b0;
  const M = [
    [-b3 * b1 + 1 - b3 * b3 - b2, (b3 + b1) * (b2 + b3 * b1), b3 * (b1 + b3 * b2)],
    [b1 + b3 * b2, -(b2 - 1) * (b2 + b3 * b1), -(b3 * b1 + b3 * b3 + b2 - 1) * b3],
    [b3 * b1 + b2 + b1 * b1 - b2 * b2, b1 * b2 + b3 * b2 * b2 - b1 * b3 * b3 - b3 * b3 * b3 - b3 * b2 + b3, b3 * (b1 + b3 * b2)],
  ];
  const scale = (1 + b2 + (b1 - b3) * b3) / ((1 + b1 - b2 + b3) * (1 - b1 - b2 - b3));
  for (const row of M) for (let j = 0; j < 3; j++) row[j] *= scale;
  return { B, b1, b2, b3, M };
}

/** One line of `n` values, from `start` in steps of `step`, blurred in place. */
function line(data: Float32Array, start: number, step: number, n: number, k: Coefficients, tmp: Float64Array): void {
  const { B, b1, b2, b3, M } = k;
  const src = (j: number) => data[start + j * step];
  tmp[0] = src(0) * (B + b1 + b2 + b3);
  tmp[1] = B * src(1) + b1 * tmp[0] + src(0) * (b2 + b3);
  tmp[2] = B * src(2) + b1 * tmp[1] + b2 * tmp[0] + b3 * src(0);
  for (let j = 3; j < n; j++) tmp[j] = B * src(j) + b1 * tmp[j - 1] + b2 * tmp[j - 2] + b3 * tmp[j - 3];
  const last = src(n - 1);
  const d0 = tmp[n - 1] - last;
  const d1 = tmp[n - 2] - last;
  const d2 = tmp[n - 3] - last;
  const wm1 = last + M[0][0] * d0 + M[0][1] * d1 + M[0][2] * d2;
  const w = last + M[1][0] * d0 + M[1][1] * d1 + M[1][2] * d2;
  const wp1 = last + M[2][0] * d0 + M[2][1] * d1 + M[2][2] * d2;
  tmp[n - 1] = wm1;
  tmp[n - 2] = B * tmp[n - 2] + b1 * tmp[n - 1] + b2 * w + b3 * wp1;
  tmp[n - 3] = B * tmp[n - 3] + b1 * tmp[n - 2] + b2 * tmp[n - 1] + b3 * w;
  for (let j = n - 4; j >= 0; j--) tmp[j] = B * tmp[j] + b1 * tmp[j + 1] + b2 * tmp[j + 2] + b3 * tmp[j + 3];
  for (let j = 0; j < n; j++) data[start + j * step] = tmp[j];
}

/** `plane` (`width` x `height`) blurred in place. Each side must be at least 4. */
export function gaussianBlur(plane: Float32Array, width: number, height: number, sigma: number): void {
  const k = coefficients(sigma);
  const tmp = new Float64Array(Math.max(width, height));
  for (let i = 0; i < height; i++) line(plane, i * width, 1, width, k, tmp);
  for (let j = 0; j < width; j++) line(plane, j, width, height, k, tmp);
}
