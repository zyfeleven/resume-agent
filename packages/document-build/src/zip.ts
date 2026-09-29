/**
 * A minimal ZIP writer and reader for OOXML packages.
 *
 * Entries are stored uncompressed, which keeps the writer small enough to audit line by
 * line and keeps the output byte-for-byte deterministic: no compressor version, no clock,
 * and no platform detail leaks into a document hash that later gates approval.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

class ByteWriter {
  private readonly chunks: number[] = [];

  u16(value: number): void {
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff);
  }

  u32(value: number): void {
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  bytes(data: Uint8Array): void {
    for (const byte of data) {
      this.chunks.push(byte);
    }
  }

  get length(): number {
    return this.chunks.length;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Fixed MS-DOS timestamp: 1980-01-01. A build's bytes must not depend on when it ran. */
const DOS_TIME = 0;
const DOS_DATE = 0x00_21;

export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const output = new ByteWriter();
  const central = new ByteWriter();
  let entryCount = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const localOffset = output.length;

    output.u32(0x04_03_4b_50);
    output.u16(20); // Version needed to extract
    output.u16(0); // No flags; names are ASCII
    output.u16(0); // Stored
    output.u16(DOS_TIME);
    output.u16(DOS_DATE);
    output.u32(checksum);
    output.u32(entry.data.length);
    output.u32(entry.data.length);
    output.u16(nameBytes.length);
    output.u16(0); // No extra field
    output.bytes(nameBytes);
    output.bytes(entry.data);

    central.u32(0x02_01_4b_50);
    central.u16(20); // Version made by
    central.u16(20); // Version needed to extract
    central.u16(0);
    central.u16(0); // Stored
    central.u16(DOS_TIME);
    central.u16(DOS_DATE);
    central.u32(checksum);
    central.u32(entry.data.length);
    central.u32(entry.data.length);
    central.u16(nameBytes.length);
    central.u16(0); // No extra field
    central.u16(0); // No comment
    central.u16(0); // Disk number
    central.u16(0); // Internal attributes
    central.u32(0); // External attributes
    central.u32(localOffset);
    central.bytes(nameBytes);

    entryCount += 1;
  }

  const centralOffset = output.length;
  const centralBytes = central.toUint8Array();
  output.bytes(centralBytes);

  output.u32(0x06_05_4b_50);
  output.u16(0); // Disk number
  output.u16(0); // Disk with central directory
  output.u16(entryCount);
  output.u16(entryCount);
  output.u32(centralBytes.length);
  output.u32(centralOffset);
  output.u16(0); // No comment

  return output.toUint8Array();
}

/**
 * Read back a package this writer produced. Only stored entries are supported, so a
 * compressed archive from elsewhere is rejected rather than silently half-read.
 */
export function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  if (data.length < 22) throw new Error("This ZIP package is truncated.");

  const endOffset = data.length - 22;
  if (readU32(data, endOffset) !== 0x06_05_4b_50 || readU16(data, endOffset + 20) !== 0) {
    throw new Error("This ZIP package has no canonical end record.");
  }
  const entryCount = readU16(data, endOffset + 10);
  const centralSize = readU32(data, endOffset + 12);
  const centralOffset = readU32(data, endOffset + 16);
  if (
    readU16(data, endOffset + 4) !== 0 ||
    readU16(data, endOffset + 6) !== 0 ||
    readU16(data, endOffset + 8) !== entryCount ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new Error("This ZIP package has an inconsistent central directory.");
  }

  const localRecords: Array<{
    name: string;
    crc: number;
    size: number;
    localOffset: number;
  }> = [];
  let offset = 0;

  while (offset < centralOffset) {
    if (offset + 30 > centralOffset || readU32(data, offset) !== 0x04_03_4b_50) {
      throw new Error("This ZIP package has a malformed local entry.");
    }
    const localOffset = offset;
    const flags = readU16(data, offset + 6);
    const method = readU16(data, offset + 8);
    const checksum = readU32(data, offset + 14);
    const compressedSize = readU32(data, offset + 18);
    const size = readU32(data, offset + 18);
    const uncompressedSize = readU32(data, offset + 22);
    const nameLength = readU16(data, offset + 26);
    const extraLength = readU16(data, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;

    if (flags !== 0 || method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error("This package uses unsupported ZIP flags or compression.");
    }
    if (nameLength === 0 || extraLength !== 0 || dataEnd > centralOffset) {
      throw new Error("This ZIP entry is truncated or contains a non-canonical extra field.");
    }

    const name = decoder.decode(data.subarray(nameStart, nameStart + nameLength));
    const segments = name.split("/");
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes(":") ||
      [...name].some((character) => character.charCodeAt(0) > 0x7f) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
      entries.has(name)
    ) {
      throw new Error("This ZIP package contains an unsafe or duplicate entry name.");
    }

    const entryData = data.subarray(dataStart, dataEnd);
    if (crc32(entryData) !== checksum) throw new Error("This ZIP entry failed its CRC-32 check.");

    entries.set(name, entryData);
    localRecords.push({ name, crc: checksum, size, localOffset });
    offset = dataEnd;
  }

  if (localRecords.length !== entryCount || offset !== centralOffset) {
    throw new Error("This ZIP package has the wrong number of local entries.");
  }

  let centralCursor = centralOffset;
  for (const expected of localRecords) {
    if (centralCursor + 46 > endOffset || readU32(data, centralCursor) !== 0x02_01_4b_50) {
      throw new Error("This ZIP package has a malformed central entry.");
    }
    const flags = readU16(data, centralCursor + 8);
    const method = readU16(data, centralCursor + 10);
    const checksum = readU32(data, centralCursor + 16);
    const compressedSize = readU32(data, centralCursor + 20);
    const uncompressedSize = readU32(data, centralCursor + 24);
    const nameLength = readU16(data, centralCursor + 28);
    const extraLength = readU16(data, centralCursor + 30);
    const commentLength = readU16(data, centralCursor + 32);
    const localOffset = readU32(data, centralCursor + 42);
    const nameStart = centralCursor + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    const name = decoder.decode(data.subarray(nameStart, nameStart + nameLength));
    if (
      next > endOffset ||
      flags !== 0 ||
      method !== 0 ||
      checksum !== expected.crc ||
      compressedSize !== expected.size ||
      uncompressedSize !== expected.size ||
      localOffset !== expected.localOffset ||
      name !== expected.name ||
      extraLength !== 0 ||
      commentLength !== 0
    ) {
      throw new Error("This ZIP package's central entry does not match its local entry.");
    }
    centralCursor = next;
  }

  if (centralCursor !== endOffset) throw new Error("This ZIP package has trailing central-directory data.");

  return entries;
}
