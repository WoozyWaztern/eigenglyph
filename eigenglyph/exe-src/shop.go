package main

// SHOP, INVENTORY and the bought weapons (port of the matching parts of server.js
// and shared/world.js): AK-47, pistol, hunting knife, bat, molotov (fire), medkit.

import "math"

type itemDef struct {
	ID      string
	Name    string
	Kind    string
	Price   int
	Starter bool
}

// same order as ITEMS in shared/world.js — the index is the "w" sent over the network
var items = []itemDef{
	{"shotgun", "SHOTGUN", "shotgun", 0, true},
	{"knife", "KNIFE", "knife", 0, true},
	{"soda", "SODA", "drink", 0, true},
	{"ak47", "DARK AK-47", "gun", 750, false},
	{"pistol", "PISTOL", "gun", 200, false},
	{"hknife", "HUNTING KNIFE", "melee", 150, false},
	{"bat", "BASEBALL BAT", "melee", 120, false},
	{"molotov", "MOLOTOV", "throw", 350, false},
	{"medkit", "MEDKIT", "heal", 250, false},
}

const (
	idxMolotov = 7
	idxMedkit  = 8

	molCount   = 2
	molSpeed   = 15.0
	molFireR   = 2.4
	molFireT   = 6.0
	molBurnT   = 3.0
	molBurnDmg = 5
	molTick    = 0.5
	molCD      = 1.2
	throwG     = 16.0

	medHeal = 60
	medCD   = 20.0
)

type gunDef struct {
	dmg      int
	cooldown float64
	rng      float64
}
type meleeDef struct {
	dmg      int
	cooldown float64
	rng      float64
	push     float64
}

var guns = map[string]gunDef{"ak47": {9, 0.105, 60}, "pistol": {17, 0.26, 50}}
var melees = map[string]meleeDef{"hknife": {15, 0.55, 2.6, 0}, "bat": {24, 0.9, 2.9, 8}}

func owns(p *player, idx int) bool {
	if idx < 0 || idx >= len(items) {
		return false
	}
	it := items[idx]
	return it.Starter || has(statsOf(p.c.acc).Inv, it.ID)
}

func onBuy(c *conn, m M) {
	reply := func(text string, ok bool) { c.send(M{"t": "notice", "text": text, "ok": ok}) }
	id, _ := m["id"].(string)
	var it *itemDef
	for i := range items {
		if items[i].ID == id {
			it = &items[i]
		}
	}
	if it == nil || it.Starter {
		reply("this item is not for sale", false)
		return
	}
	st := statsOf(c.acc)
	if has(st.Inv, it.ID) {
		reply("you already own "+it.Name, false)
		return
	}
	if st.Stars < it.Price {
		reply("not enough stars: "+it.Name+" costs "+itoa(it.Price)+" ★", false)
		return
	}
	st.Stars -= it.Price
	st.Inv = append(st.Inv, it.ID)
	addNote(c.acc, "you bought "+it.Name+" for "+itoa(it.Price)+" ★")
	saveSoon()
	sendProfile(c)
	c.send(socialMsg(c.acc))
	c.send(M{"t": "bought", "id": it.ID})
	reply(it.Name+" added to your inventory", true)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s, neg := "", n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}

func solid(x, y, z int) bool {
	if y < 0 {
		return true
	}
	if x < 0 || z < 0 || x >= W || z >= D {
		return true
	}
	if y >= H {
		return false
	}
	return voxels[vid(x, y, z)] != 0
}
func groundBelow(x, y, z float64) float64 {
	gx, gz := int(math.Floor(x)), int(math.Floor(z))
	for yy := min(H-1, int(math.Floor(y))); yy >= 0; yy-- {
		if solid(gx, yy, gz) {
			return float64(yy + 1)
		}
	}
	return 0
}

// ── guns ──
func onFire(p *player, m M) {
	t := now()
	wf, _ := m["w"].(float64)
	w := int(wf)
	if p.Dead || w < 0 || w >= len(items) || items[w].Kind != "gun" || !owns(p, w) {
		return
	}
	g := guns[items[w].ID]
	if p.lastFire == nil {
		p.lastFire = map[int]float64{}
	}
	if t-p.lastFire[w] < g.cooldown*0.75 {
		return
	}
	p.lastFire[w] = t
	d, ok := norm(m["d"])
	if !ok {
		return
	}
	o := [3]float64{p.X, p.Y + eyeH, p.Z}
	broadcast(M{"t": "fx", "k": "shot", "w": w, "id": p.ID, "o": r3v(o), "pel": [][3]float64{r3v(d)}}, p.c)
	h := traceHit(p, o, d, g.rng, bodyR+0.04)
	if h == nil || t < h.p.protUntil {
		return
	}
	damage(h.p, p, g.dmg, items[w].ID, [][4]float64{woundFor(h.p, h.point, 0)}, [][3]float64{r3v(h.point)})
}

// ── hunting knife / bat ──
func onMelee(p *player, m M) {
	t := now()
	wf, _ := m["w"].(float64)
	w := int(wf)
	if p.Dead || w < 0 || w >= len(items) || items[w].Kind != "melee" || !owns(p, w) {
		return
	}
	md := melees[items[w].ID]
	if t-p.lastMelee < md.cooldown-0.1 {
		return
	}
	p.lastMelee = t
	d, ok := norm(m["d"])
	if !ok {
		return
	}
	o := [3]float64{p.X, p.Y + eyeH, p.Z}
	broadcast(M{"t": "fx", "k": "melee", "w": w, "id": p.ID}, p.c)
	h := traceHit(p, o, d, md.rng, bodyR+0.32)
	if h == nil || t < h.p.protUntil {
		return
	}
	tg := h.p
	base := woundFor(tg, h.point, 1)
	side := 1.0
	if s, ok := m["side"].(float64); ok && s == -1 {
		side = -1
	}
	n, typ := 2, 1.0
	if items[w].ID == "bat" {
		n, typ = 1, 0
	}
	var wounds [][4]float64
	for i := -n; i <= n; i++ {
		a := float64(i) * 0.13 * side
		c, s := math.Cos(a), math.Sin(a)
		wounds = append(wounds, [4]float64{r3(base[0]*c + base[2]*s), r3(base[1] + float64(i)*0.06), r3(-base[0]*s + base[2]*c), typ})
	}
	damage(tg, p, md.dmg, items[w].ID, wounds, [][3]float64{r3v(h.point)})
	if md.push > 0 && !tg.Dead {
		px, pz := tg.X-p.X, tg.Z-p.Z
		l := math.Hypot(px, pz)
		if l == 0 {
			l = 1
		}
		tg.c.send(M{"t": "push", "vx": r3(px / l * md.push), "vy": 3.6, "vz": r3(pz / l * md.push)})
	}
}

// ── molotov: the server flies the bottle, then the ground burns ──
type fireZone struct {
	x, y, z, r, until float64
	by                *player
}
type pendingFire struct {
	at, x, y, z float64
	hit, by     *player
}

var fires []*fireZone
var pendingFires []*pendingFire

func fireMsg(f *fireZone) M {
	by := 0
	if f.by != nil {
		by = f.by.ID
	}
	return M{"t": "fire", "x": r3(f.x), "y": r3(f.y), "z": r3(f.z), "r": f.r, "life": r3(math.Max(0, f.until-now())), "by": by}
}
func firesList() []M {
	out := []M{}
	for _, f := range fires {
		out = append(out, fireMsg(f))
	}
	return out
}

func onThrow(p *player, m M) {
	t := now()
	if p.Dead || !owns(p, idxMolotov) || p.molotovs <= 0 || t-p.lastThrow < molCD-0.2 {
		return
	}
	d, ok := norm(m["d"])
	if !ok {
		return
	}
	p.lastThrow = t
	p.molotovs--
	o := [3]float64{p.X + d[0]*0.5, p.Y + eyeH - 0.1 + d[1]*0.5, p.Z + d[2]*0.5}
	v := [3]float64{d[0] * molSpeed, d[1]*molSpeed + 3.2, d[2] * molSpeed}
	// same simulation as throwPath() in shared/world.js
	x, y, z, vx, vy, vz := o[0], o[1], o[2], v[0], v[1], v[2]
	const h = 1.0 / 60
	pf := &pendingFire{by: p}
	tt := 0.0
	done := false
	for ; tt < 4 && !done; tt += h {
		nx, ny, nz := x+vx*h, y+vy*h, z+vz*h
		if ny <= 0 || solid(int(math.Floor(nx)), int(math.Floor(ny)), int(math.Floor(nz))) {
			pf.x, pf.y, pf.z = x, groundBelow(x, y, z), z
			done = true
			break
		}
		for _, q := range players {
			if q != p && !q.Dead && math.Sqrt((nx-q.X)*(nx-q.X)+(ny-q.Y-bodyCY)*(ny-q.Y-bodyCY)+(nz-q.Z)*(nz-q.Z)) < bodyR+0.1 {
				pf.x, pf.y, pf.z, pf.hit = q.X, q.Y, q.Z, q
				done = true
				break
			}
		}
		if done {
			break
		}
		x, y, z = nx, ny, nz
		vy -= throwG * h
	}
	if !done {
		pf.x, pf.y, pf.z = x, math.Max(0, y), z
	}
	pf.at = t + tt
	broadcast(M{"t": "throw", "id": p.ID, "o": r3v(o), "v": r3v(v), "left": p.molotovs}, nil)
	pendingFires = append(pendingFires, pf)
}

func burn(tg, by *player) {
	if tg == by || tg.Dead || matchPhase != "play" {
		return
	}
	was := tg.burnUntil > now()
	tg.burnUntil = now() + molBurnT
	tg.burnBy = by
	if !was {
		tg.burnTick = now() + 0.15
	}
}

func onMedkit(p *player) {
	t := now()
	if p.Dead || !owns(p, idxMedkit) || t-p.lastMed < medCD-0.5 {
		return
	}
	p.lastMed = t
	p.HP = min(maxHP, p.HP+medHeal)
	p.burnUntil = 0
	broadcast(M{"t": "heal", "id": p.ID, "hp": p.HP, "w": idxMedkit}, nil)
}

func fireTick(t float64) {
	keep := pendingFires[:0]
	var ready []*pendingFire
	for _, pf := range pendingFires {
		if t >= pf.at {
			ready = append(ready, pf)
		} else {
			keep = append(keep, pf)
		}
	}
	pendingFires = keep
	for _, pf := range ready {
		y := pf.y
		if pf.hit != nil {
			y = pf.hit.Y
		}
		f := &fireZone{pf.x, y, pf.z, molFireR, now() + molFireT, pf.by}
		fires = append(fires, f)
		broadcast(fireMsg(f), nil)
		if pf.hit != nil && !pf.hit.Dead {
			burn(pf.hit, pf.by)
		}
	}
	alive := fires[:0]
	for _, f := range fires {
		if t > f.until {
			continue
		}
		alive = append(alive, f)
		for _, q := range players {
			if !q.Dead && math.Hypot(q.X-f.x, q.Z-f.z) < f.r && q.Y >= f.y-0.6 && q.Y < f.y+1.4 {
				burn(q, f.by)
			}
		}
	}
	fires = alive
	for _, q := range players {
		if q.Dead || q.burnUntil <= t {
			continue
		}
		if t >= q.burnTick {
			q.burnTick = t + molTick
			damage(q, q.burnBy, molBurnDmg, "fire", [][4]float64{}, [][3]float64{})
		}
	}
}
