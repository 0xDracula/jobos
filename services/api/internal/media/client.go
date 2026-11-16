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
	"strings"
	"time"
)

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: base, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) do(ctx context.Context, u string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, body, err
}

func (c *Client) get(ctx context.Context, u string) ([]byte, error) {
	status, body, err := c.do(ctx, u)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("media service: %d: %s", status, body)
	}
	return body, nil
}

func (c *Client) Search(ctx context.Context, query string, limit int, sources []string) (json.RawMessage, error) {
	u := c.base + "/search?q=" + url.QueryEscape(query) + "&limit=" + strconv.Itoa(limit)
	if len(sources) > 0 {
		u += "&sources=" + url.QueryEscape(strings.Join(sources, ","))
	}
	return c.get(ctx, u)
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

type LinkError struct{ Message string }

func (e *LinkError) Error() string { return e.Message }

type SpotifyArtist struct {
	Name      string  `json:"name"`
	SpotifyID *string `json:"spotify_id"`
}

type SpotifyTrack struct {
	SpotifyID      string          `json:"spotify_id"`
	Title          string          `json:"title"`
	Artists        []SpotifyArtist `json:"artists"`
	Album          string          `json:"album"`
	AlbumSpotifyID string          `json:"album_spotify_id"`
	ArtworkURL     *string         `json:"artwork_url"`
	DurationMs     *int32          `json:"duration_ms"`
	Explicit       bool            `json:"explicit"`
}

type Link struct {
	Kind       string          `json:"kind"`
	Provider   string          `json:"provider"`
	Type       string          `json:"type"`
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Tracks     []SpotifyTrack  `json:"tracks"`
	Truncated  bool            `json:"truncated"`
	Recording  json.RawMessage `json:"recording"`
	Recordings json.RawMessage `json:"recordings"`
}

func (c *Client) Link(ctx context.Context, link string) (*Link, error) {
	status, body, err := c.do(ctx, c.base+"/link?url="+url.QueryEscape(link))
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnprocessableEntity {
		var e struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(body, &e)
		return nil, &LinkError{Message: e.Detail}
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("media service: %d: %s", status, body)
	}
	var l Link
	return &l, json.Unmarshal(body, &l)
}

func (c *Client) Status(ctx context.Context) (json.RawMessage, error) {
	return c.get(ctx, c.base+"/status")
}
