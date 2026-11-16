package world

import (
	"errors"
	"net/netip"
	"os"

	"github.com/oschwald/maxminddb-golang/v2"
)

type Locator struct {
	db *maxminddb.Reader
}

func OpenLocator(path string) (*Locator, error) {
	if path == "" {
		return nil, nil
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	db, err := maxminddb.Open(path)
	if err != nil {
		return nil, err
	}
	return &Locator{db: db}, nil
}

type cityRecord struct {
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
	Country struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"country"`
	Subdivisions []struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"subdivisions"`
	Location struct {
		Latitude  *float64 `maxminddb:"latitude"`
		Longitude *float64 `maxminddb:"longitude"`
		TimeZone  string   `maxminddb:"time_zone"`
	} `maxminddb:"location"`
}

func (l *Locator) City(ip netip.Addr) (Place, bool) {
	if l == nil || !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return Place{}, false
	}
	var rec cityRecord
	res := l.db.Lookup(ip.Unmap())
	if err := res.Decode(&rec); err != nil || !res.Found() {
		return Place{}, false
	}
	name := rec.City.Names["en"]
	if name == "" || rec.Location.Latitude == nil || rec.Location.Longitude == nil {
		return Place{}, false
	}
	p := Place{
		Name:     name,
		Country:  rec.Country.Names["en"],
		Lat:      *rec.Location.Latitude,
		Lon:      *rec.Location.Longitude,
		Timezone: rec.Location.TimeZone,
	}
	if len(rec.Subdivisions) > 0 {
		p.Region = rec.Subdivisions[0].Names["en"]
	}
	return p, true
}

func (l *Locator) Close() error {
	if l == nil {
		return nil
	}
	return l.db.Close()
}
