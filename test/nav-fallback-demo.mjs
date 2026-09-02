// Demonstrates that the pipeline needs NO special detector for "is this a
// tab-style nav bar" (or any other UI pattern OCR happens to miss). The
// orchestrator (locateKeyword.js) only ever asks "did OCR find this
// keyword with enough confidence?" — when the answer is no, it falls
// through to the vision provider automatically, regardless of *why* OCR
// missed it.
//
// This uses the REAL Tesseract OCR pass against the REAL course-announce
// screenshot (README § 4.1 established OCR can't detect "課程查詢" /
// "登入系統" / "相關資訊" in the nav bar no matter how it's tuned), paired
// with a stub vision provider standing in for azureOpenAiVision.js until
// we have a real Azure OpenAI key. The stub's coordinate is a placeholder,
// not a real detection — what this proves is the ROUTING (OCR miss -> LLM
// call, with OCR's candidate boxes passed along as context), which is
// exactly what src/providers/azureOpenAiVision.js will plug into as-is
// once real credentials are available (see npm run test:azure).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import { locateKeyword } from '../src/pipeline/locateKeyword.js';
import { createTesseractOcrProvider } from '../src/providers/tesseractOcr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'course-announce.png');

const stubVisionFallback = {
  name: 'stub-vision (placeholder for azureOpenAiVision.js)',
  async locate({ keyword, candidates }) {
    console.log(`[nav-fallback-demo] LLM fallback invoked: keyword="${keyword}", ${candidates.length} OCR boxes given as context`);
    return {
      matches: [{ text: keyword, boundingBox: { x: 255, y: 94, width: 60, height: 20 }, confidence: 0.5, matchType: 'llm-direct' }],
      raw: {},
    };
  },
};

const meta = await Jimp.read(fixturePath);
const image = { path: fixturePath, width: meta.bitmap.width, height: meta.bitmap.height };
const ocr = createTesseractOcrProvider({ lang: 'chi_tra+eng' });

for (const keyword of ['課程查詢', '登入系統']) {
  const result = await locateKeyword({ image, keyword }, { ocr, visionFallback: stubVisionFallback });
  console.log(
    `[nav-fallback-demo] "${keyword}" -> source: ${result.source}, found: ${result.found}` +
      (result.found ? `, coordinate: (${result.primaryMatch.boundingBox.x}, ${result.primaryMatch.boundingBox.y})` : '')
  );
  if (result.source !== 'llm-vision') {
    throw new Error(`expected "${keyword}" to fall through to the vision fallback, got source=${result.source}`);
  }
}

console.log('[nav-fallback-demo] PASS — nav-bar keywords correctly routed to the vision fallback with no special-case detection needed');
