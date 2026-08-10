# 子项目2：AES 加密（java.createSymmetricCrypto）设计文档

日期：2026-08-10
状态：已批准

## 1. 背景与目标

部分 legado 书源（如可乐小说）用 `java.createSymmetricCrypto('AES/CBC/PKCS5Padding', key, iv)` 对搜索关键词等做 AES 加密。当前「枕书」的 `evalJs` 的 `java` 对象无此方法，此类书源无法使用。

**目标**：在 `evalJs` 的 `java` 对象中实现 `createSymmetricCrypto(transformation, key, iv?)`，返回支持 `encryptBase64`/`encryptHex`/`encrypt`/`decryptStr`/`decrypt` 的同步加密对象，覆盖 legado 书源的 AES-CBC/ECB 用法。

**参考**：legado-md3 仓库 `JsEncodeUtils.kt` 的 `createSymmetricCrypto` 接口 + Hutool 的 `SymmetricCrypto`。

## 2. 非目标

- 不支持非 AES 算法（DES/3DES/SM4 等）—— legado 书源主流是 AES。
- 不支持 `key=null` 随机密钥场景（书源需已知 key 才能解密，随机 key 无实用价值）。
- 不异步（保持书源 `@js:` 同步调用模型）。

## 3. 技术方案：同步纯 JS AES

Web Crypto `crypto.subtle` 是异步的，与书源同步 `@js:` 调用冲突。故**内置一个同步纯 JS AES 实现**（AES-128/192/256 + CBC/ECB + PKCS7 填充）。

- 新建 `src/services/aes.ts`：
  - `export class SymmetricCrypto { constructor(transformation: string, key: string | number[] | null, iv?: string | number[] | null); encryptBase64(data: string): string; encryptHex(data: string): string; encrypt(data: string): string; decryptStr(data: string): string; decrypt(data: string): string; }`
  - 内部 AES 核心：S-box、密钥扩展、CBC/ECB 模式、PKCS7 填充。
  - `transformation` 解析：`AES/CBC/PKCS5Padding`、`AES/ECB/PKCS5Padding`、`AES/CBC/PKCS7Padding`、`AES/ECB/PKCS7Padding` 等；默认 CBC。
  - key：字符串按 UTF-8 字节，长度 16/24/32（不足补零/取前 N）；IV 默认 16 字节零（或取 key 前 16）。
  - `encryptBase64`：AES 加密 → Base64（UTF-8 编码输入）。
  - `decryptStr`：Base64/Hex 解码 → AES 解密 → UTF-8 字符串。
  - `encryptHex`：AES 加密 → Hex。
  - `encrypt`：AES 加密 → 返回字节数组（`Uint8Array`）。书源脚本通常用 `encryptBase64`/`encryptHex`；`encrypt` 为兼容 Hutool 语义暴露原始字节。

## 4. evalJs 注入

`src/services/bookSourceEngine.ts` 的 `evalJs` `java` 对象加：
```ts
createSymmetricCrypto: (transformation: string, key: any, iv?: any) => new SymmetricCrypto(transformation, key, iv),
```
并注入 `java`（已有）。书源脚本内 `java.createSymmetricCrypto(...)` 即返回可用的加密对象。

## 5. 测试

- `src/services/aes.test.ts`：
  - 已知向量：NIST AES-128 ECB 测试向量；AES-CBC 标准向量。
  - PKCS7 填充/去填充边界（恰好整块、不足一块）。
  - `encryptBase64`/`decryptStr` 往返。
  - `transformation` 解析（CBC/ECB + PKCS5/7）。
  - key/iv 字符串与字节数组两种传法。
- `bookSourceEngine.test.ts`：
  - `evalJs("java.createSymmetricCrypto('AES/ECB/PKCS5Padding','0123456789abcdef').encryptBase64('你好')", { doc })` 返回可预期的值并 `decryptStr` 还原。
- 可乐书源场景：用其真实 key/iv 验证 `encryptBase64` 输出匹配（若可离线验证）。

## 6. 交付文件

- `src/services/aes.ts`（新建）
- `src/services/aes.test.ts`（新建）
- `src/services/bookSourceEngine.ts`（java 注入 createSymmetricCrypto）
- `src/services/bookSourceEngine.test.ts`

## 7. 已知限制

- 仅 AES（legado 书源主流）；DES/3DES 等不实现。
- `key=null` 随机密钥场景不实现（无实用价值）。
- 纯 JS 实现比原生略慢，但对单次关键词加密无感。
