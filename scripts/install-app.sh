#!/bin/sh
# Installs the DeviceTally app from GitHub Releases:
#   curl -fsSL https://raw.githubusercontent.com/bipul0525/devicetally/main/scripts/install-app.sh | sh
# Downloading with curl (not a browser) means macOS does not mark the app "damaged" (it isn't signed
# with a paid Apple certificate). Windows: download the .exe from the Releases page instead.
set -eu
REPO=bipul0525/devicetally
tag=$(curl -fsSI "https://github.com/$REPO/releases/latest" | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/tag/##p')
[ -n "$tag" ] || { echo "Could not find the latest DeviceTally release." >&2; exit 1; }
base="https://github.com/$REPO/releases/download/$tag"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo "Downloading DeviceTally $tag..."
case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in arm64) asset=DeviceTally_aarch64.app.tar.gz ;; *) asset=DeviceTally_x64.app.tar.gz ;; esac
    curl -fsSL "$base/$asset" -o "$tmp/app.tgz"
    tar -xzf "$tmp/app.tgz" -C "$tmp"
    pkill -f "DeviceTally.app/Contents/MacOS" 2>/dev/null || true
    dest=/Applications; [ -w "$dest" ] || dest="$HOME/Applications"; mkdir -p "$dest"
    rm -rf "$dest/DeviceTally.app"; mv "$tmp/DeviceTally.app" "$dest/"
    open "$dest/DeviceTally.app"
    echo "✓ DeviceTally is installed in $dest and open." ;;
  Linux)
    [ "$(uname -m)" = x86_64 ] || { echo "The Linux app is available for x86_64 only." >&2; exit 1; }
    mkdir -p "$HOME/.local/bin"
    curl -fsSL "$base/DeviceTally_${tag#v}_amd64.AppImage" -o "$HOME/.local/bin/DeviceTally.AppImage"
    chmod +x "$HOME/.local/bin/DeviceTally.AppImage"
    (nohup "$HOME/.local/bin/DeviceTally.AppImage" >/dev/null 2>&1 &)
    echo "✓ DeviceTally is installed in ~/.local/bin and open." ;;
  *) echo "On Windows, download the installer from https://github.com/$REPO/releases/latest" >&2; exit 1 ;;
esac
