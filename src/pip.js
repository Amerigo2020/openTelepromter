// ==========================================
// FLOATING PROMPTER (Picture-in-Picture)
// Renders the script as a scrolling video. The phone plays it in a
// floating Picture-in-Picture window on top of other apps, e.g. the
// camera app, so the text runs in front while recording.
// The video plays by itself, also when the browser is in the background:
// play/pause and skipping use the controls of the floating window.
// The camera app has the microphone then, so the text scrolls at the
// classic speed (words per second) instead of following the voice.
// Layout and timing are pure logic and covered by `npm test`.
// ==========================================

const LEAD_IN = 3;   // seconds of countdown before the text moves
const TAIL = 2;      // seconds the end stays visible

const SIZES = {
  small: { width: 854, height: 480, fontSize: 44 },
  medium: { width: 640, height: 360, fontSize: 44 },
  large: { width: 480, height: 270, fontSize: 40 },
};

function splitWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

// Breaks words into lines no wider than maxWidth.
// measure(text) returns the drawn width, e.g. ctx.measureText(text).width
function layoutLines(words, measure, maxWidth) {
  const lines = [];
  let current = [];
  let start = 0;
  words.forEach((word, i) => {
    const candidate = current.concat(word).join(' ');
    if (current.length && measure(candidate) > maxWidth) {
      lines.push({ text: current.join(' '), start, count: current.length });
      current = [];
      start = i;
    }
    current.push(word);
  });
  if (current.length) lines.push({ text: current.join(' '), start, count: current.length });
  return lines;
}

function duration(wordCount, wps) {
  return LEAD_IN + wordCount / (wps || 3) + TAIL;
}

// Where the reading line is at time t (seconds): a fractional line index,
// so the text moves smoothly while the words of a line are read
function linePosition(lines, wps, t) {
  if (!lines.length) return 0;
  const words = Math.max(0, (t - LEAD_IN) * (wps || 3));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (words < line.start + line.count) return i + (words - line.start) / line.count;
  }
  return lines.length;
}

// Draws one frame of the floating prompter at time t
function drawFrame(ctx, scene, t) {
  const { width, height, fontSize, lines, wps, highlightColor, fontFamily, mirror } = scene;
  const lineHeight = fontSize * 1.35;
  const focusY = height * 0.38;
  const pos = linePosition(lines, wps, t);

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.font = `600 ${fontSize}px ${fontFamily || 'sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Reading line
  ctx.fillStyle = highlightColor || '#e94560';
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, focusY - lineHeight / 2, width, lineHeight);
  ctx.globalAlpha = 1;

  const first = Math.max(0, Math.floor(pos - focusY / lineHeight) - 1);
  const last = Math.min(lines.length - 1, Math.ceil(pos + (height - focusY) / lineHeight) + 1);
  for (let i = first; i <= last; i++) {
    const y = focusY + (i - pos + 0.5) * lineHeight;
    const distance = Math.abs(i + 0.5 - pos);
    ctx.fillStyle = i < Math.floor(pos) ? '#777' : '#fff';
    ctx.globalAlpha = distance < 1 ? 1 : 0.75;
    ctx.fillText(lines[i].text, width / 2, y);
  }
  ctx.globalAlpha = 1;

  if (t < LEAD_IN) {
    // Countdown in the corner, the first lines are already readable
    ctx.fillStyle = highlightColor || '#e94560';
    ctx.font = `700 ${Math.round(fontSize * 1.2)}px sans-serif`;
    ctx.fillText(String(Math.ceil(LEAD_IN - t)), width - fontSize, fontSize);
  }
  ctx.restore();
}

// Lays out a script for the given size and settings
function buildScene(text, options, measureCtx) {
  const size = SIZES[options.size] || SIZES.medium;
  const scene = {
    ...size,
    wps: options.wps || 3,
    highlightColor: options.highlightColor,
    fontFamily: options.fontFamily,
    mirror: !!options.mirror,
  };
  measureCtx.font = `600 ${scene.fontSize}px ${scene.fontFamily || 'sans-serif'}`;
  const words = splitWords(text);
  scene.lines = layoutLines(words, s => measureCtx.measureText(s).width, scene.width * 0.92);
  scene.duration = duration(words.length, scene.wps);
  return scene;
}

function isSupported(win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  return typeof w.VideoEncoder === 'function' && typeof w.VideoFrame === 'function' && !!w.Mp4Muxer;
}

// Encodes the scene into an MP4 video (H.264) without playing it in real time.
// onProgress(0..1); returns a Blob
async function renderVideo(scene, { onProgress, fps = 30, win } = {}) {
  const w = win || window;
  const canvas = w.document.createElement('canvas');
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext('2d');

  // H.264 Baseline plays everywhere, incl. iOS; VP9 where H.264 cannot be encoded
  const codecs = [['avc1.42001f', 'avc'], ['vp09.00.10.08', 'vp9']];
  let config = null;
  let muxCodec = null;
  for (const [codec, mux] of codecs) {
    const candidate = { codec, width: scene.width, height: scene.height, bitrate: 1_000_000, framerate: fps };
    const support = await w.VideoEncoder.isConfigSupported(candidate).catch(() => ({}));
    if (support.supported) { config = candidate; muxCodec = mux; break; }
  }
  if (!config) throw new Error('This browser cannot create videos');

  const muxer = new w.Mp4Muxer.Muxer({
    target: new w.Mp4Muxer.ArrayBufferTarget(),
    video: { codec: muxCodec, width: scene.width, height: scene.height },
    fastStart: 'in-memory',
  });
  let failure = null;
  const encoder = new w.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);

  const frames = Math.ceil(scene.duration * fps);
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    drawFrame(ctx, scene, i / fps);
    const frame = new w.VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8 || i % 15 === 0) {
      // Let the encoder catch up and the page repaint the progress
      await new Promise(resolve => setTimeout(resolve, 0));
      if (onProgress) onProgress(i / frames);
    }
  }
  await encoder.flush();
  if (failure) throw failure;
  encoder.close();
  muxer.finalize();
  if (onProgress) onProgress(1);
  return new w.Blob([muxer.target.buffer], { type: 'video/mp4' });
}

// Opens the video in a floating window. Needs a tap (user activation).
async function openFloating(video) {
  if (video.paused) await video.play().catch(() => {});
  if (video.requestPictureInPicture && video.ownerDocument.pictureInPictureEnabled !== false) {
    await video.requestPictureInPicture();
    return true;
  }
  if (video.webkitSupportsPresentationMode && video.webkitSupportsPresentationMode('picture-in-picture')) {
    video.webkitSetPresentationMode('picture-in-picture');
    return true;
  }
  return false;
}

module.exports = {
  LEAD_IN,
  TAIL,
  SIZES,
  splitWords,
  layoutLines,
  duration,
  linePosition,
  drawFrame,
  buildScene,
  isSupported,
  renderVideo,
  openFloating,
};
