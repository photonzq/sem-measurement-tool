// Types of the parts of vendor/UTIF.js that the app uses, for type checking only.

/** A decoded image file directory: every tag as "t" + its number, e.g. t256 (width). */
interface UtifIfd {
  [tag: string]: unknown;
  width?: number;
  height?: number;
  /** Pixel bytes after decodeImage; 16-bit samples little-endian. */
  data?: Uint8Array;
  /** Whether the file is little-endian ("II"). */
  isLE?: boolean;
}

declare const UTIF: {
  decode(buffer: ArrayBuffer): UtifIfd[];
  decodeImage(buffer: ArrayBuffer, ifd: UtifIfd, ifds?: UtifIfd[]): void;
};
