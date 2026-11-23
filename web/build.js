// Build the web version: copy the desktop renderer and add the browser bridge, menu bar and app manifest.
// Usage: node web/build.js [outDir]   (default web/public)
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'public'));
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src/renderer'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'web'), { recursive: true });
for (const f of ['web-native.js', 'web-menu.js', 'web.css']) fs.copyFileSync(path.join(__dirname, 'client', f), path.join(out, 'web', f));
fs.copyFileSync(path.join(__dirname, 'client/manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
for (const s of [192, 512]) { const f = path.join(__dirname, `client/icon-${s}.png`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(out, `web/icon-${s}.png`)); }

const idx = path.join(out, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
const must = (s, from, to) => { if (!s.includes(from)) throw new Error('index.html changed; cannot find: ' + from); return s.replace(from, to); };
html = must(html, "font-src 'self' data:", "font-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'");
html = must(html, '<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="web/web.css">\n  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="icon" href="web/icon-192.png">\n  <meta name="theme-color" content="#151619">');
html = must(html, '<script src="js/util.js"></script>', '<script src="web/web-native.js"></script>\n  <script src="js/util.js"></script>');
html = must(html, '<script src="js/app.js"></script>', '<script src="js/app.js"></script>\n  <script src="web/web-menu.js"></script>');
fs.writeFileSync(idx, html);
console.log('Forged Web built in', path.relative(process.cwd(), out) || '.');
