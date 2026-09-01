// Screenshots any public URL using the machine's installed Microsoft Edge
// via puppeteer-core (no Chromium download needed). Unlike
// generateFixture.mjs (which renders a hand-built mockup because the
// Portal login page requires auth), this hits the real, live page —
// usable for any of the three target systems that don't require login,
// e.g. the 選課系統 announcement board.
//
// Usage: node test/screenshotUrl.mjs <url> <outPath> [--width 1280] [--height 900]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export async function screenshotUrl(url, outPath, { width = 1280, height = 900 } = {}) {
  const executablePath = EDGE_PATHS.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error('Microsoft Edge not found at expected install paths; edit test/screenshotUrl.mjs');
  }

  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
  return outPath;
}

function getFlag(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const [url, outPath] = process.argv.slice(2);
  if (!url || !outPath) {
    console.error('Usage: node test/screenshotUrl.mjs <url> <outPath> [--width 1280] [--height 900]');
    process.exit(1);
  }
  const width = getFlag('width', 1280);
  const height = getFlag('height', 900);
  await screenshotUrl(url, outPath, { width, height });
  console.log(`Screenshot written to ${outPath}`);
}
