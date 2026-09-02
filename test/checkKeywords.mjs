// Full local coverage check: for every fixture that has a matching keyword
// list in test/keywords/, run EVERY keyword through the pipeline and print
// a report — no need to test keywords one at a time with `npm run demo`.
//
// For each keyword this shows two things:
//   1. "OCR" column — can Azure/Tesseract OCR alone find it? (the fast,
//      cheap, primary path)
//   2. "with fallback" column — once the vision fallback is added, does
//      the keyword resolve at all? This is what answers "OCR 辨識不到的
//      要怎麼辦" — it should ALWAYS say yes here, because that's exactly
//      what the fallback exists for. If a row ever shows "with fallback:
//      NOT FOUND", that's a real bug in the orchestrator, not an
//      OCR/detection limitation, and needs investigating.
//
// Without Azure credentials, the fallback column uses a stub that always
// returns a placeholder coordinate — it proves the ROUTING is correct
// (OCR miss -> LLM call), not that the coordinate is accurate. Once
// AZURE_OPENAI_* env vars are set, it automatically switches to the real
// createAzureOpenAiVisionProvider so the "with fallback" column becomes a
// real accuracy check too.
//
// Usage:
//   node test/checkKeywords.mjs --all
//   node test/checkKeywords.mjs --image test/fixtures/course-announce.png --keywords test/keywords/course-announce.json
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { Jimp } from 'jimp';
import { locateKeyword } from '../src/pipeline/locateKeyword.js';
import { createTesseractOcrProvider } from '../src/providers/tesseractOcr.js';
import { createAzureOpenAiVisionProvider } from '../src/providers/azureOpenAiVision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function makeStubVisionFallback() {
  return {
    name: 'stub-vision (placeholder — proves routing only, not real accuracy)',
    async locate({ keyword }) {
      return {
        matches: [{ text: keyword, boundingBox: { x: 0, y: 0, width: 0, height: 0 }, confidence: 0, matchType: 'llm-direct (stub)' }],
        raw: {},
      };
    },
  };
}

function makeVisionFallback() {
  if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT) {
    return {
      provider: createAzureOpenAiVisionProvider({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiKey: process.env.AZURE_OPENAI_KEY,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      }),
      isReal: true,
    };
  }
  return { provider: makeStubVisionFallback(), isReal: false };
}

// Wraps a provider's detectText result so it's computed once and reused —
// running the full OCR pass again per keyword would be ~2-6s x N keywords
// for no benefit, since the underlying screenshot never changes mid-report.
function cacheOcr(realOcr, cached) {
  return { name: realOcr.name, async detectText() { return cached; } };
}

async function checkOne(imagePath, keywordsPath) {
  const keywords = JSON.parse(await readFile(keywordsPath, 'utf8'));
  const meta = await Jimp.read(imagePath);
  const image = { path: imagePath, width: meta.bitmap.width, height: meta.bitmap.height };

  const realOcr = createTesseractOcrProvider({ lang: 'chi_tra+eng' });
  const ocrResult = await realOcr.detectText(image);
  const ocr = cacheOcr(realOcr, ocrResult);
  const { provider: visionFallback, isReal } = makeVisionFallback();

  console.log(`\n=== ${path.basename(imagePath)} (${keywords.length} keywords, fallback: ${isReal ? 'REAL Azure OpenAI' : 'stub placeholder'}) ===`);

  let ocrHits = 0;
  let fallbackHits = 0;
  let unresolved = 0;

  for (const keyword of keywords) {
    const ocrOnly = await locateKeyword({ image, keyword }, { ocr });
    const withFallback = await locateKeyword({ image, keyword }, { ocr, visionFallback });

    const ocrCol = ocrOnly.found
      ? `OCR: FOUND (${ocrOnly.primaryMatch.confidence.toFixed(2)})`
      : 'OCR: not found';
    const fallbackCol = withFallback.found ? `with fallback: FOUND via ${withFallback.source}` : 'with fallback: NOT FOUND ⚠️';

    console.log(`  ${keyword.padEnd(20, '　')} ${ocrCol.padEnd(22)} | ${fallbackCol}`);

    if (ocrOnly.found) ocrHits++;
    else if (withFallback.found) fallbackHits++;
    else unresolved++;
  }

  console.log(
    `  --- ${ocrHits}/${keywords.length} found by OCR directly, ${fallbackHits}/${keywords.length} needed the vision fallback, ${unresolved}/${keywords.length} unresolved by either ---`
  );
  if (unresolved > 0) {
    console.log('  ⚠️  unresolved > 0 with a fallback attached is unexpected — investigate locateKeyword.js, not OCR tuning.');
  }
  return { total: keywords.length, ocrHits, fallbackHits, unresolved };
}

const imageArg = getArg('image');
const keywordsArg = getArg('keywords');
const all = process.argv.includes('--all');

let pairs;
if (all) {
  const keywordFiles = (await readdir(path.join(__dirname, 'keywords'))).filter((f) => f.endsWith('.json'));
  pairs = keywordFiles.map((f) => ({
    image: path.join(__dirname, 'fixtures', f.replace(/\.json$/, '.png')),
    keywords: path.join(__dirname, 'keywords', f),
  }));
} else if (imageArg && keywordsArg) {
  pairs = [{ image: path.resolve(imageArg), keywords: path.resolve(keywordsArg) }];
} else {
  console.error('Usage: node test/checkKeywords.mjs --all');
  console.error('   or: node test/checkKeywords.mjs --image <png> --keywords <json>');
  process.exit(1);
}

const totals = { total: 0, ocrHits: 0, fallbackHits: 0, unresolved: 0 };
for (const { image, keywords } of pairs) {
  const r = await checkOne(image, keywords);
  totals.total += r.total;
  totals.ocrHits += r.ocrHits;
  totals.fallbackHits += r.fallbackHits;
  totals.unresolved += r.unresolved;
}

if (pairs.length > 1) {
  console.log(
    `\n=== TOTAL: ${totals.total} keywords across ${pairs.length} pages — ${totals.ocrHits} via OCR, ${totals.fallbackHits} via fallback, ${totals.unresolved} unresolved ===`
  );
}
