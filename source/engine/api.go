package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/* ---------------- live-update hub (Server-Sent Events) ---------------- */

type Hub struct {
	mu        sync.Mutex
	clients   map[chan string]bool
	lastEmpty time.Time
}

func newHub() *Hub { return &Hub{clients: map[chan string]bool{}, lastEmpty: time.Now()} }

func (h *Hub) add() chan string {
	h.mu.Lock()
	defer h.mu.Unlock()
	c := make(chan string, 8)
	h.clients[c] = true
	return c
}
func (h *Hub) remove(c chan string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	if len(h.clients) == 0 {
		h.lastEmpty = time.Now()
	}
}
func (h *Hub) broadcast(msg string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c <- msg:
		default:
		}
	}
}
func (h *Hub) idleFor() time.Duration {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.clients) > 0 {
		return 0
	}
	return time.Since(h.lastEmpty)
}

/* ---------------- sessions ---------------- */

var (
	sessMu   sync.Mutex
	sessions = map[string]time.Time{}
)

func newSession(w http.ResponseWriter) {
	tok := randHex(24)
	sessMu.Lock()
	sessions[tok] = time.Now().Add(7 * 24 * time.Hour)
	sessMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "phx", Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 7 * 24 * 3600})
}
func authed(r *http.Request) bool {
	c, err := r.Cookie("phx")
	if err != nil {
		return false
	}
	sessMu.Lock()
	defer sessMu.Unlock()
	exp, ok := sessions[c.Value]
	return ok && time.Now().Before(exp)
}
func endSession(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("phx"); err == nil {
		sessMu.Lock()
		delete(sessions, c.Value)
		sessMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "phx", Value: "", Path: "/", MaxAge: -1})
}

/* ---------------- helpers ---------------- */

func writeJSONResp(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func bad(w http.ResponseWriter, code int, msg string) {
	writeJSONResp(w, code, map[string]string{"error": msg})
}
func readBody(r *http.Request, v any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func goodHost(r *http.Request) bool {
	h := r.Host
	return h == fmt.Sprintf("127.0.0.1:%d", port) || h == fmt.Sprintf("localhost:%d", port)
}
func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	return o == "" || o == baseURL || o == fmt.Sprintf("http://localhost:%d", port)
}
func fromExtension(r *http.Request) bool {
	o := r.Header.Get("Origin")
	return strings.HasPrefix(o, "chrome-extension://") || strings.HasPrefix(o, "extension://") || strings.HasPrefix(o, "moz-extension://")
}

/* ---------------- routes ---------------- */

func routes() http.Handler {
	mux := http.NewServeMux()
	static := http.FileServer(http.FS(subFS()))

	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		writeJSONResp(w, 200, map[string]any{"app": "phalanx", "version": version, "edition": edition})
	})

	// ----- extension endpoints -----
	mux.HandleFunc("/api/ext/sync", extOnly(handleSync))
	mux.HandleFunc("/api/ext/open", extOnly(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Path string }
		readBody(r, &b)
		p := b.Path
		if !strings.HasPrefix(p, "/") || strings.Contains(p, "..") || strings.HasPrefix(p, "//") {
			p = "/"
		}
		openAppWindow(baseURL+p, appWindowProfile(getStore().dataDir))
		writeJSONResp(w, 200, map[string]bool{"ok": true})
	}))

	// ----- auth -----
	mux.HandleFunc("/api/me", ui(false, func(w http.ResponseWriter, r *http.Request) {
		p := getStore().Profile()
		if p == nil {
			writeJSONResp(w, 200, map[string]any{"setup": false})
			return
		}
		writeJSONResp(w, 200, map[string]any{"setup": true, "name": p.Name, "hasPass": p.Hash != "", "authed": authed(r)})
	}))
	mux.HandleFunc("/api/setup", ui(false, func(w http.ResponseWriter, r *http.Request) {
		if getStore().Profile() != nil {
			bad(w, 409, "Profile already exists")
			return
		}
		var b struct{ Name, Passcode string }
		if readBody(r, &b) != nil || strings.TrimSpace(b.Name) == "" {
			bad(w, 400, "Please enter a name")
			return
		}
		getStore().SetProfile(strings.TrimSpace(b.Name), b.Passcode)
		newSession(w)
		writeJSONResp(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("/api/login", ui(false, func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Passcode string }
		readBody(r, &b)
		if !getStore().CheckPass(b.Passcode) {
			time.Sleep(600 * time.Millisecond)
			bad(w, 401, "Wrong passcode")
			return
		}
		newSession(w)
		writeJSONResp(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("/api/logout", ui(false, func(w http.ResponseWriter, r *http.Request) {
		endSession(w, r)
		writeJSONResp(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("/api/profile", ui(true, func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Name, Current, Passcode string
			ChangePass             bool
		}
		if readBody(r, &b) != nil {
			bad(w, 400, "bad request")
			return
		}
		s := getStore()
		if b.ChangePass {
			if !s.CheckPass(b.Current) {
				bad(w, 401, "Current passcode is wrong")
				return
			}
			name := b.Name
			if name == "" {
				name = s.Profile().Name
			}
			s.SetProfile(name, b.Passcode)
		} else if strings.TrimSpace(b.Name) != "" {
			s.RenameProfile(strings.TrimSpace(b.Name))
		}
		writeJSONResp(w, 200, map[string]bool{"ok": true})
	}))

	// ----- app data -----
	mux.HandleFunc("/api/state", ui(true, handleState))
	mux.HandleFunc("/api/events", ui(true, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		lim, _ := strconv.Atoi(q.Get("limit"))
		since, _ := strconv.ParseFloat(q.Get("since"), 64)
		writeJSONResp(w, 200, getStore().List(Filter{Status: q.Get("status"), Kind: q.Get("kind"), Severity: q.Get("severity"), Q: q.Get("q"), Since: since, Limit: lim}))
	}))
	mux.HandleFunc("/api/event", ui(true, func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if r.Method == http.MethodPost {
			var b struct{ Action string }
			readBody(r, &b)
			e, err := getStore().Decide(id, b.Action)
			if err != nil {
				bad(w, 400, err.Error())
				return
			}
			hub.broadcast("events")
			writeJSONResp(w, 200, e)
			return
		}
		e := getStore().Get(id)
		if e == nil {
			bad(w, 404, "not found")
			return
		}
		writeJSONResp(w, 200, e)
	}))
	mux.HandleFunc("/api/settings", ui(true, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var p map[string]any
			if readBody(r, &p) != nil {
				bad(w, 400, "bad request")
				return
			}
			out := getStore().PatchSettings(p)
			hub.broadcast("settings")
			writeJSONResp(w, 200, out)
			return
		}
		writeJSONResp(w, 200, getStore().Settings())
	}))
	mux.HandleFunc("/api/lists", ui(true, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var b struct{ List, Op, Site string }
			readBody(r, &b)
			l := getStore().EditList(b.List, b.Op, b.Site)
			hub.broadcast("lists")
			writeJSONResp(w, 200, l)
			return
		}
		writeJSONResp(w, 200, getStore().Lists())
	}))
	mux.HandleFunc("/api/history/clear", ui(true, func(w http.ResponseWriter, r *http.Request) {
		getStore().ClearHistory()
		hub.broadcast("events")
		writeJSONResp(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("/api/export", ui(true, handleExport))
	mux.HandleFunc("/api/cache", ui(true, handleCache))
	mux.HandleFunc("/api/cache/clear", ui(true, handleCacheClear))
	mux.HandleFunc("/api/cache/location", ui(true, handleCacheLocation))
	mux.HandleFunc("/api/cache/browse", ui(true, func(w http.ResponseWriter, r *http.Request) {
		p, err := pickFolder()
		if err != nil {
			bad(w, 501, err.Error())
			return
		}
		writeJSONResp(w, 200, map[string]string{"path": p})
	}))
	mux.HandleFunc("/api/open", ui(true, handleOpen))
	mux.HandleFunc("/api/quit", ui(true, func(w http.ResponseWriter, r *http.Request) {
		writeJSONResp(w, 200, map[string]bool{"ok": true})
		go func() { time.Sleep(400 * time.Millisecond); getStore().Close(); os.Exit(0) }()
	}))
	// presence keeps the engine alive while a sign-in / setup page is open
	mux.HandleFunc("/api/presence", ui(false, func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		c := hub.add()
		defer hub.remove(c)
		fmt.Fprint(w, ": hi\n\n")
		fl.Flush()
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-c:
			case <-tick.C:
				fmt.Fprint(w, ": ping\n\n")
				fl.Flush()
			}
		}
	}))
	mux.HandleFunc("/api/stream", ui(true, func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			bad(w, 500, "no stream")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		c := hub.add()
		defer hub.remove(c)
		fmt.Fprint(w, "event: hello\ndata: ok\n\n")
		fl.Flush()
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case m := <-c:
				fmt.Fprintf(w, "event: update\ndata: %s\n\n", m)
				fl.Flush()
			case <-tick.C:
				fmt.Fprint(w, ": ping\n\n")
				fl.Flush()
			}
		}
	}))

	// ----- test lab (served to the user's normal browser) -----
	mux.HandleFunc("/testlab/download/", func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.URL.Path)
		allowed := map[string]bool{"invoice.pdf.exe": true, "photoshop_crack.zip": true, "free_movie_player.msi": true, "report.pdf": true}
		if !allowed[name] {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		fmt.Fprintf(w, "PHALANX TEST FILE (%s)\r\nThis file is harmless plain text. It only exists so you can see how Phalanx reacts to risky-looking downloads.\r\n", name)
	})

	// ----- static UI -----
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if !goodHost(r) {
			http.Error(w, "forbidden", 403)
			return
		}
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-store")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !strings.HasPrefix(r.URL.Path, "/testlab") {
			w.Header().Set("X-Frame-Options", "DENY")
		}
		static.ServeHTTP(w, r)
	})
	return mux
}

func extOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if !goodHost(r) || !fromExtension(r) || r.Method != http.MethodPost {
			bad(w, 403, "extension only")
			return
		}
		h(w, r)
	}
}

func ui(needAuth bool, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !goodHost(r) || !sameOrigin(r) {
			bad(w, 403, "forbidden")
			return
		}
		if r.Method == http.MethodPost && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") && r.ContentLength > 0 {
			bad(w, 415, "json only")
			return
		}
		if needAuth && !authed(r) {
			bad(w, 401, "sign in required")
			return
		}
		h(w, r)
	}
}

/* ---------------- extension sync ---------------- */

var (
	extMu    sync.Mutex
	extState ExtState
)

func handleSync(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Version string           `json:"version"`
		Edition string           `json:"edition"`
		Paused  bool             `json:"paused"`
		Stats   map[string]any   `json:"stats"`
		Series  []map[string]any `json:"series"`
		Events  []Event          `json:"events"`
	}
	if err := readBody(r, &b); err != nil {
		bad(w, 400, "bad json")
		return
	}
	s := getStore()
	for _, e := range b.Events {
		s.Upsert(e)
	}
	extMu.Lock()
	prevSeen := extState.LastSeen
	extState = ExtState{LastSeen: time.Now().UnixMilli(), Version: b.Version, Edition: b.Edition, Paused: b.Paused, Stats: b.Stats, Series: b.Series}
	extMu.Unlock()
	if len(b.Events) > 0 {
		hub.broadcast("events")
	} else if time.Now().UnixMilli()-prevSeen > 60000 {
		hub.broadcast("ext")
	} else {
		hub.broadcast("tick")
	}
	settings := s.Settings()
	writeJSONResp(w, 200, map[string]any{"version": version, "settings": settings, "lists": s.Lists(), "commands": s.TakeCommands()})
}

/* ---------------- state / analytics ---------------- */

func dirSize(p string) int64 {
	var n int64
	filepath.WalkDir(p, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if fi, e := d.Info(); e == nil {
				n += fi.Size()
			}
		}
		return nil
	})
	return n
}

func handleState(w http.ResponseWriter, r *http.Request) {
	s := getStore()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	extMu.Lock()
	ex := extState
	extMu.Unlock()
	all := s.List(Filter{})
	now := time.Now()
	counts := map[string]int{}
	bySev := map[string]int{}
	byKind := map[string]int{}
	byCat := map[string]int{}
	hosts := map[string]int{}
	day := map[string]int{}
	hour := make([]int, 24)
	today := 0
	startToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).UnixMilli()
	for _, e := range all {
		st := e.str("status")
		counts[st]++
		bySev[e.str("severity")]++
		byKind[e.str("kind")]++
		if c := e.str("category"); c != "" {
			byCat[c]++
		}
		if h := e.str("site"); h != "" {
			hosts[h]++
		} else if h := e.str("host"); h != "" {
			hosts[h]++
		}
		ts := int64(e.num("ts"))
		t := time.UnixMilli(ts)
		day[t.Format("2006-01-02")]++
		if now.Sub(t) < 24*time.Hour {
			hour[23-int(now.Sub(t).Hours())]++
		}
		if ts >= startToday {
			today++
		}
	}
	type kv struct {
		K string `json:"k"`
		V int    `json:"v"`
	}
	top := []kv{}
	for k, v := range hosts {
		top = append(top, kv{k, v})
	}
	sort.Slice(top, func(i, j int) bool { return top[i].V > top[j].V || (top[i].V == top[j].V && top[i].K < top[j].K) })
	if len(top) > 8 {
		top = top[:8]
	}
	days := []kv{}
	for i := 13; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Format("2006-01-02")
		days = append(days, kv{d, day[d]})
	}
	p := s.Profile()
	name := ""
	if p != nil {
		name = p.Name
	}
	writeJSONResp(w, 200, map[string]any{
		"version": version, "edition": edition, "uptime": int(time.Since(startedAt).Seconds()),
		"engine":  map[string]any{"memMB": float64(ms.Sys) / (1 << 20), "heapMB": float64(ms.HeapAlloc) / (1 << 20), "goroutines": runtime.NumGoroutine(), "pid": os.Getpid(), "dataDir": s.dataDir, "os": runtime.GOOS},
		"ext":     map[string]any{"online": time.Now().UnixMilli()-ex.LastSeen < 75000, "lastSeen": ex.LastSeen, "version": ex.Version, "paused": ex.Paused, "stats": ex.Stats, "series": ex.Series},
		"totals":  map[string]any{"all": len(all), "today": today, "status": counts, "severity": bySev, "kind": byKind, "category": byCat},
		"topHosts": top, "days": days, "hours": hour, "profile": name, "settings": s.Settings(),
	})
}

/* ---------------- export ---------------- */

func handleExport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	since, _ := strconv.ParseFloat(q.Get("since"), 64)
	list := getStore().List(Filter{Status: q.Get("status"), Kind: q.Get("kind"), Severity: q.Get("severity"), Q: q.Get("q"), Since: since})
	stamp := time.Now().Format("2006-01-02_1504")
	if q.Get("format") == "json" {
		w.Header().Set("Content-Disposition", `attachment; filename="phalanx-report-`+stamp+`.json"`)
		writeJSONResp(w, 200, list)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="phalanx-report-`+stamp+`.csv"`)
	cw := csv.NewWriter(w)
	cw.Write([]string{"time", "kind", "title", "severity", "score", "status", "host", "category", "url", "target", "signals"})
	for _, e := range list {
		sig := []string{}
		if arr, ok := e["signals"].([]any); ok {
			for _, x := range arr {
				if m, ok := x.(map[string]any); ok {
					sig = append(sig, fmt.Sprint(m["label"]))
				}
			}
		}
		cw.Write([]string{time.UnixMilli(int64(e.num("ts"))).Format(time.RFC3339), e.str("kind"), e.str("title"), e.str("severity"),
			strconv.Itoa(int(e.num("score"))), e.str("status"), e.str("host"), e.str("category"), e.str("url"), e.str("target"), strings.Join(sig, " | ")})
	}
	cw.Flush()
}

/* ---------------- cache management ---------------- */

type cachePart struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Desc  string `json:"desc"`
	Bytes int64  `json:"bytes"`
	Clear bool   `json:"clearable"`
}

func cacheParts(dir string) []cachePart {
	return []cachePart{
		{"appwindow", "App window cache", "Browser cache of the Phalanx app window (images, scripts, GPU shaders).", dirSize(filepath.Join(dir, "cache", "appwindow")), true},
		{"reports", "Saved reports", "Exported report files kept by Phalanx.", dirSize(filepath.Join(dir, "cache", "reports")), true},
		{"temp", "Temporary files", "Scratch files created during analysis.", dirSize(filepath.Join(dir, "cache", "tmp")), true},
		{"logs", "Engine logs", "Diagnostic log of the desktop engine.", dirSize(filepath.Join(dir, "logs")), true},
		{"history", "Threat history", "Your detection history (cleared separately in the danger zone).", dirSize(filepath.Join(dir, "history")), false},
		{"config", "Settings & profile", "Your preferences, sign-in profile and site lists.", dirSize(filepath.Join(dir, "config")), false},
	}
}

func handleCache(w http.ResponseWriter, r *http.Request) {
	s := getStore()
	parts := cacheParts(s.dataDir)
	var total int64
	for _, p := range parts {
		total += p.Bytes
	}
	writeJSONResp(w, 200, map[string]any{"dataDir": s.dataDir, "defaultDir": defaultDataDir(), "parts": parts, "total": total, "canBrowse": runtime.GOOS == "windows"})
}

var browserCacheDirs = map[string]bool{"Cache": true, "Code Cache": true, "GPUCache": true, "DawnCache": true, "DawnGraphiteCache": true, "DawnWebGPUCache": true,
	"GrShaderCache": true, "ShaderCache": true, "GraphiteDawnCache": true, "CacheStorage": true, "ScriptCache": true, "Crashpad": true}

func clearDirContents(dir string) {
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		os.RemoveAll(filepath.Join(dir, e.Name()))
	}
}

func handleCacheClear(w http.ResponseWriter, r *http.Request) {
	var b struct{ Targets []string }
	readBody(r, &b)
	s := getStore()
	before := dirSize(filepath.Join(s.dataDir, "cache")) + dirSize(filepath.Join(s.dataDir, "logs"))
	for _, t := range b.Targets {
		switch t {
		case "appwindow":
			root := filepath.Join(s.dataDir, "cache", "appwindow")
			var victims []string
			filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
				if err == nil && d.IsDir() && browserCacheDirs[d.Name()] {
					victims = append(victims, p)
					return filepath.SkipDir
				}
				return nil
			})
			for _, v := range victims {
				os.RemoveAll(v) // files in use are skipped silently
			}
		case "reports":
			clearDirContents(filepath.Join(s.dataDir, "cache", "reports"))
		case "temp":
			clearDirContents(filepath.Join(s.dataDir, "cache", "tmp"))
		case "logs":
			if logFile != nil {
				logFile.Truncate(0)
			}
			ents, _ := os.ReadDir(filepath.Join(s.dataDir, "logs"))
			for _, e := range ents {
				if e.Name() != "engine.log" {
					os.Remove(filepath.Join(s.dataDir, "logs", e.Name()))
				}
			}
		case "extension":
			s.QueueCommand(Command{Type: "clearCache"})
		}
	}
	after := dirSize(filepath.Join(s.dataDir, "cache")) + dirSize(filepath.Join(s.dataDir, "logs"))
	log.Printf("Cache cleared %v: freed %d bytes", b.Targets, before-after)
	writeJSONResp(w, 200, map[string]any{"freed": before - after})
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		in, err := os.Open(p)
		if err != nil {
			return nil
		}
		defer in.Close()
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	})
}

func handleCacheLocation(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Path  string
		Reset bool
	}
	readBody(r, &b)
	target := strings.TrimSpace(b.Path)
	if b.Reset {
		target = defaultDataDir()
	}
	if target == "" || !filepath.IsAbs(target) {
		bad(w, 400, "Please choose a full folder path, e.g. D:\\PhalanxData")
		return
	}
	target = filepath.Clean(target)
	old := getStore()
	if strings.EqualFold(target, old.dataDir) {
		writeJSONResp(w, 200, map[string]any{"dataDir": target})
		return
	}
	if !writable(target) {
		bad(w, 400, "Phalanx cannot write to that folder. Pick another one.")
		return
	}
	if err := ensureDirs(target); err != nil {
		bad(w, 400, err.Error())
		return
	}
	storeMu.Lock()
	defer storeMu.Unlock()
	old.Close()
	for _, d := range []string{"history", "config", filepath.Join("cache", "reports")} {
		if err := copyTree(filepath.Join(old.dataDir, d), filepath.Join(target, d)); err != nil {
			s2, _ := OpenStore(old.dataDir)
			store = s2
			bad(w, 500, "Copy failed: "+err.Error())
			return
		}
	}
	ns, err := OpenStore(target)
	if err != nil {
		s2, _ := OpenStore(old.dataDir)
		store = s2
		bad(w, 500, err.Error())
		return
	}
	ns.commands = old.commands
	store = ns
	saveLocation(target)
	setupLog(target)
	// remove migrated data from the old place (app-window cache stays until next launch)
	for _, d := range []string{"history", "config", filepath.Join("cache", "reports"), filepath.Join("cache", "tmp")} {
		os.RemoveAll(filepath.Join(old.dataDir, d))
	}
	log.Printf("Data folder moved from %s to %s", old.dataDir, target)
	writeJSONResp(w, 200, map[string]any{"dataDir": target})
}

/* ---------------- open helpers ---------------- */

func handleOpen(w http.ResponseWriter, r *http.Request) {
	var b struct{ Target, URL string }
	readBody(r, &b)
	s := getStore()
	switch b.Target {
	case "testlab":
		openDefaultBrowser(baseURL + "/testlab/")
	case "extensions-page":
		openDefaultBrowser("chrome://extensions") // most browsers block this; UI shows manual steps too
	case "extension-folder":
		dir := filepath.Join(exeDir, "extension")
		if _, err := os.Stat(dir); err != nil {
			bad(w, 404, "Extension folder not found next to Phalanx.exe")
			return
		}
		openFolder(dir)
	case "data-folder":
		openFolder(s.dataDir)
	case "url":
		if !strings.HasPrefix(b.URL, "https://") {
			bad(w, 400, "only https links")
			return
		}
		openDefaultBrowser(b.URL)
	default:
		bad(w, 400, "unknown target")
		return
	}
	writeJSONResp(w, 200, map[string]bool{"ok": true})
}
