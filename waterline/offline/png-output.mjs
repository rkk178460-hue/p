import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function uniformHash(x, y) {
  let h = Math.imul(x+1, 0x9e3779b1) ^ Math.imul(y+1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function encodeDisplayRows(values, width, height, stride) {
  const master = Buffer.allocUnsafe((1 + width*6)*height);
  const display = Buffer.allocUnsafe((1 + width*3)*height);
  const last16 = [0,0,0];
  const last8 = [0,0,0];
  for (let y=0; y<height; y++) {
    let big = y*(1+width*6), small = y*(1+width*3);
    master[big++] = 1;
    display[small++] = 1; // PNG Sub, separately for the high and low bytes.
    last16.fill(0);
    last8.fill(0);
    let previous = uniformHash(-1, y);
    for (let x=0; x<width; x++) {
      const next = uniformHash(x,y);
      // The difference of two uniform variates gives high-pass triangular
      // dither with unit-LSB peak. Share it across RGB to avoid chroma speckle.
      const noise = next-previous;
      previous = next;
      for (let c=0; c<3; c++) {
        const v = values[y*stride+4*x+c];
        if (!Number.isFinite(v)) throw Error('Invalid resolved display sample');
        const unit = Math.min(1, Math.max(0,v));
        const q = Math.round(unit*65535);
        master[big++] = (q >>> 8) - (last16[c] >>> 8);
        master[big++] = (q & 255) - (last16[c] & 255);
        last16[c] = q;
        const b = Math.min(255,Math.max(0,Math.round(unit*255+noise)));
        display[small++] = b-last8[c];
        last8[c] = b;
      }
    }
  }
  return { master, display };
}

const crcTable = Uint32Array.from({length:256}, (_, n) => {
  let crc=n;
  for (let i=0; i<8; i++) crc=crc&1 ? 0xedb88320 ^ (crc>>>1) : crc>>>1;
  return crc>>>0;
});
function chunk(type, data) {
  const tag = Buffer.from(type);
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  let crc=0xffffffff;
  for (const part of [tag,data]) {
    for (const b of part) crc=crcTable[(crc^b)&255]^(crc>>>8);
  }
  tail.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([head,tag,data,tail]);
}

export async function writePNG(path, rows, width, height, bits, metadata) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width,0);
  header.writeUInt32BE(height,4);
  header[8]=bits;
  header[9]=2; // Truecolor RGB.
  const stream=await fs.open(path,'w');
  try {
    for (const piece of [Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
      chunk('sRGB',Buffer.from([0])),chunk('tEXt',Buffer.from('Waterline Render\0'+JSON.stringify(metadata))),
      chunk('IDAT',deflateSync(rows,{level:6})),chunk('IEND',Buffer.alloc(0))]) {
      await stream.writeFile(piece);
    }
  } finally {
    await stream.close();
  }
}
