import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

// Run with Node. Set RENDER_MODULES, FFMPEG_PATH and BROWSER_PATH if needed.
// --serve opens the local source; --preview exports selected frames; default renders MP4.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(here, 'renders');
const cache = resolve(root, 'cache/otf-launch-teaser');
const runtimeModules = process.env.RENDER_MODULES || resolve(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const browserPath = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ffmpeg = process.env.FFMPEG_PATH || resolve(cache, 'tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const port = Number(process.env.PORT || 4178);
const contentTypes = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
await mkdir(out, { recursive: true });
await mkdir(cache, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
const url = `http://127.0.0.1:${port}/marketing/launch-teaser/index.html`;
console.log(url);
if (process.argv.includes('--serve')) await new Promise(() => {});

const { chromium } = await import(pathToFileURL(resolve(runtimeModules, 'playwright/index.mjs')));
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--hide-scrollbars', '--disable-background-timer-throttling'] });
let encoder;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error('PAGE ERROR', error));
  await page.goto(`${url}?t=0`);
  await page.waitForFunction(() => window.teaserReady);
  const layout = await page.evaluate(() => {
    const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { fontLoaded: document.fonts.check('560 104px "Instrument Sans"'), brand: rect('#brand'), title: document.querySelector('h1').textContent, announcement: document.querySelector('#announcement span').textContent, announcementBounds: rect('#announcement'), logo: rect('#logo-slot') };
  });
  console.log(JSON.stringify(layout));
  await writeFile(resolve(out, 'layout.json'), JSON.stringify(layout, null, 2));

  if (process.argv.includes('--preview')) {
    for (const t of [0, 0.65, 2, 4.5, 6.2, 6.75, 7.45, 8, 11.9666666667]) {
      await page.evaluate(t => window.renderFrame(t), t);
      await page.screenshot({ path: resolve(out, `frame-${t.toFixed(2)}.png`) });
    }
    const require = createRequire(resolve(runtimeModules, 'package.json'));
    const sharp = require('sharp');
    const times = ['0.00', '0.65', '2.00', '4.50', '6.20', '6.75', '7.45', '8.00', '11.97'];
    const tiles = await Promise.all(times.map(async (t, i) => ({ input: await sharp(resolve(out, `frame-${t}.png`)).resize(640, 360).png().toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#080907' } }).composite(tiles).png().toFile(resolve(out, 'contact-sheet.png'));
  } else {
    if (!existsSync(ffmpeg)) throw new Error(`Set FFMPEG_PATH to a local FFmpeg executable: ${ffmpeg}`);
    const sampleRate = 48000, duration = 12, samples = sampleRate * duration;
    const wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
    wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
    const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const swell = smooth(t / 5.8) * (1 - smooth((t - 6.55) / 2.2));
      const arrivalT = Math.max(0, t - 6.57);
      const arrival = t < 6.57 ? 0 : smooth(arrivalT / 0.18) * Math.exp(-arrivalT / 1.24) * (1 - smooth((t - 9) / 2));
      for (let ch = 0; ch < 2; ch++) {
        const phase = ch * 0.08;
        const pad = (Math.sin(2 * Math.PI * 130.813 * t + phase) * 0.33 + Math.sin(2 * Math.PI * 196.0 * t - phase) * 0.19 + Math.sin(2 * Math.PI * 261.626 * t + Math.sin(t * 0.47) * 0.07) * 0.1) * swell * 0.072;
        const tone = (Math.sin(2 * Math.PI * 523.251 * arrivalT) * 0.43 + Math.sin(2 * Math.PI * 784.0 * arrivalT + phase) * 0.21 + Math.sin(2 * Math.PI * 1046.502 * arrivalT) * 0.06) * arrival * 0.11;
        wav.writeInt16LE(Math.round((pad + tone) * 32767), 44 + (i * 2 + ch) * 2);
      }
    }
    const sound = resolve(cache, 'swell.wav');
    await writeFile(sound, wav);
    const output = resolve(out, 'otf-launch-teaser-1080p.mp4');
    encoder = spawn(ffmpeg, ['-hide_banner', '-y', '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'png', '-i', 'pipe:0', '-i', sound, '-map', '0:v:0', '-map', '1:a:0', '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '16', '-maxrate', '16M', '-bufsize', '32M', '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-g', '60', '-r', '30', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-c:a', 'aac', '-b:a', '192k', '-t', '12', '-video_track_timescale', '30000', '-movflags', '+faststart', output], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let logs = '';
    encoder.stderr.on('data', data => { logs += data; });
    const encoderDone = new Promise((done, reject) => { encoder.once('error', reject); encoder.once('close', code => code === 0 ? done() : reject(new Error(logs))); });
    for (let frame = 0; frame < 360; frame++) {
      await page.evaluate(t => window.renderFrame(t), frame / 30);
      const png = await page.screenshot();
      if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
      if (frame % 30 === 0) console.log(`Rendered ${frame}/360 frames`);
      if (frame === 359) await writeFile(resolve(out, 'otf-launch-teaser-end-card.png'), png);
    }
    encoder.stdin.end();
    await encoderDone;
    await writeFile(resolve(out, 'encode.log'), logs);
    console.log(JSON.stringify({ output, bytes: (await stat(output)).size, width: 1920, height: 1080, fps: 30, frames: 360, duration: 12 }));
  }
} finally {
  encoder?.kill();
  await browser.close();
  server.close();
}
