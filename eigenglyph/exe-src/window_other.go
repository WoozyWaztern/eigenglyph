//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func findAppBrowser() string {
	for _, n := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

func windowProfileDir() string {
	d, _ := os.UserCacheDir()
	return filepath.Join(d, "eigenglyph-window")
}

func messageBox(title, text string) { fmt.Println(title + ": " + text) }
