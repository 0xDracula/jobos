package world

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func TestCondition(t *testing.T) {
	cases := map[int]string{
		0: Clear, 1: Clear, 2: Clouds, 3: Clouds, 45: Fog, 48: Fog, 51: Drizzle, 57: Drizzle,
		61: Rain, 65: Rain, 67: Rain, 80: Rain, 82: Rain, 71: Snow, 77: Snow, 85: Snow, 86: Snow,
		95: Thunderstorm, 99: Thunderstorm,
	}
	for code, want := range cases {
		if got := Condition(code); got != want {
			t.Errorf("Condition(%d) = %s, want %s", code, got, want)
		}
	}
}

func TestPlaceValidate(t *testing.T) {
	if err := (Place{Name: "Cairo", Country: "Egypt", Lat: 30.06, Lon: 31.25}).Validate(); err != nil {
		t.Fatal(err)
	}
	for _, p := range []Place{{Name: "", Lat: 1}, {Name: "X", Lat: 91}, {Name: "X", Lon: -181}} {
		if p.Validate() == nil {
			t.Errorf("%+v should not validate", p)
		}
	}
}

func TestWeatherIsCached(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("current") == "" {
			t.Errorf("missing current fields: %s", r.URL)
		}
		_, _ = w.Write([]byte(`{"timezone":"Africa/Cairo","utc_offset_seconds":7200,
			"current":{"temperature_2m":19.4,"weather_code":61,"cloud_cover":90,"precipitation":0.6,"wind_speed_10m":11,"is_day":0}}`))
	}))
	defer srv.Close()
	o := NewOpenMeteo()
	o.ForecastURL = srv.URL
	ctx := context.Background()
	w, err := o.Weather(ctx, 30.0444, 31.2357)
	if err != nil {
		t.Fatal(err)
	}
	if w.Condition != Rain || w.TemperatureC != 19.4 || w.IsDay || w.Timezone != "Africa/Cairo" || w.UTCOffsetS != 7200 {
		t.Fatalf("unexpected weather %+v", w)
	}
	if _, err := o.Weather(ctx, 30.0431, 31.2402); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 upstream call, got %d", calls.Load())
	}
	o.weather["30.04,31.24"] = cachedWeather{w: *w, until: time.Now().Add(-time.Second)}
	if _, err := o.Weather(ctx, 30.0444, 31.2357); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected a refresh after expiry, got %d calls", calls.Load())
	}
}

func TestSearch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("name") != "Alexandria" {
			t.Errorf("unexpected query %s", r.URL)
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"Alexandria","admin1":"Alexandria","country":"Egypt","latitude":31.2,"longitude":29.92,"timezone":"Africa/Cairo"}]}`))
	}))
	defer srv.Close()
	o := NewOpenMeteo()
	o.GeocodingURL = srv.URL
	places, err := o.Search(context.Background(), " Alexandria ")
	if err != nil {
		t.Fatal(err)
	}
	if len(places) != 1 || places[0].Country != "Egypt" || places[0].Timezone != "Africa/Cairo" {
		t.Fatalf("unexpected places %+v", places)
	}
}

func TestLocatorSkipsPrivateAddresses(t *testing.T) {
	var l *Locator
	for _, s := range []string{"127.0.0.1", "10.0.0.2", "192.168.1.5", "::1", "8.8.8.8"} {
		if _, ok := l.City(netip.MustParseAddr(s)); ok {
			t.Errorf("nil locator found a city for %s", s)
		}
	}
	missing, err := OpenLocator("/nonexistent/dbip.mmdb")
	if err != nil || missing != nil {
		t.Fatalf("missing database should give a nil locator, got %v, %v", missing, err)
	}
}
