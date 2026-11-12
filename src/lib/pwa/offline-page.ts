/**
 * Self-contained offline page served at /offline and cached by the service
 * worker. Pure: texts are already translated by the caller; colours come from
 * the tenant's theme tokens (brandingToCssVars), never literals.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only well-formed custom properties with harmless values reach the <style>. */
function cssVarBlock(vars: Record<string, string>): string {
  return Object.entries(vars)
    .filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && /^[#a-zA-Z0-9(),.\s%-]+$/.test(v))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
}

export function renderOfflinePage(p: {
  lang: string;
  appName: string;
  cssVars: Record<string, string>;
  title: string;
  body: string;
  retry: string;
}): string {
  const lang = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2})?$/.test(p.lang) ? p.lang : "en";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escapeHtml(p.title)} · ${escapeHtml(p.appName)}</title>
<style>
:root{${cssVarBlock(p.cssVars)}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{max-width:420px;width:100%;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:32px 24px}
.app{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--text-muted)}
h1{font-family:Georgia,"Times New Roman",serif;font-size:24px;margin:10px 0 8px}
p{color:var(--text-secondary);font-size:14px;line-height:1.5;margin:0 0 20px}
a.btn{display:inline-block;min-height:44px;line-height:44px;padding:0 20px;border-radius:8px;background:var(--brand-primary);color:var(--brand-primary-contrast);text-decoration:none;font-weight:600}
</style>
</head>
<body>
<main>
<div class="card">
<div class="app">${escapeHtml(p.appName)}</div>
<h1>${escapeHtml(p.title)}</h1>
<p>${escapeHtml(p.body)}</p>
<a class="btn" href="">${escapeHtml(p.retry)}</a>
</div>
</main>
</body>
</html>`;
}
