#!/usr/bin/env bash
# Build the DLang OS Connect WordPress plugin zip: dist/dlang-os-connect.zip
#
#   scripts/build-wp-plugin.sh            # test, lint, compile translations, zip
#   SKIP_TESTS=1 scripts/build-wp-plugin.sh
#
# Upload the zip in WordPress: Plugins > Add New > Upload Plugin.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WP="$ROOT/integrations/wordpress"
SRC="$WP/dlang-os-connect"
DIST="$ROOT/dist"
OUT="$DIST/dlang-os-connect.zip"

command -v php >/dev/null || { echo "php is required" >&2; exit 1; }

echo "==> PHP lint"
while IFS= read -r -d '' f; do
  php -l "$f" >/dev/null || { echo "Syntax error in $f" >&2; exit 1; }
done < <(find "$WP" -name '*.php' -print0)

echo "==> Translations (.pot, .po, .mo)"
php "$WP/tools/i18n.php"

if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  echo "==> Tests"
  php "$WP/tests/run.php"
fi

echo "==> Zip"
mkdir -p "$DIST"
# dist/ is a build output: keep it out of git without touching the root .gitignore.
printf '*\n' > "$DIST/.gitignore"
rm -f "$OUT"
VERSION="$(sed -n 's/^ \* Version: *//p' "$SRC/dlang-os-connect.php" | head -n1 | tr -d '[:space:]')"

if command -v zip >/dev/null; then
  (cd "$WP" && zip -qr -X "$OUT" dlang-os-connect -x '*.DS_Store' -x '*/.git*')
else
  php -r '
    [$src, $out] = [$argv[1], $argv[2]];
    $zip = new ZipArchive();
    if ($zip->open($out, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) { exit(1); }
    $base = dirname($src);
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
      $rel = substr($file->getPathname(), strlen($base) + 1);
      if (basename($rel) === ".DS_Store") { continue; }
      $zip->addFile($file->getPathname(), $rel);
    }
    $zip->close();
  ' "$SRC" "$OUT"
fi

echo "Built $OUT (version ${VERSION:-unknown}, $(du -h "$OUT" | cut -f1))"
