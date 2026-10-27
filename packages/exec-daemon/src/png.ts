const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngSize {
  width: number;
  height: number;
}

/** Read width and height from a PNG IHDR. Does not decode pixels. */
export function readPngSize(bytes: Buffer): PngSize {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("capture file is not a png");
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("capture file is not a png");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
