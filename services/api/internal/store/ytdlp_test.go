package store

import "testing"

func TestYtdlpUpdateResultValidate(t *testing.T) {
	ok := []string{
		`{"result":"updated","version":"2026.11.15","previous":"2026.10.26","latest":"2026.11.15"}`,
		`{"result":"current","version":"2026.10.26.232112","previous":"2026.10.26.232112","latest":"2026.10.26.232112"}`,
	}
	for _, body := range ok {
		if err := completeYtdlpUpdate([]byte(body)); err != nil {
			t.Errorf("%s: %v", body, err)
		}
	}
	bad := []string{
		`{"result":"installed","version":"2026.11.15"}`,
		`{"result":"updated"}`,
		`{"result":"updated","version":"latest"}`,
		`{"result":"current","previous":"1.0"}`,
		`not json`,
	}
	for _, body := range bad {
		if err := completeYtdlpUpdate([]byte(body)); err == nil {
			t.Errorf("%s accepted", body)
		}
	}
}
