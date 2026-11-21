import { inflateRawSync } from "node:zlib";

/**
 * Whether a ZIP really unpacks into at most `limit` bytes. The sizes a file declares can
 * be made up, so every part is unpacked here with a ceiling, and the counting stops the
 * moment the ceiling is passed: a file built to swell into gigabytes is refused after
 * `limit` bytes, before the workbook reader ever sees it.
 */
export function unpacksWithin(zip: Buffer, limit: number): boolean {
  let total = 0;
  for (let i = zip.indexOf("PK\x01\x02", 0, "latin1"); i >= 0 && i + 46 <= zip.length; i = zip.indexOf("PK\x01\x02", i + 4, "latin1")) {
    const method = zip.readUInt16LE(i + 10);
    const packed = zip.readUInt32LE(i + 20);
    const at = zip.readUInt32LE(i + 42);
    // Sizes too large for these fields are kept elsewhere in the file (ZIP64); no workbook this app accepts needs that.
    if (packed === 0xffffffff || at === 0xffffffff) return false;
    if (at + 30 > zip.length || zip.readUInt32LE(at) !== 0x04034b50) continue;
    const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
    if (start + packed > zip.length) continue;
    if (method === 0) total += packed;
    else if (method === 8) {
      try {
        total += inflateRawSync(zip.subarray(start, start + packed), { maxOutputLength: limit - total + 1 }).length;
      } catch (e) {
        // More than the ceiling allows. Anything else is a damaged part, which the reader reports as unreadable.
        if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return false;
      }
    }
    if (total > limit) return false;
  }
  return true;
}
