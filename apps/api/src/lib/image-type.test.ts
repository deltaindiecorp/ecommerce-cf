import { describe, it, expect } from "vitest";
import { detectImageType } from "./image-type";

describe("detectImageType", () => {
  it("mengenali JPEG dari magic bytes FF D8 FF", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageType(bytes)).toBe("image/jpeg");
  });

  it("mengenali PNG dari 8-byte signature", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectImageType(bytes)).toBe("image/png");
  });

  it("mengenali WebP dari RIFF....WEBP", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // ukuran file (diabaikan)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(detectImageType(bytes)).toBe("image/webp");
  });

  it("menolak file kosong", () => {
    expect(detectImageType(new Uint8Array([]))).toBeNull();
  });

  it("menolak file teks biasa yang mengaku gambar", () => {
    const bytes = new TextEncoder().encode("<html><body>bukan gambar</body></html>");
    expect(detectImageType(bytes)).toBeNull();
  });

  it("menolak RIFF yang bukan WEBP (mis. file WAV)", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // WAVE, bukan WEBP
    ]);
    expect(detectImageType(bytes)).toBeNull();
  });

  it("tidak tertipu file yang cuma punya prefix mirip tapi truncated", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e]); // PNG signature terpotong
    expect(detectImageType(bytes)).toBeNull();
  });
});
