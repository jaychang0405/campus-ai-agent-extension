// Renders a local HTML mockup of the NCU Portal login page (portal.ncu.edu.tw)
// and screenshots it with the machine's installed Microsoft Edge via
// puppeteer-core (no Chromium download needed). This is NOT a scrape of the
// live page's pixels — it's a hand-built layout using the same real button
// / label text observed on the live page, built so we have a realistic,
// reusable, offline test fixture with genuine Traditional-Chinese UI text.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const HTML = /* html */ `
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Microsoft JhengHei","PingFang TC",sans-serif; background:#fff; }
  header { background:#2f5f8f; color:#fff; padding:14px 24px; font-size:20px; display:flex; justify-content:space-between; align-items:center; }
  .wrap { display:flex; gap:24px; padding:32px; }
  .card { border:1px solid #ddd; border-radius:6px; padding:24px; }
  .login { border-color:#3aa15a; width:320px; }
  .links { border-color:#3a7fbf; width:320px; }
  label { display:block; font-size:14px; color:#333; margin-bottom:6px; }
  input[type=text], input[type=password] { width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; margin-bottom:16px; font-size:14px; }
  .recaptcha { border:1px solid #ccc; border-radius:4px; padding:12px; font-size:13px; color:#555; margin-bottom:16px; }
  .btn { background:#3a7fbf; color:#fff; border:none; border-radius:4px; padding:10px 24px; font-size:15px; cursor:pointer; }
  .links a { display:block; color:#2f5f8f; text-decoration:none; font-size:14px; margin-bottom:14px; }
  .links a:hover { text-decoration:underline; }
  .notice { padding:24px 32px; font-size:13px; color:#333; line-height:2; }
  .notice a { color:#2f5f8f; }
</style>
</head>
<body>
  <header>
    <span>中央大學入口網站</span>
    <span style="font-size:14px;">⚙ ▾</span>
  </header>
  <div class="wrap">
    <div class="card login">
      <label>帳號</label>
      <input type="text">
      <label>密碼</label>
      <input type="password">
      <div class="recaptcha">☐ 我不是機器人</div>
      <button class="btn">登入 Portal</button>
    </div>
    <div class="card links">
      <a href="#">English Version</a>
      <a href="#">忘記密碼</a>
      <a href="#">註冊 NetID</a>
      <a href="#">使用手機掃 QR-Code 登入</a>
      <a href="#">國立中央大學</a>
      <a href="#">電算中心</a>
    </div>
  </div>
  <div class="notice">
    1. 新生請先進入新生帳號啟動介面啟動帳號。<br>
    2. 學生請輸入電算中心 Portal 帳號、密碼，無法登入之學生請至修改密碼頁面。<br>
    3. 新進教職員帳號於到職日當天中午 12 點後生效，如忘記密碼，請洽人事室校內分機 57771。
  </div>
</body>
</html>
`;

export async function generateFixture(outPath) {
  const executablePath = EDGE_PATHS.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error('Microsoft Edge not found at expected install paths; edit test/generateFixture.mjs');
  }

  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 620 });
    await page.setContent(HTML, { waitUntil: 'load' });
    await page.screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
  return outPath;
}

// Allow `node test/generateFixture.mjs` standalone.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const out = process.argv[2] ?? 'test/fixtures/portal-mockup.png';
  await generateFixture(out);
  console.log(`Fixture written to ${out}`);
}
