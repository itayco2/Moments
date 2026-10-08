// Small pure helpers shared by the page and the tests.

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

// Decode IEEE 754 half-precision values (the demo library ships its vectors as fp16 to halve the download).
export function fp16ToFloat32(bits: Uint16Array): Float32Array {
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    const h = bits[i];
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) out[i] = sign * 2 ** -14 * (frac / 1024);
    else if (exp === 31) out[i] = frac ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    else out[i] = sign * 2 ** (exp - 15) * (1 + frac / 1024);
  }
  return out;
}
