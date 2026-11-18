package httpapi

import (
	"bytes"
	"hash/fnv"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
)

const coverStyleVersion = 1

const (
	coverGrid  = 64
	coverScale = 8
)

func fnvHash(s string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return h.Sum64()
}

var coverDefaults = map[string][]string{
	"daily":      {"#e86a4f", "#f2b45a", "#6a5acd"},
	"your_song":  {"#d94b6a", "#f29bb2", "#7a3b69"},
	"morning":    {"#f6c35b", "#f39a6b", "#7ec4cf"},
	"afternoon":  {"#4fa3d9", "#7cc6e8", "#f6d36b"},
	"evening":    {"#e0734f", "#b24b7a", "#3d3a78"},
	"late_night": {"#1f2a5a", "#3c3f8f", "#6c5fc7"},
	"happy":      {"#f7c948", "#f08a4b", "#5cc9a7"},
	"calm":       {"#7fb8d6", "#a8d5ba", "#4a6fa5"},
	"sad":        {"#5b6c8f", "#8ea3c4", "#2f3b55"},
	"energetic":  {"#ef476f", "#ffd166", "#118ab2"},
	"rediscover": {"#c9a227", "#8c5e3c", "#4f7c6b"},
}

var coverLines = map[string][]string{
	"daily":      {"DAILY", "MIX"},
	"your_song":  {"MORE LIKE", "OUR SONG"},
	"morning":    {"MORNING"},
	"afternoon":  {"AFTERNOON"},
	"evening":    {"EVENING"},
	"late_night": {"LATE", "NIGHT"},
	"happy":      {"HAPPY"},
	"calm":       {"CALM"},
	"sad":        {"SAD"},
	"energetic":  {"ENERGETIC"},
	"rediscover": {"REDISCOVER"},
}

func hexColor(s string) (color.RGBA, bool) {
	s = strings.TrimPrefix(s, "#")
	if len(s) != 6 {
		return color.RGBA{}, false
	}
	var v [3]uint8
	for i := 0; i < 3; i++ {
		var b uint8
		for _, c := range s[i*2 : i*2+2] {
			b <<= 4
			switch {
			case c >= '0' && c <= '9':
				b |= uint8(c - '0')
			case c >= 'a' && c <= 'f':
				b |= uint8(c-'a') + 10
			case c >= 'A' && c <= 'F':
				b |= uint8(c-'A') + 10
			default:
				return color.RGBA{}, false
			}
		}
		v[i] = b
	}
	return color.RGBA{v[0], v[1], v[2], 255}, true
}

func shade(c color.RGBA, f float64) color.RGBA {
	m := func(x uint8) uint8 { return uint8(math.Max(0, math.Min(255, float64(x)*f))) }
	return color.RGBA{m(c.R), m(c.G), m(c.B), 255}
}

func luma(c color.RGBA) float64 {
	return 0.2126*float64(c.R) + 0.7152*float64(c.G) + 0.0722*float64(c.B)
}

var bayer = [4][4]float64{{0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5}}

type canvas struct {
	px [coverGrid][coverGrid]color.RGBA
}

type layer [coverGrid][coverGrid]color.RGBA

func (l *layer) set(x, y int, c color.RGBA) {
	if x >= 0 && y >= 0 && x < coverGrid && y < coverGrid {
		l[y][x] = c
	}
}

func (l *layer) disc(cx, cy, r float64, c color.RGBA) {
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			if math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy) <= r {
				l[y][x] = c
			}
		}
	}
}

func (l *layer) ring(cx, cy, r float64, c color.RGBA) {
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			d := math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy)
			if d <= r && d > r-1 && l[y][x].A != 0 {
				l[y][x] = c
			}
		}
	}
}

func (l *layer) erase(cx, cy, r float64) {
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			if math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy) <= r {
				l[y][x] = color.RGBA{}
			}
		}
	}
}

func (l *layer) poly(pts [][2]float64, c color.RGBA) {
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			in := false
			for i, j := 0, len(pts)-1; i < len(pts); j, i = i, i+1 {
				a, b := pts[i], pts[j]
				if (a[1] > py) != (b[1] > py) && px < (b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0] {
					in = !in
				}
			}
			if in {
				l[y][x] = c
			}
		}
	}
}

func (l *layer) rect(x0, y0, x1, y1 int, c color.RGBA) {
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			l.set(x, y, c)
		}
	}
}

func (l *layer) grid(x0, y0 int, rows []string, colors map[rune]color.RGBA) {
	for y, row := range rows {
		for x, ch := range row {
			if c, ok := colors[ch]; ok {
				l.set(x0+x, y0+y, c)
			}
		}
	}
}

func (cv *canvas) stamp(l *layer, ink color.RGBA) {
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			if l[y][x].A != 0 {
				continue
			}
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nx, ny := x+d[0], y+d[1]
				if nx >= 0 && ny >= 0 && nx < coverGrid && ny < coverGrid && l[ny][nx].A != 0 {
					cv.px[y][x] = ink
					break
				}
			}
		}
	}
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			if l[y][x].A != 0 {
				cv.px[y][x] = l[y][x]
			}
		}
	}
}

var (
	white  = color.RGBA{255, 250, 240, 255}
	cream  = color.RGBA{244, 236, 203, 255}
	yellow = color.RGBA{255, 211, 77, 255}
	amber  = color.RGBA{232, 163, 43, 255}
	pink   = color.RGBA{255, 92, 122, 255}
	vinyl  = color.RGBA{28, 28, 36, 255}
	groove = color.RGBA{50, 50, 64, 255}
	cloud  = color.RGBA{214, 222, 238, 255}
	rain   = color.RGBA{127, 178, 255, 255}
	leaf   = color.RGBA{90, 163, 107, 255}
	leaf2  = color.RGBA{63, 127, 82, 255}
	brown  = color.RGBA{138, 90, 43, 255}
)

func illustrate(kind string, cx, cy int, accent color.RGBA) *layer {
	l := &layer{}
	fx, fy := float64(cx), float64(cy)
	switch kind {
	case "daily":
		l.disc(fx, fy, 14, vinyl)
		l.ring(fx, fy, 11, groove)
		l.ring(fx, fy, 8, groove)
		l.disc(fx, fy, 5, accent)
		l.disc(fx, fy, 1, vinyl)
		l.set(cx-9, cy-7, groove)
		l.set(cx-8, cy-9, groove)
		l.set(cx-10, cy-5, white)
		l.set(cx-11, cy-3, white)
	case "your_song":
		l.disc(fx-6, fy-4, 7.5, pink)
		l.disc(fx+6, fy-4, 7.5, pink)
		l.poly([][2]float64{{fx - 13.2, fy - 2}, {fx + 13.2, fy - 2}, {fx, fy + 13}}, pink)
		l.rect(cx-9, cy-8, cx-8, cy-7, white)
		l.set(cx-10, cy-6, white)
	case "morning":
		l.disc(fx, fy+1, 9, yellow)
		l.ring(fx, fy+1, 9, amber)
		for x := 0; x < coverGrid; x++ {
			far := fy + 5 + 3*math.Sin(float64(x)/7)
			near := fy + 9 + 2*math.Cos(float64(x)/5+1)
			for y := int(far); y <= cy+13; y++ {
				if float64(y) >= near {
					l.set(x, y, leaf2)
				} else {
					l.set(x, y, leaf)
				}
			}
		}
	case "afternoon":
		l.disc(fx, fy, 9, yellow)
		l.ring(fx, fy, 9, amber)
		for i := 0; i < 8; i++ {
			a := float64(i) * math.Pi / 4
			for r := 12.0; r <= 15; r++ {
				l.set(cx+int(math.Round(r*math.Cos(a))), cy+int(math.Round(r*math.Sin(a))), yellow)
			}
		}
	case "evening":
		sun := color.RGBA{255, 138, 92, 255}
		for y := 0; y < coverGrid; y++ {
			for x := 0; x < coverGrid; x++ {
				if y <= cy+2 && math.Hypot(float64(x)+0.5-fx, float64(y)+0.5-fy-2) <= 11 {
					l[y][x] = sun
				}
			}
		}
		for i, y := range []int{cy + 5, cy + 8, cy + 11} {
			w := 13 - i*3
			for x := cx - w; x <= cx+w; x++ {
				l.set(x, y, sun)
			}
		}
	case "late_night":
		l.disc(fx, fy, 10, cream)
		l.erase(fx+5, fy-3, 8.5)
		for _, s := range [][2]int{{cx + 9, cy - 9}, {cx + 13, cy + 3}, {cx - 14, cy - 11}, {cx + 4, cy + 10}} {
			l.set(s[0], s[1], white)
			l.set(s[0]-1, s[1], cream)
			l.set(s[0]+1, s[1], cream)
			l.set(s[0], s[1]-1, cream)
			l.set(s[0], s[1]+1, cream)
		}
	case "happy":
		for i := 0; i < 8; i++ {
			a := float64(i) * math.Pi / 4
			l.disc(fx+8*math.Cos(a), fy+8*math.Sin(a), 4.2, yellow)
		}
		l.disc(fx, fy, 6, brown)
		l.set(cx-2, cy-1, vinyl)
		l.set(cx+2, cy-1, vinyl)
		l.rect(cx-2, cy+2, cx+2, cy+2, vinyl)
		l.set(cx-3, cy+1, vinyl)
		l.set(cx+3, cy+1, vinyl)
	case "calm":
		for row := 0; row < 3; row++ {
			y0 := fy - 6 + float64(row)*6
			for x := cx - 16; x <= cx+16; x++ {
				y := int(math.Round(y0 + 2*math.Sin(float64(x)/3+float64(row))))
				l.set(x, y, white)
				l.set(x, y+1, cloud)
			}
		}
	case "sad":
		l.disc(fx-5, fy-1, 6, cloud)
		l.disc(fx+3, fy-4, 7.5, cloud)
		l.disc(fx+10, fy, 5, cloud)
		l.rect(cx-11, cy+1, cx+14, cy+4, cloud)
		for i, x := range []int{cx - 8, cx - 2, cx + 4, cx + 10} {
			top := cy + 8 + (i%2)*3
			l.rect(x, top, x, top+2, rain)
		}
	case "energetic":
		l.poly([][2]float64{{fx + 4, fy - 15}, {fx - 8, fy + 2}, {fx - 1, fy + 2}, {fx - 5, fy + 15}, {fx + 9, fy - 3}, {fx + 2, fy - 3}, {fx + 8, fy - 15}}, yellow)
		l.set(cx+3, cy-12, white)
		l.set(cx+2, cy-11, white)
	case "rediscover":
		body := color.RGBA{232, 225, 209, 255}
		l.rect(cx-14, cy-9, cx+14, cy+9, body)
		l.rect(cx-11, cy-6, cx+11, cy+1, accent)
		l.rect(cx-7, cy-3, cx+7, cy, vinyl)
		l.disc(fx-4, fy-1.5, 2, white)
		l.disc(fx+4, fy-1.5, 2, white)
		l.rect(cx-8, cy+4, cx+8, cy+9, groove)
		l.rect(cx-6, cy+6, cx-5, cy+7, body)
		l.rect(cx+5, cy+6, cx+6, cy+7, body)
	}
	return l
}

var font5x7 = map[rune][7]string{
	'A': {".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"},
	'B': {"####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."},
	'C': {".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."},
	'D': {"####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."},
	'E': {"#####", "#....", "#....", "####.", "#....", "#....", "#####"},
	'F': {"#####", "#....", "#....", "####.", "#....", "#....", "#...."},
	'G': {".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"},
	'H': {"#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"},
	'I': {".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."},
	'J': {"..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."},
	'K': {"#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"},
	'L': {"#....", "#....", "#....", "#....", "#....", "#....", "#####"},
	'M': {"#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"},
	'N': {"#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"},
	'O': {".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."},
	'P': {"####.", "#...#", "#...#", "####.", "#....", "#....", "#...."},
	'Q': {".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"},
	'R': {"####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"},
	'S': {".####", "#....", "#....", ".###.", "....#", "....#", "####."},
	'T': {"#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."},
	'U': {"#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."},
	'V': {"#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."},
	'W': {"#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."},
	'X': {"#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"},
	'Y': {"#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."},
	'Z': {"#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"},
	'-': {".....", ".....", ".....", ".###.", ".....", ".....", "....."},
}

func textWidth(s string) int {
	w := 0
	for i, r := range s {
		if i > 0 {
			w++
		}
		if r == ' ' {
			w += 2
		} else {
			w += 5
		}
	}
	return w
}

func text(l *layer, s string, y int, c color.RGBA) {
	x := (coverGrid - textWidth(s)) / 2
	for _, r := range s {
		if r == ' ' {
			x += 3
			continue
		}
		g, ok := font5x7[r]
		if ok {
			for gy, row := range g {
				for gx, ch := range row {
					if ch == '#' {
						l.set(x+gx, y+gy, c)
					}
				}
			}
		}
		x += 6
	}
}

func RenderMixCover(kind string, palette []string) ([]byte, error) {
	var cols []color.RGBA
	defaults := coverDefaults[kind]
	if len(defaults) > 0 {
		if c, ok := hexColor(defaults[0]); ok {
			cols = append(cols, c)
		}
	}
	for _, h := range palette {
		if c, ok := hexColor(h); ok && len(cols) < 3 {
			cols = append(cols, c)
		}
	}
	for _, h := range defaults[min(1, len(defaults)):] {
		if c, ok := hexColor(h); ok && len(cols) < 3 {
			cols = append(cols, c)
		}
	}
	if len(cols) == 0 {
		cols = []color.RGBA{{90, 90, 140, 255}}
	}
	for len(cols) < 3 {
		cols = append(cols, shade(cols[len(cols)-1], 0.75))
	}
	if luma(cols[2]) > luma(cols[1]) {
		cols[1], cols[2] = cols[2], cols[1]
	}
	cv := &canvas{}
	for y := 0; y < coverGrid; y++ {
		t := float64(y) / float64(coverGrid-1) * 2
		i := int(math.Min(1, math.Floor(t)))
		f := t - float64(i)
		for x := 0; x < coverGrid; x++ {
			if f > (bayer[y%4][x%4]+0.5)/16 {
				cv.px[y][x] = cols[i+1]
			} else {
				cv.px[y][x] = cols[i]
			}
		}
	}
	ink := shade(cols[2], 0.3)
	lines := coverLines[kind]
	cy := 25
	if len(lines) > 1 {
		cy = 21
	}
	accent := cols[0]
	if luma(accent) < 60 {
		accent = shade(accent, 2.2)
	}
	cv.stamp(illustrate(kind, coverGrid/2, cy, accent), ink)
	t := &layer{}
	top := coverGrid - 4 - 7 - (len(lines)-1)*9
	for i, line := range lines {
		text(t, line, top+i*9, white)
	}
	cv.stamp(t, ink)

	img := image.NewRGBA(image.Rect(0, 0, coverGrid*coverScale, coverGrid*coverScale))
	for y := 0; y < coverGrid; y++ {
		for x := 0; x < coverGrid; x++ {
			c := cv.px[y][x]
			for dy := 0; dy < coverScale; dy++ {
				row := img.Pix[(y*coverScale+dy)*img.Stride:]
				for dx := 0; dx < coverScale; dx++ {
					o := (x*coverScale + dx) * 4
					row[o], row[o+1], row[o+2], row[o+3] = c.R, c.G, c.B, 255
				}
			}
		}
	}
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
