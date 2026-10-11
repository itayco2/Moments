import { describe, expect, it } from "vitest";
import { fp16ToFloat32 } from "../../web/src/format";
import { toFp16 } from "../src/fp16";

describe("toFp16", () => {
  it("encodes exactly representable values exactly", () => {
    expect(Array.from(toFp16(new Float32Array([0, 1, -1, 0.5, -2])))).toEqual([0x0000, 0x3c00, 0xbc00, 0x3800, 0xc000]);
  });

  it("round-trips unit-vector values within half precision", () => {
    const values = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.37) * 0.2);
    const back = fp16ToFloat32(toFp16(values));
    let worst = 0;
    for (let i = 0; i < values.length; i++) worst = Math.max(worst, Math.abs(back[i] - values[i]));
    expect(worst).toBeLessThan(1e-4);
  });

  it("keeps tiny values as subnormals instead of dropping them to zero", () => {
    const back = fp16ToFloat32(toFp16(new Float32Array([3e-6])));
    expect(back[0]).toBeGreaterThan(2.5e-6);
    expect(back[0]).toBeLessThan(3.5e-6);
  });
});
