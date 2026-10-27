// Phalanx desktop engine.
//
// One small executable that:
//   - hosts the Phalanx app UI (dashboard, live threats, analysis, history,
//     site scanner, settings, about) on http://127.0.0.1:47821
//   - opens it in its own app window (Microsoft Edge / Chrome "app mode")
//   - receives events from the browser extension and keeps long-term history
//   - owns settings, trusted/blocked lists, cache folder and local sign-in
//
// No external dependencies: Go standard library only.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

var (
	version = "2.0.0"
	edition = "original" // set with -ldflags "-X main.edition=pink"
)

const port = 47821

var (
	baseURL   = fmt.Sprintf("http://127.0.0.1:%d", port)
	startedAt = time.Now()
	store     *Store
	storeMu   sync.RWMutex
	hub       = newHub()
	exeDir    string
	logFile   *os.File
)

func main() {
	dataFlag := flag.String("data", "", "override data/cache folder")
	noWindow := flag.Bool("no-window", false, "do not open the app window (server only)")
	keep := flag.Bool("keep", false, "keep running when the window closes")
	flag.Parse()

	exe, _ := os.Executable()
	exeDir = filepath.Dir(exe)

	// phalanx://open/<path> links (from the browser extension) arrive as an argument.
	startPath := "/"
	for _, a := range flag.Args() {
		if strings.HasPrefix(strings.ToLower(a), "phalanx://") {
			startPath = protocolPath(a)
		}
	}

	// Single instance: if the engine is already running, just open a window.
	if alreadyRunning() {
		openAppWindow(baseURL+startPath, appWindowProfile(resolveDataDir(*dataFlag)))
		return
	}

	dataDir := resolveDataDir(*dataFlag)
	if err := ensureDirs(dataDir); err != nil {
		fatal("Cannot create data folder %s: %v", dataDir, err)
	}
	setupLog(dataDir)
	s, err := OpenStore(dataDir)
	if err != nil {
		fatal("Cannot open data store: %v", err)
	}
	store = s
	log.Printf("Phalanx engine %s (%s edition) starting, data: %s", version, edition, dataDir)

	registerProtocol(exe)

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		fatal("Port %d is busy. Close the other program using it and try again.\n\n%v", port, err)
	}
	srv := &http.Server{Handler: routes(), ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)

	if !*noWindow {
		openAppWindow(baseURL+startPath, appWindowProfile(dataDir))
	}

	// Lifecycle: exit when every app window has been closed for a while,
	// unless "keep running" is on. The extension buffers events meanwhile.
	go func() {
		t := time.NewTicker(5 * time.Second)
		for range t.C {
			keepRunning, _ := getStore().Settings()["keepRunning"].(bool)
			if *keep || *noWindow || keepRunning {
				continue
			}
			if hub.idleFor() > 30*time.Second && time.Since(startedAt) > 90*time.Second {
				log.Printf("No app window open — shutting down engine")
				shutdown(srv)
			}
		}
	}()
	select {}
}

func getStore() *Store {
	storeMu.RLock()
	defer storeMu.RUnlock()
	return store
}

func shutdown(srv *http.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	getStore().Close()
	os.Exit(0)
}

func protocolPath(a string) string {
	u, err := url.Parse(a)
	if err != nil {
		return "/"
	}
	p := strings.TrimPrefix(u.Opaque+u.Path, "//")
	p = strings.TrimPrefix(p, "open")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	if p == "/" || strings.Contains(p, "..") {
		p = "/"
	}
	if u.RawQuery != "" {
		p += "?" + u.RawQuery
	}
	return p
}

func alreadyRunning() bool {
	c := http.Client{Timeout: 800 * time.Millisecond}
	r, err := c.Get(baseURL + "/api/ping")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return strings.Contains(string(b), "phalanx")
}

/* ---------- data folder resolution ---------- */

func bootstrapDir() string {
	if runtime.GOOS == "windows" {
		if d := os.Getenv("APPDATA"); d != "" {
			return filepath.Join(d, "Phalanx")
		}
	}
	d, _ := os.UserConfigDir()
	return filepath.Join(d, "phalanx")
}

func defaultDataDir() string {
	// Default: a "PhalanxData" folder next to Phalanx.exe (the project/download folder).
	d := filepath.Join(exeDir, "PhalanxData")
	if writable(d) {
		return d
	}
	if runtime.GOOS == "windows" {
		if l := os.Getenv("LOCALAPPDATA"); l != "" {
			return filepath.Join(l, "Phalanx", "Data")
		}
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".local", "share", "phalanx")
}

func resolveDataDir(override string) string {
	if override != "" {
		return override
	}
	var loc struct {
		DataDir string `json:"dataDir"`
	}
	if readJSON(filepath.Join(bootstrapDir(), "location.json"), &loc) == nil && loc.DataDir != "" && writable(loc.DataDir) {
		return loc.DataDir
	}
	return defaultDataDir()
}

func saveLocation(dir string) error {
	os.MkdirAll(bootstrapDir(), 0o755)
	return writeJSON(filepath.Join(bootstrapDir(), "location.json"), map[string]string{"dataDir": dir})
}

func writable(dir string) bool {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false
	}
	f, err := os.CreateTemp(dir, ".probe-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

func appWindowProfile(dataDir string) string {
	return filepath.Join(dataDir, "cache", "appwindow")
}

func setupLog(dataDir string) {
	p := filepath.Join(dataDir, "logs", "engine.log")
	if st, err := os.Stat(p); err == nil && st.Size() > 2<<20 {
		os.Rename(p, p+".1")
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		if logFile != nil {
			logFile.Close()
		}
		logFile = f
		log.SetOutput(io.MultiWriter(f, os.Stderr)) // file first: in GUI mode stderr is invalid
	}
}

func fatal(format string, a ...any) {
	msg := fmt.Sprintf(format, a...)
	log.Print(msg)
	showError("Phalanx", msg)
	os.Exit(1)
}

func subFS() fs.FS {
	f, _ := fs.Sub(webFS, "web")
	return f
}
