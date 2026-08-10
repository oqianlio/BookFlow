// 同步纯 JS AES 实现（FIPS-197），供 legado 书源 createSymmetricCrypto 使用。
// 支持 AES-128/192/256，ECB/CBC 模式，PKCS5/PKCS7 填充，UTF-8 字符串。

const SBOX: number[] = [
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];

const INVSBOX: number[] = [
  0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
  0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
  0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
  0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
  0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
  0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
  0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
  0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
  0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
  0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
  0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
  0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
  0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
  0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
  0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
  0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d,
];

const RCON: number[] = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

const BLOCK_SIZE = 16;

function xtime(x: number): number {
  return ((x << 1) ^ ((x & 0x80) ? 0x1b : 0x00)) & 0xff;
}

function gfMul(a: number, b: number): number {
  let p = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) p ^= x;
    y >>= 1;
    x = xtime(x);
  }
  return p;
}

function subWord(w: number[]): number[] {
  return [SBOX[w[0]!]!, SBOX[w[1]!]!, SBOX[w[2]!]!, SBOX[w[3]!]!];
}

function rotWord(w: number[]): number[] {
  return [w[1]!, w[2]!, w[3]!, w[0]!];
}

// 密钥扩展，返回 (Nr+1) 个 16 字节轮密钥
function keyExpansion(key: Uint8Array): Uint8Array {
  const nk = key.length / 4;
  const nr = nk + 6;
  const w: number[][] = [];
  for (let i = 0; i < nk; i++) {
    w.push([key[4 * i]!, key[4 * i + 1]!, key[4 * i + 2]!, key[4 * i + 3]!]);
  }
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let temp = w[i - 1]!;
    if (i % nk === 0) {
      temp = subWord(rotWord(temp));
      temp[0] = temp[0]! ^ RCON[i / nk]!;
    } else if (nk > 6 && i % nk === 4) {
      temp = subWord(temp);
    }
    w.push([w[i - nk]![0]! ^ temp[0]!, w[i - nk]![1]! ^ temp[1]!, w[i - nk]![2]! ^ temp[2]!, w[i - nk]![3]! ^ temp[3]!]);
  }
  const roundKeys = new Uint8Array(BLOCK_SIZE * (nr + 1));
  for (let r = 0; r <= nr; r++) {
    for (let c = 0; c < 4; c++) {
      const word = w[r * 4 + c]!;
      roundKeys[r * BLOCK_SIZE + c * 4] = word[0]!;
      roundKeys[r * BLOCK_SIZE + c * 4 + 1] = word[1]!;
      roundKeys[r * BLOCK_SIZE + c * 4 + 2] = word[2]!;
      roundKeys[r * BLOCK_SIZE + c * 4 + 3] = word[3]!;
    }
  }
  return roundKeys;
}

function addRoundKey(state: Uint8Array, roundKey: Uint8Array): void {
  for (let i = 0; i < BLOCK_SIZE; i++) state[i] = state[i]! ^ roundKey[i]!;
}

// state 采用列主序：state[r + 4*c]
function shiftRows(state: Uint8Array): void {
  const tmp = state.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      state[r + 4 * c] = tmp[r + 4 * ((c + r) % 4)]!;
    }
  }
}

function invShiftRows(state: Uint8Array): void {
  const tmp = state.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      state[r + 4 * c] = tmp[r + 4 * ((c - r + 4) % 4)]!;
    }
  }
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < BLOCK_SIZE; i++) state[i] = SBOX[state[i]!]!;
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < BLOCK_SIZE; i++) state[i] = INVSBOX[state[i]!]!;
}

function mixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const a0 = state[4 * c]!;
    const a1 = state[4 * c + 1]!;
    const a2 = state[4 * c + 2]!;
    const a3 = state[4 * c + 3]!;
    state[4 * c] = gfMul(a0, 2) ^ gfMul(a1, 3) ^ a2 ^ a3;
    state[4 * c + 1] = a0 ^ gfMul(a1, 2) ^ gfMul(a2, 3) ^ a3;
    state[4 * c + 2] = a0 ^ a1 ^ gfMul(a2, 2) ^ gfMul(a3, 3);
    state[4 * c + 3] = gfMul(a0, 3) ^ a1 ^ a2 ^ gfMul(a3, 2);
  }
}

function invMixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const a0 = state[4 * c]!;
    const a1 = state[4 * c + 1]!;
    const a2 = state[4 * c + 2]!;
    const a3 = state[4 * c + 3]!;
    state[4 * c] = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
    state[4 * c + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
    state[4 * c + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11);
    state[4 * c + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14);
  }
}

function encryptBlock(state: Uint8Array, roundKeys: Uint8Array, nr: number): void {
  addRoundKey(state, roundKeys.subarray(0, BLOCK_SIZE));
  for (let round = 1; round < nr; round++) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, roundKeys.subarray(round * BLOCK_SIZE, (round + 1) * BLOCK_SIZE));
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, roundKeys.subarray(nr * BLOCK_SIZE, (nr + 1) * BLOCK_SIZE));
}

function decryptBlock(state: Uint8Array, roundKeys: Uint8Array, nr: number): void {
  addRoundKey(state, roundKeys.subarray(nr * BLOCK_SIZE, (nr + 1) * BLOCK_SIZE));
  for (let round = nr - 1; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, roundKeys.subarray(round * BLOCK_SIZE, (round + 1) * BLOCK_SIZE));
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, roundKeys.subarray(0, BLOCK_SIZE));
}

// PKCS5 与 PKCS7 对 AES(块16) 等价：缺多少补多少，满块也补一整块
function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = BLOCK_SIZE - (data.length % BLOCK_SIZE);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const pad = data[data.length - 1]!;
  if (pad < 1 || pad > BLOCK_SIZE) throw new Error("Invalid PKCS7 padding");
  for (let i = data.length - pad; i < data.length; i++) {
    if (data[i] !== pad) throw new Error("Invalid PKCS7 padding");
  }
  return data.subarray(0, data.length - pad);
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : "=";
  }
  return out;
}

function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[\r\n]/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:]/g, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function isHex(s: string): boolean {
  return s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

function normalizeKey(key: string | number[]): Uint8Array {
  const bytes = typeof key === "string" ? textEncoder.encode(key) : Uint8Array.from(key);
  const target = bytes.length <= 16 ? 16 : bytes.length <= 24 ? 24 : 32;
  const out = new Uint8Array(target);
  out.set(bytes.subarray(0, target));
  return out;
}

function normalizeIv(iv: string | number[] | null | undefined): Uint8Array {
  if (iv == null) return new Uint8Array(BLOCK_SIZE);
  const bytes = typeof iv === "string" ? textEncoder.encode(iv) : Uint8Array.from(iv);
  const out = new Uint8Array(BLOCK_SIZE);
  out.set(bytes.subarray(0, BLOCK_SIZE));
  return out;
}

function parseTransformation(transformation: string): { mode: "CBC" | "ECB"; nr: number; nk: number } {
  const parts = transformation.split("/").map((p) => p.toUpperCase());
  const mode = parts[1] === "ECB" ? "ECB" : "CBC";
  return { mode, nr: 0, nk: 0 };
}

export class SymmetricCrypto {
  private readonly mode: "CBC" | "ECB";
  private readonly roundKeys: Uint8Array;
  private readonly nr: number;
  private readonly iv: Uint8Array;

  constructor(
    transformation: string,
    key: string | number[] | null,
    iv?: string | number[] | null,
  ) {
    const parsed = parseTransformation(transformation);
    this.mode = parsed.mode;
    const keyBytes =
      key == null
        ? Uint8Array.from([0x31, 0x41, 0x59, 0x26, 0x53, 0x58, 0x97, 0x93, 0x23, 0x84, 0x62, 0x64, 0x33, 0x83, 0x27, 0x95])
        : normalizeKey(key);
    const nk = keyBytes.length / 4;
    this.nr = nk + 6;
    this.roundKeys = keyExpansion(keyBytes);
    this.iv = normalizeIv(iv);
  }

  encryptBytes(data: Uint8Array): Uint8Array {
    const padded = pkcs7Pad(data);
    const out = new Uint8Array(padded.length);
    const prev = this.mode === "CBC" ? this.iv.slice() : new Uint8Array(BLOCK_SIZE);
    for (let off = 0; off < padded.length; off += BLOCK_SIZE) {
      const block = padded.slice(off, off + BLOCK_SIZE);
      if (this.mode === "CBC") {
        for (let i = 0; i < BLOCK_SIZE; i++) block[i] = block[i]! ^ prev[i]!;
      }
      encryptBlock(block, this.roundKeys, this.nr);
      out.set(block, off);
      if (this.mode === "CBC") prev.set(block);
    }
    return out;
  }

  decryptBytes(data: Uint8Array): Uint8Array {
    if (data.length === 0 || data.length % BLOCK_SIZE !== 0) {
      throw new Error("Invalid ciphertext length");
    }
    const out = new Uint8Array(data.length);
    const prev = this.mode === "CBC" ? this.iv.slice() : new Uint8Array(BLOCK_SIZE);
    for (let off = 0; off < data.length; off += BLOCK_SIZE) {
      const block = data.slice(off, off + BLOCK_SIZE);
      decryptBlock(block, this.roundKeys, this.nr);
      if (this.mode === "CBC") {
        for (let i = 0; i < BLOCK_SIZE; i++) block[i] = block[i]! ^ prev[i]!;
        prev.set(data.subarray(off, off + BLOCK_SIZE));
      }
      out.set(block, off);
    }
    return pkcs7Unpad(out);
  }

  encrypt(data: string): Uint8Array {
    return this.encryptBytes(textEncoder.encode(data));
  }

  encryptBase64(data: string): string {
    return bytesToBase64(this.encrypt(data));
  }

  encryptHex(data: string): string {
    return bytesToHex(this.encrypt(data));
  }

  // 自动识别 base64 或 hex 输入
  decrypt(data: string): string {
    const bytes = isHex(data) ? hexToBytes(data) : base64ToBytes(data);
    return textDecoder.decode(this.decryptBytes(bytes));
  }

  decryptStr(data: string): string {
    return this.decrypt(data);
  }
}
