import { parentPort } from 'node:worker_threads';
import zlib from 'node:zlib';

parentPort.on('message', (m) => {
  if (m && m.cmd === 'exit') { process.exit(0); }
  const { id, buf, quality, lgwin } = m;
  try {
    const out = zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
        [zlib.constants.BROTLI_PARAM_LGWIN]: lgwin,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    });
    parentPort.postMessage({ id, ok: true, out });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, err: String((e && e.stack) || e) });
  }
});
