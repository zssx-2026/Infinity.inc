/* Infinity Edge Shell - inline SVG icon set (no external resources). */
(function () {
  "use strict";
  var S = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
  var F = '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">';
  var E = "</svg>";

  var ICONS = {
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    forward: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    "chevron-down": '<path d="M6.5 9.5 12 15l5.5-5.5"/>',
    "chevron-left": '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    "chevron-right": '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20 4.5V9h-4.5"/>',
    home: '<path d="M4 11 12 5l8 6"/><path d="M6.5 10.2V19h11v-8.8"/>',
    plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
    close: '<path d="M6.5 6.5 17.5 17.5"/><path d="M17.5 6.5 6.5 17.5"/>',
    min: '<path d="M6 12.5h12"/>',
    max: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/>',
    restore: '<rect x="5.5" y="8.5" width="10" height="10" rx="1.6"/><path d="M9 8.5V7a1.5 1.5 0 0 1 1.5-1.5H17A1.5 1.5 0 0 1 18.5 7v6.5A1.5 1.5 0 0 1 17 15h-1.5"/>',
    search: '<circle cx="11" cy="11" r="5.5"/><path d="M15.2 15.2 20 20"/>',
    "panel-left": '<rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><path d="M9.5 4.5v15"/>',
    star: '<path d="m12 4.6 2.3 4.75 5.2.72-3.8 3.6.94 5.13L12 16.4l-4.64 2.4.94-5.13-3.8-3.6 5.2-.72z"/>',
    "star-fill": '<path d="m12 4.6 2.3 4.75 5.2.72-3.8 3.6.94 5.13L12 16.4l-4.64 2.4.94-5.13-3.8-3.6 5.2-.72z"/>',
    translate: '<path d="M4.5 6.5h9"/><path d="M9 4.5v2"/><path d="M6.6 6.5c.5 3.6 2.7 6.6 5.9 8.2"/><path d="M11.6 6.5c-.6 4-3 7.4-6.6 9"/><path d="m13.5 19.5 3.6-8.5 3.6 8.5"/><path d="M14.8 16.6h4.6"/>',
    collections: '<rect x="4" y="5" width="16" height="14" rx="2.2"/><path d="M4 15.6l3.6-3.2 3.2 2.8 3-2.6L20 16"/><circle cx="9.2" cy="9.3" r="1.4"/>',
    puzzle: '<path d="M10 5.2c0-1 .8-1.7 1.8-1.7s1.7.7 1.7 1.7v.9h2.7c.6 0 1 .5 1 1v2.6h.9c1 0 1.7.8 1.7 1.8s-.7 1.7-1.7 1.7h-.9v2.6c0 .6-.4 1-1 1h-2.7v.9c0 1-.8 1.7-1.7 1.7s-1.8-.7-1.8-1.7v-.9H6.9c-.6 0-1-.4-1-1V11c0-.6.4-1 1-1h1.8v-.9A1.75 1.75 0 0 1 10 5.2z"/>',
    more: '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>',
    settings: '<circle cx="12" cy="12" r="2.8"/><path d="M12 3.6v2.1M12 18.3v2.1M4.6 12H2.5M21.5 12h-2.1M6.8 6.8 5.3 5.3M18.7 18.7l-1.5-1.5M6.8 17.2l-1.5 1.5M18.7 5.3l-1.5 1.5"/>',
    info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/>',
    code: '<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/><path d="m13.4 5.5-2.8 13"/>',
    signal: '<path d="M5 19v-3.5M9.7 19v-6M14.3 19v-9M19 19V7"/>',
    history: '<path d="M3.8 12a8.2 8.2 0 1 1 2.4 5.8"/><path d="M3.5 17.5V13h4.5"/><path d="M12 8v4.4l3 1.8"/>',
    download: '<path d="M12 4.5v10"/><path d="m8.2 11 3.8 3.6L15.8 11"/><path d="M5 19h14"/>',
    window: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 9h17"/>',
    print: '<path d="M7.5 9V4.8h9V9"/><rect x="4.5" y="9" width="15" height="6.5" rx="1.6"/><path d="M7.5 15v4.2h9V15"/>',
    palette: '<path d="M12 4.2a7.8 7.8 0 0 0 0 15.6c1.2 0 1.7-.9 1.2-1.8-.5-.9 0-1.8 1.1-1.8h1.5c1.7 0 3-1.3 3-3A7.8 7.8 0 0 0 12 4.2z"/><circle cx="8.6" cy="10" r="1.05" fill="currentColor" stroke="none"/><circle cx="12" cy="8.2" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.3" cy="10" r="1.05" fill="currentColor" stroke="none"/>',
    language: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z"/>',
    external: '<path d="M14 5h5v5"/><path d="M19 5l-7.5 7.5"/><path d="M17.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.4"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.4A1.9 1.9 0 0 0 13.6 4.5H6.4A1.9 1.9 0 0 0 4.5 6.4v7.2a1.9 1.9 0 0 0 1.9 1.9h2.1"/>',
    check: '<path d="m5.5 12.5 4.2 4.2 8.8-9.4"/>',
    cloud: '<path d="M7.2 18.5h9.6a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.7-1.2 3.9 3.9 0 0 0 .7 9z"/>',
    toolbox: '<rect x="3.5" y="8" width="17" height="11" rx="2.2"/><path d="M8.5 8V6.4A1.4 1.4 0 0 1 9.9 5h4.2a1.4 1.4 0 0 1 1.4 1.4V8"/><path d="M3.5 12.5h17"/>',
    installer: '<path d="M12 4.5v9.5"/><path d="m8.4 10.6 3.6 3.4 3.6-3.4"/><path d="M5 19.5h14"/>',
    files: '<path d="M4.5 7.2A1.7 1.7 0 0 1 6.2 5.5h3.1l1.6 2h7A1.7 1.7 0 0 1 19.5 9.2v7.6a1.7 1.7 0 0 1-1.6 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7z"/>',
    folder: '<path d="M4.5 7.2A1.7 1.7 0 0 1 6.2 5.5h3.1l1.6 2h7A1.7 1.7 0 0 1 19.5 9.2v7.6a1.7 1.7 0 0 1-1.6 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7z"/>',
    globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2.2"/><path d="M8.5 10.5V8.2a3.5 3.5 0 0 1 7 0v2.3"/>',
    audio: '<path d="M5.5 9.5h3l3.5-3v11l-3.5-3h-3z"/><path d="M15.5 9.6a3.4 3.4 0 0 1 0 4.8"/>',
    shield: '<path d="M12 4.2 5.6 6.6v5c0 3.6 2.6 6.6 6.4 8.2 3.8-1.6 6.4-4.6 6.4-8.2v-5z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
    sparkle: '<path d="M12 4.5 13.6 10 19 11.6 13.6 13.2 12 18.7 10.4 13.2 5 11.6 10.4 10z"/>'
  };

  function svg(name) {
    var body = ICONS[name];
    var filled = name === "star-fill";
    if (name === "star-fill") { body = ICONS["star"]; }
    if (body === undefined) { body = ICONS.info; }
    return (filled ? F : S) + body + E;
  }

  function hydrate(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll("[data-icon]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-icon-done") === "1") { continue; }
      el.insertAdjacentHTML("afterbegin", svg(el.getAttribute("data-icon")));
      el.setAttribute("data-icon-done", "1");
    }
  }

  window.InfinityIcons = { ICONS: ICONS, svg: svg, hydrate: hydrate };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { hydrate(document); });
  } else { hydrate(document); }
})();
