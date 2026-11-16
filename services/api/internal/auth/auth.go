package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory  = 64 * 1024
	argonTime    = 3
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16

	MinPasswordLen = 8
	SessionTTL     = 90 * 24 * time.Hour
	InviteTTL      = 30 * 24 * time.Hour
	ResetTTL       = 24 * time.Hour
	MaxSessions    = 10
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

func CheckPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func NewToken() (string, []byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	t := base64.RawURLEncoding.EncodeToString(b)
	return t, HashToken(t), nil
}

func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func PasswordProblem(password string) string {
	if len([]rune(password)) < MinPasswordLen {
		return "Password needs at least 8 characters"
	}
	if commonPasswords[strings.ToLower(password)] {
		return "Password is too common"
	}
	return ""
}

type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string][]time.Time{}}
}

func (l *Limiter) prune(key string, now time.Time) []time.Time {
	hs := l.hits[key]
	i := 0
	for i < len(hs) && now.Sub(hs[i]) >= l.window {
		i++
	}
	hs = hs[i:]
	if len(hs) == 0 {
		delete(l.hits, key)
	} else {
		l.hits[key] = hs
	}
	return hs
}

func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key, time.Now())) >= l.max
}

func (l *Limiter) Hit(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.hits[key] = append(l.prune(key, now), now)
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	hs := l.prune(key, now)
	if len(hs) >= l.max {
		return false
	}
	l.hits[key] = append(hs, now)
	return true
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

var commonPasswords = func() map[string]bool {
	m := map[string]bool{}
	for _, p := range strings.Fields(`123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon
		123123 baseball abc123 football monkey letmein 696969 shadow master 666666 qwertyuiop 123321
		mustang 1234567890 michael 654321 superman 1qaz2wsx 7777777 121212 000000 qazwsx 123qwe killer
		trustno1 jordan jennifer zxcvbnm asdfgh hunter buster soccer harley batman andrew tigger sunshine
		iloveyou 2000 charlie robert thomas hockey ranger daniel starwars klaster 112233 george computer
		michelle jessica pepper 1111 zxcvbn 555555 11111111 131313 freedom 777777 pass maggie 159753
		aaaaaa ginger princess joshua cheese amanda summer love ashley nicole chelsea biteme matthew
		access yankees 987654321 dallas austin thunder taylor matrix mobilemail mom monitor monitoring
		montana moon moscow password1 password123 qwerty123 welcome welcome1 admin admin123 iloveyou1
		11223344 1q2w3e4r 1q2w3e4r5t q1w2e3r4 passw0rd p@ssw0rd abcd1234 abcdefgh 87654321 88888888
		12341234 00000000 asdfghjkl lovely loveyou babygirl secret liverpool arsenal chocolate butterfly`) {
		m[p] = true
	}
	return m
}()
