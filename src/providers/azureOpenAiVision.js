// FALLBACK provider. Used only when the OCR pass (azureVisionOcr.js) can't
// confidently locate the keyword — e.g. the target is an icon-only button,
// or the keyword is a semantic description ("送出選課申請的按鈕") rather
// than literal on-screen text.
//
// Two strategies, tried in order:
//   1. Set-of-Mark (SoM): number the OCR-detected regions directly on the
//      image and ask the model to pick a number. This turns "guess x,y"
//      into "pick from a list", which measurably improves grounding
//      accuracy for GPT-4o-class models (see Microsoft's UFO agent / the
//      WebVoyager paper for background on why SoM beats raw coordinates).
//   2. Direct coordinate prompting: no candidates available (or none was
//      picked) -> ask the model to output a pixel bounding box directly.
//      Least reliable of the two, kept as a last resort.
import { toDataUrl } from '../pipeline/imageUtils.js';
import { drawSetOfMark } from '../matching/setOfMark.js';

export function createAzureOpenAiVisionProvider({
  endpoint,
  apiKey,
  deployment,
  apiVersion = '2024-08-01-preview',
} = {}) {
  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      'Azure OpenAI provider requires { endpoint, apiKey, deployment } ' +
        '(env: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT)'
    );
  }
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  return {
    name: 'azure-openai-gpt4o-vision',
    async locate({ image, keyword, candidates = [] }) {
      if (candidates.length) {
        const somResult = await trySetOfMark(url, apiKey, image, keyword, candidates);
        if (somResult.matches.length) return somResult;
      }
      return direct(url, apiKey, image, keyword);
    },
  };
}

async function trySetOfMark(url, apiKey, image, keyword, candidates) {
  const { dataUrl, marks } = await drawSetOfMark(image, candidates);
  const list = marks.map((m) => `${m.id}: "${m.text}"`).join('\n');
  const prompt =
    `你是一個網頁 UI 定位助手。圖片上已用紅色數字方框標出候選文字區塊：\n${list}\n\n` +
    `請找出與關鍵字「${keyword}」語意最相符的方框編號。` +
    `若沒有任何方框對應（例如目標其實是純圖示按鈕，畫面上沒有文字），id 請回傳 null。\n` +
    `只回傳 JSON，不要有其他文字：{"id": <數字或 null>, "confidence": 0~1}`;

  const json = await callChat(url, apiKey, prompt, dataUrl);
  const picked = json.id ? marks[json.id - 1] : null;
  return {
    matches: picked
      ? [
          {
            text: picked.text,
            boundingBox: picked.boundingBox,
            confidence: json.confidence ?? 0.6,
            matchType: 'llm-som',
          },
        ]
      : [],
    raw: json,
  };
}

async function direct(url, apiKey, image, keyword) {
  const dataUrl = await toDataUrl(image);
  const prompt =
    `你是一個網頁 UI 定位助手。圖片尺寸為 ${image.width}x${image.height} 像素（左上角為原點 (0,0)）。` +
    `請找出畫面上與「${keyword}」對應的可點擊元素，回傳其外框的像素座標。\n` +
    `只回傳 JSON，不要有其他文字：{"x":..,"y":..,"width":..,"height":..,"confidence":0~1}，` +
    `找不到則回傳 {"x":null}`;

  const json = await callChat(url, apiKey, prompt, dataUrl);
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
    raw: json,
  };
}

async function callChat(url, apiKey, prompt, dataUrl) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`Azure OpenAI error ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return JSON.parse(body.choices[0].message.content);
}
