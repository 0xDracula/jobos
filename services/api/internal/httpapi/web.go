package httpapi

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func webApp(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + r.URL.Path)
		full := filepath.Join(root, filepath.FromSlash(clean))
		if info, err := os.Stat(full); err != nil || (info.IsDir() && !exists(filepath.Join(full, "index.html"))) {
			if alt := full + ".html"; exists(alt) {
				r.URL.Path = clean + ".html"
			} else if page := linkPage(clean); page != "" && exists(filepath.Join(root, page, "index.html")) {
				r.URL.Path = "/" + page + "/"
			} else {
				w.Header().Set("Cache-Control", "no-cache")
				w.WriteHeader(http.StatusNotFound)
				if page, err := os.ReadFile(filepath.Join(root, "404.html")); err == nil {
					_, _ = w.Write(page)
				}
				return
			}
		}
		if strings.HasPrefix(clean, "/_next/static/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func linkPage(p string) string {
	for _, page := range []string{"invite", "reset"} {
		if strings.HasPrefix(p, "/"+page+"/") && len(p) > len(page)+2 {
			return page
		}
	}
	return ""
}
