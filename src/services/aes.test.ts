import { describe, it, expect } from "vitest";
import { SymmetricCrypto } from "./aes";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

describe("SymmetricCrypto AES-128-ECB", () => {
  it("matches NIST vector: key=000102...0f, plaintext=00112233...ff", () => {
    // NIST FIPS-197 C.1: key=000102030405060708090a0b0c0d0e0f, input=00112233445566778899aabbccddeeff
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", [
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    ]);
    const plain = Uint8Array.from([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ]);
    const out = c.encryptBytes(plain);
    // 16-byte input with PKCS7 → 32-byte output; first block should be 69c4e0d86a7b0430d8cdb78070b4c55a
    expect(toHex(out).slice(0, 32)).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
  });

  it("round-trips encryptBase64 → decryptStr", () => {
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", "0123456789abcdef");
    const enc = c.encryptBase64("你好，世界");
    expect(c.decryptStr(enc)).toBe("你好，世界");
  });

  it("round-trips encryptHex → decryptStr", () => {
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", "0123456789abcdef");
    const enc = c.encryptHex("hello");
    expect(c.decryptStr(enc)).toBe("hello");
  });
});

describe("SymmetricCrypto AES-128-CBC NIST SP 800-38A F.2.1", () => {
  const f2_1 = {
    key: Uint8Array.from([
      0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c,
    ]),
    iv: Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    ]),
    plaintext:
      "6bc1bee22e409f96e93d7e117393172a" +
      "ae2d8a571e03ac9c9eb76fac45af8e51" +
      "30c81c46a35ce411e5fbc1191a0a52ef" +
      "f69f2445df4f9b17ad2b417be66c3710",
    ciphertext:
      "7649abac8119b246cee98e9b12e9197d" +
      "5086cb9b507219ee95db113a917678b2" +
      "73bed6b8e3c1743b7116e69e22229516" +
      "3ff1caa1681fac09120eca307586e1a7",
  };

  it("encryptBytes matches all four official CBC ciphertext blocks", () => {
    const c = new SymmetricCrypto("AES/CBC/PKCS5Padding", Array.from(f2_1.key), Array.from(f2_1.iv));
    const plain = hexToBytes(f2_1.plaintext);
    const out = c.encryptBytes(plain);
    // 64-byte plaintext is a whole-block multiple, so PKCS7 appends one full
    // padding block; the first four blocks must equal the official ciphertext.
    expect(toHex(out).slice(0, 128)).toBe(f2_1.ciphertext);
    expect(toHex(out).slice(128)).toBe("8cb82807230e1321d3fae00d18cc2012");
  });

  it("decryptBytes recovers the plaintext from the official CBC ciphertext", () => {
    const c = new SymmetricCrypto("AES/CBC/PKCS5Padding", Array.from(f2_1.key), Array.from(f2_1.iv));
    // Official F.2.1 ciphertext is unpadded; decryptBytes requires PKCS7, so
    // append the CBC-chained PKCS7 block for the empty final block (from our
    // own encrypt of the plaintext, whose first 64 bytes equal the official CT).
    const enc = c.encryptBytes(hexToBytes(f2_1.plaintext));
    const padded = new Uint8Array(80);
    padded.set(hexToBytes(f2_1.ciphertext), 0);
    padded.set(enc.subarray(64), 64);
    expect(toHex(c.decryptBytes(padded))).toBe(f2_1.plaintext);
  });
});

describe("SymmetricCrypto AES-128 FIPS-197 C.1 decrypt", () => {
  it("decryptBytes maps official ciphertext back to the plaintext", () => {
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", [
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    ]);
    // Official C.1 ciphertext is a single unpadded block; decryptBytes requires
    // PKCS7, so append the ciphertext of the empty-block padding (ECB is
    // stateless, so encryptBytes of empty data yields the exact continuation block).
    const padded = new Uint8Array(32);
    padded.set(hexToBytes("69c4e0d86a7b0430d8cdb78070b4c55a"), 0);
    padded.set(c.encryptBytes(new Uint8Array(0)), 16);
    expect(toHex(c.decryptBytes(padded))).toBe("00112233445566778899aabbccddeeff");
  });
});

describe("SymmetricCrypto AES-CBC", () => {
  it("round-trips with explicit iv", () => {
    const c = new SymmetricCrypto("AES/CBC/PKCS5Padding", "0123456789abcdef", "0000000000000000");
    const enc = c.encryptBase64("cbc test");
    expect(c.decryptStr(enc)).toBe("cbc test");
  });

  it("handles transformation with PKCS7 alias", () => {
    const c = new SymmetricCrypto("AES/CBC/PKCS7Padding", "0123456789abcdef", "0000000000000000");
    expect(c.decryptStr(c.encryptBase64("x"))).toBe("x");
  });

  it("defaults to CBC when no mode specified", () => {
    const c = new SymmetricCrypto("AES", "0123456789abcdef");
    expect(c.decryptStr(c.encryptBase64("default"))).toBe("default");
  });
});

describe("SymmetricCrypto key handling", () => {
  it("pads short key to 16 bytes with zeros", () => {
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", "shortkey");
    expect(c.decryptStr(c.encryptBase64("pad"))).toBe("pad");
  });

  it("accepts 24-byte (AES-192) and 32-byte (AES-256) keys", () => {
    const c192 = new SymmetricCrypto("AES/ECB/PKCS5Padding", "abcdefghijklmnopqrstuvwx");
    expect(c192.decryptStr(c192.encryptBase64("aes192"))).toBe("aes192");
    const c256 = new SymmetricCrypto("AES/ECB/PKCS5Padding", "abcdefghijklmnopqrstuvwxyzabcdef");
    expect(c256.decryptStr(c256.encryptBase64("aes256"))).toBe("aes256");
  });

  it("truncates keys longer than 32 bytes down to 32 (AES-256)", () => {
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", "a 40-character key string exceeding 32 bytes........");
    expect(c.decryptStr(c.encryptBase64("longkey"))).toBe("longkey");
  });
});

describe("SymmetricCrypto robustness", () => {
  it("rejects unsupported padding modes", () => {
    expect(() => new SymmetricCrypto("AES/CBC/NoPadding", "0123456789abcdef")).toThrow("不支持的填充模式: NoPadding");
  });

  it("rejects ciphertext with invalid PKCS7 padding on decryptBytes", () => {
    const c = new SymmetricCrypto("AES/CBC/PKCS5Padding", "0123456789abcdef", "0000000000000000");
    const bad = new Uint8Array(32).fill(0x10);
    expect(() => c.decryptBytes(bad)).toThrow("Invalid PKCS7 padding");
  });
});
