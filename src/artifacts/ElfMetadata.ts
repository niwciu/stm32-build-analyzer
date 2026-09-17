export interface ElfMetadata {
  readonly machine: number;
  readonly bitness: 32 | 64;
  readonly littleEndian: boolean;
}

const ELF_HEADER_MINIMUM_BYTES = 20;

/** Parses only the identification and machine fields; it never executes ELF data. */
export function parseElfMetadata(header: Buffer): ElfMetadata | null {
  if (
    header.length < ELF_HEADER_MINIMUM_BYTES
    || header[0] !== 0x7f
    || header[1] !== 0x45
    || header[2] !== 0x4c
    || header[3] !== 0x46
  ) {
    return null;
  }

  const bitness = header[4] === 1 ? 32 : header[4] === 2 ? 64 : undefined;
  const littleEndian = header[5] === 1
    ? true
    : header[5] === 2
      ? false
      : undefined;
  if (bitness === undefined || littleEndian === undefined) {
    return null;
  }

  return {
    machine: littleEndian
      ? header.readUInt16LE(18)
      : header.readUInt16BE(18),
    bitness,
    littleEndian,
  };
}
