// PRIMARY provider (recommended default). Azure AI Vision — Image Analysis
// "Read" feature. Deterministic OCR with per-word/per-line bounding
// polygons and confidence scores; no LLM guessing involved, so coordinates
// are as precise as the underlying text detector (typically single-digit
// pixel error), which is what a keyword-based locator actually needs.
//
// Docs: https://learn.microsoft.com/azure/ai-services/computer-vision/how-to/call-read-api
import { toBuffer } from '../pipeline/imageUtils.js';

export function createAzureVisionOcrProvider({ endpoint, apiKey, apiVersion = '2024-02-01' } = {}) {
  if (!endpoint || !apiKey) {
    throw new Error(
      'Azure AI Vision provider requires { endpoint, apiKey } (env: AZURE_VISION_ENDPOINT, AZURE_VISION_KEY)'
    );
  }
  const url = `${endpoint.replace(/\/$/, '')}/computervision/imageanalysis:analyze?api-version=${apiVersion}&features=read`;

  return {
    name: 'azure-ai-vision-read',
    async detectText(image) {
      const buffer = await toBuffer(image);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/octet-stream',
        },
        body: buffer,
      });
      if (!res.ok) {
        throw new Error(`Azure AI Vision error ${res.status}: ${await res.text()}`);
      }
      const json = await res.json();
      const items = [];
      for (const block of json.readResult?.blocks ?? []) {
        for (const line of block.lines ?? []) {
          items.push({
            text: line.text,
            level: 'line',
            confidence: avgWordConfidence(line.words),
            boundingBox: polygonToBBox(line.boundingPolygon),
          });
          for (const word of line.words ?? []) {
            items.push({
              text: word.text,
              level: 'word',
              confidence: word.confidence ?? 1,
              boundingBox: polygonToBBox(word.boundingPolygon),
            });
          }
        }
      }
      return { items, raw: json };
    },
  };
}

function avgWordConfidence(words = []) {
  if (!words.length) return 1;
  return words.reduce((s, w) => s + (w.confidence ?? 1), 0) / words.length;
}

function polygonToBBox(polygon = []) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
