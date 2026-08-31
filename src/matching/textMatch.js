// Turns a list of OCR-detected text items into ranked matches against a
// user-supplied keyword. Pure logic, no network calls, so it's the easiest
// part of the pipeline to unit test offline.

function normalize(s) {
  return String(s ?? '').replace(/\s+/g, '').trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function unionBBox(items) {
  const x0 = Math.min(...items.map((i) => i.boundingBox.x));
  const y0 = Math.min(...items.map((i) => i.boundingBox.y));
  const x1 = Math.max(...items.map((i) => i.boundingBox.x + i.boundingBox.width));
  const y1 = Math.max(...items.map((i) => i.boundingBox.y + i.boundingBox.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * @param {Array<{text:string, level:'line'|'word', confidence:number, boundingBox:{x,y,width,height}}>} items
 * @param {string} keyword
 * @param {{fuzzyThreshold?:number, maxResults?:number}} options
 * @returns Array of items with matchType/matchScore attached, sorted best-first.
 */
export function matchKeyword(items, keyword, options = {}) {
  const kw = normalize(keyword);
  const fuzzyThreshold = options.fuzzyThreshold ?? 0.72;
  const results = [];

  const lines = items.filter((i) => i.level !== 'word');
  const pool = lines.length ? lines : items;

  for (const item of pool) {
    const text = normalize(item.text);
    if (!text || !kw) continue;
    if (text === kw) {
      results.push({ ...item, matchType: 'exact', matchScore: 1 });
    } else if (text.includes(kw) || kw.includes(text)) {
      const score = Math.min(text.length, kw.length) / Math.max(text.length, kw.length);
      results.push({ ...item, matchType: 'substring', matchScore: score });
    } else {
      const score = similarity(text, kw);
      if (score >= fuzzyThreshold) {
        results.push({ ...item, matchType: 'fuzzy', matchScore: score });
      }
    }
  }

  // Multi-word keywords sometimes land as several adjacent word-level boxes
  // (e.g. OCR splits "登入 Portal" into "登入" + "Portal"). Try merging spans.
  const words = items.filter((i) => i.level === 'word');
  if (words.length && kw.length > 0) {
    for (let i = 0; i < words.length; i++) {
      let combined = '';
      const span = [];
      for (let j = i; j < Math.min(words.length, i + 6); j++) {
        combined = normalize(combined + words[j].text);
        span.push(words[j]);
        if (combined === kw || (combined.length >= kw.length * 0.8 && combined.includes(kw))) {
          results.push({
            text: span.map((w) => w.text).join(''),
            level: 'span',
            boundingBox: unionBBox(span),
            confidence: Math.min(...span.map((w) => w.confidence ?? 1)),
            matchType: combined === kw ? 'exact-span' : 'substring-span',
            matchScore: combined === kw ? 1 : kw.length / combined.length,
          });
          break;
        }
        if (combined.length > kw.length * 2) break;
      }
    }
  }

  results.sort((a, b) => (b.confidence ?? 1) * b.matchScore - (a.confidence ?? 1) * a.matchScore);

  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = `${Math.round(r.boundingBox.x)}_${Math.round(r.boundingBox.y)}_${r.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped.slice(0, options.maxResults ?? 5);
}
