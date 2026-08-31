// One-shot smoke test for the two real Azure services this pipeline
// depends on. Run once you've filled in .env:
//
//   node --env-file=.env test/azure-connection-test.mjs
//
// It reuses the same fixture + scenario from the offline demo (npm run
// demo) so the result is directly comparable: "忘記密碼" should resolve
// via OCR alone, and "登入 Portal" should resolve via the LLM fallback
// (Azure AI Vision misses that button's white-on-blue text, same as the
// local Tesseract run did).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import { generateFixture } from './generateFixture.mjs';
import { createAzureVisionOcrProvider } from '../src/providers/azureVisionOcr.js';
import { createAzureOpenAiVisionProvider } from '../src/providers/azureOpenAiVision.js';
import { locateKeyword } from '../src/pipeline/locateKeyword.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const required = [
  'AZURE_VISION_ENDPOINT',
  'AZURE_VISION_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_KEY',
  'AZURE_OPENAI_DEPLOYMENT',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[azure-test] missing env vars: ${missing.join(', ')}`);
  console.error('[azure-test] cp .env.example .env, fill it in, then run:');
  console.error('[azure-test]   node --env-file=.env test/azure-connection-test.mjs');
  process.exit(1);
}

const fixturePath = path.join(__dirname, 'fixtures', 'portal-mockup.png');
await generateFixture(fixturePath);
const meta = await Jimp.read(fixturePath);
const image = { path: fixturePath, width: meta.bitmap.width, height: meta.bitmap.height };

console.log('[azure-test] 1/3 calling Azure AI Vision (Read OCR)...');
const ocr = createAzureVisionOcrProvider({
  endpoint: process.env.AZURE_VISION_ENDPOINT,
  apiKey: process.env.AZURE_VISION_KEY,
});
const ocrResult = await ocr.detectText(image);
const lineCount = ocrResult.items.filter((i) => i.level === 'line').length;
console.log(`[azure-test]    OK — detected ${lineCount} lines of text`);

console.log('[azure-test] 2/3 locating "忘記密碼" (should resolve via OCR alone)...');
const r1 = await locateKeyword({ image, keyword: '忘記密碼' }, { ocr });
console.log(
  '   ',
  r1.found
    ? `FOUND via ${r1.source} at (${Math.round(r1.primaryMatch.boundingBox.x)}, ${Math.round(r1.primaryMatch.boundingBox.y)})`
    : 'NOT FOUND'
);

console.log('[azure-test] 3/3 locating "登入 Portal" (should force the Azure OpenAI SoM fallback)...');
const visionFallback = createAzureOpenAiVisionProvider({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiKey: process.env.AZURE_OPENAI_KEY,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
});
const r2 = await locateKeyword({ image, keyword: '登入 Portal' }, { ocr, visionFallback });
console.log(
  '   ',
  r2.found
    ? `FOUND via ${r2.source} at (${Math.round(r2.primaryMatch.boundingBox.x)}, ${Math.round(r2.primaryMatch.boundingBox.y)})`
    : 'NOT FOUND'
);

console.log('\n[azure-test] both services responded successfully — Azure integration is wired up correctly.');
