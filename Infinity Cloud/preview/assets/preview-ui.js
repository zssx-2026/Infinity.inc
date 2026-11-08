  // ---- streaming preview ---------------------------------------------
  //
  // The file is read in 256 KiB windows over /api/preview/chunk, so the first
  // window can be on screen while the rest is still in the cloud. Text is kept
  // as a list of lines and only the rows the viewport shows are put in the
  // document: 20000 lines cost a few dozen nodes. Closing the preview aborts
  // the request and tells the reader, by epoch, to stop; nothing is kept.
  var PV_CHUNK = PV.PV_CHUNK;
  var PV_ROW = PV.PV_ROW;
  var PV_MAX_LINES = PV.PV_MAX_LINES;
  var PV_MAX_BYTES = PV.PV_MAX_BYTES;
  var PV_TEXT = /[.](txt|md|json|csv|tsv|log|xml|ya?ml|ini|conf|cfg|toml|sql|c|h|hpp|cpp|cc|cs|java|js|mjs|cjs|jsx|tsx?|py|rb|go|rs|php|sh|bash|ps1|bat|cmd|css|html?|srt|vtt)$/i;
  var PV_IMAGE = /[.](png|jpe?g|webp|gif|bmp)$/i;
  var PV_MEDIA = /[.](mp3|wav|ogg|m4a|flac|aac|mp4|webm|mkv|mov)$/i;
  var PV_PDF = /[.]pdf$/i;
  var PV_ZIP = /[.]zip$/i;
  var pv = null;

  function pvKind(name) {
    if (PV_ZIP.test(name)) return 'zip';
    if (PV_TEXT.test(name)) return 'text';
    if (PV_IMAGE.test(name)) return 'image';
    if (PV_MEDIA.test(name)) return 'media';
    if (PV_PDF.test(name)) return 'pdf';
    return null;
  }

  function pvNote(text) { $('pvNote').textContent = text || ''; }

  function pvClose() {
    if (!pv) return;
    var closing = pv;
    pv = null;
    closing.cancelled = true;
    if (closing.controller) { try { closing.controller.abort(); } catch (e) {} }
    if (closing.url) { try { URL.revokeObjectURL(closing.url); } catch (e) {} }
    $('preview').hidden = true;
    $('pvBody').innerHTML = '';
    // The reader is told to stop by epoch: a window in flight ends within its
    // own 8 s timeout, and no further window is asked for.
    fetch('/api/preview/cancel?epoch=' + encodeURIComponent(closing.epoch || 0),
          { method: 'POST' }).catch(function () {});
  }

  // ---- text: all the lines in an array, a window of rows in the document
  function pvStage() {
    $('pvBody').innerHTML = '<div class="pv-lines" id="pvLines"></div>';
    pv.stage = $('pvLines');
  }

  function pvRenderText() {
    if (!pv || !pv.stage) return;
    var body = $('pvBody');
    var w = PV.pvWindow(pv.lines.length, body.scrollTop, body.clientHeight, PV_ROW, PV.PV_OVERSCAN);
    var html = '';
    for (var i = w.start; i < w.end; i++) {
      html += '<div class="pv-line" style="top:' + (i * PV_ROW) + 'px">' + esc(pv.lines[i]) + '</div>';
    }
    pv.stage.style.height = (pv.lines.length * PV_ROW) + 'px';
    pv.stage.innerHTML = html;
    pv.rendered = w.rows;
  }

  function pvOnScroll() {
    if (!pv || pv.kind !== 'text' || pv.raf) return;
    pv.raf = requestAnimationFrame(function () { pv.raf = 0; pvRenderText(); });
  }

  function pvAppendText(bytes) {
    if (!bytes.length) return;
    var piece = pv.text ? pv.text.decode(bytes, { stream: true })
                        : String.fromCharCode.apply(null, bytes);
    pv.tail += piece;
    var cut = pv.tail.lastIndexOf('\n');
    if (cut < 0) return;
    var lines = pv.tail.slice(0, cut).split('\n');
    pv.tail = pv.tail.slice(cut + 1);
    var kept = PV.pvRetain(pv.lines, pv.lineFirst, lines, PV_MAX_LINES);
    pv.lines = kept.lines;
    pv.lineFirst = kept.first;
    pvRenderText();
    if ($('pvFollow').checked) $('pvBody').scrollTop = $('pvBody').scrollHeight;
  }

  // ---- binary: re-decode the bytes so far after every window
  function pvAppendBinary(bytes) {
    pv.parts.push(bytes);
    if (pv.url) { try { URL.revokeObjectURL(pv.url); } catch (e) {} pv.url = null; }
    pv.url = URL.createObjectURL(new Blob(pv.parts));
    var el = $('pvBody').firstChild;
    if (!el || el.tagName === 'DIV') {
      el = document.createElement(pv.kind === 'image' ? 'img' : (pv.kind === 'media' ? 'video' : 'iframe'));
      if (pv.kind === 'media') el.controls = true;
      $('pvBody').innerHTML = '';
      $('pvBody').appendChild(el);
    }
    el.onload = function () {
      pvNote('Decoded after ' + Math.round(pv.first) + ' ms, with ' + human(pv.bytes) + ' downloaded.');
    };
    el.onerror = function () {
      pvNote('Waiting for enough bytes to decode\u2026 ' + human(pv.bytes) + ' so far.');
    };
    el.src = pv.url;
  }

  function pvNext() {
    if (!pv || pv.done || pv.cancelled) return;
    var at = pv.offset;
    var want = PV.pvChunk(at, pv.total, PV_CHUNK);
    status('Loading\u2026 ' + human(pv.bytes));
    fetch('/api/preview/chunk?path=' + encodeURIComponent(pv.path) + '&offset=' + at +
          '&length=' + want + '&epoch=' + pv.epoch, { signal: pv.controller.signal })
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            throw new Error(j && j.error ? j.error : ('HTTP ' + r.status));
          });
        }
        var total = Number(r.headers.get('X-Preview-Total') || pv.total || 0);
        return r.arrayBuffer().then(function (buf) { return { buf: buf, total: total }; });
      })
      .then(function (chunk) {
        if (!pv) return;
        if (pv.first === null) pv.first = performance.now() - pv.started;
        var bytes = new Uint8Array(chunk.buf);
        pv.bytes += bytes.length;
        pv.offset = at + bytes.length;
        if (chunk.total) pv.total = chunk.total;
        if (pv.kind === 'text') pvAppendText(bytes); else pvAppendBinary(bytes);
        $('pvMeta').textContent = human(pv.bytes) + (pv.total ? (' of ' + human(pv.total)) : '') +
                                  ' \u00b7 first content ' + Math.round(pv.first) + ' ms' +
                                  (pv.kind === 'text' ? (' \u00b7 ' + pv.lines.length + ' lines') : '');
        if (bytes.length < want) {
          pv.done = true;
          pvNote('Complete: ' + human(pv.bytes) + ', first content after ' + Math.round(pv.first) + ' ms.');
          status('Ready');
          return;
        }
        if (pv.bytes >= PV_MAX_BYTES) {
          pv.done = true;
          pvNote('Stopped at the 64 MiB preview ceiling; Download gets the rest.');
          return;
        }
        pvNext();
      })
      .catch(function (e) {
        if (!pv || e.name === 'AbortError') return;
        pvNote(e.message);
        status(e.message, 'err');
      });
  }

  // ---- zip: the central directory first, one entry only when it is wanted
  function pvZip() {
    status('Reading the archive directory\u2026');
    fetch('/api/preview/zip?path=' + encodeURIComponent(pv.path) + '&epoch=' + pv.epoch,
          { signal: pv.controller.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!pv) return;
        if (j && j.error) throw new Error(j.error);
        var list = (j && j.list) || [];
        var html = '<table><thead><tr><th>Name</th><th>Size</th><th>Stored</th><th>Method</th></tr></thead><tbody>';
        for (var i = 0; i < list.length; i++) {
          html += '<tr class="pv-entry" data-name="' + esc(list[i].name) + '"><td>' + esc(list[i].name) +
                  '</td><td>' + human(list[i].uncompressed) + '</td><td>' + human(list[i].compressed) +
                  '</td><td>' + (list[i].method === 0 ? 'stored' : 'deflate') + '</td></tr>';
        }
        html += '</tbody></table>';
        $('pvBody').innerHTML = html;
        $('pvMeta').textContent = list.length + ' entries \u00b7 central directory only \u00b7 ' +
                                  Math.round(performance.now() - pv.started) + ' ms';
        pvNote('Click an entry to pull just that entry.');
        status('Ready');
      })
      .catch(function (e) {
        if (!pv || e.name === 'AbortError') return;
        pvNote(e.message);
        status(e.message, 'err');
      });
  }

  function pvShowHex(bytes, name) {
    var out = '';
    var n = Math.min(bytes.length, 4096);
    for (var i = 0; i < n; i += 16) {
      var hex = '', ascii = '';
      for (var k = 0; k < 16; k++) {
        if (i + k < n) {
          var b = bytes[i + k];
          hex += (b < 16 ? '0' : '') + b.toString(16) + ' ';
          ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
        } else { hex += '   '; }
      }
      out += hex + ' ' + ascii + '\n';
    }
    $('pvBody').innerHTML = '<div class="pv-hex">' + esc(out) + '</div>';
    pvNote(name + ': ' + human(bytes.length) + ' shown as hex' +
           (bytes.length > 4096 ? ' (first 4 KiB)' : '') + '.');
  }

  function pvShowEntry(name, method, bytes) {
    if (!pv) return;
    if (pvKind(name) === 'text') {
      pv.kind = 'text';
      pv.text = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
      pv.tail = '';
      pv.lines = [];
      pv.lineFirst = 0;
      pvStage();
      pvAppendText(bytes);
      $('pvMeta').textContent = name + ' \u00b7 ' + human(bytes.length) + ' \u00b7 ' +
                                pv.lines.length + ' lines';
      pvNote('Entry pulled on demand' + (method === 0 ? ' (stored).' : ' and inflated in the page.'));
    } else if (pvKind(name) === 'image') {
      var url = URL.createObjectURL(new Blob([bytes]));
      $('pvBody').innerHTML = '';
      var img = document.createElement('img');
      img.src = url;
      $('pvBody').appendChild(img);
      pvNote(name + ': ' + human(bytes.length) + ' pulled on demand.');
    } else {
      pvShowHex(bytes, name);
    }
    status('Ready');
  }

  function pvOpenEntry(name) {
    if (!pv) return;
    pvNote('Pulling ' + name + '\u2026');
    var method = 0;
    fetch('/api/preview/zip/entry?path=' + encodeURIComponent(pv.path) +
          '&name=' + encodeURIComponent(name) + '&epoch=' + pv.epoch,
          { signal: pv.controller.signal })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var message = t;
            try { var j = JSON.parse(t); if (j && j.error) message = j.error; } catch (e) {}
            throw new Error(message || ('HTTP ' + r.status));
          });
        }
        method = Number(r.headers.get('X-Zip-Method') || 0);
        return r.arrayBuffer();
      })
      .then(function (ab) {
        if (!pv) return null;
        if (method !== 0 && typeof DecompressionStream !== 'undefined') {
          // The bytes crossed the wire compressed; the page inflates them.
          var stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Response(stream).arrayBuffer();
        }
        return ab;
      })
      .then(function (out) {
        if (!pv || !out) return;
        pvShowEntry(name, method, new Uint8Array(out));
      })
      .catch(function (e) {
        if (!pv || e.name === 'AbortError') return;
        pvNote(e.message);
        status(e.message, 'err');
      });
  }

  function pvOpen(path, name) {
    pvClose();
    var kind = pvKind(name);
    pv = { path: path, name: name, kind: kind, epoch: 0, offset: 0, bytes: 0, total: 0,
           started: performance.now(), first: null, controller: new AbortController(),
           text: (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null,
           tail: '', lines: [], lineFirst: 0, parts: [], url: null, done: false,
           cancelled: false, stage: null, raf: 0, rendered: 0 };
    $('preview').hidden = false;
    $('pvName').textContent = name;
    $('pvMeta').textContent = 'Opening\u2026';
    $('pvBody').innerHTML = '';
    $('pvNote').textContent = '';
    $('pvFollow').parentNode.style.display = (kind === 'text') ? '' : 'none';
    if (!kind) {
      pvNote('This type is not read while it arrives; Download still works.');
      return;
    }
    if (kind === 'text') pvStage();
    api('/api/preview/meta?path=' + encodeURIComponent(path)).then(function (m) {
      if (!pv) return;
      pv.epoch = Number(m.epoch) || 0;
      pv.total = Number(m.size) || 0;
      if (kind !== 'text') pv.kind = kind;
      if (kind === 'zip') { pvZip(); return; }
      pvNext();
    }).catch(function (e) {
      if (!pv) return;
      pvNote(e.message);
      status(e.message, 'err');
    });
  }

  $('pvClose').onclick = pvClose;
  $('pvBody').addEventListener('scroll', pvOnScroll);
  $('pvBody').addEventListener('click', function (ev) {
    if (!pv || pv.kind !== 'zip') return;
    var tr = ev.target;
    while (tr && tr.tagName !== 'TR') tr = tr.parentNode;
    if (!tr || !tr.getAttribute('data-name')) return;
    ev.preventDefault();
    pvOpenEntry(tr.getAttribute('data-name'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pv) pvClose();
  });
  // Double-clicking a previewable file opens it streaming. The capture listener
  // runs before the row handler, so it does not also start a download.
  $('rows').addEventListener('dblclick', function (ev) {
    var tr = ev.target;
    while (tr && tr.tagName !== 'TR') tr = tr.parentNode;
    if (!tr || tr.getAttribute('data-type') !== 'file') return;
    var name = tr.getAttribute('data-name');
    if (!pvKind(name)) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (typeof select === 'function') select(tr);
    pvOpen(tr.getAttribute('data-path'), name);
  }, true);
