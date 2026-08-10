import { describe, it, expect } from "vitest";
import { SymmetricCrypto } from "./aes";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
});
