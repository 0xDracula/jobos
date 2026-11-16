package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

type Event struct {
	Type string          `json:"type"`
	ID   string          `json:"id,omitempty"`
	TS   int64           `json:"ts"`
	Data json.RawMessage `json:"data,omitempty"`
}

func NewEvent(typ string, data any) Event {
	raw, _ := json.Marshal(data)
	return Event{Type: typ, TS: time.Now().UnixMilli(), Data: raw}
}

type Handler func(ctx context.Context, user uuid.UUID, e Event, reply func(Event))

const (
	pingEvery    = 25 * time.Second
	onlineWindow = 45 * time.Second
	sendBuffer   = 64
)

type conn struct {
	user    uuid.UUID
	ws      *websocket.Conn
	send    chan []byte
	visible bool
	beat    time.Time
}

type PresenceChange struct {
	User     uuid.UUID
	Online   bool
	LastSeen time.Time
}

type Hub struct {
	mu             sync.Mutex
	conns          map[uuid.UUID]map[*conn]struct{}
	online         map[uuid.UUID]bool
	lastSeen       map[uuid.UUID]time.Time
	handlers       map[string]Handler
	OnPresence     func(PresenceChange)
	OriginPatterns []string
	Log            *slog.Logger
}

func NewHub(log *slog.Logger) *Hub {
	return &Hub{conns: map[uuid.UUID]map[*conn]struct{}{}, online: map[uuid.UUID]bool{}, lastSeen: map[uuid.UUID]time.Time{}, handlers: map[string]Handler{}, Log: log}
}

func (h *Hub) Handle(typ string, fn Handler) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.handlers[typ] = fn
}

func (h *Hub) Run(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	persist := time.NewTicker(5 * time.Minute)
	defer persist.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.checkPresence(false)
		case <-persist.C:
			h.checkPresence(true)
		}
	}
}

func (h *Hub) checkPresence(periodic bool) {
	now := time.Now()
	var changes []PresenceChange
	h.mu.Lock()
	users := map[uuid.UUID]bool{}
	for u := range h.conns {
		users[u] = true
	}
	for u := range h.online {
		users[u] = true
	}
	for u := range users {
		last := time.Time{}
		for c := range h.conns[u] {
			if c.beat.After(last) {
				last = c.beat
			}
		}
		if !last.IsZero() && last.After(h.lastSeen[u]) {
			h.lastSeen[u] = last
		}
		on := !last.IsZero() && now.Sub(last) < onlineWindow
		if on != h.online[u] || (periodic && on) {
			if on {
				h.online[u] = true
			} else {
				delete(h.online, u)
			}
			changes = append(changes, PresenceChange{User: u, Online: on, LastSeen: h.lastSeen[u]})
		}
	}
	h.mu.Unlock()
	if h.OnPresence != nil {
		for _, c := range changes {
			h.OnPresence(c)
		}
	}
}

func (h *Hub) Online(user uuid.UUID) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.online[user]
}

func (h *Hub) Connected(user uuid.UUID) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns[user]) > 0
}

func (h *Hub) Send(user uuid.UUID, e Event) {
	raw, err := json.Marshal(e)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns[user] {
		select {
		case c.send <- raw:
		default:
			go c.ws.Close(websocket.StatusPolicyViolation, "too slow")
		}
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, user uuid.UUID) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.OriginPatterns})
	if err != nil {
		return
	}
	ws.SetReadLimit(1 << 16)
	c := &conn{user: user, ws: ws, send: make(chan []byte, sendBuffer), visible: true, beat: time.Now()}
	h.mu.Lock()
	if h.conns[user] == nil {
		h.conns[user] = map[*conn]struct{}{}
	}
	h.conns[user][c] = struct{}{}
	h.mu.Unlock()
	h.checkPresence(false)

	ctx, cancel := context.WithCancel(r.Context())
	defer func() {
		cancel()
		h.mu.Lock()
		delete(h.conns[user], c)
		if len(h.conns[user]) == 0 {
			delete(h.conns, user)
		}
		h.mu.Unlock()
		h.checkPresence(false)
		_ = ws.CloseNow()
	}()
	go h.writeLoop(ctx, c)
	h.readLoop(ctx, c)
}

func (h *Hub) writeLoop(ctx context.Context, c *conn) {
	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case raw := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.ws.Write(wctx, websocket.MessageText, raw)
			cancel()
			if err != nil {
				_ = c.ws.CloseNow()
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.ws.Ping(pctx)
			cancel()
			if err != nil {
				_ = c.ws.CloseNow()
				return
			}
		}
	}
}

func (h *Hub) readLoop(ctx context.Context, c *conn) {
	for {
		_, raw, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		var e Event
		if json.Unmarshal(raw, &e) != nil || e.Type == "" {
			continue
		}
		if e.Type == "presence.heartbeat" {
			var d struct {
				Visible bool `json:"visible"`
			}
			_ = json.Unmarshal(e.Data, &d)
			h.mu.Lock()
			c.visible = d.Visible
			if d.Visible {
				c.beat = time.Now()
			}
			h.mu.Unlock()
			h.checkPresence(false)
			continue
		}
		h.mu.Lock()
		fn := h.handlers[e.Type]
		h.mu.Unlock()
		if fn == nil {
			continue
		}
		reply := func(out Event) {
			raw, err := json.Marshal(out)
			if err != nil {
				return
			}
			select {
			case c.send <- raw:
			default:
			}
		}
		func() {
			defer func() {
				if p := recover(); p != nil && h.Log != nil {
					h.Log.Error("realtime handler panicked", "type", e.Type, "panic", p)
				}
			}()
			fn(ctx, c.user, e, reply)
		}()
	}
}
