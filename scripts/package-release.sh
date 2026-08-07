#!/usr/bin/env bash
set -euo pipefail

platform="${1:-linux-x64}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(
  cd "$root_dir"
  bun -e 'console.log(require("./package.json").version)'
)"

case "$platform" in
  darwin-arm64)
    build_script="build:darwin-arm64"
    binary="$root_dir/server/herdr-gui-darwin-arm64"
    ;;
  darwin-x64)
    build_script="build:darwin-x64"
    binary="$root_dir/server/herdr-gui-darwin-x64"
    ;;
  linux-x64)
    build_script="build:linux-x64"
    binary="$root_dir/server/herdr-gui-linux-x64"
    ;;
  linux-arm64)
    build_script="build:linux-arm64"
    binary="$root_dir/server/herdr-gui-linux-arm64"
    ;;
  *)
    echo "unsupported platform: $platform" >&2
    echo "supported platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64" >&2
    exit 2
    ;;
esac

package_dir_name="herdr-gui-$platform"
package_dir="$root_dir/dist/$package_dir_name"
versioned_archive="$root_dir/dist/herdr-gui-v$version-$platform.tar.xz"
latest_archive="$root_dir/dist/herdr-gui-$platform.tar.xz"
versioned_checksum="$versioned_archive.sha256"
latest_checksum="$latest_archive.sha256"

cd "$root_dir"
bun run "$build_script"

rm -rf "$package_dir"
mkdir -p "$package_dir"
cp "$binary" "$package_dir/herdr-gui"
chmod 755 "$package_dir/herdr-gui"
printf 'herdr-gui %s %s\n' "$version" "$platform" > "$package_dir/VERSION"

rm -f \
  "$versioned_archive" \
  "$latest_archive" \
  "$versioned_checksum" \
  "$latest_checksum"

# Avoid macOS extended headers without passing bsdtar-only flags on Linux.
tar_options=()
if [[ "$(uname -s)" == "Darwin" ]]; then
  tar_options+=(--no-xattrs --no-mac-metadata)
elif tar --help 2>&1 | grep -- "--no-xattrs" >/dev/null; then
  tar_options+=(--no-xattrs)
fi
COPYFILE_DISABLE=1 tar "${tar_options[@]}" \
  -C "$root_dir/dist" \
  -cJf "$versioned_archive" \
  "$package_dir_name"

cp "$versioned_archive" "$latest_archive"

checksum_for() {
  archive="$1"
  output="$2"
  if command -v shasum >/dev/null 2>&1; then
    digest="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
  elif command -v sha256sum >/dev/null 2>&1; then
    digest="$(sha256sum "$archive" | awk '{ print $1 }')"
  else
    echo "shasum or sha256sum is required" >&2
    exit 1
  fi
  printf '%s  %s\n' "$digest" "$(basename "$archive")" > "$output"
}

checksum_for "$versioned_archive" "$versioned_checksum"
checksum_for "$latest_archive" "$latest_checksum"
cat "$versioned_checksum" "$latest_checksum"
ls -lh \
  "$versioned_archive" \
  "$versioned_checksum" \
  "$latest_archive" \
  "$latest_checksum"
