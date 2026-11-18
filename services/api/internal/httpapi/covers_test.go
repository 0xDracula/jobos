package httpapi

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestRenderMixCover(t *testing.T) {
	out := os.Getenv("COVER_OUT")
	for kind := range coverLines {
		for name, palette := range map[string][]string{"default": nil, "artwork": {"#2f6f8f", "#d9a441", "#7b2d3b"}} {
			b, err := RenderMixCover(kind, palette)
			if err != nil {
				t.Fatalf("%s: %v", kind, err)
			}
			img, err := png.Decode(bytes.NewReader(b))
			if err != nil {
				t.Fatalf("%s: %v", kind, err)
			}
			if s := img.Bounds().Size(); s.X != 512 || s.Y != 512 {
				t.Fatalf("%s: size %v", kind, s)
			}
			if out != "" {
				if err := os.WriteFile(filepath.Join(out, kind+"-"+name+".png"), b, 0o644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}

func TestCoverTitlesFit(t *testing.T) {
	for kind, lines := range coverLines {
		for _, line := range lines {
			if w := textWidth(line); w > coverGrid-4 {
				t.Errorf("%s: %q is %d px wide", kind, line, w)
			}
			for _, r := range line {
				if _, ok := font5x7[r]; !ok && r != ' ' {
					t.Errorf("%s: no glyph for %q", kind, r)
				}
			}
		}
	}
}
