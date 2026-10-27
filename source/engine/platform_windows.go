//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

// findBrowser returns Edge (preferred, ships with Windows) or Chrome.
func findBrowser() string {
	cands := []string{}
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		cands = append(cands,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(base, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"))
	}
	for _, c := range cands {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func openAppWindow(url, profileDir string) {
	if b := findBrowser(); b != "" {
		args := []string{
			"--app=" + url,
			"--user-data-dir=" + profileDir,
			"--no-first-run", "--no-default-browser-check", "--disable-sync",
			"--disable-extensions", "--disable-background-networking",
			"--disable-features=Translate,msEdgeSidebarV2,EdgeCollections,msUndersideButton",
			"--window-size=1360,880",
		}
		if err := exec.Command(b, args...).Start(); err == nil {
			return
		}
	}
	openDefaultBrowser(url)
}

func openDefaultBrowser(url string) {
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
}

func openFolder(dir string) {
	exec.Command("explorer.exe", dir).Start()
}

func pickFolder() (string, error) {
	ps := `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$f.Description = 'Choose where Phalanx stores its cache and history'; $f.ShowNewFolderButton = $true; ` +
		`$t = New-Object System.Windows.Forms.Form; $t.TopMost = $true; ` +
		`if ($f.ShowDialog($t) -eq 'OK') { Write-Output $f.SelectedPath }`
	out, err := hidden(exec.Command("powershell", "-NoProfile", "-STA", "-Command", ps)).Output()
	if err != nil {
		return "", err
	}
	p := strings.TrimSpace(string(out))
	if p == "" {
		return "", errors.New("cancelled")
	}
	return p, nil
}

// registerProtocol lets the browser extension start the app via phalanx:// links.
// Per-user registry (HKCU), no admin rights needed.
func registerProtocol(exe string) {
	key := `HKCU\Software\Classes\phalanx`
	hidden(exec.Command("reg", "add", key, "/ve", "/d", "URL:Phalanx Protocol", "/f")).Run()
	hidden(exec.Command("reg", "add", key, "/v", "URL Protocol", "/d", "", "/f")).Run()
	hidden(exec.Command("reg", "add", key+`\DefaultIcon`, "/ve", "/d", `"`+exe+`",0`, "/f")).Run()
	hidden(exec.Command("reg", "add", key+`\shell\open\command`, "/ve", "/d", `"`+exe+`" "%1"`, "/f")).Run()
}

func showError(title, msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(msg)
	box.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
}
