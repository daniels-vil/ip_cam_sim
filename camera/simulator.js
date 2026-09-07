import { spawn } from 'node:child_process';
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../shared/config.js';

const RESTART_MS = 2000;
let useDrawtext = true;
let drawtextBroken = false; // set from stderr if the filter/font actually fails

function escapeDrawtextPath(filePath) {
  return filePath.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function buildFilter() {
  if (!useDrawtext) return 'format=yuv420p';

  const fontPath = fs.existsSync(config.paths.font)
    ? config.paths.font
    : fallbackFont();

  if (!fontPath) {
    useDrawtext = false;
    console.warn('no TTF font found; relying on testsrc2 clock');
    return 'format=yuv420p';
  }

  // under the testsrc2 timer so both are readable
  return `drawtext=fontfile='${escapeDrawtextPath(fontPath)}':text='%{localtime}':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:x=16:y=40,format=yuv420p`;
}

function fallbackFont() {
  const candidates = process.platform === 'win32'
    ? ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
    : process.platform === 'darwin'
      ? [
          '/Library/Fonts/Arial.ttf',
          '/System/Library/Fonts/Supplemental/Arial.ttf',
          '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        ]
      : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'];

  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

function looksLikeDrawtextError(text) {
  return /drawtext|fontfile|Cannot load font|Fontconfig|error parsing filter/i.test(text);
}

function start() {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not provide an ffmpeg binary');
  }

  drawtextBroken = false;
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-re',
    '-stream_loop', '-1',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x480:rate=30',
    '-vf', buildFilter(),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-x264-params', 'bframes=0',
    '-g', '30',
    '-keyint_min', '30',
    '-an',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    config.rtsp.url,
  ];

  console.log(`publishing ${config.rtsp.url}${useDrawtext ? ' (with localtime overlay)' : ' (testsrc2 clock only)'}`);
  const child = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  child.stderr.on('data', (data) => {
    const text = String(data).trim();
    if (!text) return;
    console.log(text);
    if (useDrawtext && looksLikeDrawtextError(text)) {
      drawtextBroken = true;
    }
  });

  child.on('exit', (code, signal) => {
    // don't kill drawtext just because mediamtx wasn't up yet
    if (code !== 0 && useDrawtext && drawtextBroken) {
      useDrawtext = false;
      console.warn('drawtext overlay failed; restarting with testsrc2 clock only');
    } else {
      console.warn(`ffmpeg exited code=${code} signal=${signal ?? ''} - restarting in ${RESTART_MS}ms`);
    }
    setTimeout(start, RESTART_MS);
  });
}

start();
