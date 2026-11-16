package auth

import (
	"strings"
	"testing"
	"time"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("rooftop kitten")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Fatalf("unexpected hash format %q", hash)
	}
	if !CheckPassword(hash, "rooftop kitten") {
		t.Error("right password rejected")
	}
	if CheckPassword(hash, "rooftop kittens") || CheckPassword("garbage", "rooftop kitten") {
		t.Error("wrong password accepted")
	}
}

func TestPasswordProblem(t *testing.T) {
	for pw, ok := range map[string]bool{"short": false, "password1": false, "Qwerty123": false, "عصفور على السطح": true, "eight ch": true} {
		if got := PasswordProblem(pw) == ""; got != ok {
			t.Errorf("%q: accepted=%v, want %v", pw, got, ok)
		}
	}
}

func TestTokensAreRandomAndHashed(t *testing.T) {
	a, ha, _ := NewToken()
	b, _, _ := NewToken()
	if a == b || len(a) != 43 || string(HashToken(a)) != string(ha) {
		t.Errorf("tokens %q %q", a, b)
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(2, time.Hour)
	if !l.Allow("ip") || !l.Allow("ip") || l.Allow("ip") {
		t.Error("third event in the window allowed")
	}
	if !l.Allow("other") {
		t.Error("keys share a budget")
	}
	l.Hit("user")
	l.Hit("user")
	if !l.Blocked("user") {
		t.Error("not blocked after max hits")
	}
	l.Reset("user")
	if l.Blocked("user") {
		t.Error("still blocked after reset")
	}
}
