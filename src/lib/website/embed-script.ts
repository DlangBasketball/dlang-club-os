/**
 * The /embed.js helper (no dependencies, ~1.5 kB). On the club's website:
 *
 *   <div data-dlang-widget="camps" data-club="dlang" data-season="summer"></div>
 *   <script src="https://<app>/embed.js" async></script>
 *
 * Turns each placeholder into an iframe of <app>/embed/<widget>?club=..&origin=<page origin>
 * and resizes it on { type: "dlang:resize", height } messages, accepted only
 * from the app's own origin and only for the iframe that sent them.
 */
export const EMBED_SCRIPT = `(function () {
  "use strict";
  var cur = document.currentScript;
  var base = "";
  try { base = new URL(cur && cur.src ? cur.src : "").origin; } catch (e) { return; }
  var WIDGET = /^(camps|programs|schedule|results|teams|book|shop|donate|login|register(\\/[a-z0-9-]{1,120})?)$/;
  var VALUE = /^[A-Za-z0-9_.-]{1,80}$/;
  var frames = [];
  function mount(el) {
    if (el.getAttribute("data-dlang-mounted")) return;
    var w = el.getAttribute("data-dlang-widget") || "";
    var program = el.getAttribute("data-program");
    if (w === "register" && program && VALUE.test(program)) w = "register/" + program.toLowerCase();
    if (!WIDGET.test(w)) return;
    el.setAttribute("data-dlang-mounted", "1");
    var q = new URLSearchParams();
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf("data-") !== 0) continue;
      var k = a.name.slice(5);
      if (k === "dlang-widget" || k === "dlang-mounted" || k === "program") continue;
      if (VALUE.test(a.value)) q.set(k, a.value);
    }
    q.set("origin", location.origin);
    var f = document.createElement("iframe");
    f.src = base + "/embed/" + w + "?" + q.toString();
    f.title = el.getAttribute("data-title") || w;
    f.loading = "lazy";
    f.style.width = "100%";
    f.style.border = "0";
    f.style.minHeight = "320px";
    f.style.display = "block";
    el.appendChild(f);
    frames.push(f);
  }
  function scan() {
    var els = document.querySelectorAll("[data-dlang-widget]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== base) return;
    var d = e.data;
    if (!d || d.type !== "dlang:resize" || typeof d.height !== "number" || !isFinite(d.height)) return;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(120, Math.min(20000, Math.ceil(d.height))) + "px";
    }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
`;
