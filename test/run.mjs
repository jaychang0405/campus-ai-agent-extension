// Phase-1 validation harness: screenshot -> OCR -> keyword -> coordinate.
// Runs fully offline (Tesseract.js OCR, no API key) by default. If Azure
// OpenAI env vars are set, also demonstrates the vision-fallback branch.
//
// Usage:
//   node test/run.mjs --keyword "登入 Portal"
//   node test/run.mjs --keyword "忘記密碼"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import { generateFixture } from './generateFixture.mjs';
import { createTesseractOcrProvider } from '../src/providers/tesseractOcr.js';
import { createAzureOpenAiVisionProvider } from '../src/providers/azureOpenAiVision.js';
import { locateKeyword } from '../src/pipeline/locateKeyword.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const keyword = getArg('keyword', '登入 Portal');
const customImage = getArg('image', null);
const fixturePath = customImage
  ? path.resolve(customImage)
  : path.join(__dirname, 'fixtures', 'portal-mockup.png');

if (customImage) {
  console.log(`[run] using provided screenshot: ${fixturePath}`);
} else {
  console.log(`[run] generating fixture screenshot (NCU portal login mockup)...`);
  await generateFixture(fixturePath);
}

const meta = await Jimp.read(fixturePath);
const image = { path: fixturePath, width: meta.bitmap.width, height: meta.bitmap.height };

const ocr = createTesseractOcrProvider({ lang: 'chi_tra+eng' });

let visionFallback;
if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT) {
  visionFallback = createAzureOpenAiVisionProvider({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  });
  console.log('[run] Azure OpenAI vision fallback: ENABLED');
} else {
  console.log('[run] Azure OpenAI env vars not set -> OCR-only run (set them in .env to also exercise the fallback)');
}

console.log(`[run] locating keyword: "${keyword}"`);
const result = await locateKeyword({ image, keyword }, { ocr, visionFallback });

console.log(JSON.stringify(result, null, 2));

if (result.primaryMatch) {
  const outPath = path.join(__dirname, 'output', 'result-annotated.png');
  await annotate(fixturePath, result.primaryMatch.boundingBox, outPath);
  console.log(`[run] annotated result image written to ${outPath}`);
} else {
  console.log('[run] no match found for this keyword.');
}

async function annotate(srcPath, box, outPath) {
  const img = await Jimp.read(srcPath);
  const x0 = Math.round(box.x);
  const y0 = Math.round(box.y);
  const x1 = Math.round(box.x + box.width);
  const y1 = Math.round(box.y + box.height);
  for (let t = -2; t <= 2; t++) {
    for (let px = x0; px <= x1; px++) {
      safeSet(img, px, y0 + t);
      safeSet(img, px, y1 + t);
    }
    for (let py = y0; py <= y1; py++) {
      safeSet(img, x0 + t, py);
      safeSet(img, x1 + t, py);
    }
  }
  await img.write(outPath);
}

function safeSet(img, x, y) {
  if (x >= 0 && y >= 0 && x < img.bitmap.width && y < img.bitmap.height) {
    img.setPixelColor(0xff3b30ff, x, y);
  }
}
