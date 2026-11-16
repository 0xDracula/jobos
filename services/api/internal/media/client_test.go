package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveAcceptsOnlyYouTubeMediaHosts(t *testing.T) {
	for url, ok := range map[string]bool{
		"https://rr3---sn-x.googlevideo.com/videoplayback?itag=140": true,
		"http://rr3---sn-x.googlevideo.com/videoplayback":           false,
		"https://googlevideo.com.evil.example/videoplayback":        false,
		"https://127.0.0.1/videoplayback":                           false,
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"url":"` + url + `","mime":"audio/mp4","headers":{}}`))
		}))
		_, err := New(srv.URL).Resolve(context.Background(), "ytmusic", "abc")
		srv.Close()
		if (err == nil) != ok {
			t.Errorf("%s: err %v, want accepted=%v", url, err, ok)
		}
	}
}
