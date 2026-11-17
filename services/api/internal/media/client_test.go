package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRadioPassesTheResultsThrough(t *testing.T) {
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/radio" {
			http.NotFound(w, r)
			return
		}
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"results":[{"provider":"ytmusic","external_id":"Brhya_OvTls","title":"Nesena"}]}`))
	}))
	defer srv.Close()
	body, err := New(srv.URL).Radio(context.Background(), "EFMOFo7apVk", 25)
	if err != nil {
		t.Fatal(err)
	}
	if query != "video_id=EFMOFo7apVk&limit=25" || string(body) != `{"results":[{"provider":"ytmusic","external_id":"Brhya_OvTls","title":"Nesena"}]}` {
		t.Errorf("query %q, body %s", query, body)
	}
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"detail":"radio failed"}`, http.StatusBadGateway)
	})
	if _, err := New(srv.URL).Radio(context.Background(), "EFMOFo7apVk", 25); err == nil {
		t.Error("a 502 from the media service is not an error")
	}
}

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
