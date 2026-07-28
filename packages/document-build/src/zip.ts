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
  let offset = 0;

  while (offset + 30 <= data.length && readU32(data, offset) === 0x04_03_4b_50) {
    const method = readU16(data, offset + 8);
    const size = readU32(data, offset + 18);
    const nameLength = readU16(data, offset + 26);
    const extraLength = readU16(data, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    if (method !== 0) {
      throw new Error("This package uses compressed entries, which this reader does not support.");
    }

    entries.set(decoder.decode(data.subarray(nameStart, nameStart + nameLength)), data.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }

  return entries;
}
