package world

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Weather struct {
	Condition       string    `json:"condition"`
	Code            int       `json:"code"`
	TemperatureC    float64   `json:"temperature_c"`
	CloudCover      int       `json:"cloud_cover"`
	PrecipitationMM float64   `json:"precipitation_mm"`
	WindKmh         float64   `json:"wind_kmh"`
	IsDay           bool      `json:"is_day"`
	Timezone        string    `json:"timezone"`
	UTCOffsetS      int       `json:"utc_offset_s"`
	FetchedAt       time.Time `json:"fetched_at"`
}

type OpenMeteo struct {
	ForecastURL  string
	GeocodingURL string
	UserAgent    string
	TTL          time.Duration
	http         *http.Client

	mu       sync.Mutex
	weather  map[string]cachedWeather
	searches map[string]cachedPlaces
}

type cachedWeather struct {
	w     Weather
	until time.Time
}

type cachedPlaces struct {
	p     []Place
	until time.Time
}

func NewOpenMeteo() *OpenMeteo {
	return &OpenMeteo{
		ForecastURL:  "https://api.open-meteo.com/v1/forecast",
		GeocodingURL: "https://geocoding-api.open-meteo.com/v1/search",
		UserAgent:    "Jobbos/0.1 (private music player)",
		TTL:          30 * time.Minute,
		http:         &http.Client{Timeout: 15 * time.Second},
		weather:      map[string]cachedWeather{},
		searches:     map[string]cachedPlaces{},
	}
}

func (o *OpenMeteo) get(ctx context.Context, u string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", o.UserAgent)
	resp, err := o.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("open-meteo: %d: %s", resp.StatusCode, body)
	}
	return json.Unmarshal(body, v)
}

func (o *OpenMeteo) Weather(ctx context.Context, lat, lon float64) (*Weather, error) {
	key := fmt.Sprintf("%.2f,%.2f", lat, lon)
	o.mu.Lock()
	hit, ok := o.weather[key]
	o.mu.Unlock()
	if ok && time.Now().Before(hit.until) {
		return &hit.w, nil
	}
	q := url.Values{
		"latitude":  {fmt.Sprintf("%.4f", lat)},
		"longitude": {fmt.Sprintf("%.4f", lon)},
		"current":   {"temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,is_day"},
		"timezone":  {"auto"},
	}
	var body struct {
		Timezone   string `json:"timezone"`
		UTCOffsetS int    `json:"utc_offset_seconds"`
		Current    struct {
			Temperature   float64 `json:"temperature_2m"`
			WeatherCode   int     `json:"weather_code"`
			CloudCover    int     `json:"cloud_cover"`
			Precipitation float64 `json:"precipitation"`
			WindSpeed     float64 `json:"wind_speed_10m"`
			IsDay         int     `json:"is_day"`
		} `json:"current"`
	}
	if err := o.get(ctx, o.ForecastURL+"?"+q.Encode(), &body); err != nil {
		if ok {
			return &hit.w, nil
		}
		return nil, err
	}
	c := body.Current
	w := Weather{
		Condition: Condition(c.WeatherCode), Code: c.WeatherCode, TemperatureC: c.Temperature, CloudCover: c.CloudCover,
		PrecipitationMM: c.Precipitation, WindKmh: c.WindSpeed, IsDay: c.IsDay == 1,
		Timezone: body.Timezone, UTCOffsetS: body.UTCOffsetS, FetchedAt: time.Now().UTC(),
	}
	o.mu.Lock()
	o.weather[key] = cachedWeather{w: w, until: time.Now().Add(o.TTL)}
	o.mu.Unlock()
	return &w, nil
}

func (o *OpenMeteo) Search(ctx context.Context, name string) ([]Place, error) {
	name = strings.TrimSpace(name)
	key := strings.ToLower(name)
	o.mu.Lock()
	hit, ok := o.searches[key]
	o.mu.Unlock()
	if ok && time.Now().Before(hit.until) {
		return hit.p, nil
	}
	q := url.Values{"name": {name}, "count": {"8"}, "language": {"en"}, "format": {"json"}}
	var body struct {
		Results []struct {
			Name      string  `json:"name"`
			Admin1    string  `json:"admin1"`
			Country   string  `json:"country"`
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
			Timezone  string  `json:"timezone"`
		} `json:"results"`
	}
	if err := o.get(ctx, o.GeocodingURL+"?"+q.Encode(), &body); err != nil {
		return nil, err
	}
	places := make([]Place, 0, len(body.Results))
	for _, r := range body.Results {
		places = append(places, Place{Name: r.Name, Region: r.Admin1, Country: r.Country, Lat: r.Latitude, Lon: r.Longitude, Timezone: r.Timezone})
	}
	o.mu.Lock()
	o.searches[key] = cachedPlaces{p: places, until: time.Now().Add(24 * time.Hour)}
	o.mu.Unlock()
	return places, nil
}
