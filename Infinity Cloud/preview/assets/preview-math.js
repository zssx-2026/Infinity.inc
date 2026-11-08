// preview-math.js - the arithmetic behind the streaming preview, kept apart
// from the DOM so it can be exercised without a browser.
//
// It is inlined into the page by apply-preview.mjs and it also exports itself
// for node, which is how "Infinity Cloud/preview/tests/ui-preview.test.mjs"
// checks the windowing and the byte counts.
(function (root) {
  'use strict';

  var PV_CHUNK = 256 * 1024;                  // one Range window
  var PV_ROW = 18;                            // a fixed line box, in CSS pixels
  var PV_MAX_LINES = 20000;                   // the line ceiling of a preview
  var PV_MAX_BYTES = 64 * 1024 * 1024;        // the byte ceiling of a preview
  var PV_OVERSCAN = 8;                        // rows kept above and below

  // The slice of a long list worth putting in the document: what the viewport
  // shows, plus a little on each side. This is what keeps the DOM at a few
  // dozen nodes when the file has 20000 lines.
  function pvWindow(total, scrollTop, viewH, rowH, overscan) {
    rowH = rowH > 0 ? rowH : PV_ROW;
    overscan = overscan >= 0 ? overscan : PV_OVERSCAN;
    if (total <= 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0, rows: 0 };
    var first = Math.floor((scrollTop > 0 ? scrollTop : 0) / rowH) - overscan;
    if (first < 0) first = 0;
    if (first > total) first = total;
    var visible = Math.ceil((viewH > 0 ? viewH : rowH) / rowH) + overscan * 2 + 1;
    var end = first + visible;
    if (end > total) end = total;
    return { start: first, end: end, topPad: first * rowH,
             bottomPad: (total - end) * rowH, rows: end - first };
  }

  // Where the compressed bytes of a zip entry begin: the offset of the local
  // file header plus the header itself plus the two lengths it carries.
  function pvDataOffset(headerOffset, nameLen, extraLen) {
    return Number(headerOffset) + 30 + Number(nameLen) + Number(extraLen);
  }

  // The next window to ask for: never past the end, never larger than a window.
  function pvChunk(offset, size, chunk) {
    chunk = chunk > 0 ? chunk : PV_CHUNK;
    offset = Number(offset) || 0;
    size = Number(size) || 0;
    if (offset < 0 || offset >= size) return 0;
    var left = size - offset;
    return left < chunk ? left : chunk;
  }

  // 20000 lines is the preview's line ceiling: the oldest line is dropped so a
  // vast log cannot grow the list without bound. Returns the kept list and the
  // index of its first line in the file.
  function pvRetain(lines, first, incoming, cap) {
    cap = cap > 0 ? cap : PV_MAX_LINES;
    var all = lines.concat(incoming);
    if (all.length <= cap) return { lines: all, first: first };
    var drop = all.length - cap;
    return { lines: all.slice(drop), first: first + drop };
  }

  root.PV = {
    PV_CHUNK: PV_CHUNK, PV_ROW: PV_ROW, PV_MAX_LINES: PV_MAX_LINES,
    PV_MAX_BYTES: PV_MAX_BYTES, PV_OVERSCAN: PV_OVERSCAN,
    pvWindow: pvWindow, pvDataOffset: pvDataOffset, pvChunk: pvChunk, pvRetain: pvRetain
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PV;
})(typeof globalThis !== 'undefined' ? globalThis : this);
