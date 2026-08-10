# 子项目2：AES 加密（java.createSymmetricCrypto）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `evalJs` 的 `java` 对象中实现 `createSymmetricCrypto(transformation, key, iv?)`（同步纯 JS AES），支持 `encryptBase64`/`encryptHex`/`encrypt`/`decryptStr`/`decrypt`，覆盖 legado 书源 AES-CBC/ECB 加密需求。

**Architecture:** 新建 `src/services/aes.ts`（同步纯 JS AES-128/192/256 + CBC/ECB + PKCS7），`evalJs` 的 `java` 对象注入 `createSymmetricCrypto`，返回 `SymmetricCrypto` 实例。

**Tech Stack:** React + TS + Vitest

**Spec:** `docs/superpowers/specs/2026-08-10-aes-crypto-design.md`

## Global Constraints

- 同步纯 JS AES（不用 Web Crypto 异步）。
- `createSymmetricCrypto(transformation, key, iv?)` 返回对象：`encryptBase64`/`encryptHex`/`encrypt`（返回 Uint8Array）/`decryptStr`/`decrypt`。
- `transformation` 解析 `AES/CBC/PKCS5Padding`、`AES/ECB/PKCS5Padding`、`AES/CBC/PKCS7Padding`、`AES/ECB/PKCS7Padding` 等；默认 CBC。
- key：字符串 UTF-8 字节，长度 16/24/32（不足补零、超出截断）；IV 默认 16 字节零（或取 key 前 16）。
- 现有测试保持绿：`npm test`（126 个）。
- 不修改 `docs/` 与 `.git/`。

---

### Task 1: 同步纯 JS AES 核心（aes.ts）

**Files:**
- Create: `src/services/aes.ts`
- Create: `src/services/aes.test.ts`

**Interfaces:**
- Produces:
  - `export class SymmetricCrypto { constructor(transformation: string, key: string | number[] | null, iv?: string | number[] | null); encryptBase64(data: string): string; encryptHex(data: string): string; encrypt(data: string): Uint8Array; decryptStr(data: string): string; decrypt(data: string): string; }`

- [ ] **Step 1: 写失败的测试**

`src/services/aes.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SymmetricCrypto } from "./aes";

describe("SymmetricCrypto AES-128-ECB", () => {
  it("matches NIST vector: key=000102...0f, plaintext=00112233...ff", () => {
    // NIST FIPS-197 C.1: key=000102030405060708090a0b0c0d0e0f, input=00112233445566778899aabbccddeeff
    const c = new SymmetricCrypto("AES/ECB/PKCS5Padding", "000102030405060708090a0b0c0d0e0f");
    // Note: key string is UTF-8 bytes of the ASCII hex chars, NOT hex-decoded.
    // For a true NIST vector test we'd pass the 16 raw bytes. Use raw bytes:
    const c2 = new SymmetricCrypto("AES/ECB/PKCS5Padding", [0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f]);
    const out = c2.encryptHex("00112233445566778899aabbccddeeff");
    // 16-byte input with PKCS7 → 32-byte output; first block should be 69c4e0d86a7b0430d8cdb78070b4c55a
    expect(out.slice(0, 32)).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
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
```
> 注：NIST 向量那条要求 key 为**原始 16 字节**（number[] 传法），输入为原始 16 字节（这里用 ASCII hex 字符串「001122...」会先 UTF-8 编码成 32 字节再加密——为得到标准向量，实现需支持把 key/明文按字节数组传。若实现按「字符串=UTF-8 字节」处理，测试应改用字节数组传明文。实现者需协调：`encryptHex` 的输入若是 `Uint8Array` 或 hex 字符串？**设计上 `encrypt(data)`/`encryptHex(data)` 的 data 统一按 UTF-8 字符串处理**；NIST 向量测试改用「key=字节数组、明文=字节数组」需要 aes.ts 暴露底层 `encryptBytes(bytes: Uint8Array)`。让实现提供 `encryptBytes`/`decryptBytes` 内部方法供测试，NIST 向量用它断言。若不便，可降级为只用 round-trip 测试 + 一个已知的在线 AES 输出做参考。实现者按能测为准，向量测试优先用 FIPS-197 C.1 官方值。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/aes.test.ts`
Expected: FAIL（aes.ts 不存在）。

- [ ] **Step 3: 实现 aes.ts**

同步纯 JS AES 实现（S-box、密钥扩展、加密轮、CBC/ECB、PKCS7 填充/去填充、字节数组↔UTF-8、Base64/Hex 编解码）。约 250-300 行。要点：
```ts
// 内部
const SBOX: number[]; // AES S-box
function keyExpansion(key: Uint8Array): number[][]; // 44 字轮密钥
function encryptBlock(state: Uint8Array, roundKeys: number[][]): void;
function pkcs7Pad(data: Uint8Array): Uint8Array;
function pkcs7Unpad(data: Uint8Array): Uint8Array;

export class SymmetricCrypto {
  private roundKeys: number[][];
  private mode: "CBC" | "ECB";
  private iv: Uint8Array;
  constructor(transformation: string, key: string | number[] | null, iv?: string | number[] | null) {
    // 解析 transformation: "AES/CBC/PKCS5Padding" → mode=CBC; "AES/ECB/..." → ECB; 默认 CBC
    // key: string→TextEncoder UTF-8 字节, 截断/补零到 16/24/32
    // iv: string→UTF-8 字节 前16, 或 null→零16
  }
  encryptBytes(data: Uint8Array): Uint8Array { /* pkcs7 + CBC/ECB */ }
  decryptBytes(data: Uint8Array): Uint8Array { /* 去填充 */ }
  encrypt(data: string): Uint8Array { return this.encryptBytes(new TextEncoder().encode(data)); }
  encryptBase64(data: string): string { return bytesToBase64(this.encrypt(data)); }
  encryptHex(data: string): string { return bytesToHex(this.encrypt(data)); }
  decrypt(data: string): string { /* base64 或 hex 解码 → decryptBytes → UTF-8 */ }
  decryptStr(data: string): string { return this.decrypt(data); }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/aes.test.ts`
Expected: 全部 PASS（NIST 向量 + round-trip + key 处理）。

- [ ] **Step 5: 提交**

```bash
git add src/services/aes.ts src/services/aes.test.ts
git commit -m "feat: 同步纯 JS AES 加密"
```

---

### Task 2: java.createSymmetricCrypto 注入

**Files:**
- Modify: `src/services/bookSourceEngine.ts`
- Modify: `src/services/bookSourceEngine.test.ts`

**Interfaces:**
- Consumes: Task 1 `SymmetricCrypto`
- Produces: `evalJs` 的 `java` 对象加 `createSymmetricCrypto(transformation, key, iv?)` 返回 `SymmetricCrypto` 实例。

- [ ] **Step 1: 写失败的测试**

`src/services/bookSourceEngine.test.ts` 追加：
```ts
it("java.createSymmetricCrypto encrypts and decrypts", () => {
  const r = evalJs("var c=java.createSymmetricCrypto('AES/ECB/PKCS5Padding','0123456789abcdef'); c.decryptStr(c.encryptBase64('你好'))", { doc: emptyDoc() });
  expect(r).toBe("你好");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/bookSourceEngine.test.ts`
Expected: FAIL（createSymmetricCrypto 不存在）。

- [ ] **Step 3: 实现**

`bookSourceEngine.ts`：
- 顶部 `import { SymmetricCrypto } from "./aes";`
- `java` 对象加：
```ts
createSymmetricCrypto: (transformation: string, key: any, iv?: any) =>
  new SymmetricCrypto(transformation, key, iv),
```
（key/iv 传 `string | number[] | null`，由 SymmetricCrypto 内部处理。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/bookSourceEngine.test.ts` — 全 PASS。`npm test` 全量 + `npm run build`。

- [ ] **Step 5: 提交**

```bash
git add src/services/bookSourceEngine.ts src/services/bookSourceEngine.test.ts
git commit -m "feat: java.createSymmetricCrypto 注入"
```

---

## 已知限制（记录于 spec 附录）

- 仅 AES（legado 书源主流）；DES/3DES 不实现。
- `key=null` 随机密钥场景不实现。
- 纯 JS 实现比原生略慢，单次关键词加密无感。
