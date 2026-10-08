// Builds the web app (PWA) into dist-web/ from the Electron sources.
// Usage: npm run build:web
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const WEB = path.join(SRC, 'web');
const OUT = path.join(ROOT, 'dist-web');

// App modules shared with the desktop app, loaded through require()
const MODULES = ['speech-tracker', 'timing', 'device', 'pip'];
const MARKER = '<!-- web:head -->';

const CONTROL_HEAD = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="theme-color" content="#1a1a2e">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Teleprompter">',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
  '<link rel="icon" href="icons/icon-192.png">',
  '<script src="jszip.min.js"></script>',
  '<script src="mp4-muxer.js"></script>',
  '<script src="app.js"></script>',
].join('\n  ');
const PROMPTER_HEAD = '<script src="app.js"></script>';

function read(file) {
  return fs.readFileSync(file, 'utf-8');
}

function page(file, head) {
  const html = read(path.join(SRC, file));
  if (!html.includes(MARKER)) throw new Error(`${file} is missing ${MARKER}`);
  return html.replace(MARKER, head);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

const bundle = [read(path.join(WEB, 'platform.js'))]
  .concat(MODULES.map(name => `window.otDefine('./${name}', function (module, exports, require) {\n${read(path.join(SRC, name + '.js'))}\n});`))
  .join('\n');

const files = {
  'index.html': page('control.html', CONTROL_HEAD),
  'prompter.html': page('prompter.html', PROMPTER_HEAD),
  'app.js': bundle,
  'jszip.min.js': read(require.resolve('jszip/dist/jszip.min.js')),
  'mp4-muxer.js': read(path.join(path.dirname(require.resolve('mp4-muxer')), 'mp4-muxer.js')),
  'manifest.webmanifest': read(path.join(WEB, 'manifest.webmanifest')),
};
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), content);
}

const icons = fs.readdirSync(path.join(WEB, 'icons'));
for (const icon of icons) {
  fs.copyFileSync(path.join(WEB, 'icons', icon), path.join(OUT, 'icons', icon));
}

// The cache version changes with every change to the app
const hash = crypto.createHash('sha256');
Object.values(files).forEach(content => hash.update(content));
const cached = ['./', ...Object.keys(files), ...icons.map(icon => `icons/${icon}`)];
const sw = read(path.join(WEB, 'sw.js'))
  .replace('__VERSION__', hash.digest('hex').slice(0, 12))
  .replace('__FILES__', JSON.stringify(cached));
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

console.log(`Web app built in ${path.relative(ROOT, OUT)}/ (${cached.length} files)`);
