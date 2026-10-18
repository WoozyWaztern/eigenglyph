#!/bin/sh
# builds EIGENGLYPH.exe (Windows, no console window) with the game files embedded
#   ./build.sh                          → exe hosts the game on the player's PC
#   ./build.sh https://my-server.com    → exe joins that online server
cd "$(dirname "$0")"
SERVER="$1"
rm -rf assets && mkdir -p assets
cp -r ../public/* assets/ && cp -r ../shared assets/shared
[ -f go.mod ] || go mod init eigenglyph >/dev/null 2>&1
[ -f rsrc_windows_amd64.syso ] || (printf "1 ICON \"logo.ico\"\n" > icon.rc && llvm-rc /fo icon.res icon.rc && llvm-cvtres /machine:x64 /out:rsrc_windows_amd64.syso icon.res)
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H=windowsgui -X main.defaultServer=$SERVER" -o ../EIGENGLYPH.exe .
go build -o /tmp/eigenglyph-linux . 2>/dev/null
rm -rf assets
echo built
