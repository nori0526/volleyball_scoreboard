// zip.js — 依存なしの最小ZIP生成（無圧縮/store方式）。
// PNG一式＋テキストをひとつのZIPにまとめてダウンロードさせる用途。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function strToU8(s) {
  return new TextEncoder().encode(s);
}

// files: [{ name: 'dir/file.png', data: Uint8Array }]
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const DOS_DATE = 0x21; // 1980-01-01（固定。ZIP必須フィールドのため）

  for (const f of files) {
    const nameU8 = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);  // local file header
    lh.setUint16(4, 20, true);          // version needed
    lh.setUint16(6, 0x0800, true);      // flags: UTF-8 filename
    lh.setUint16(8, 0, true);           // method: store
    lh.setUint16(10, 0, true);          // time
    lh.setUint16(12, DOS_DATE, true);   // date
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameU8.length, true);
    lh.setUint16(28, 0, true);          // extra len
    parts.push(new Uint8Array(lh.buffer), nameU8, f.data);
    central.push({ nameU8, crc, size, offset });
    offset += 30 + nameU8.length + size;
  }

  const cdParts = [];
  let cdSize = 0;
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);  // central directory header
    ch.setUint16(4, 20, true);          // version made by
    ch.setUint16(6, 20, true);          // version needed
    ch.setUint16(8, 0x0800, true);      // flags: UTF-8
    ch.setUint16(10, 0, true);          // method: store
    ch.setUint16(12, 0, true);          // time
    ch.setUint16(14, 0x21, true);       // date
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.size, true);
    ch.setUint32(24, c.size, true);
    ch.setUint16(28, c.nameU8.length, true);
    // 30..40: extra/comment/disk/attrs = 0
    ch.setUint32(42, c.offset, true);
    cdParts.push(new Uint8Array(ch.buffer), c.nameU8);
    cdSize += 46 + c.nameU8.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...cdParts, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}
