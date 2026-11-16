package world

import (
	"errors"
	"math"
	"strings"
)

type Place struct {
	Name     string  `json:"name"`
	Region   string  `json:"region,omitempty"`
	Country  string  `json:"country"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Timezone string  `json:"timezone,omitempty"`
}

func (p Place) Validate() error {
	switch {
	case strings.TrimSpace(p.Name) == "" || len(p.Name) > 120 || len(p.Region) > 120 || len(p.Country) > 120:
		return errors.New("name of 120 characters at most is required")
	case math.IsNaN(p.Lat) || p.Lat < -90 || p.Lat > 90 || math.IsNaN(p.Lon) || p.Lon < -180 || p.Lon > 180:
		return errors.New("lat must be within ±90 and lon within ±180")
	case len(p.Timezone) > 64:
		return errors.New("timezone of 64 characters at most")
	}
	return nil
}

const (
	Clear        = "clear"
	Clouds       = "clouds"
	Fog          = "fog"
	Drizzle      = "drizzle"
	Rain         = "rain"
	Snow         = "snow"
	Thunderstorm = "thunderstorm"
)

func Condition(code int) string {
	switch {
	case code <= 1:
		return Clear
	case code <= 3:
		return Clouds
	case code == 45 || code == 48:
		return Fog
	case code >= 51 && code <= 57:
		return Drizzle
	case (code >= 61 && code <= 67) || (code >= 80 && code <= 82):
		return Rain
	case (code >= 71 && code <= 77) || code == 85 || code == 86:
		return Snow
	case code >= 95:
		return Thunderstorm
	}
	return Clouds
}
