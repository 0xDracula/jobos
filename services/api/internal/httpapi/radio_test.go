package httpapi

import (
	"testing"

	"jobbos/api/internal/world"
)

func TestWeatherTarget(t *testing.T) {
	cases := []struct {
		wx   world.Weather
		mood string
	}{
		{world.Weather{Condition: world.Rain, TemperatureC: 25, IsDay: true}, "mellow"},
		{world.Weather{Condition: world.Snow, TemperatureC: -2, IsDay: true}, "mellow"},
		{world.Weather{Condition: world.Fog, TemperatureC: 10, IsDay: false}, "mellow"},
		{world.Weather{Condition: world.Clear, TemperatureC: 28, IsDay: true}, "upbeat"},
		{world.Weather{Condition: world.Clear, TemperatureC: 12, IsDay: false}, "soft"},
	}
	for _, c := range cases {
		_, mood, energy, _ := weatherTarget(&c.wx)
		if mood != c.mood {
			t.Errorf("%s %v°C: %s, want %s", c.wx.Condition, c.wx.TemperatureC, mood, c.mood)
		}
		if mood == "mellow" && energy > 0.4 || mood == "upbeat" && energy < 0.6 {
			t.Errorf("%s: energy %v", mood, energy)
		}
	}
}
