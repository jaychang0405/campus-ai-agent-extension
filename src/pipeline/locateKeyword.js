// Core orchestrator: screenshot + keyword -> coordinate.
// No provider-specific code lives here — it only knows the two provider
// interfaces:
//   ocr:            { name, detectText(image) -> { items, raw } }
//   visionFallback: { name, locate({image, keyword, candidates}) -> { matches, raw } }
// which is what makes providers swappable (Azure <-> Tesseract <-> Claude)
// without touching this file.
import { matchKeyword } from '../matching/textMatch.js';

/**
 * @param {{image: {path?,buffer?,dataUrl?,width,height}, keyword: string, options?: object}} input
 * @param {{ocr: object, visionFallback?: object}} providers
 */
export async function locateKeyword({ image, keyword, options = {} }, providers) {
  if (!providers?.ocr) throw new Error('locateKeyword requires providers.ocr');
  const minConfidence = options.minConfidence ?? 0.55;
  const t0 = Date.now();
  const timing = {};

  const ocrResult = await providers.ocr.detectText(image);
  timing.ocrMs = Date.now() - t0;

  const ocrMatches = matchKeyword(ocrResult.items, keyword, options);
  const best = ocrMatches[0];
  const ocrConfident = !!best && (best.confidence ?? 1) * best.matchScore >= minConfidence;

  if (ocrConfident || !providers.visionFallback) {
    return finalize({
      source: ocrConfident ? 'ocr' : 'none',
      matches: ocrMatches,
      image,
      timing: { ...timing, totalMs: Date.now() - t0 },
      ocrProvider: providers.ocr.name,
    });
  }

  const t1 = Date.now();
  const lineCandidates = ocrResult.items.filter((i) => i.level === 'line');
  const llmResult = await providers.visionFallback.locate({
    image,
    keyword,
    candidates: lineCandidates,
    options,
  });
  timing.llmMs = Date.now() - t1;

  const matches = llmResult.matches.length ? llmResult.matches : ocrMatches;
  return finalize({
    source: llmResult.matches.length ? 'llm-vision' : 'none',
    matches,
    image,
    timing: { ...timing, totalMs: Date.now() - t0 },
    ocrProvider: providers.ocr.name,
    visionProvider: providers.visionFallback.name,
  });
}

function finalize({ source, matches, image, timing, ocrProvider, visionProvider }) {
  const primary = matches[0] ?? null;
  return {
    found: !!primary,
    source,
    imageSize: { width: image.width, height: image.height },
    primaryMatch: primary
      ? {
          text: primary.text,
          boundingBox: primary.boundingBox,
          center: {
            x: primary.boundingBox.x + primary.boundingBox.width / 2,
            y: primary.boundingBox.y + primary.boundingBox.height / 2,
          },
          confidence: primary.confidence ?? primary.matchScore ?? null,
          matchType: primary.matchType,
        }
      : null,
    candidates: matches,
    timing,
    providers: { ocr: ocrProvider, visionFallback: visionProvider },
  };
}
