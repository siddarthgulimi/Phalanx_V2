package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Event is kept as a generic JSON object so the extension can evolve fields
// without breaking the engine. Well-known keys: id, ts, kind, type, title,
// score, severity, status, host, site, category, decidedAt, decidedBy.
type Event map[string]any

func (e Event) str(k string) string {
	if v, ok := e[k].(string); ok {
		return v
	}
	return ""
}
func (e Event) num(k string) float64 {
	switch v := e[k].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	}
	return 0
}

type Lists struct {
	Allow []string `json:"allow"`
	Block []string `json:"block"`
}

type Profile struct {
	Name    string `json:"name"`
	Salt    string `json:"salt"`
	Hash    string `json:"hash"`
	Created int64  `json:"created"`
}

type Command struct {
	Type   string `json:"type"`
	ID     string `json:"id,omitempty"`
	Action string `json:"action,omitempty"`
}

type ExtState struct {
	LastSeen int64            `json:"lastSeen"`
	Version  string           `json:"version"`
	Edition  string           `json:"edition"`
	Paused   bool             `json:"paused"`
	Stats    map[string]any   `json:"stats"`
	Series   []map[string]any `json:"series"`
}

var DefaultSettings = map[string]any{
	"sensitivity":    "medium",
	"autoQuarantine": true,
	"notifyStyle":    "toast",
	"siteScan":       true,
	"downloadScan":   true,
	"domScan":        true,
	"network":        "light",
	"theme":          "dark",
	"accent":         "",
	"size":           "normal",
	"keepRunning":    false,
	"historyDays":    float64(90),
}

type Store struct {
	mu       sync.RWMutex
	dataDir  string
	events   map[string]Event
	order    []string // newest first
	settings map[string]any
	lists    Lists
	profile  *Profile
	commands []Command
	ext      ExtState
	evFile   *os.File
}

func (s *Store) path(parts ...string) string {
	return filepath.Join(append([]string{s.dataDir}, parts...)...)
}

func ensureDirs(dir string) error {
	for _, d := range []string{"history", "config", "logs", filepath.Join("cache", "reports"), filepath.Join("cache", "tmp"), filepath.Join("cache", "appwindow")} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o755); err != nil {
			return err
		}
	}
	return nil
}

func OpenStore(dataDir string) (*Store, error) {
	s := &Store{dataDir: dataDir}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	if err := ensureDirs(s.dataDir); err != nil {
		return err
	}
	s.events = map[string]Event{}
	s.order = nil
	s.settings = map[string]any{}
	for k, v := range DefaultSettings {
		s.settings[k] = v
	}
	readJSON(s.path("config", "settings.json"), &s.settings)
	s.lists = Lists{Allow: []string{}, Block: []string{}}
	readJSON(s.path("config", "lists.json"), &s.lists)
	if s.lists.Allow == nil {
		s.lists.Allow = []string{}
	}
	if s.lists.Block == nil {
		s.lists.Block = []string{}
	}
	var p Profile
	if readJSON(s.path("config", "profile.json"), &p) == nil && p.Name != "" {
		s.profile = &p
	} else {
		s.profile = nil
	}

	lines := 0
	if f, err := os.Open(s.path("history", "events.jsonl")); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for sc.Scan() {
			lines++
			var rec struct {
				Op string `json:"op"`
				Ev Event  `json:"ev"`
				ID string `json:"id"`
			}
			if json.Unmarshal(sc.Bytes(), &rec) != nil {
				continue
			}
			switch rec.Op {
			case "put":
				if id := rec.Ev.str("id"); id != "" {
					s.events[id] = rec.Ev
				}
			case "del":
				delete(s.events, rec.ID)
			case "clear":
				s.events = map[string]Event{}
			}
		}
		f.Close()
	}
	s.pruneOld()
	s.reorder()
	if lines > 2*len(s.events)+200 {
		s.compact()
	}
	f, err := os.OpenFile(s.path("history", "events.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	s.evFile = f
	return nil
}

func (s *Store) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.evFile != nil {
		s.evFile.Close()
		s.evFile = nil
	}
}

func (s *Store) pruneOld() {
	days, _ := s.settings["historyDays"].(float64)
	if days <= 0 {
		return
	}
	cut := float64(time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli())
	for id, e := range s.events {
		if e.num("ts") < cut {
			delete(s.events, id)
		}
	}
}

func (s *Store) reorder() {
	s.order = s.order[:0]
	for id := range s.events {
		s.order = append(s.order, id)
	}
	sort.Slice(s.order, func(i, j int) bool { return s.events[s.order[i]].num("ts") > s.events[s.order[j]].num("ts") })
}

func (s *Store) compact() {
	tmp := s.path("history", "events.jsonl.tmp")
	f, err := os.Create(tmp)
	if err != nil {
		return
	}
	w := bufio.NewWriter(f)
	for i := len(s.order) - 1; i >= 0; i-- {
		b, _ := json.Marshal(map[string]any{"op": "put", "ev": s.events[s.order[i]]})
		w.Write(b)
		w.WriteByte('\n')
	}
	w.Flush()
	f.Close()
	os.Rename(tmp, s.path("history", "events.jsonl"))
}

func (s *Store) appendLog(rec map[string]any) {
	if s.evFile == nil {
		return
	}
	b, _ := json.Marshal(rec)
	s.evFile.Write(append(b, '\n'))
}

// Upsert merges an event coming from the extension. The side that decided
// most recently wins the status.
func (s *Store) Upsert(in Event) {
	id := in.str("id")
	if id == "" || len(id) > 64 {
		return
	}
	sanitize(in)
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.events[id]
	if ok {
		if cur.num("decidedAt") > in.num("decidedAt") {
			in["status"] = cur["status"]
			in["decidedAt"] = cur["decidedAt"]
			in["decidedBy"] = cur["decidedBy"]
		}
		for k, v := range in {
			cur[k] = v
		}
		in = cur
	} else {
		s.events[id] = in
		s.order = append([]string{id}, s.order...)
		if len(s.order) > 1 && s.events[s.order[1]].num("ts") > in.num("ts") {
			s.reorder()
		}
	}
	s.applyListEffect(in)
	s.appendLog(map[string]any{"op": "put", "ev": in})
}

func (s *Store) applyListEffect(e Event) {
	if e.str("kind") != "site" || e.str("site") == "" {
		return
	}
	site := e.str("site")
	switch e.str("status") {
	case "resolved":
		s.lists.Block = without(s.lists.Block, site)
		if !contains(s.lists.Allow, site) {
			s.lists.Allow = append(s.lists.Allow, site)
		}
	case "quarantined":
		s.lists.Allow = without(s.lists.Allow, site)
		if !contains(s.lists.Block, site) {
			s.lists.Block = append(s.lists.Block, site)
		}
	default:
		return
	}
	writeJSON(s.path("config", "lists.json"), s.lists)
}

func (s *Store) Decide(id, action string) (Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.events[id]
	if !ok {
		return nil, errors.New("not found")
	}
	switch action {
	case "resolved", "quarantined", "analysis", "pending":
	default:
		return nil, errors.New("bad action")
	}
	e["status"] = action
	e["decidedAt"] = float64(time.Now().UnixMilli())
	e["decidedBy"] = "app"
	s.applyListEffect(e)
	s.appendLog(map[string]any{"op": "put", "ev": e})
	if action != "pending" {
		s.commands = append(s.commands, Command{Type: "decide", ID: id, Action: action})
	}
	return e, nil
}

func (s *Store) Get(id string) Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.events[id]
}

type Filter struct {
	Status, Kind, Severity, Q string
	Since                     float64
	Limit                     int
}

func (s *Store) List(f Filter) []Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Event{}
	q := strings.ToLower(f.Q)
	for _, id := range s.order {
		e := s.events[id]
		if f.Status != "" {
			st := e.str("status")
			if f.Status == "quarantined" {
				if !strings.Contains(st, "quarantined") {
					continue
				}
			} else if st != f.Status {
				continue
			}
		}
		if f.Kind != "" && e.str("kind") != f.Kind {
			continue
		}
		if f.Severity != "" && e.str("severity") != f.Severity {
			continue
		}
		if f.Since > 0 && e.num("ts") < f.Since {
			continue
		}
		if q != "" {
			hay := strings.ToLower(e.str("title") + " " + e.str("host") + " " + e.str("url") + " " + e.str("target") + " " + e.str("category"))
			if !strings.Contains(hay, q) {
				continue
			}
		}
		out = append(out, e)
		if f.Limit > 0 && len(out) >= f.Limit {
			break
		}
	}
	return out
}

func (s *Store) ClearHistory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = map[string]Event{}
	s.order = nil
	if s.evFile != nil {
		s.evFile.Truncate(0)
	}
	s.commands = append(s.commands, Command{Type: "clearCache"})
}

func (s *Store) Settings() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]any{}
	for k, v := range s.settings {
		out[k] = v
	}
	return out
}

func (s *Store) PatchSettings(p map[string]any) map[string]any {
	s.mu.Lock()
	for k, v := range p {
		if _, known := DefaultSettings[k]; known {
			s.settings[k] = v
		}
	}
	writeJSON(s.path("config", "settings.json"), s.settings)
	s.mu.Unlock()
	return s.Settings()
}

func (s *Store) Lists() Lists {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return Lists{Allow: append([]string{}, s.lists.Allow...), Block: append([]string{}, s.lists.Block...)}
}

func (s *Store) EditList(list, op, site string) Lists {
	site = strings.ToLower(strings.TrimSpace(site))
	s.mu.Lock()
	if site != "" {
		switch list + ":" + op {
		case "allow:add":
			s.lists.Block = without(s.lists.Block, site)
			if !contains(s.lists.Allow, site) {
				s.lists.Allow = append(s.lists.Allow, site)
			}
		case "block:add":
			s.lists.Allow = without(s.lists.Allow, site)
			if !contains(s.lists.Block, site) {
				s.lists.Block = append(s.lists.Block, site)
			}
		case "allow:remove":
			s.lists.Allow = without(s.lists.Allow, site)
		case "block:remove":
			s.lists.Block = without(s.lists.Block, site)
		}
		writeJSON(s.path("config", "lists.json"), s.lists)
	}
	s.mu.Unlock()
	return s.Lists()
}

func (s *Store) TakeCommands() []Command {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.commands
	s.commands = nil
	if c == nil {
		c = []Command{}
	}
	return c
}

func (s *Store) QueueCommand(c Command) {
	s.mu.Lock()
	s.commands = append(s.commands, c)
	s.mu.Unlock()
}

/* ---- profile / login ---- */

func hashPass(salt, pass string) string {
	h := sha256.Sum256([]byte(salt + ":" + pass))
	for i := 0; i < 20000; i++ {
		h = sha256.Sum256(append(h[:], []byte(salt)...))
	}
	return hex.EncodeToString(h[:])
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) Profile() *Profile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.profile == nil {
		return nil
	}
	p := *s.profile
	return &p
}

func (s *Store) SetProfile(name, pass string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := &Profile{Name: name, Created: time.Now().Unix()}
	if s.profile != nil {
		p.Created = s.profile.Created
	}
	if pass != "" {
		p.Salt = randHex(16)
		p.Hash = hashPass(p.Salt, pass)
	}
	s.profile = p
	writeJSON(s.path("config", "profile.json"), p)
}

func (s *Store) RenameProfile(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.profile != nil {
		s.profile.Name = name
		writeJSON(s.path("config", "profile.json"), s.profile)
	}
}

func (s *Store) CheckPass(pass string) bool {
	p := s.Profile()
	if p == nil {
		return false
	}
	if p.Hash == "" {
		return true
	}
	return hashPass(p.Salt, pass) == p.Hash
}

/* ---- helpers ---- */

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func contains(l []string, v string) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

func without(l []string, v string) []string {
	out := l[:0:0]
	for _, x := range l {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

var (
	okSeverity = map[string]bool{"info": true, "low": true, "medium": true, "high": true, "critical": true}
	okStatus   = map[string]bool{"pending": true, "resolved": true, "quarantined": true, "auto-quarantined": true, "analysis": true}
	okKind     = map[string]bool{"dom": true, "site": true, "download": true}
)

// sanitize keeps enum-like fields within known values (defence in depth: these
// end up in CSS class names in the UI).
func sanitize(e Event) {
	if !okSeverity[e.str("severity")] {
		e["severity"] = "low"
	}
	if !okStatus[e.str("status")] {
		e["status"] = "pending"
	}
	if !okKind[e.str("kind")] {
		e["kind"] = "dom"
	}
	sc := e.num("score")
	if sc < 0 {
		sc = 0
	}
	if sc > 100 {
		sc = 100
	}
	e["score"] = sc
	for _, k := range []string{"title", "host", "site", "url", "source", "target", "category", "type"} {
		if v := e.str(k); len(v) > 2000 {
			e[k] = v[:2000]
		}
	}
}
