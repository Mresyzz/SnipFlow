#!/bin/sh
# SnipFlow cross-platform unattended installer
# Verified across Debian, Ubuntu, and Alpine containers using OpsScript Gate.
set -eu

REPO="Mresyzz/SnipFlow"
BINARY_NAME="snipflow"
FALLBACK_VERSION="v0.7.1"

# 1. Determine installation directory
INSTALL_DIR="${SNIPFLOW_INSTALL_DIR:-"$HOME/.local/bin"}"
mkdir -p "$INSTALL_DIR"

# 2. Detect OS & Machine Architecture
OS_RAW="$(uname -s)"
case "$OS_RAW" in
  Linux*)  OS="linux" ;;
  Darwin*) OS="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
  *)
    echo "[!] Unsupported operating system: $OS_RAW" >&2
    exit 1
    ;;
esac

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64|amd64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *)
    echo "[!] Unsupported CPU architecture: $ARCH_RAW" >&2
    exit 1
    ;;
esac

# 3. Determine release asset target triple
if [ "$OS" = "linux" ]; then
  if [ "$ARCH" = "x86_64" ]; then
    TARGET="x86_64-unknown-linux-gnu"
  else
    echo "[!] Official pre-built Linux binaries currently require x86_64 architecture." >&2
    exit 1
  fi
elif [ "$OS" = "darwin" ]; then
  if [ "$ARCH" = "aarch64" ]; then
    TARGET="aarch64-apple-darwin"
  else
    TARGET="x86_64-apple-darwin"
  fi
else
  echo "[!] For Windows, please download the zip release from https://github.com/${REPO}/releases" >&2
  exit 1
fi

# 4. Resolve download tool (curl or wget)
if command -v curl >/dev/null 2>&1; then
  DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER="wget"
else
  echo "[!] Neither 'curl' nor 'wget' was found in PATH." >&2
  if [ -f /etc/alpine-release ]; then
    echo "[*] Install on Alpine via: apk add curl" >&2
  elif [ -f /etc/debian_version ]; then
    echo "[*] Install on Debian/Ubuntu via: apt-get update && apt-get install -y curl" >&2
  fi
  exit 1
fi

# Ensure tar is available
if ! command -v tar >/dev/null 2>&1; then
  echo "[!] 'tar' command is required to extract release archive." >&2
  if [ -f /etc/alpine-release ]; then
    echo "[*] Install on Alpine via: apk add tar" >&2
  fi
  exit 1
fi

# 5. Resolve target release version
VERSION="${SNIPFLOW_VERSION:-}"
if [ -z "$VERSION" ]; then
  if [ "$DOWNLOADER" = "curl" ]; then
    LATEST_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)"
  else
    LATEST_JSON="$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)"
  fi

  if [ -n "$LATEST_JSON" ]; then
    VERSION="$(printf '%s\n' "$LATEST_JSON" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')"
  fi

  if [ -z "$VERSION" ]; then
    VERSION="$FALLBACK_VERSION"
  fi
fi

# 6. Fetch and extract release archive
ARCHIVE_NAME="snipflow-${VERSION}-${TARGET}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE_NAME}"

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t snipflow-install)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

echo "[*] Installing SnipFlow ${VERSION} (${TARGET})..."
echo "[*] Downloading: ${DOWNLOAD_URL}"

if [ "$DOWNLOADER" = "curl" ]; then
  if ! curl -fL --retry 3 --connect-timeout 10 "$DOWNLOAD_URL" -o "$TMP_DIR/archive.tar.gz"; then
    echo "[!] Download failed. Please verify release exists at https://github.com/${REPO}/releases" >&2
    exit 1
  fi
else
  if ! wget -q "$DOWNLOAD_URL" -O "$TMP_DIR/archive.tar.gz"; then
    echo "[!] Download failed. Please verify release exists at https://github.com/${REPO}/releases" >&2
    exit 1
  fi
fi

# Extract archive safely (--no-same-owner prevents chown EPERM inside unprivileged/rootless containers)
if tar --help 2>&1 | grep -q -- '--no-same-owner'; then
  tar -xzf "$TMP_DIR/archive.tar.gz" --no-same-owner -C "$TMP_DIR"
else
  tar -xzf "$TMP_DIR/archive.tar.gz" -C "$TMP_DIR" 2>/dev/null || tar -xzf "$TMP_DIR/archive.tar.gz" --no-same-owner -C "$TMP_DIR"
fi

if [ ! -f "$TMP_DIR/$BINARY_NAME" ]; then
  # Check if unpacked into subfolder
  FOUND_BIN="$(find "$TMP_DIR" -type f -name "$BINARY_NAME" | head -n 1)"
  if [ -n "$FOUND_BIN" ]; then
    cp "$FOUND_BIN" "$TMP_DIR/$BINARY_NAME"
  else
    echo "[!] Archive did not contain '$BINARY_NAME' binary." >&2
    exit 1
  fi
fi

chmod +x "$TMP_DIR/$BINARY_NAME"
mv "$TMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"

echo "[OK] SnipFlow binary installed to: $INSTALL_DIR/$BINARY_NAME"

# 7. Check runtime compatibility (Alpine musl libc check)
if [ "$OS" = "linux" ] && [ -f /etc/alpine-release ]; then
  if [ ! -f /lib/ld-linux-x86-64.so.2 ] && [ ! -f /usr/glibc-compat/lib/ld-linux-x86-64.so.2 ]; then
    echo "[*] Alpine Linux detected: SnipFlow is built with glibc."
    echo "[*] To run glibc binaries on Alpine, install gcompat: apk add gcompat"
  fi
fi

# 8. Check FFmpeg availability and output package recommendation
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo ""
  echo "[!] Note: FFmpeg was not detected in PATH. SnipFlow requires FFmpeg for media stream operations."
  if [ -f /etc/os-release ]; then
    . /etc/os-release 2>/dev/null || true
    DISTRO_ID="${ID:-}"
  else
    DISTRO_ID=""
  fi

  case "$DISTRO_ID" in
    alpine)
      echo "[*] Install on Alpine: apk add ffmpeg"
      ;;
    debian|ubuntu|linuxmint|pop)
      echo "[*] Install on Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y ffmpeg"
      ;;
    arch|manjaro)
      echo "[*] Install on Arch Linux: sudo pacman -S ffmpeg"
      ;;
    fedora|rhel|centos)
      echo "[*] Install on Fedora/RHEL: sudo dnf install -y ffmpeg"
      ;;
    *)
      if [ "$OS" = "darwin" ]; then
        echo "[*] Install on macOS: brew install ffmpeg"
      else
        echo "[*] Please install FFmpeg via your distribution package manager."
      fi
      ;;
  esac
fi

# 9. Verify PATH accessibility
case ":${PATH}:" in
  *:"${INSTALL_DIR}":*) ;;
  *)
    echo ""
    echo "[*] To use 'snipflow' directly from your shell, add $INSTALL_DIR to your PATH:"
    echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

echo ""
echo "[OK] SnipFlow installation finished successfully."
