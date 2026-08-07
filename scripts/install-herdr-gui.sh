#!/bin/sh
set -eu

github_repository="powerfooI/herdr-gui"
custom_release_base="${HERDR_GUI_RELEASE_BASE_URL:-}"
install_dir="${HERDR_GUI_INSTALL_DIR:-$HOME/.local/bin}"
requested_version="${HERDR_GUI_VERSION:-}"

fail() {
  printf 'herdr-gui installer: %s\n' "$*" >&2
  exit 1
}

for command in curl tar install uname awk; do
  command -v "$command" >/dev/null 2>&1 ||
    fail "required command not found: $command"
done
if command -v shasum >/dev/null 2>&1; then
  checksum_tool="shasum"
elif command -v sha256sum >/dev/null 2>&1; then
  checksum_tool="sha256sum"
else
  fail "required command not found: shasum or sha256sum"
fi

case "$(uname -s):$(uname -m)" in
  Darwin:arm64 | Darwin:aarch64)
    platform="darwin-arm64"
    ;;
  Darwin:x86_64 | Darwin:amd64)
    platform="darwin-x64"
    ;;
  Linux:x86_64 | Linux:amd64)
    platform="linux-x64"
    ;;
  Linux:arm64 | Linux:aarch64)
    platform="linux-arm64"
    ;;
  *)
    fail "unsupported platform: $(uname -s) $(uname -m)"
    ;;
esac

if [ -n "$requested_version" ]; then
  case "$requested_version" in
    *[!0-9A-Za-z._-]*)
      fail "invalid HERDR_GUI_VERSION: $requested_version"
      ;;
  esac
  archive_name="herdr-gui-v${requested_version}-${platform}.tar.xz"
else
  archive_name="herdr-gui-${platform}.tar.xz"
fi

# GitHub uses a different asset directory for latest and versioned releases.
# Custom mirrors keep the existing flat-directory contract.
if [ -n "$custom_release_base" ]; then
  release_base="$custom_release_base"
elif [ -n "$requested_version" ]; then
  release_base="https://github.com/$github_repository/releases/download/v${requested_version}"
else
  release_base="https://github.com/$github_repository/releases/latest/download"
fi
release_base="${release_base%/}"
package_dir="herdr-gui-${platform}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/herdr-gui-install.XXXXXX")"
target_tmp=""

cleanup() {
  rm -rf "$tmp"
  if [ -n "${target_tmp:-}" ]; then
    rm -f "$target_tmp"
  fi
}
trap cleanup EXIT HUP INT TERM

archive="$tmp/$archive_name"
checksum="$archive.sha256"
printf 'Downloading herdr-gui for %s...\n' "$platform"
curl -fsSL "$release_base/$archive_name" -o "$archive"
curl -fsSL "$release_base/$archive_name.sha256" -o "$checksum"
(
  cd "$tmp"
  if [ "$checksum_tool" = "shasum" ]; then
    shasum -a 256 -c "$(basename "$checksum")"
  else
    sha256sum -c "$(basename "$checksum")"
  fi
)
tar -xJf "$archive" -C "$tmp"

version_file="$tmp/$package_dir/VERSION"
binary="$tmp/$package_dir/herdr-gui"
[ -f "$version_file" ] || fail "package VERSION file is missing"
[ -x "$binary" ] || fail "package binary is missing or not executable"

package_name=""
package_version=""
package_platform=""
extra_version_field=""
read -r package_name package_version package_platform extra_version_field \
  < "$version_file" || fail "invalid package VERSION file"
[ "$package_name" = "herdr-gui" ] || fail "invalid package VERSION file"
[ -z "$extra_version_field" ] || fail "invalid package VERSION file"
[ -n "$package_version" ] || fail "package version is missing"
[ "$package_platform" = "$platform" ] ||
  fail "package platform is $package_platform, expected $platform"
[ -z "$requested_version" ] || [ "$package_version" = "$requested_version" ] ||
  fail "package version is $package_version, expected $requested_version"

binary_version="$("$binary" --version | awk '{ print $2; exit }')"
[ "$binary_version" = "$package_version" ] ||
  fail "binary reports $binary_version, expected $package_version"

mkdir -p "$install_dir"
target="$install_dir/herdr-gui"
target_tmp="$install_dir/.herdr-gui.new.$$"
install -m 0755 "$binary" "$target_tmp"
mv -f "$target_tmp" "$target"
target_tmp=""

printf 'Installed herdr-gui %s to %s\n' "$package_version" "$target"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *)
    printf 'Add %s to PATH to run herdr-gui directly.\n' "$install_dir"
    ;;
esac
