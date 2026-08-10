const S: number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K: number[] = [];
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

function leftRotate(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

function toHexLE(n: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;

  const padded: number[] = [];
  for (const b of bytes) padded.push(b);
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  for (let i = 0; i < 8; i++) {
    padded.push(Math.floor(bitLen / Math.pow(2, 8 * i)) & 0xff);
  }

  const M: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    M.push(
      (padded[i]! | (padded[i + 1]! << 8) | (padded[i + 2]! << 16) | (padded[i + 3]! << 24)) >>> 0,
    );
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let i = 0; i < M.length; i += 16) {
    const chunk = M.slice(i, i + 16);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let j = 0; j < 64; j++) {
      let F: number;
      let g: number;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) % 16;
      }
      F = (F + A + K[j]! + chunk[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + leftRotate(F, S[j]!)) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}
