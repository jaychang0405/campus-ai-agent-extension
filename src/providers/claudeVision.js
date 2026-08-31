// OPTIONAL / reference provider — NOT part of the Microsoft stack, kept
// only so the fallback slot is a drop-in swap if you ever want to A/B
// accuracy. Anthropic's Claude models (via the "computer use" tool) are
// specifically trained for on-screen coordinate grounding and tend to beat
// general-purpose GPT-4o on pixel-grounding benchmarks (e.g. ScreenSpot).
// Since the competition track is "Microsoft AI 及 Data 生態系應用組", lead
// with azureOpenAiVision.js for the submission; this file just proves the
// pipeline's provider interface is not locked to one vendor.
import { toDataUrl } from '../pipeline/imageUtils.js';

export function createClaudeVisionProvider({ apiKey, model = 'claude-sonnet-5' } = {}) {
  if (!apiKey) {
    throw new Error('Claude vision provider requires { apiKey } (env: ANTHROPIC_API_KEY)');
  }

  return {
    name: 'claude-vision (reference only, not Microsoft-stack)',
    async locate({ image, keyword }) {
      const dataUrl = await toDataUrl(image);
      const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!match) throw new Error('expected a base64 data URL');
      const [, mediaType, base64] = match;

      const prompt =
        `Image size: ${image.width}x${image.height}px, origin top-left. ` +
        `Find the clickable UI element matching "${keyword}". ` +
        `Reply with strict JSON only: {"x":..,"y":..,"width":..,"height":..,"confidence":0-1} ` +
        `or {"x":null} if not found.`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
      }
      const body = await res.json();
      const text = body.content?.[0]?.text ?? '{}';
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
      return {
        matches:
          json.x != null
            ? [
                {
                  text: keyword,
                  boundingBox: { x: json.x, y: json.y, width: json.width, height: json.height },
                  confidence: json.confidence ?? 0.4,
                  matchType: 'llm-direct',
                },
              ]
            : [],
        raw: body,
      };
    },
  };
}
