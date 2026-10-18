//go:build windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

// Edge is on every Windows 10/11 PC; Chrome/Brave as fallback.
func findAppBrowser() string {
	roots := []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LocalAppData")}
	rel := []string{
		`Microsoft\Edge\Application\msedge.exe`,
		`Google\Chrome\Application\chrome.exe`,
		`BraveSoftware\Brave-Browser\Application\brave.exe`,
	}
	for _, r := range rel {
		for _, root := range roots {
			if root == "" {
				continue
			}
			f := filepath.Join(root, r)
			if _, err := os.Stat(f); err == nil {
				return f
			}
		}
	}
	return ""
}

func windowProfileDir() string {
	return filepath.Join(os.Getenv("LocalAppData"), "Eigenyth", "window")
}

func messageBox(title, text string) {
	proc := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	proc.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}
