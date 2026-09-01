// Local, no-API-key OCR provider used to validate the pipeline end-to-end
// without needing any cloud credentials. Same output shape as the Azure
// provider (src/providers/azureVisionOcr.js) so the orchestrator can't
// tell the difference — swapping providers is a one-line change.
//
// Real screenshots of dense production pages (e.g. the 選課系統 announce
// board, with its header banner, sidebar, and multi-column body all in one
// image) trip up Tesseract's default automatic page-segmentation: tested
// against test/fixtures/course-announce.png it returned near-total garbage
// at defaults. Two changes fixed it: (1) upscale 2x before recognition,
// and (2) use PSM.SPARSE_TEXT instead of the library's default AUTO —
// AUTO tries to carve the page into a few big regions first and silently
// drops whole sections (nav bars, sidebars) that don't fit its model;
// SPARSE_TEXT makes no structural assumption and just hunts for text
// anywhere, which recovered most of what AUTO missed. One thing NEITHER
// setting recovers: tab-style nav bars (see README § 4.1) — that's a
// genuine detection blind spot, not a tuning problem, and is exactly the
// class of target the Azure OpenAI vision fallback exists for. This is a
// Tesseract-specific quirk, not a fundamental limit of the approach:
// Azure AI Vision's Read API has much more robust layout analysis out of
// the box and shouldn't need this workaround, but it's cheap insurance to
// keep here too.
import { createWorker, PSM } from 'tesseract.js';
import { Jimp, JimpMime } from 'jimp';
import { toBuffer } from '../pipeline/imageUtils.js';

export function createTesseractOcrProvider(opts = {}) {
  const lang = opts.lang ?? 'chi_tra+eng';
  const upscale = opts.upscale ?? 2;

  return {
    name: 'tesseract-local',
    async detectText(image) {
      const worker = await createWorker(
        lang,
        1,
        opts.verbose ? { logger: (m) => console.log('[tesseract]', m.status, m.progress) } : undefined
      );
      try {
        await worker.setParameters({ tessedit_pageseg_mode: opts.pageSegMode ?? PSM.SPARSE_TEXT });

        const source = await prepareSource(image, upscale);
        const { data } = await worker.recognize(source);
        const lines = (data.lines ?? []).map((l) => toItem(l, 'line', upscale));
        const words = (data.words ?? []).map((w) => toItem(w, 'word', upscale));
        return { items: [...lines, ...words], raw: opts.keepRaw ? data : undefined };
      } finally {
        await worker.terminate();
      }
    },
  };
}

async function prepareSource(image, upscale) {
  if (upscale === 1) return image.path ?? image.dataUrl ?? image.buffer;
  const buffer = await toBuffer(image);
  const jimg = await Jimp.read(buffer);
  jimg.scale(upscale);
  return jimg.getBuffer(JimpMime.png);
}

function toItem(entry, level, upscale) {
  const { x0, y0, x1, y1 } = entry.bbox;
  return {
    text: entry.text,
    level,
    confidence: (entry.confidence ?? 0) / 100,
    boundingBox: {
      x: x0 / upscale,
      y: y0 / upscale,
      width: (x1 - x0) / upscale,
      height: (y1 - y0) / upscale,
    },
  };
}
