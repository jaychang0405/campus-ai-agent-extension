// Local, no-API-key OCR provider used to validate the pipeline end-to-end
// without needing any cloud credentials. Same output shape as the Azure
// provider (src/providers/azureVisionOcr.js) so the orchestrator can't
// tell the difference — swapping providers is a one-line change.
import { createWorker } from 'tesseract.js';

export function createTesseractOcrProvider(opts = {}) {
  const lang = opts.lang ?? 'chi_tra+eng';

  return {
    name: 'tesseract-local',
    async detectText(image) {
      const worker = await createWorker(
        lang,
        1,
        opts.verbose ? { logger: (m) => console.log('[tesseract]', m.status, m.progress) } : undefined
      );
      try {
        const source = image.path ?? image.dataUrl ?? image.buffer;
        const { data } = await worker.recognize(source);
        const lines = (data.lines ?? []).map((l) => toItem(l, 'line'));
        const words = (data.words ?? []).map((w) => toItem(w, 'word'));
        return { items: [...lines, ...words], raw: opts.keepRaw ? data : undefined };
      } finally {
        await worker.terminate();
      }
    },
  };
}

function toItem(entry, level) {
  const { x0, y0, x1, y1 } = entry.bbox;
  return {
    text: entry.text,
    level,
    confidence: (entry.confidence ?? 0) / 100,
    boundingBox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  };
}
