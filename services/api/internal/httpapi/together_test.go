package httpapi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestTogetherListsNeverNull(t *testing.T) {
	a := &api{}
	ctx := context.Background()
	a.roomOf(ctx).state = roomState{Active: true, SessionID: uuid.New()}
	b, err := json.Marshal(a.together(ctx))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"members":[]`, `"queue":[]`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("room state %s: missing %s", b, want)
		}
	}
}
