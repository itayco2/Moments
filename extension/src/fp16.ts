// Float32 to IEEE 754 half precision, rounding half up. Saved vectors are fp16: the NASA demo ships its vectors
// the same way and scores the same as fp32.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toFp16(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    f32[0] = values[i];
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 112; // rebias 127 to 15
    const mant = x & 0x7fffff;
    if (exp <= 0) {
      // Too small for a normal half: a subnormal, or zero when even that underflows.
      out[i] = exp < -10 ? sign : sign | ((((mant | 0x800000) >>> (1 - exp)) + 0x1000) >>> 13);
    } else if (exp >= 31) {
      out[i] = sign | 0x7c00;
    } else {
      out[i] = (sign | (exp << 10) | (mant >>> 13)) + ((mant >>> 12) & 1);
    }
  }
  return out;
}
