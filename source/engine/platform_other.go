//go:build !windows

package main

import (
	"errors"
	"log"
	"os/exec"
	"runtime"
)

func openAppWindow(url, profileDir string) {
	for _, b := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
		if p, err := exec.LookPath(b); err == nil {
			if exec.Command(p, "--app="+url, "--user-data-dir="+profileDir, "--no-first-run").Start() == nil {
				return
			}
		}
	}
	openDefaultBrowser(url)
}

func openDefaultBrowser(url string) {
	cmd := "xdg-open"
	if runtime.GOOS == "darwin" {
		cmd = "open"
	}
	if err := exec.Command(cmd, url).Start(); err != nil {
		log.Printf("Open %s in your browser", url)
	}
}

func openFolder(dir string) { openDefaultBrowser(dir) }

func pickFolder() (string, error) { return "", errors.New("folder picker is available on Windows; type the path instead") }

func registerProtocol(exe string) {}

func showError(title, msg string) { log.Printf("%s: %s", title, msg) }
