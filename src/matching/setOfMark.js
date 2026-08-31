// Set-of-Mark (SoM) helper: draws numbered boxes over OCR-detected regions
// so a vision-language model can answer "which numbered box is X" instead
// of guessing raw pixel coordinates. Classification is far more reliable
// than regression for these models — this is the standard trick used by
// GUI-agent research (e.g. Microsoft's UFO, the WebVoyager paper).
import { Jimp, loadFont } from 'jimp';
import { SANS_16_BLACK } from 'jimp/fonts';
import { toBuffer } from '../pipeline/imageUtils.js';

const BOX_COLOR = 0xff3b30ff; // red, RGBA hex as Jimp expects

export async function drawSetOfMark(image, candidates) {
  const buffer = await toBuffer(image);
  const jimg = await Jimp.read(buffer);
  const font = await loadFont(SANS_16_BLACK);
  const marks = candidates.map((c, idx) => ({ id: idx + 1, ...c }));

  for (const m of marks) {
    const { x, y, width, height } = m.boundingBox;
    strokeRect(jimg, x, y, width, height);
    const labelY = Math.max(0, Math.round(y) - 16);
    jimg.print({ font, x: Math.round(x), y: labelY, text: String(m.id) });
  }

  const dataUrl = await jimg.getBase64('image/png');
  return { dataUrl, marks };
}

function strokeRect(jimg, x, y, w, h) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + w);
  const y1 = Math.round(y + h);
  for (let px = x0; px <= x1; px++) {
    safeSet(jimg, px, y0);
    safeSet(jimg, px, y1);
  }
  for (let py = y0; py <= y1; py++) {
    safeSet(jimg, x0, py);
    safeSet(jimg, x1, py);
  }
}

function safeSet(jimg, x, y, color = BOX_COLOR) {
  if (x >= 0 && y >= 0 && x < jimg.bitmap.width && y < jimg.bitmap.height) {
    jimg.setPixelColor(color, x, y);
  }
}
