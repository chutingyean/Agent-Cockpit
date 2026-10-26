// 用 Chrome DevTools Protocol 截高解析度圖（deviceScaleFactor 2、淺色主題）。
// 用法：node shot.mjs shots.json   shots.json：[{ out, url, width, height, wait, steps:[{ js, wait }] }]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9333;
const shots = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'shot-'))}`,
  '--hide-scrollbars', '--no-first-run', '--font-render-hinting=none', 'about:blank'], { stdio:'ignore' });

let info;
for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {} }
const page = info.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once:true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-color-scheme', value:'light' }] });
for (const s of shots) {
  await send('Emulation.setDeviceMetricsOverride', { width:s.width || 1600, height:s.height || 1000, deviceScaleFactor:2, mobile:false });
  await send('Page.navigate', { url:s.url });
  await sleep(s.wait ?? 2500);
  for (const st of s.steps || []) {
    const r = await send('Runtime.evaluate', { expression:st.js, awaitPromise:true });
    if (r.result?.value !== undefined) console.log(r.result.value);
    if (r.exceptionDetails) console.error(s.out, '步驟失敗：', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    await sleep(st.wait ?? 800);
  }
  const { data } = await send('Page.captureScreenshot', { format:'png', ...(s.clip ? { clip:{ ...s.clip, scale:1 } } : {}) });
  writeFileSync(s.out, Buffer.from(data, 'base64'));
  console.log('✓', s.out);
}
ws.close(); chrome.kill();
