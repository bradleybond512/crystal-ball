import { deflateSync } from 'node:zlib';

// Build WOFF1 from the already installed test font. No font bytes are vendored.
export function toWoff(ttf) {
  const count = ttf.readUInt16BE(4);
  let offset = 44 + 20 * count;
  let compressedTables = 0;
  const tables = [];
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const start = ttf.readUInt32BE(record + 8);
    const length = ttf.readUInt32BE(record + 12);
    const raw = ttf.subarray(start, start + length);
    const compressed = deflateSync(raw);
    const data = compressed.length < raw.length ? compressed : raw;
    if (data === compressed) compressedTables++;
    tables.push({ record, offset, length, data });
    offset += (data.length + 3) & ~3;
  }
  const output = Buffer.alloc(offset);
  output.write('wOFF');
  ttf.copy(output, 4, 0, 4);
  output.writeUInt32BE(output.length, 8);
  output.writeUInt16BE(count, 12);
  output.writeUInt32BE(12 + count * 16 + tables.reduce((n, t) => n + ((t.length + 3) & ~3), 0), 16);
  for (const [i, table] of tables.entries()) {
    const record = 44 + i * 20;
    ttf.copy(output, record, table.record, table.record + 4);
    output.writeUInt32BE(table.offset, record + 4);
    output.writeUInt32BE(table.data.length, record + 8);
    output.writeUInt32BE(table.length, record + 12);
    ttf.copy(output, record + 16, table.record + 4, table.record + 8);
    table.data.copy(output, table.offset);
  }
  return { output, compressedTables };
}
