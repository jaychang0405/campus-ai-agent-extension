// Verifies the orchestrator's fallback branch (locateKeyword.js) without
// needing any cloud credentials: a stub OCR provider "fails" to find the
// keyword (simulating an icon-only button with no on-screen text), and a
// stub vision provider returns a canned coordinate. Confirms the pipeline
// correctly falls through OCR -> LLM and reports source: 'llm-vision'.
import assert from 'node:assert/strict';
import { locateKeyword } from '../src/pipeline/locateKeyword.js';

const image = { width: 1000, height: 620, path: 'unused-in-this-test' };

const stubOcr = {
  name: 'stub-ocr-no-match',
  async detectText() {
    // Simulates a screen with some text, none of which relates to the
    // keyword we're about to search for (an icon-only button case).
    return {
      items: [{ text: '登入 Portal', level: 'line', confidence: 0.9, boundingBox: { x: 10, y: 10, width: 80, height: 20 } }],
    };
  },
};

const stubVision = {
  name: 'stub-vision-fallback',
  async locate({ keyword }) {
    return {
      matches: [
        {
          text: keyword,
          boundingBox: { x: 200, y: 300, width: 40, height: 40 },
          confidence: 0.7,
          matchType: 'llm-direct',
        },
      ],
      raw: { note: 'canned response' },
    };
  },
};

const result = await locateKeyword(
  { image, keyword: '搜尋圖示' }, // a keyword the stub OCR text has no relation to
  { ocr: stubOcr, visionFallback: stubVision }
);

assert.equal(result.source, 'llm-vision');
assert.equal(result.found, true);
assert.deepEqual(result.primaryMatch.boundingBox, { x: 200, y: 300, width: 40, height: 40 });
assert.equal(result.primaryMatch.center.x, 220);
assert.equal(result.primaryMatch.center.y, 320);

console.log('[unit-fallback] PASS — orchestrator correctly fell through OCR -> LLM vision fallback');
console.log(JSON.stringify(result, null, 2));
