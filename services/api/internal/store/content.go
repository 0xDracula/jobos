package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ContentCount struct {
	Kind         string `json:"kind"`
	Total        int    `json:"total"`
	Placeholders int    `json:"placeholders"`
	Drafts       int    `json:"drafts"`
	Scheduled    int    `json:"scheduled"`
}

func (s *Store) ContentCounts(ctx context.Context, admin uuid.UUID) ([]ContentCount, error) {
	rows, err := s.pool.Query(ctx, `
		select 'welcome', count(*), 0, count(*) filter (where status = 'draft'), 0 from letters where kind = 'welcome' and author_id = $1
		union all select 'letters', count(*), count(*) filter (where placeholder), count(*) filter (where status = 'draft'),
			count(*) filter (where unlock_at > now()) from letters where kind <> 'welcome' and author_id = $1
		union all select 'notes:' || k, count(n.id), count(*) filter (where n.placeholder), 0,
			count(*) filter (where n.id is not null and n.available_on is null)
			from unnest(array['daily', 'morning', 'night']) k left join notes n on n.kind = k and n.author_id = $1 group by k
		union all select 'hidden_notes', count(*), 0, 0, count(*) filter (where unlock_at > now()) from hidden_notes where author_id = $1
		union all select 'song_notes', count(*), 0, 0, 0 from song_notes where author_id = $1
		union all select 'dedications', count(*), 0, 0, 0 from dedications where author_id = $1
		union all select 'mixtapes', count(*), 0, count(*) filter (where sent_at is null), 0 from mixtapes where from_user = $1
		union all select 'songs_of_the_day', count(*), count(*) filter (where placeholder), 0, count(*) filter (where date > current_date)
			from songs_of_the_day where author_id = $1 and not auto
		union all select 'promises', count(*), count(*) filter (where placeholder), 0, 0 from promises where author_id = $1
		union all select 'questions', count(*), 0, 0, count(*) filter (where asked_on is null) from daily_questions
		union all select 'memories', count(*), count(*) filter (where placeholder), 0, 0 from memories
		union all select 'story_chapters', count(*), count(*) filter (where placeholder), 0, 0 from story_chapters
		union all select 'places', count(*), count(*) filter (where placeholder), 0, 0 from places
		union all select 'glossary', count(*), count(*) filter (where placeholder), 0, 0 from glossary_entries
		union all select 'recap_notes', count(*), count(*) filter (where placeholder), 0, 0 from recap_notes where author_id = $1`, admin)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ContentCount, error) {
		var c ContentCount
		return c, r.Scan(&c.Kind, &c.Total, &c.Placeholders, &c.Drafts, &c.Scheduled)
	})
}
