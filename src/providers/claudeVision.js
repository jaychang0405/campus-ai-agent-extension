// Claude vision fallback — same provider interface as azureOpenAiVision.js,
// callable two ways:
//
//   1. Direct Anthropic API (default) — NOT part of the Microsoft stack,
//      kept mainly as an accuracy reference. Claude models (especially with
//      the "computer use" tool) are specifically trained for on-screen
//      coordinate grounding and tend to beat general-purpose GPT-4o on
//      pixel-grounding benchmarks (e.g. ScreenSpot).
//   2. Claude models hosted in Microsoft Foundry (pass `foundryEndpoint`) —
//      Anthropic's Claude family went GA in Microsoft Foundry in July 2026,
//      so calling it through a Foundry resource DOES count as "Microsoft AI
//      生態系". The Messages API request/response shape is byte-for-byte
//      the same as calling Anthropic directly (same `x-api-key` +
//      `anthropic-version` headers) — only the base URL changes, and the
//      `model` field becomes your Foundry *deployment name* rather than the
//      raw model id. See:
//      https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-claude
//
//   ⚠️ Known gotcha (as of the models' Foundry GA, confirmed in MS Learn's
//   troubleshooting table): Claude on Foundry requires an Azure Marketplace
//   subscription with an active pay-as-you-go billing method. Student /
//   free-trial / startup-credit-only subscriptions are explicitly NOT
//   supported for deploying it — Azure AI Vision and Azure OpenAI don't have
//   this restriction, only this Foundry/Marketplace-gated model family does.
//   Confirm your team's Azure subscription type before planning around this.
import { toDataUrl } from '../pipeline/imageUtils.js';

export function createClaudeVisionProvider({
  apiKey,
  model = 'claude-sonnet-5',
  foundryEndpoint, // e.g. "https://<resource-name>.services.ai.azure.com/anthropic"
} = {}) {
  if (!apiKey) {
    throw new Error(
      'Claude vision provider requires { apiKey } ' +
        '(env: ANTHROPIC_API_KEY, or CLAUDE_FOUNDRY_API_KEY when using foundryEndpoint)'
    );
  }
  const url = foundryEndpoint
    ? `${foundryEndpoint.replace(/\/$/, '')}/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  return {
    name: foundryEndpoint ? 'claude-vision (via Microsoft Foundry)' : 'claude-vision (direct Anthropic API, reference only)',
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

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model, // direct API: model id (e.g. "claude-sonnet-5") — Foundry: your deployment name
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
