package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: base, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) get(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("media service: %s: %s", resp.Status, body)
	}
	return body, nil
}

func (c *Client) Search(ctx context.Context, query string, limit int) (json.RawMessage, error) {
	return c.get(ctx, c.base+"/search?q="+url.QueryEscape(query)+"&limit="+strconv.Itoa(limit))
}

type Stream struct {
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	Mime      string            `json:"mime"`
	Bytes     *int64            `json:"bytes"`
	ExpiresAt *int64            `json:"expires_at"`
}

var streamHostRE = regexp.MustCompile(`(^|\.)googlevideo\.com$`)

func (c *Client) Resolve(ctx context.Context, provider, externalID string) (*Stream, error) {
	body, err := c.get(ctx, c.base+"/resolve?provider="+url.QueryEscape(provider)+"&id="+url.QueryEscape(externalID))
	if err != nil {
		return nil, err
	}
	var s Stream
	if err := json.Unmarshal(body, &s); err != nil {
		return nil, err
	}
	u, err := url.Parse(s.URL)
	if err != nil || u.Scheme != "https" || !streamHostRE.MatchString(u.Hostname()) {
		return nil, errors.New("media service returned a stream URL on an unexpected host")
	}
	return &s, nil
}
