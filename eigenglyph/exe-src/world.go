package main

// Port of shared/world.js — map, raycast, body constants (server side).

import "math"

const (
	W = 48
	D = 48
	H = 8

	matFloor = 8

	bodyR   = 0.75
	bodyCY  = 0.75
	eyeH    = 1.3
	maxHP   = 100
	sgDmg   = 27
	sgCD    = 0.85
	sgRange = 40.0
	knDmg   = 7
	knCD    = 0.36
	knRange = 2.4
	sodaHeal = 25
	sodaCD  = 7.0
)

var voxels [W * D * H]uint8
var spawns [][3]float64

func vid(x, y, z int) int { return (y*D+z)*W + x }

func fill(x0, z0, x1, z1, y0, y1 int, m uint8) {
	ax, bx := min(x0, x1), max(x0, x1)
	az, bz := min(z0, z1), max(z0, z1)
	for y := y0; y < y1; y++ {
		for z := az; z <= bz; z++ {
			for x := ax; x <= bx; x++ {
				if x >= 0 && x < W && z >= 0 && z < D && y >= 0 && y < H {
					voxels[vid(x, y, z)] = m
				}
			}
		}
	}
}
func sym(x0, z0, x1, z1, y0, y1 int, m uint8) {
	mx := func(v int) int { return W - 1 - v }
	mz := func(v int) int { return D - 1 - v }
	fill(x0, z0, x1, z1, y0, y1, m)
	fill(mx(x0), z0, mx(x1), z1, y0, y1, m)
	fill(x0, mz(z0), x1, mz(z1), y0, y1, m)
	fill(mx(x0), mz(z0), mx(x1), mz(z1), y0, y1, m)
}
func sym8(x0, z0, x1, z1, y0, y1 int, m uint8) {
	sym(x0, z0, x1, z1, y0, y1, m)
	sym(z0, x0, z1, x1, y0, y1, m)
}

// must stay identical to shared/world.js build()
func buildWorld() {
	const (CONCRETE = 1; DARK = 2; CRATE = 3; PILLAR = 4; PANEL = 5; BORDER = 6; METAL = 7)
	fill(0, 0, W-1, 0, 0, 5, BORDER)
	fill(0, D-1, W-1, D-1, 0, 5, BORDER)
	fill(0, 0, 0, D-1, 0, 5, BORDER)
	fill(W-1, 0, W-1, D-1, 0, 5, BORDER)
	sym(1, 1, 2, 2, 0, 7, PILLAR)
	sym8(12, 4, 12, 6, 0, 1, CONCRETE)
	sym8(13, 4, 13, 6, 0, 2, CONCRETE)
	sym8(14, 4, 15, 6, 0, 3, CONCRETE)
	sym8(16, 4, 23, 6, 2, 3, DARK)
	sym8(17, 4, 22, 4, 3, 4, METAL)
	sym8(18, 18, 18, 18, 0, 6, PILLAR)
	fill(21, 21, 26, 26, 0, 1, DARK)
	fill(23, 23, 24, 24, 1, 2, METAL)
	fill(20, 20, 27, 20, 4, 5, DARK)
	fill(20, 27, 27, 27, 4, 5, DARK)
	fill(20, 20, 20, 27, 4, 5, DARK)
	fill(27, 20, 27, 27, 4, 5, DARK)
	sym8(9, 11, 14, 11, 0, 3, CONCRETE)
	sym8(9, 16, 9, 19, 0, 3, PANEL)
	sym8(4, 4, 5, 5, 0, 1, CRATE)
	sym8(4, 4, 4, 4, 1, 2, CRATE)
	sym8(8, 8, 8, 8, 0, 2, CRATE)
	sym8(22, 13, 22, 13, 0, 1, CRATE)
	sym8(11, 17, 11, 17, 0, 2, METAL)
	sym8(15, 15, 15, 15, 0, 1, CRATE)

	base := [][2]int{{3, 10}, {10, 3}, {9, 15}, {15, 9}, {20, 13}, {13, 20}}
	seen := map[[2]int]bool{}
	for _, b := range base {
		x, z := b[0], b[1]
		for _, c := range [][2]int{{x, z}, {W - 1 - x, z}, {x, D - 1 - z}, {W - 1 - x, D - 1 - z}} {
			if seen[c] {
				continue
			}
			seen[c] = true
			if voxels[vid(c[0], 0, c[1])] == 0 {
				spawns = append(spawns, [3]float64{float64(c[0]) + 0.5, 0, float64(c[1]) + 0.5})
			}
		}
	}
}

func raycast(ox, oy, oz, dx, dy, dz, maxT float64) float64 {
	x, y, z := int(math.Floor(ox)), int(math.Floor(oy)), int(math.Floor(oz))
	sx, sy, sz := 1, 1, 1
	if dx <= 0 { sx = -1 }
	if dy <= 0 { sy = -1 }
	if dz <= 0 { sz = -1 }
	inv := func(d float64) float64 {
		if d != 0 { return math.Abs(1 / d) }
		return 1e30
	}
	ddx, ddy, ddz := inv(dx), inv(dy), inv(dz)
	start := func(d, o float64, c int, dd float64) float64 {
		if d > 0 { return (float64(c) + 1 - o) * dd }
		if d < 0 { return (o - float64(c)) * dd }
		return 1e30
	}
	tx, ty, tz := start(dx, ox, x, ddx), start(dy, oy, y, ddy), start(dz, oz, z, ddz)
	t := 0.0
	for i := 0; i < 200; i++ {
		if tx < ty {
			if tx < tz { x += sx; t = tx; tx += ddx } else { z += sz; t = tz; tz += ddz }
		} else {
			if ty < tz { y += sy; t = ty; ty += ddy } else { z += sz; t = tz; tz += ddz }
		}
		if t > maxT { return -1 }
		if y < 0 { return t }
		if y >= H {
			if sy > 0 { return -1 }
			continue
		}
		if x < 0 || z < 0 || x >= W || z >= D {
			if dy >= 0 { return -1 }
			tf := -oy / dy
			if tf > maxT { return -1 }
			return tf
		}
		if voxels[vid(x, y, z)] != 0 { return t }
	}
	return -1
}

func raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r float64) float64 {
	lx, ly, lz := ox-cx, oy-cy, oz-cz
	b := lx*dx + ly*dy + lz*dz
	c := lx*lx + ly*ly + lz*lz - r*r
	h := b*b - c
	if h < 0 { return -1 }
	h = math.Sqrt(h)
	t := -b - h
	if t < 0 { t = -b + h }
	if t < 0 { return -1 }
	return t
}

func toLocal(vx, vy, vz, yaw float64) [3]float64 {
	fx, fz := -math.Sin(yaw), -math.Cos(yaw)
	rx, rz := math.Cos(yaw), -math.Sin(yaw)
	return [3]float64{vx*rx + vz*rz, vy, vx*fx + vz*fz}
}
