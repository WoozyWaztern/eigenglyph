// EIGENGLYPH : ΣVOID — standalone server (single .exe, no installs).
// Serves the game to the browser and runs the multiplayer.
package main

import (
	"bufio"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

//go:embed assets
var assets embed.FS

var start = time.Now()

func now() float64 { return time.Since(start).Seconds() }
func r3(v float64) float64 { return math.Round(v*1000) / 1000 }

// ───────────── accounts ─────────────
type account struct {
	Name    string `json:"name"`
	Salt    string `json:"salt"`
	Hash    string `json:"hash"`
	Created int64  `json:"created"`
	Stats   *stats `json:"stats,omitempty"`
	Friends []string `json:"friends,omitempty"`
	ReqIn   []string `json:"reqIn,omitempty"`
	ReqOut  []string `json:"reqOut,omitempty"`
	Notes   []note   `json:"notes,omitempty"`
}

type note struct {
	Text string `json:"text"`
	At   int64  `json:"at"`
}

type matchRec struct {
	Place int    `json:"place"`
	Mode  string `json:"mode"`
	K     int    `json:"k"`
	D     int    `json:"d"`
	RP    int    `json:"rp"`
}
type stats struct {
	RP      int        `json:"rp"`
	Stars   int        `json:"stars"`
	Since   int64      `json:"since"`
	Kills   int        `json:"kills"`
	Deaths  int        `json:"deaths"`
	Wins    int        `json:"wins"`
	Matches int        `json:"matches"`
	History []matchRec `json:"history"`
}

func statsOf(a *account) *stats {
	if a == nil {
		return &stats{History: []matchRec{}}
	}
	if a.Stats == nil {
		a.Stats = &stats{History: []matchRec{}}
	}
	if a.Stats.History == nil {
		a.Stats.History = []matchRec{}
	}
	if a.Stats.Since == 0 {
		a.Stats.Since = a.Created
	}
	return a.Stats
}

// ───────────── friends ─────────────
func has(list []string, k string) bool {
	for _, v := range list {
		if v == k {
			return true
		}
	}
	return false
}
func without(list []string, k string) []string {
	out := []string{}
	for _, v := range list {
		if v != k {
			out = append(out, v)
		}
	}
	return out
}
func onlineConn(key string) *conn {
	for c := range clients {
		if c.acc != nil && strings.ToLower(c.name) == key {
			return c
		}
	}
	return nil
}
func addNote(a *account, text string) {
	a.Notes = append([]note{{text, time.Now().UnixMilli()}}, a.Notes...)
	if len(a.Notes) > 20 {
		a.Notes = a.Notes[:20]
	}
}
func card(key string) M {
	a := accounts[key]
	if a == nil {
		return nil
	}
	oc := onlineConn(key)
	st := statsOf(a)
	return M{"name": a.Name, "rp": st.RP, "stars": st.Stars, "online": oc != nil, "ingame": oc != nil && oc.player != nil}
}
func socialMsg(a *account) M {
	cards := func(keys []string) []M {
		out := []M{}
		for _, k := range keys {
			if c := card(k); c != nil {
				out = append(out, c)
			}
		}
		return out
	}
	out := []string{}
	for _, k := range a.ReqOut {
		if accounts[k] != nil {
			out = append(out, accounts[k].Name)
		}
	}
	notes := a.Notes
	if notes == nil {
		notes = []note{}
	}
	return M{"t": "social", "friends": cards(a.Friends), "requests": cards(a.ReqIn), "outgoing": out, "notes": notes}
}
func pushSocial(key string) {
	if c := onlineConn(key); c != nil {
		c.send(socialMsg(c.acc))
	}
}
func relation(a *account, key string) string {
	switch {
	case strings.ToLower(a.Name) == key:
		return "you"
	case has(a.Friends, key):
		return "friend"
	case has(a.ReqOut, key):
		return "pending"
	case has(a.ReqIn, key):
		return "incoming"
	}
	return "none"
}
func makeFriends(a, b *account) {
	ka, kb := strings.ToLower(a.Name), strings.ToLower(b.Name)
	a.ReqIn, a.ReqOut = without(a.ReqIn, kb), without(a.ReqOut, kb)
	b.ReqIn, b.ReqOut = without(b.ReqIn, ka), without(b.ReqOut, ka)
	if !has(a.Friends, kb) {
		a.Friends = append(a.Friends, kb)
	}
	if !has(b.Friends, ka) {
		b.Friends = append(b.Friends, ka)
	}
}
func onSocial(c *conn, t string, m M) {
	me := c.acc
	myKey := strings.ToLower(c.name)
	key := strings.ToLower(strings.TrimSpace(fmt.Sprint(m["name"])))
	other := accounts[key]
	reply := func(text string, ok bool) { c.send(M{"t": "notice", "text": text, "ok": ok}) }
	switch t {
	case "social":
		c.send(socialMsg(me))
	case "search":
		q := strings.ToLower(strings.TrimSpace(fmt.Sprint(m["q"])))
		if q == "<nil>" {
			q = ""
		}
		keys := []string{}
		for k := range accounts {
			if q == "" || strings.Contains(k, q) {
				keys = append(keys, k)
			}
		}
		sort.Slice(keys, func(i, j int) bool {
			pi, pj := strings.HasPrefix(keys[i], q), strings.HasPrefix(keys[j], q)
			if pi != pj {
				return pi
			}
			return keys[i] < keys[j]
		})
		if len(keys) > 12 {
			keys = keys[:12]
		}
		list := []M{}
		for _, k := range keys {
			a := accounts[k]
			st := statsOf(a)
			list = append(list, M{"name": a.Name, "rp": st.RP, "stars": st.Stars, "online": onlineConn(k) != nil, "rel": relation(me, k)})
		}
		c.send(M{"t": "searchRes", "q": q, "list": list})
	case "friendAdd":
		if other == nil {
			reply("player not found", false)
			return
		}
		if key == myKey {
			reply("you can't add yourself", false)
			return
		}
		switch relation(me, key) {
		case "friend":
			reply(other.Name+" is already your friend", false)
			return
		case "pending":
			reply("request to "+other.Name+" already sent", false)
			return
		case "incoming":
			makeFriends(me, other)
			addNote(other, me.Name+" accepted your friend request")
			reply("you and "+other.Name+" are now friends", true)
		default:
			me.ReqOut = append(me.ReqOut, key)
			other.ReqIn = append(other.ReqIn, myKey)
			addNote(other, me.Name+" wants to be your friend")
			reply("friend request sent to "+other.Name, true)
		}
		saveSoon()
		pushSocial(myKey)
		pushSocial(key)
	case "friendAccept":
		if other == nil || !has(me.ReqIn, key) {
			return
		}
		makeFriends(me, other)
		addNote(other, me.Name+" accepted your friend request")
		saveSoon()
		pushSocial(myKey)
		pushSocial(key)
		reply("you and "+other.Name+" are now friends", true)
	case "friendDecline":
		if other == nil {
			return
		}
		me.ReqIn = without(me.ReqIn, key)
		other.ReqOut = without(other.ReqOut, myKey)
		saveSoon()
		pushSocial(myKey)
		pushSocial(key)
	case "friendRemove":
		if other == nil {
			return
		}
		me.Friends = without(me.Friends, key)
		other.Friends = without(other.Friends, myKey)
		saveSoon()
		pushSocial(myKey)
		pushSocial(key)
		reply(other.Name+" removed from friends", true)
	}
}

var saveTimer *time.Timer

func saveSoon() {
	if saveTimer != nil {
		saveTimer.Stop()
	}
	saveTimer = time.AfterFunc(time.Second, func() { mu.Lock(); saveAccounts(); mu.Unlock() })
}
func sendProfile(c *conn) {
	if c != nil && c.acc != nil {
		c.send(M{"t": "profile", "stats": statsOf(c.acc)})
	}
}

// ── match: DEATHMATCH 5 min → results 10 s → new match ──
const matchTime, resultsTime = 300.0, 10.0

var matchPhase = "idle"
var matchEnds = 0.0

func matchInfo() M {
	return M{"t": "match", "phase": matchPhase, "left": math.Max(0, math.Round(matchEnds-now()))}
}
func startMatch() {
	matchPhase, matchEnds = "play", now()+matchTime
	for _, p := range players {
		p.Kills, p.Deaths = 0, 0
		spawnP(p)
		broadcast(M{"t": "respawn", "id": p.ID, "x": r3(p.X), "y": 0, "z": r3(p.Z), "yaw": r3(p.Yaw)}, nil)
	}
	broadcast(M{"t": "matchstart", "left": matchTime}, nil)
}
func starsFor(place int) int {
	if place == 1 {
		return 50
	}
	if place <= 3 {
		return 20
	}
	return 10
}
func endMatch() {
	matchPhase, matchEnds = "results", now()+resultsTime
	list := make([]*player, 0, len(players))
	for _, p := range players {
		list = append(list, p)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Kills != list[j].Kills {
			return list[i].Kills > list[j].Kills
		}
		return list[i].Deaths < list[j].Deaths
	})
	ranked := len(list) >= 2
	results := []M{}
	for i, p := range list {
		place, delta := i+1, 0
		if ranked {
			if place == 1 {
				delta = 25
			} else if place <= 3 {
				delta = 10
			} else {
				delta = -15
			}
			st := statsOf(p.c.acc)
			st.Matches++
			if place == 1 {
				st.Wins++
			}
			st.RP = max(0, st.RP+delta)
			st.Stars += starsFor(place)
			st.History = append([]matchRec{{place, "DEATHMATCH", p.Kills, p.Deaths, delta + p.Kills*2}}, st.History...)
			if len(st.History) > 8 {
				st.History = st.History[:8]
			}
			sendProfile(p.c)
		}
		stars := 0
		if ranked {
			stars = starsFor(place)
		}
		results = append(results, M{"id": p.ID, "name": p.Name, "kills": p.Kills, "deaths": p.Deaths, "place": place, "rp": delta, "stars": stars})
	}
	if ranked {
		saveSoon()
	}
	broadcast(M{"t": "matchend", "results": results, "ranked": ranked, "next": resultsTime}, nil)
}

var (
	accounts = map[string]*account{}
	accFile  string
)

func hashPass(pass, salt string) string {
	k, _ := pbkdf2.Key(sha256.New, pass, []byte(salt), 60000, 32)
	return hex.EncodeToString(k)
}
func loadAccounts() {
	b, err := os.ReadFile(accFile)
	if err == nil {
		json.Unmarshal(b, &accounts)
	}
}
func saveAccounts() {
	os.MkdirAll(filepath.Dir(accFile), 0o755)
	b, _ := json.MarshalIndent(accounts, "", "  ")
	os.WriteFile(accFile, b, 0o644)
}

var nameRe = regexp.MustCompile(`^[A-Za-z0-9_\x{0400}-\x{04FF}]{3,16}$`)

// ───────────── minimal websocket ─────────────
type conn struct {
	c      net.Conn
	r      *bufio.Reader
	wmu    sync.Mutex
	closed bool
	name   string
	player *player
	acc    *account
	out    chan []byte
}

// queue a message (keeps order; drops if the client is hopelessly behind)
func (c *conn) sendRaw(b []byte) {
	select {
	case c.out <- b:
	default:
	}
}
func (c *conn) writer() {
	for b := range c.out {
		c.write(b)
	}
}
func (c *conn) write(b []byte) {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.closed {
		return
	}
	n := len(b)
	var head []byte
	switch {
	case n < 126:
		head = []byte{0x81, byte(n)}
	case n < 65536:
		head = []byte{0x81, 126, byte(n >> 8), byte(n)}
	default:
		head = make([]byte, 10)
		head[0], head[1] = 0x81, 127
		binary.BigEndian.PutUint64(head[2:], uint64(n))
	}
	c.c.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.c.Write(append(head, b...)); err != nil {
		c.closed = true
		c.c.Close()
	}
}
func (c *conn) send(v any) {
	b, _ := json.Marshal(v)
	c.sendRaw(b)
}
func (c *conn) readMsg() (string, error) {
	var msg []byte
	for {
		h := make([]byte, 2)
		if _, err := io.ReadFull(c.r, h); err != nil {
			return "", err
		}
		fin, op, masked := h[0]&0x80 != 0, h[0]&0x0f, h[1]&0x80 != 0
		n := uint64(h[1] & 0x7f)
		if n == 126 {
			e := make([]byte, 2)
			if _, err := io.ReadFull(c.r, e); err != nil {
				return "", err
			}
			n = uint64(binary.BigEndian.Uint16(e))
		} else if n == 127 {
			e := make([]byte, 8)
			if _, err := io.ReadFull(c.r, e); err != nil {
				return "", err
			}
			n = binary.BigEndian.Uint64(e)
		}
		if n > 1<<20 {
			return "", fmt.Errorf("too big")
		}
		var mask [4]byte
		if masked {
			if _, err := io.ReadFull(c.r, mask[:]); err != nil {
				return "", err
			}
		}
		p := make([]byte, n)
		if _, err := io.ReadFull(c.r, p); err != nil {
			return "", err
		}
		if masked {
			for i := range p {
				p[i] ^= mask[i&3]
			}
		}
		switch op {
		case 0x8:
			return "", io.EOF
		case 0x9:
			c.wmu.Lock()
			c.c.Write(append([]byte{0x8A, byte(len(p))}, p...))
			c.wmu.Unlock()
			continue
		case 0xA:
			continue
		}
		msg = append(msg, p...)
		if fin {
			return string(msg), nil
		}
	}
}

// ───────────── game state ─────────────
type player struct {
	ID       int         `json:"id"`
	Name     string      `json:"name"`
	X        float64     `json:"x"`
	Y        float64     `json:"y"`
	Z        float64     `json:"z"`
	Yaw      float64     `json:"yaw"`
	Pitch    float64     `json:"pitch"`
	W        int         `json:"w"`
	HP       int         `json:"hp"`
	Dead     bool        `json:"dead"`
	Kills    int         `json:"kills"`
	Deaths   int         `json:"deaths"`
	Wounds   [][4]float64 `json:"wounds"`
	c        *conn
	deadUntil, protUntil, lastShot, lastKnife, lastDrink, lastChat float64
}

var (
	mu      sync.Mutex
	clients = map[*conn]bool{}
	players = map[int]*player{}
	nextID  = 1
)

type M = map[string]any

func broadcast(v any, except *conn) {
	b, _ := json.Marshal(v)
	for _, p := range players {
		if p.c != except {
			p.c.sendRaw(b)
		}
	}
}
func sysMsg(text string) { broadcast(M{"t": "chat", "id": 0, "name": "", "text": text, "sys": true}, nil) }

func pub(p *player) M {
	w := p.Wounds
	if w == nil {
		w = [][4]float64{}
	}
	return M{"id": p.ID, "name": p.Name, "x": r3(p.X), "y": r3(p.Y), "z": r3(p.Z), "yaw": r3(p.Yaw), "pitch": r3(p.Pitch),
		"w": p.W, "hp": p.HP, "dead": p.Dead, "kills": p.Kills, "deaths": p.Deaths, "wounds": w}
}

func pickSpawn() [3]float64 {
	best, bestD := spawns[0], -1.0
	for _, s := range spawns {
		d := 1e9
		for _, p := range players {
			if !p.Dead {
				d = math.Min(d, math.Hypot(p.X-s[0], p.Z-s[2]))
			}
		}
		d += randf() * 6
		if d > bestD {
			bestD, best = d, s
		}
	}
	return best
}
func randf() float64 {
	var b [8]byte
	rand.Read(b[:])
	return float64(binary.LittleEndian.Uint64(b[:])>>11) / float64(1<<53)
}
func spawnP(p *player) {
	s := pickSpawn()
	p.X, p.Y, p.Z = s[0], 0, s[2]
	p.Yaw = math.Atan2(-(24 - p.X), -(24 - p.Z))
	p.Pitch, p.HP, p.Dead = 0, maxHP, false
	p.Wounds = nil
	p.protUntil = now() + 1.5
}

func joinGame(c *conn) {
	if c.player != nil {
		return
	}
	p := &player{ID: nextID, Name: c.name, c: c, lastDrink: -99}
	nextID++
	spawnP(p)
	c.player = p
	players[p.ID] = p
	list := []M{}
	for _, o := range players {
		list = append(list, pub(o))
	}
	c.send(M{"t": "welcome", "id": p.ID, "you": pub(p), "players": list})
	broadcast(M{"t": "join", "p": pub(p)}, c)
	sysMsg(p.Name + " entered the void")
	if matchPhase == "idle" {
		startMatch()
	} else {
		c.send(matchInfo())
	}
}
func leaveGame(c *conn) {
	p := c.player
	if p == nil {
		return
	}
	delete(players, p.ID)
	c.player = nil
	broadcast(M{"t": "leave", "id": p.ID}, nil)
	sysMsg(p.Name + " left")
	if len(players) == 0 {
		matchPhase = "idle"
	}
}

func damage(t, a *player, dmg int, weapon string, wounds [][4]float64, pts [][3]float64) {
	if t.Dead || matchPhase != "play" {
		return
	}
	t.HP = max(0, t.HP-dmg)
	t.Wounds = append(t.Wounds, wounds...)
	if len(t.Wounds) > 28 {
		t.Wounds = t.Wounds[len(t.Wounds)-28:]
	}
	broadcast(M{"t": "hit", "id": t.ID, "by": a.ID, "dmg": dmg, "hp": t.HP, "w": weapon, "wounds": wounds, "pts": pts}, nil)
	if t.HP <= 0 {
		t.Dead = true
		t.deadUntil = now() + 3.5
		t.Deaths++
		a.Kills++
		sa, sv := statsOf(a.c.acc), statsOf(t.c.acc)
		sa.Kills++
		sa.RP += 2
		sa.Stars += 5
		sv.Deaths++
		sendProfile(a.c)
		sendProfile(t.c)
		saveSoon()
		broadcast(M{"t": "kill", "victim": t.ID, "killer": a.ID, "w": weapon, "vk": t.Kills, "vd": t.Deaths, "kk": a.Kills, "kd": a.Deaths}, nil)
	}
}

func norm(v any) ([3]float64, bool) {
	arr, ok := v.([]any)
	if !ok || len(arr) != 3 {
		return [3]float64{}, false
	}
	var d [3]float64
	for i := range 3 {
		f, ok := arr[i].(float64)
		if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
			return d, false
		}
		d[i] = f
	}
	l := math.Sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2])
	if l < 1e-6 {
		return d, false
	}
	return [3]float64{d[0] / l, d[1] / l, d[2] / l}, true
}

type hitRes struct {
	p     *player
	point [3]float64
}

func traceHit(sh *player, o, d [3]float64, maxT, rad float64) *hitRes {
	wall := raycast(o[0], o[1], o[2], d[0], d[1], d[2], maxT)
	if wall < 0 {
		wall = maxT
	}
	var best *player
	bestT := wall
	for _, p := range players {
		if p == sh || p.Dead {
			continue
		}
		t := raySphere(o[0], o[1], o[2], d[0], d[1], d[2], p.X, p.Y+bodyCY, p.Z, rad)
		if t > 0 && t < bestT {
			bestT, best = t, p
		}
	}
	if best == nil {
		return nil
	}
	return &hitRes{best, [3]float64{o[0] + d[0]*bestT, o[1] + d[1]*bestT, o[2] + d[2]*bestT}}
}
func woundFor(p *player, pt [3]float64, typ float64) [4]float64 {
	vx, vy, vz := pt[0]-p.X, pt[1]-(p.Y+bodyCY), pt[2]-p.Z
	l := math.Sqrt(vx*vx + vy*vy + vz*vz)
	if l == 0 {
		l = 1
	}
	L := toLocal(vx/l, vy/l, vz/l, p.Yaw)
	return [4]float64{r3(L[0]), r3(L[1]), r3(L[2]), typ}
}
func r3v(v [3]float64) [3]float64 { return [3]float64{r3(v[0]), r3(v[1]), r3(v[2])} }

func onShoot(p *player, m M) {
	t := now()
	if p.Dead || t-p.lastShot < sgCD-0.12 {
		return
	}
	p.lastShot = t
	d, ok := norm(m["d"])
	if !ok {
		return
	}
	o := [3]float64{p.X, p.Y + eyeH, p.Z}
	var pel [][3]float64
	if arr, ok := m["pel"].([]any); ok {
		for i, v := range arr {
			if i >= 10 {
				break
			}
			if n, ok := norm(v); ok {
				pel = append(pel, n)
			}
		}
	}
	if len(pel) == 0 {
		pel = append(pel, d)
	}
	pr := make([][3]float64, len(pel))
	for i, v := range pel {
		pr[i] = r3v(v)
	}
	broadcast(M{"t": "fx", "k": "shot", "id": p.ID, "o": r3v(o), "pel": pr}, p.c)
	hits := map[*player][][3]float64{}
	order := []*player{}
	for _, pd := range pel {
		if pd[0]*d[0]+pd[1]*d[1]+pd[2]*d[2] < 0.97 {
			continue
		}
		h := traceHit(p, o, pd, sgRange, bodyR+0.06)
		if h == nil {
			continue
		}
		if _, ok := hits[h.p]; !ok {
			order = append(order, h.p)
		}
		hits[h.p] = append(hits[h.p], h.point)
	}
	for _, tg := range order {
		if t < tg.protUntil {
			continue
		}
		pts := hits[tg]
		if len(pts) > 5 {
			pts = pts[:5]
		}
		var wounds [][4]float64
		var rp [][3]float64
		for _, pt := range pts {
			wounds = append(wounds, woundFor(tg, pt, 0))
			rp = append(rp, r3v(pt))
		}
		damage(tg, p, sgDmg, "shotgun", wounds, rp)
	}
}

func onKnife(p *player, m M) {
	t := now()
	if p.Dead || t-p.lastKnife < knCD-0.08 {
		return
	}
	p.lastKnife = t
	d, ok := norm(m["d"])
	if !ok {
		return
	}
	o := [3]float64{p.X, p.Y + eyeH, p.Z}
	broadcast(M{"t": "fx", "k": "knife", "id": p.ID}, p.c)
	h := traceHit(p, o, d, knRange, bodyR+0.3)
	if h == nil || t < h.p.protUntil {
		return
	}
	base := woundFor(h.p, h.point, 1)
	side := 1.0
	if s, ok := m["side"].(float64); ok && s == -1 {
		side = -1
	}
	var wounds [][4]float64
	for i := -1; i <= 1; i++ {
		a := float64(i) * 0.16 * side
		c, s := math.Cos(a), math.Sin(a)
		wounds = append(wounds, [4]float64{r3(base[0]*c + base[2]*s), r3(base[1] + float64(i)*0.07), r3(-base[0]*s + base[2]*c), 1})
	}
	damage(h.p, p, knDmg, "knife", wounds, [][3]float64{r3v(h.point)})
}

func onDrink(p *player) {
	t := now()
	if p.Dead || t-p.lastDrink < sodaCD-0.3 {
		return
	}
	p.lastDrink = t
	p.HP = min(maxHP, p.HP+sodaHeal)
	broadcast(M{"t": "heal", "id": p.ID, "hp": p.HP}, nil)
}

func handle(c *conn, raw string) {
	var m M
	if json.Unmarshal([]byte(raw), &m) != nil {
		return
	}
	t, _ := m["t"].(string)
	mu.Lock()
	defer mu.Unlock()
	if t == "auth" {
		name := strings.TrimSpace(fmt.Sprint(m["name"]))
		pass, _ := m["pass"].(string)
		if !nameRe.MatchString(name) {
			c.send(M{"t": "auth", "ok": false, "msg": "nickname: 3-16 letters, digits or _"})
			return
		}
		if n := utf8.RuneCountInString(pass); n < 3 || n > 64 {
			c.send(M{"t": "auth", "ok": false, "msg": "password: 3-64 characters"})
			return
		}
		key := strings.ToLower(name)
		for o := range clients {
			if o != c && strings.ToLower(o.name) == key {
				c.send(M{"t": "auth", "ok": false, "msg": "this nickname is already online"})
				return
			}
		}
		created := false
		if a, ok := accounts[key]; ok {
			if hashPass(pass, a.Salt) != a.Hash {
				c.send(M{"t": "auth", "ok": false, "msg": "wrong password"})
				return
			}
		} else {
			var sb [16]byte
			rand.Read(sb[:])
			salt := hex.EncodeToString(sb[:])
			accounts[key] = &account{Name: name, Salt: salt, Hash: hashPass(pass, salt), Created: time.Now().UnixMilli()}
			saveAccounts()
			created = true
		}
		c.name = accounts[key].Name
		c.acc = accounts[key]
		c.send(M{"t": "auth", "ok": true, "name": c.name, "created": created, "stats": statsOf(c.acc), "lan": lanAddrs()})
		return
	}
	if c.name == "" {
		return
	}
	switch t {
	case "social", "search", "friendAdd", "friendAccept", "friendDecline", "friendRemove":
		onSocial(c, t, m)
		return
	case "join":
		joinGame(c)
		return
	case "leave":
		leaveGame(c)
		return
	}
	p := c.player
	if p == nil {
		return
	}
	switch t {
	case "st":
		if p.Dead {
			return
		}
		f := func(k string) (float64, bool) { v, ok := m[k].(float64); return v, ok && !math.IsNaN(v) && !math.IsInf(v, 0) }
		x, ok1 := f("x")
		y, ok2 := f("y")
		z, ok3 := f("z")
		yaw, ok4 := f("yaw")
		pitch, ok5 := f("pitch")
		if ok1 && ok2 && ok3 && ok4 && ok5 {
			p.X = math.Max(0, math.Min(W, x))
			p.Y = math.Max(0, math.Min(H, y))
			p.Z = math.Max(0, math.Min(D, z))
			p.Yaw, p.Pitch = yaw, pitch
		}
		if w, ok := m["w"].(float64); ok && (w == 0 || w == 1 || w == 2) {
			p.W = int(w)
		}
	case "shoot":
		onShoot(p, m)
	case "knife":
		onKnife(p, m)
	case "drink":
		onDrink(p)
	case "chat":
		tt := now()
		if tt-p.lastChat < 0.35 {
			return
		}
		p.lastChat = tt
		text := strings.Map(func(r rune) rune {
			if r < 32 || r == 127 {
				return -1
			}
			return r
		}, fmt.Sprint(m["text"]))
		text = strings.TrimSpace(text)
		if r := []rune(text); len(r) > 120 {
			text = string(r[:120])
		}
		if text != "" {
			broadcast(M{"t": "chat", "id": p.ID, "name": p.Name, "text": text}, nil)
		}
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		http.Error(w, "websocket only", 400)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return
	}
	nc, rw, err := hj.Hijack()
	if err != nil {
		return
	}
	h := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
		base64.StdEncoding.EncodeToString(h[:]) + "\r\n\r\n")
	rw.Flush()
	if tc, ok := nc.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
	}
	c := &conn{c: nc, r: rw.Reader, out: make(chan []byte, 512)}
	go c.writer()
	mu.Lock()
	clients[c] = true
	mu.Unlock()
	for {
		msg, err := c.readMsg()
		if err != nil {
			break
		}
		handle(c, msg)
	}
	mu.Lock()
	leaveGame(c)
	delete(clients, c)
	mu.Unlock()
	close(c.out)
	c.wmu.Lock()
	c.closed = true
	c.wmu.Unlock()
	nc.Close()
}

func tick() {
	t := time.NewTicker(50 * time.Millisecond)
	n := 0
	for range t.C {
		n++
		mu.Lock()
		tt := now()
		for _, p := range players {
			if p.Dead && tt > p.deadUntil {
				spawnP(p)
				broadcast(M{"t": "respawn", "id": p.ID, "x": r3(p.X), "y": 0, "z": r3(p.Z), "yaw": r3(p.Yaw)}, nil)
			}
		}
		if matchPhase == "play" && tt > matchEnds {
			endMatch()
		} else if matchPhase == "results" && tt > matchEnds {
			startMatch()
		}
		if len(players) > 0 {
			ids := make([]int, 0, len(players))
			for id := range players {
				ids = append(ids, id)
			}
			sort.Ints(ids)
			snap := make([][]any, 0, len(ids))
			for _, id := range ids {
				p := players[id]
				d := 0
				if p.Dead {
					d = 1
				}
				snap = append(snap, []any{p.ID, r3(p.X), r3(p.Y), r3(p.Z), r3(p.Yaw), r3(p.Pitch), p.W, p.HP, d})
			}
			broadcast(M{"t": "s", "p": snap}, nil)
		}
		if n%30 == 0 {
			b, _ := json.Marshal(M{"t": "online", "n": len(clients), "ingame": len(players)})
			for c := range clients {
				c.sendRaw(b)
			}
		}
		mu.Unlock()
	}
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

// Online server baked into the exe:  go build -ldflags "-X main.defaultServer=https://your-server"
var defaultServer = ""
var listenPort = 3000

func lanAddrs() []string {
	out := []string{}
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() && ipn.IP.To4() != nil {
				s := ipn.IP.String()
				if listenPort != 3000 {
					s += fmt.Sprintf(":%d", listenPort)
				}
				out = append(out, s)
			}
		}
	}
	return out
}

// open the game in its own window (Edge/Chrome "app" mode: no tabs, no address bar).
// returns a function that blocks until the window is closed, or nil if only a browser tab could be opened.
func openGameWindow(url string) func() {
	b := findAppBrowser()
	if b == "" {
		openBrowser(url)
		return nil
	}
	args := []string{
		"--app=" + url,
		"--user-data-dir=" + windowProfileDir(),
		"--window-size=1366,820",
		"--no-first-run", "--no-default-browser-check",
		"--disable-sync", // never sign in / sync a Microsoft or Google account
		"--disable-features=Translate,msEdgeSidebarV2,msImplicitSignin,msEdgeSyncFirstRunExperience",
		"--autoplay-policy=no-user-gesture-required",
	}
	if strings.Contains(strings.ToLower(b), "msedge") {
		args = append(args, "--inprivate") // InPrivate: Edge never signs in or shows sync popups
	}
	cmd := exec.Command(b, args...)
	if err := cmd.Start(); err != nil {
		openBrowser(url)
		return nil
	}
	return func() { cmd.Wait() }
}

// keep running while anyone is connected (used when we could not track the window)
func waitWhileClients() {
	start, last := time.Now(), time.Now()
	for {
		time.Sleep(2 * time.Second)
		mu.Lock()
		n := len(clients)
		mu.Unlock()
		if n > 0 {
			last = time.Now()
		} else if time.Since(last) > 20*time.Second && time.Since(start) > 90*time.Second {
			return
		}
	}
}

type launchConfig struct {
	Server string `json:"server"`
	Port   int    `json:"port"`
}

func main() {
	port := flag.Int("port", 0, "port")
	noOpen := flag.Bool("no-browser", false, "server only, do not open a window")
	host := flag.Bool("host", false, "always host a local server (ignore online server)")
	serverFlag := flag.String("server", "", "online server address to join")
	flag.Parse()

	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	// optional eigenglyph.json next to the exe: {"server": "https://...", "port": 3000}
	cfg := launchConfig{Server: defaultServer, Port: 3000}
	if b, err := os.ReadFile(filepath.Join(dir, "eigenglyph.json")); err == nil {
		json.Unmarshal(b, &cfg)
	}
	if *serverFlag != "" {
		cfg.Server = *serverFlag
	}
	if *port != 0 {
		cfg.Port = *port
	}
	if p := os.Getenv("PORT"); p != "" {
		fmt.Sscan(p, &cfg.Port)
	}
	listenPort = cfg.Port

	// ── join an online server: just open the window there ──
	if cfg.Server != "" && !*host && !*noOpen {
		srv := cfg.Server
		if !strings.HasPrefix(srv, "http") {
			srv = "https://" + srv
		}
		if wait := openGameWindow(srv); wait != nil {
			wait()
		}
		return
	}

	// ── host the game on this PC ──
	accFile = filepath.Join(dir, "eigenglyph-data", "accounts.json")
	loadAccounts()
	buildWorld()
	sub, _ := fs.Sub(assets, "assets")
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", wsHandler)
	prefsFile := filepath.Join(dir, "eigenglyph-data", "prefs.json")
	mux.HandleFunc("/api/prefs", func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			http.Error(w, "local only", 403)
			return
		}
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
			if json.Valid(b) {
				os.MkdirAll(filepath.Dir(prefsFile), 0o755)
				os.WriteFile(prefsFile, b, 0o644)
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if b, err := os.ReadFile(prefsFile); err == nil {
			w.Write(b)
		} else {
			w.Write([]byte("{}"))
		}
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	url := fmt.Sprintf("http://localhost:%d", cfg.Port)
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.Port))
	if err != nil {
		// most likely the game is already running → just open another window
		if !*noOpen {
			if wait := openGameWindow(url); wait != nil {
				wait()
			}
		} else {
			messageBox("EIGENGLYPH", fmt.Sprintf("Port %d is busy: %v", cfg.Port, err))
		}
		return
	}
	go tick()
	go http.Serve(ln, mux)
	fmt.Printf("EIGENGLYPH server on %s  LAN: %v\n", url, lanAddrs())
	if *noOpen {
		select {}
	}
	started := time.Now()
	if wait := openGameWindow(url); wait != nil {
		wait()
		if time.Since(started) > 8*time.Second {
			return // the window was closed → stop the server
		}
	}
	// the window handed off to an already-open browser: keep serving while players are connected
	waitWhileClients()
}
