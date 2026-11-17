package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindProcessPhoto = "process_photo"

type PhotoPayload struct {
	PhotoID uuid.UUID `json:"photo_id"`
	Path    string    `json:"path"`
}

func ValidDay(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Year() >= 1900 && t.Year() <= 2100
}

func day(s *string) (*string, error) {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil, nil
	}
	v := strings.TrimSpace(*s)
	if !ValidDay(v) {
		return nil, fmt.Errorf("date %q must be YYYY-MM-DD", v)
	}
	return &v, nil
}

func checkText(name, v string, min, max int) error {
	n := utf8.RuneCountInString(v)
	if n < min || n > max {
		if min > 0 {
			return fmt.Errorf("%s of %d to %d characters", name, min, max)
		}
		return fmt.Errorf("%s of %d characters at most", name, max)
	}
	return nil
}

func mediaURL(sha, mime *string) *string {
	if sha == nil || mime == nil {
		return nil
	}
	u := "/api/media/" + *sha + "." + MediaExt[*mime]
	return &u
}

type Photo struct {
	ID          uuid.UUID  `json:"id"`
	AlbumID     *uuid.UUID `json:"album_id"`
	Status      string     `json:"status"`
	URL         *string    `json:"url"`
	ThumbURL    *string    `json:"thumb_url"`
	OriginalURL *string    `json:"original_url"`
	Width       *int32     `json:"width"`
	Height      *int32     `json:"height"`
	Color       *string    `json:"color"`
	Caption     string     `json:"caption"`
	TakenOn     *string    `json:"taken_on"`
	UploadedBy  uuid.UUID  `json:"uploaded_by"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
}

const photoCols = `p.id, p.album_id, p.status, d.sha256, d.mime, t.sha256, t.mime, o.sha256, o.mime, p.width, p.height,
	d.palette->0->>'hex', p.caption, to_char(p.taken_on, 'YYYY-MM-DD'), p.uploaded_by, p.placeholder, p.created_at`

const photoFrom = ` from photos p
	left join media_assets d on d.id = p.asset_id
	left join media_assets t on t.id = p.thumb_asset_id
	left join media_assets o on o.id = p.original_asset_id`

func scanPhoto(row pgx.CollectableRow) (Photo, error) {
	var p Photo
	var dSHA, dMime, tSHA, tMime, oSHA, oMime *string
	if err := row.Scan(&p.ID, &p.AlbumID, &p.Status, &dSHA, &dMime, &tSHA, &tMime, &oSHA, &oMime, &p.Width, &p.Height,
		&p.Color, &p.Caption, &p.TakenOn, &p.UploadedBy, &p.Placeholder, &p.CreatedAt); err != nil {
		return p, err
	}
	p.URL, p.ThumbURL, p.OriginalURL = mediaURL(dSHA, dMime), mediaURL(tSHA, tMime), mediaURL(oSHA, oMime)
	if p.ThumbURL == nil {
		p.ThumbURL = p.URL
	}
	return p, nil
}

func (s *Store) CreatePhoto(ctx context.Context, by uuid.UUID, albumID *uuid.UUID, path, caption string) (Photo, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Photo{}, err
	}
	defer tx.Rollback(ctx)
	id := newID()
	if _, err := tx.Exec(ctx, `insert into photos (id, album_id, position, original_path, caption, uploaded_by)
		values ($1, $2, coalesce((select max(position) + 1 from photos where album_id = $2), 0), $3, $4, $5)`,
		id, albumID, path, caption, by); err != nil {
		if isForeignKey(err) {
			return Photo{}, ErrNotFound
		}
		return Photo{}, err
	}
	if _, _, err := enqueue(ctx, tx, JobSpec{Kind: KindProcessPhoto, DedupeKey: "photo:" + id.String(), Priority: PriorityInteractive,
		Payload: PhotoPayload{PhotoID: id, Path: path}}); err != nil {
		return Photo{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Photo{}, err
	}
	return s.Photo(ctx, id, true)
}

func (s *Store) Photo(ctx context.Context, id uuid.UUID, withPlaceholders bool) (Photo, error) {
	rows, err := s.pool.Query(ctx, `select `+photoCols+photoFrom+` where p.id = $1 and (not p.placeholder or $2)`, id, withPlaceholders)
	if err != nil {
		return Photo{}, err
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanPhoto)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) photosByID(ctx context.Context, ids []uuid.UUID, withPlaceholders bool) (map[uuid.UUID]*Photo, error) {
	out := map[uuid.UUID]*Photo{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `select `+photoCols+photoFrom+` where p.id = any($1) and (not p.placeholder or $2)`, ids, withPlaceholders)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanPhoto)
	if err != nil {
		return nil, err
	}
	for i := range list {
		out[list[i].ID] = &list[i]
	}
	return out, nil
}

func (s *Store) attachPhotos(ctx context.Context, n int, idOf func(int) *uuid.UUID, set func(int, *Photo), withPlaceholders bool) error {
	var ids []uuid.UUID
	for i := 0; i < n; i++ {
		if id := idOf(i); id != nil {
			ids = append(ids, *id)
		}
	}
	photos, err := s.photosByID(ctx, ids, withPlaceholders)
	if err != nil {
		return err
	}
	for i := 0; i < n; i++ {
		if id := idOf(i); id != nil {
			set(i, photos[*id])
		}
	}
	return nil
}

func (s *Store) attachOptionalTracks(ctx context.Context, n int, idOf func(int) *uuid.UUID, set func(int, *TrackView)) error {
	var ids []uuid.UUID
	for i := 0; i < n; i++ {
		if id := idOf(i); id != nil {
			ids = append(ids, *id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	views, err := s.viewsByID(ctx, ids)
	if err != nil {
		return err
	}
	for i := 0; i < n; i++ {
		if id := idOf(i); id != nil {
			if v, ok := views[*id]; ok {
				set(i, &v)
			}
		}
	}
	return nil
}

func (s *Store) UpdatePhoto(ctx context.Context, id uuid.UUID, caption string, takenOn *string, withPlaceholders bool) error {
	tag, err := s.pool.Exec(ctx, `update photos set caption = $2, taken_on = $3::date, placeholder = false, updated_at = now()
		where id = $1 and (not placeholder or $4)`, id, caption, takenOn, withPlaceholders)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeletePhoto(ctx context.Context, id, by uuid.UUID, admin bool) error {
	tag, err := s.pool.Exec(ctx, `delete from photos where id = $1 and (uploaded_by = $2 or $3) and (not placeholder or $3)`, id, by, admin)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type PhotoResult struct {
	Original AssetResult `json:"original"`
	Display  AssetResult `json:"display"`
	Thumb    AssetResult `json:"thumb"`
	TakenOn  *string     `json:"taken_on"`
}

func (r *PhotoResult) Validate() error {
	for _, a := range []*AssetResult{&r.Original, &r.Display, &r.Thumb} {
		if err := validateImage(a, "photo"); err != nil {
			return err
		}
	}
	if r.TakenOn != nil && !ValidDay(*r.TakenOn) {
		r.TakenOn = nil
	}
	return nil
}

func completePhoto(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p PhotoPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r PhotoResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from photos where id = $1)`, p.PhotoID).Scan(&exists); err != nil || !exists {
		return err
	}
	ids := make([]uuid.UUID, 3)
	for i, a := range []AssetResult{r.Original, r.Display, r.Thumb} {
		id, err := insertAsset(ctx, tx, a)
		if err != nil {
			return err
		}
		ids[i] = id
	}
	_, err := tx.Exec(ctx, `update photos set status = 'ready', original_asset_id = $2, asset_id = $3, thumb_asset_id = $4,
		width = $5, height = $6, taken_on = coalesce(taken_on, $7::date), updated_at = now() where id = $1`,
		p.PhotoID, ids[0], ids[1], ids[2], r.Display.Width, r.Display.Height, r.TakenOn)
	return err
}

func failPhoto(ctx context.Context, tx pgx.Tx, payload []byte) error {
	var p PhotoPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `update photos set status = 'failed', updated_at = now() where id = $1`, p.PhotoID)
	return err
}

func (s *Store) SeedPhoto(ctx context.Context, by uuid.UUID, albumID *uuid.UUID, asset AssetResult, caption string, placeholder bool) (uuid.UUID, error) {
	if err := validateImage(&asset, "photo"); err != nil {
		return uuid.Nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	assetID, err := insertAsset(ctx, tx, asset)
	if err != nil {
		return uuid.Nil, err
	}
	id := newID()
	if _, err := tx.Exec(ctx, `insert into photos (id, album_id, position, status, asset_id, thumb_asset_id, original_asset_id,
			width, height, caption, uploaded_by, placeholder)
		values ($1, $2, coalesce((select max(position) + 1 from photos where album_id = $2), 0), 'ready', $3, $3, $3, $4, $5, $6, $7, $8)`,
		id, albumID, assetID, asset.Width, asset.Height, caption, by, placeholder); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

func pruneLoosePhotos(ctx context.Context, q querier, ids []uuid.UUID) error {
	if ids == nil {
		ids = []uuid.UUID{}
	}
	_, err := q.Exec(ctx, `delete from photos p where p.album_id is null
		and (p.id = any($1) or p.created_at < now() - interval '1 day')
		and not exists (select 1 from memories m where m.photo_id = p.id)
		and not exists (select 1 from places x where x.photo_id = p.id)
		and not exists (select 1 from glossary_entries g where g.photo_id = p.id)
		and not exists (select 1 from story_chapter_photos c where c.photo_id = p.id)
		and not exists (select 1 from photo_albums a where a.cover_photo_id = p.id)
		and not exists (select 1 from chat_messages c where c.kind = 'photo' and c.data->>'photo_id' = p.id::text)`, ids)
	return err
}

func optional(id *uuid.UUID) []uuid.UUID {
	if id == nil {
		return nil
	}
	return []uuid.UUID{*id}
}

type PhotoAlbum struct {
	ID           uuid.UUID  `json:"id"`
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	CoverPhotoID *uuid.UUID `json:"cover_photo_id"`
	TrackID      *uuid.UUID `json:"track_id"`
	CreatedBy    uuid.UUID  `json:"created_by"`
	Placeholder  bool       `json:"placeholder"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	PhotoCount   int        `json:"photo_count"`
	Cover        *Photo     `json:"cover"`
	Track        *TrackView `json:"track"`
}

type PhotoAlbumView struct {
	PhotoAlbum
	Photos []Photo `json:"photos"`
}

type AlbumInput struct {
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	TrackID      *uuid.UUID `json:"track_id"`
	CoverPhotoID *uuid.UUID `json:"cover_photo_id"`
}

func (in *AlbumInput) Validate() error {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	if err := checkText("name", in.Name, 1, 80); err != nil {
		return err
	}
	return checkText("description", in.Description, 0, 2000)
}

const albumSQL = `select a.id, a.name, a.description, a.cover_photo_id, a.track_id, a.created_by, a.placeholder, a.created_at, a.updated_at,
		(select count(*) from photos p where p.album_id = a.id and (not p.placeholder or $1)),
		coalesce(a.cover_photo_id, (select p.id from photos p where p.album_id = a.id and p.status = 'ready'
			and (not p.placeholder or $1) order by p.position, p.created_at limit 1))
	from photo_albums a where (not a.placeholder or $1)`

func (s *Store) scanAlbums(ctx context.Context, rows pgx.Rows, withPlaceholders bool) ([]PhotoAlbum, error) {
	covers := []*uuid.UUID{}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PhotoAlbum, error) {
		var a PhotoAlbum
		var cover *uuid.UUID
		err := row.Scan(&a.ID, &a.Name, &a.Description, &a.CoverPhotoID, &a.TrackID, &a.CreatedBy, &a.Placeholder, &a.CreatedAt, &a.UpdatedAt,
			&a.PhotoCount, &cover)
		covers = append(covers, cover)
		return a, err
	})
	if err != nil {
		return nil, err
	}
	if err := s.attachPhotos(ctx, len(list), func(i int) *uuid.UUID { return covers[i] }, func(i int, p *Photo) { list[i].Cover = p }, withPlaceholders); err != nil {
		return nil, err
	}
	return list, s.attachOptionalTracks(ctx, len(list), func(i int) *uuid.UUID { return list[i].TrackID }, func(i int, v *TrackView) { list[i].Track = v })
}

func (s *Store) PhotoAlbums(ctx context.Context, withPlaceholders bool) ([]PhotoAlbum, error) {
	rows, err := s.pool.Query(ctx, albumSQL+` order by a.created_at desc`, withPlaceholders)
	if err != nil {
		return nil, err
	}
	return s.scanAlbums(ctx, rows, withPlaceholders)
}

func (s *Store) PhotoAlbum(ctx context.Context, id uuid.UUID, withPlaceholders bool) (PhotoAlbumView, error) {
	rows, err := s.pool.Query(ctx, albumSQL+` and a.id = $2`, withPlaceholders, id)
	if err != nil {
		return PhotoAlbumView{}, err
	}
	list, err := s.scanAlbums(ctx, rows, withPlaceholders)
	if err != nil {
		return PhotoAlbumView{}, err
	}
	if len(list) == 0 {
		return PhotoAlbumView{}, ErrNotFound
	}
	rows, err = s.pool.Query(ctx, `select `+photoCols+photoFrom+` where p.album_id = $1 and (not p.placeholder or $2)
		order by p.position, p.created_at`, id, withPlaceholders)
	if err != nil {
		return PhotoAlbumView{}, err
	}
	photos, err := pgx.CollectRows(rows, scanPhoto)
	if err != nil {
		return PhotoAlbumView{}, err
	}
	return PhotoAlbumView{PhotoAlbum: list[0], Photos: photos}, nil
}

func (s *Store) CreatePhotoAlbum(ctx context.Context, by uuid.UUID, in AlbumInput, placeholder bool) (uuid.UUID, error) {
	id := newID()
	_, err := s.pool.Exec(ctx, `insert into photo_albums (id, name, description, track_id, created_by, placeholder) values ($1, $2, $3, $4, $5, $6)`,
		id, in.Name, in.Description, in.TrackID, by, placeholder)
	if isForeignKey(err) {
		return id, ErrNotFound
	}
	return id, err
}

func (s *Store) UpdatePhotoAlbum(ctx context.Context, id uuid.UUID, in AlbumInput, withPlaceholders bool) error {
	tag, err := s.pool.Exec(ctx, `update photo_albums set name = $2, description = $3, track_id = $4,
		cover_photo_id = (select p.id from photos p where p.id = $5 and p.album_id = $1),
		placeholder = false, updated_at = now()
		where id = $1 and (not placeholder or $6)`, id, in.Name, in.Description, in.TrackID, in.CoverPhotoID, withPlaceholders)
	if isForeignKey(err) {
		return ErrNotFound
	}
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeletePhotoAlbum(ctx context.Context, id, by uuid.UUID, admin bool) error {
	tag, err := s.pool.Exec(ctx, `delete from photo_albums where id = $1 and (created_by = $2 or $3) and (not placeholder or $3)`, id, by, admin)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) ReorderPhotos(ctx context.Context, albumID uuid.UUID, ids []uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `update photos p set position = o.n - 1, updated_at = now()
		from unnest($2::uuid[]) with ordinality as o(id, n) where p.id = o.id and p.album_id = $1`, albumID, ids)
	return err
}

type Memory struct {
	ID          uuid.UUID  `json:"id"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	Date        string     `json:"date"`
	Title       string     `json:"title"`
	Caption     string     `json:"caption"`
	PhotoID     *uuid.UUID `json:"photo_id"`
	TrackID     *uuid.UUID `json:"track_id"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Photo       *Photo     `json:"photo"`
	Track       *TrackView `json:"track"`
}

type MemoryInput struct {
	Date    string     `json:"date"`
	Title   string     `json:"title"`
	Caption string     `json:"caption"`
	PhotoID *uuid.UUID `json:"photo_id"`
	TrackID *uuid.UUID `json:"track_id"`
}

func (in *MemoryInput) Validate() error {
	in.Title, in.Caption, in.Date = strings.TrimSpace(in.Title), strings.TrimSpace(in.Caption), strings.TrimSpace(in.Date)
	if !ValidDay(in.Date) {
		return errors.New("date must be YYYY-MM-DD")
	}
	if err := checkText("title", in.Title, 1, 60); err != nil {
		return err
	}
	return checkText("caption", in.Caption, 0, 2000)
}

const memoryCols = `id, created_by, to_char(date, 'YYYY-MM-DD'), title, caption, photo_id, track_id, placeholder, created_at, updated_at`

func scanMemory(row pgx.CollectableRow) (Memory, error) {
	var m Memory
	return m, row.Scan(&m.ID, &m.CreatedBy, &m.Date, &m.Title, &m.Caption, &m.PhotoID, &m.TrackID, &m.Placeholder, &m.CreatedAt, &m.UpdatedAt)
}

func (s *Store) memories(ctx context.Context, withPlaceholders bool, suffix string, args ...any) ([]Memory, error) {
	rows, err := s.pool.Query(ctx, `select `+memoryCols+` from memories where (not placeholder or $1) `+suffix, append([]any{withPlaceholders}, args...)...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanMemory)
	if err != nil {
		return nil, err
	}
	if err := s.attachPhotos(ctx, len(list), func(i int) *uuid.UUID { return list[i].PhotoID }, func(i int, p *Photo) { list[i].Photo = p }, withPlaceholders); err != nil {
		return nil, err
	}
	return list, s.attachOptionalTracks(ctx, len(list), func(i int) *uuid.UUID { return list[i].TrackID }, func(i int, v *TrackView) { list[i].Track = v })
}

func (s *Store) Memories(ctx context.Context, withPlaceholders bool, limit int) ([]Memory, error) {
	if limit <= 0 {
		limit = 1000
	}
	return s.memories(ctx, withPlaceholders, `order by date desc, created_at desc limit $2`, limit)
}

func (s *Store) Memory(ctx context.Context, id uuid.UUID, withPlaceholders bool) (Memory, error) {
	list, err := s.memories(ctx, withPlaceholders, `and id = $2`, id)
	if err != nil {
		return Memory{}, err
	}
	if len(list) == 0 {
		return Memory{}, ErrNotFound
	}
	return list[0], nil
}

func (s *Store) CreateMemory(ctx context.Context, by uuid.UUID, in MemoryInput, placeholder bool) (uuid.UUID, error) {
	id := newID()
	_, err := s.pool.Exec(ctx, `insert into memories (id, created_by, date, title, caption, photo_id, track_id, placeholder)
		values ($1, $2, $3::date, $4, $5, $6, $7, $8)`, id, by, in.Date, in.Title, in.Caption, in.PhotoID, in.TrackID, placeholder)
	if isForeignKey(err) {
		return id, ErrNotFound
	}
	return id, err
}

func (s *Store) UpdateMemory(ctx context.Context, id uuid.UUID, in MemoryInput, withPlaceholders bool) error {
	return s.updateWithPhoto(ctx, "memories", id, withPlaceholders, in.PhotoID, `update memories set date = $3::date, title = $4, caption = $5,
		photo_id = $6, track_id = $7, placeholder = false, updated_at = now() where id = $1 and (not placeholder or $2)`,
		in.Date, in.Title, in.Caption, in.PhotoID, in.TrackID)
}

func (s *Store) updateWithPhoto(ctx context.Context, table string, id uuid.UUID, withPlaceholders bool, photoID *uuid.UUID, update string, args ...any) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var old *uuid.UUID
	if err := tx.QueryRow(ctx, `select photo_id from `+table+` where id = $1 for update`, id).Scan(&old); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	tag, err := tx.Exec(ctx, update, append([]any{id, withPlaceholders}, args...)...)
	if isForeignKey(err) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if old != nil && (photoID == nil || *old != *photoID) {
		if err := pruneLoosePhotos(ctx, tx, []uuid.UUID{*old}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) deleteWithPhoto(ctx context.Context, table string, id, by uuid.UUID, admin bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var photo *uuid.UUID
	err = tx.QueryRow(ctx, `delete from `+table+` where id = $1 and (created_by = $2 or $3) and (not placeholder or $3) returning photo_id`,
		id, by, admin).Scan(&photo)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := pruneLoosePhotos(ctx, tx, optional(photo)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteMemory(ctx context.Context, id, by uuid.UUID, admin bool) error {
	return s.deleteWithPhoto(ctx, "memories", id, by, admin)
}

type Place struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	Lat         float64    `json:"lat"`
	Lon         float64    `json:"lon"`
	Date        *string    `json:"date"`
	Note        string     `json:"note"`
	PhotoID     *uuid.UUID `json:"photo_id"`
	TrackID     *uuid.UUID `json:"track_id"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	Photo       *Photo     `json:"photo"`
	Track       *TrackView `json:"track"`
}

type PlaceInput struct {
	Name    string     `json:"name"`
	Lat     float64    `json:"lat"`
	Lon     float64    `json:"lon"`
	Date    *string    `json:"date"`
	Note    string     `json:"note"`
	PhotoID *uuid.UUID `json:"photo_id"`
	TrackID *uuid.UUID `json:"track_id"`
}

func (in *PlaceInput) Validate() error {
	in.Name, in.Note = strings.TrimSpace(in.Name), strings.TrimSpace(in.Note)
	if err := checkText("name", in.Name, 1, 80); err != nil {
		return err
	}
	if err := checkText("note", in.Note, 0, 2000); err != nil {
		return err
	}
	if in.Lat < -90 || in.Lat > 90 || in.Lon < -180 || in.Lon > 180 || (in.Lat == 0 && in.Lon == 0) {
		return errors.New("a place needs a position on the map")
	}
	var err error
	in.Date, err = day(in.Date)
	return err
}

func (s *Store) Places(ctx context.Context, withPlaceholders bool) ([]Place, error) {
	rows, err := s.pool.Query(ctx, `select id, name, lat, lon, to_char(date, 'YYYY-MM-DD'), note, photo_id, track_id, created_by, placeholder, created_at
		from places where (not placeholder or $1) order by date nulls last, created_at`, withPlaceholders)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Place, error) {
		var p Place
		return p, row.Scan(&p.ID, &p.Name, &p.Lat, &p.Lon, &p.Date, &p.Note, &p.PhotoID, &p.TrackID, &p.CreatedBy, &p.Placeholder, &p.CreatedAt)
	})
	if err != nil {
		return nil, err
	}
	if err := s.attachPhotos(ctx, len(list), func(i int) *uuid.UUID { return list[i].PhotoID }, func(i int, p *Photo) { list[i].Photo = p }, withPlaceholders); err != nil {
		return nil, err
	}
	return list, s.attachOptionalTracks(ctx, len(list), func(i int) *uuid.UUID { return list[i].TrackID }, func(i int, v *TrackView) { list[i].Track = v })
}

func (s *Store) CreatePlace(ctx context.Context, by uuid.UUID, in PlaceInput, placeholder bool) (uuid.UUID, error) {
	id := newID()
	_, err := s.pool.Exec(ctx, `insert into places (id, name, lat, lon, date, note, photo_id, track_id, created_by, placeholder)
		values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)`, id, in.Name, in.Lat, in.Lon, in.Date, in.Note, in.PhotoID, in.TrackID, by, placeholder)
	if isForeignKey(err) {
		return id, ErrNotFound
	}
	return id, err
}

func (s *Store) UpdatePlace(ctx context.Context, id uuid.UUID, in PlaceInput, withPlaceholders bool) error {
	return s.updateWithPhoto(ctx, "places", id, withPlaceholders, in.PhotoID, `update places set name = $3, lat = $4, lon = $5, date = $6::date,
		note = $7, photo_id = $8, track_id = $9, placeholder = false, updated_at = now() where id = $1 and (not placeholder or $2)`,
		in.Name, in.Lat, in.Lon, in.Date, in.Note, in.PhotoID, in.TrackID)
}

func (s *Store) DeletePlace(ctx context.Context, id, by uuid.UUID, admin bool) error {
	return s.deleteWithPhoto(ctx, "places", id, by, admin)
}

type Chapter struct {
	ID          uuid.UUID  `json:"id"`
	Position    int        `json:"position"`
	Title       string     `json:"title"`
	DateFrom    *string    `json:"date_from"`
	DateTo      *string    `json:"date_to"`
	Body        string     `json:"body"`
	TrackID     *uuid.UUID `json:"track_id"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Photos      []Photo    `json:"photos"`
	Track       *TrackView `json:"track"`
}

const maxChapterPhotos = 12

type ChapterInput struct {
	Title    string      `json:"title"`
	DateFrom *string     `json:"date_from"`
	DateTo   *string     `json:"date_to"`
	Body     string      `json:"body"`
	TrackID  *uuid.UUID  `json:"track_id"`
	PhotoIDs []uuid.UUID `json:"photo_ids"`
}

func (in *ChapterInput) Validate() error {
	in.Title, in.Body = strings.TrimSpace(in.Title), strings.TrimSpace(in.Body)
	if err := checkText("title", in.Title, 1, 80); err != nil {
		return err
	}
	if err := checkText("text", in.Body, 0, 20000); err != nil {
		return err
	}
	var err error
	if in.DateFrom, err = day(in.DateFrom); err != nil {
		return err
	}
	if in.DateTo, err = day(in.DateTo); err != nil {
		return err
	}
	if in.DateFrom != nil && in.DateTo != nil && *in.DateTo < *in.DateFrom {
		return errors.New("the end date is before the start date")
	}
	if len(in.PhotoIDs) > maxChapterPhotos {
		return fmt.Errorf("%d photos at most", maxChapterPhotos)
	}
	seen := map[uuid.UUID]bool{}
	ids := in.PhotoIDs[:0]
	for _, id := range in.PhotoIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	in.PhotoIDs = ids
	return nil
}

func (s *Store) Chapters(ctx context.Context, withPlaceholders bool) ([]Chapter, error) {
	rows, err := s.pool.Query(ctx, `select id, position, title, to_char(date_from, 'YYYY-MM-DD'), to_char(date_to, 'YYYY-MM-DD'), body, track_id,
		created_by, placeholder, created_at, updated_at from story_chapters where (not placeholder or $1) order by position, created_at`, withPlaceholders)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Chapter, error) {
		var c Chapter
		c.Photos = []Photo{}
		return c, row.Scan(&c.ID, &c.Position, &c.Title, &c.DateFrom, &c.DateTo, &c.Body, &c.TrackID, &c.CreatedBy, &c.Placeholder, &c.CreatedAt, &c.UpdatedAt)
	})
	if err != nil || len(list) == 0 {
		return list, err
	}
	rows, err = s.pool.Query(ctx, `select chapter_id, photo_id from story_chapter_photos order by chapter_id, position`)
	if err != nil {
		return nil, err
	}
	type link struct{ chapter, photo uuid.UUID }
	links, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (link, error) {
		var l link
		return l, row.Scan(&l.chapter, &l.photo)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(links))
	for i, l := range links {
		ids[i] = l.photo
	}
	photos, err := s.photosByID(ctx, ids, withPlaceholders)
	if err != nil {
		return nil, err
	}
	index := map[uuid.UUID]int{}
	for i := range list {
		index[list[i].ID] = i
	}
	for _, l := range links {
		if i, ok := index[l.chapter]; ok && photos[l.photo] != nil {
			list[i].Photos = append(list[i].Photos, *photos[l.photo])
		}
	}
	return list, s.attachOptionalTracks(ctx, len(list), func(i int) *uuid.UUID { return list[i].TrackID }, func(i int, v *TrackView) { list[i].Track = v })
}

func setChapterPhotos(ctx context.Context, tx pgx.Tx, chapterID uuid.UUID, ids []uuid.UUID) ([]uuid.UUID, error) {
	var old []uuid.UUID
	rows, err := tx.Query(ctx, `delete from story_chapter_photos where chapter_id = $1 returning photo_id`, chapterID)
	if err != nil {
		return nil, err
	}
	if old, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
		return nil, err
	}
	for i, id := range ids {
		if _, err := tx.Exec(ctx, `insert into story_chapter_photos (chapter_id, photo_id, position) values ($1, $2, $3)`, chapterID, id, i); err != nil {
			if isForeignKey(err) {
				return nil, ErrNotFound
			}
			return nil, err
		}
	}
	return old, nil
}

func (s *Store) CreateChapter(ctx context.Context, by uuid.UUID, in ChapterInput, placeholder bool) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	id := newID()
	if _, err := tx.Exec(ctx, `insert into story_chapters (id, position, title, date_from, date_to, body, track_id, created_by, placeholder)
		values ($1, coalesce((select max(position) + 1 from story_chapters), 0), $2, $3::date, $4::date, $5, $6, $7, $8)`,
		id, in.Title, in.DateFrom, in.DateTo, in.Body, in.TrackID, by, placeholder); err != nil {
		if isForeignKey(err) {
			return id, ErrNotFound
		}
		return id, err
	}
	if _, err := setChapterPhotos(ctx, tx, id, in.PhotoIDs); err != nil {
		return id, err
	}
	return id, tx.Commit(ctx)
}

func (s *Store) UpdateChapter(ctx context.Context, id uuid.UUID, in ChapterInput, withPlaceholders bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `update story_chapters set title = $3, date_from = $4::date, date_to = $5::date, body = $6, track_id = $7,
		placeholder = false, updated_at = now() where id = $1 and (not placeholder or $2)`,
		id, withPlaceholders, in.Title, in.DateFrom, in.DateTo, in.Body, in.TrackID)
	if isForeignKey(err) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	old, err := setChapterPhotos(ctx, tx, id, in.PhotoIDs)
	if err != nil {
		return err
	}
	if err := pruneLoosePhotos(ctx, tx, old); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteChapter(ctx context.Context, id, by uuid.UUID, admin bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select photo_id from story_chapter_photos where chapter_id = $1`, id)
	if err != nil {
		return err
	}
	photos, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `delete from story_chapters where id = $1 and (created_by = $2 or $3) and (not placeholder or $3)`, id, by, admin)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := pruneLoosePhotos(ctx, tx, photos); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ReorderChapters(ctx context.Context, ids []uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `update story_chapters c set position = o.n - 1
		from unnest($1::uuid[]) with ordinality as o(id, n) where c.id = o.id`, ids)
	return err
}

type CollectionItem struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	TrackID     uuid.UUID  `json:"track_id"`
	Reason      string     `json:"reason"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	Track       *TrackView `json:"track"`
}

const collectionCols = `id, user_id, track_id, reason, placeholder, created_at`

func scanCollectionItem(row pgx.CollectableRow) (CollectionItem, error) {
	var c CollectionItem
	return c, row.Scan(&c.ID, &c.UserID, &c.TrackID, &c.Reason, &c.Placeholder, &c.CreatedAt)
}

func (s *Store) CollectionItems(ctx context.Context, withPlaceholders bool) ([]CollectionItem, error) {
	rows, err := s.pool.Query(ctx, `select `+collectionCols+` from collection_items where (not placeholder or $1) order by created_at desc`, withPlaceholders)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanCollectionItem)
	if err != nil {
		return nil, err
	}
	return list, s.attachTracks(ctx, len(list), func(i int) uuid.UUID { return list[i].TrackID }, func(i int, v *TrackView) { list[i].Track = v })
}

func (s *Store) AddToCollection(ctx context.Context, userID, trackID uuid.UUID, reason string, placeholder bool) (CollectionItem, bool, error) {
	rows, err := s.pool.Query(ctx, `insert into collection_items (id, user_id, track_id, reason, placeholder) values ($1, $2, $3, $4, $5)
		on conflict (user_id, track_id) do nothing returning `+collectionCols, newID(), userID, trackID, reason, placeholder)
	if err != nil {
		if isForeignKey(err) {
			return CollectionItem{}, false, ErrNotFound
		}
		return CollectionItem{}, false, err
	}
	item, err := pgx.CollectExactlyOneRow(rows, scanCollectionItem)
	added := err == nil
	if errors.Is(err, pgx.ErrNoRows) {
		rows, err = s.pool.Query(ctx, `select `+collectionCols+` from collection_items where user_id = $1 and track_id = $2`, userID, trackID)
		if err != nil {
			return item, false, err
		}
		item, err = pgx.CollectExactlyOneRow(rows, scanCollectionItem)
	}
	if isForeignKey(err) {
		return item, false, ErrNotFound
	}
	if err != nil {
		return item, false, err
	}
	views, err := s.TracksByID(ctx, []uuid.UUID{trackID})
	if err == nil && len(views) > 0 {
		item.Track = &views[0]
	}
	return item, added, err
}

func (s *Store) UpdateCollectionItem(ctx context.Context, id, userID uuid.UUID, reason string) error {
	tag, err := s.pool.Exec(ctx, `update collection_items set reason = $3, placeholder = false, updated_at = now()
		where id = $1 and user_id = $2`, id, userID, reason)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) RemoveFromCollection(ctx context.Context, id, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from collection_items where id = $1 and user_id = $2`, id, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

var GlossaryKinds = map[string]bool{"joke": true, "nickname": true}

type GlossaryEntry struct {
	ID          uuid.UUID  `json:"id"`
	Kind        string     `json:"kind"`
	Term        string     `json:"term"`
	Body        string     `json:"body"`
	StartedOn   *string    `json:"started_on"`
	PhotoID     *uuid.UUID `json:"photo_id"`
	TrackID     *uuid.UUID `json:"track_id"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	Photo       *Photo     `json:"photo"`
	Track       *TrackView `json:"track"`
}

type GlossaryInput struct {
	Kind      string     `json:"kind"`
	Term      string     `json:"term"`
	Body      string     `json:"body"`
	StartedOn *string    `json:"started_on"`
	PhotoID   *uuid.UUID `json:"photo_id"`
	TrackID   *uuid.UUID `json:"track_id"`
}

func (in *GlossaryInput) Validate() error {
	in.Term, in.Body = strings.TrimSpace(in.Term), strings.TrimSpace(in.Body)
	if in.Kind == "" {
		in.Kind = "joke"
	}
	if !GlossaryKinds[in.Kind] {
		return errors.New("kind must be joke or nickname")
	}
	if err := checkText("term", in.Term, 1, 80); err != nil {
		return err
	}
	if err := checkText("meaning", in.Body, 0, 2000); err != nil {
		return err
	}
	var err error
	in.StartedOn, err = day(in.StartedOn)
	return err
}

func (s *Store) GlossaryEntries(ctx context.Context, withPlaceholders bool) ([]GlossaryEntry, error) {
	rows, err := s.pool.Query(ctx, `select id, kind, term, body, to_char(started_on, 'YYYY-MM-DD'), photo_id, track_id, created_by, placeholder, created_at
		from glossary_entries where (not placeholder or $1) order by lower(term), created_at`, withPlaceholders)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (GlossaryEntry, error) {
		var g GlossaryEntry
		return g, row.Scan(&g.ID, &g.Kind, &g.Term, &g.Body, &g.StartedOn, &g.PhotoID, &g.TrackID, &g.CreatedBy, &g.Placeholder, &g.CreatedAt)
	})
	if err != nil {
		return nil, err
	}
	if err := s.attachPhotos(ctx, len(list), func(i int) *uuid.UUID { return list[i].PhotoID }, func(i int, p *Photo) { list[i].Photo = p }, withPlaceholders); err != nil {
		return nil, err
	}
	return list, s.attachOptionalTracks(ctx, len(list), func(i int) *uuid.UUID { return list[i].TrackID }, func(i int, v *TrackView) { list[i].Track = v })
}

func (s *Store) CreateGlossaryEntry(ctx context.Context, by uuid.UUID, in GlossaryInput, placeholder bool) (uuid.UUID, error) {
	id := newID()
	_, err := s.pool.Exec(ctx, `insert into glossary_entries (id, kind, term, body, started_on, photo_id, track_id, created_by, placeholder)
		values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)`, id, in.Kind, in.Term, in.Body, in.StartedOn, in.PhotoID, in.TrackID, by, placeholder)
	if isForeignKey(err) {
		return id, ErrNotFound
	}
	return id, err
}

func (s *Store) UpdateGlossaryEntry(ctx context.Context, id uuid.UUID, in GlossaryInput, withPlaceholders bool) error {
	return s.updateWithPhoto(ctx, "glossary_entries", id, withPlaceholders, in.PhotoID, `update glossary_entries set kind = $3, term = $4,
		body = $5, started_on = $6::date, photo_id = $7, track_id = $8, placeholder = false, updated_at = now()
		where id = $1 and (not placeholder or $2)`, in.Kind, in.Term, in.Body, in.StartedOn, in.PhotoID, in.TrackID)
}

func (s *Store) DeleteGlossaryEntry(ctx context.Context, id, by uuid.UUID, admin bool) error {
	return s.deleteWithPhoto(ctx, "glossary_entries", id, by, admin)
}

type Moment struct {
	Kind    string     `json:"kind"`
	ID      *uuid.UUID `json:"id,omitempty"`
	Label   string     `json:"label"`
	Date    *string    `json:"date"`
	UserID  *uuid.UUID `json:"user_id,omitempty"`
	at      string
	trackID uuid.UUID
}

type SoundtrackItem struct {
	Track   *TrackView `json:"track"`
	Moments []Moment   `json:"moments"`
}

func orderMoments(moments []Moment) [][]Moment {
	sort.SliceStable(moments, func(i, j int) bool {
		a, b := moments[i], moments[j]
		if (a.Kind == "our_song") != (b.Kind == "our_song") {
			return a.Kind == "our_song"
		}
		return a.at < b.at
	})
	var out [][]Moment
	index := map[uuid.UUID]int{}
	for _, m := range moments {
		if i, ok := index[m.trackID]; ok {
			out[i] = append(out[i], m)
			continue
		}
		index[m.trackID] = len(out)
		out = append(out, []Moment{m})
	}
	return out
}

func (s *Store) Soundtrack(ctx context.Context, ourSong *uuid.UUID, tz string, withPlaceholders bool) ([]SoundtrackItem, error) {
	rows, err := s.pool.Query(ctx, `
		select 'chapter', c.id, c.track_id, c.title, to_char(c.date_from, 'YYYY-MM-DD'), c.created_by,
			to_char(coalesce(c.date_from, (c.created_at at time zone $2::text)::date), 'YYYY-MM-DD')
		from story_chapters c where c.track_id is not null and (not c.placeholder or $1)
		union all
		select 'memory', m.id, m.track_id, m.title, to_char(m.date, 'YYYY-MM-DD'), m.created_by, to_char(m.date, 'YYYY-MM-DD')
		from memories m where m.track_id is not null and (not m.placeholder or $1)
		union all
		select 'place', p.id, p.track_id, p.name, to_char(p.date, 'YYYY-MM-DD'), p.created_by,
			to_char(coalesce(p.date, (p.created_at at time zone $2::text)::date), 'YYYY-MM-DD')
		from places p where p.track_id is not null and (not p.placeholder or $1)
		union all
		select 'dedication', d.id, d.track_id, coalesce(nullif(d.note, ''), 'Dedication'),
			to_char((d.created_at at time zone $2::text)::date, 'YYYY-MM-DD'), d.author_id, to_char((d.created_at at time zone $2::text)::date, 'YYYY-MM-DD')
		from dedications d join voice_clips v on v.id = d.clip_id where v.status = 'ready'`, withPlaceholders, tz)
	if err != nil {
		return nil, err
	}
	moments, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Moment, error) {
		var m Moment
		var id, user uuid.UUID
		err := row.Scan(&m.Kind, &id, &m.trackID, &m.Label, &m.Date, &user, &m.at)
		m.ID, m.UserID = &id, &user
		return m, err
	})
	if err != nil {
		return nil, err
	}
	if ourSong != nil {
		moments = append(moments, Moment{Kind: "our_song", Label: "Our song", trackID: *ourSong})
	}
	groups := orderMoments(moments)
	ids := make([]uuid.UUID, len(groups))
	for i, g := range groups {
		ids[i] = g[0].trackID
	}
	views, err := s.viewsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := []SoundtrackItem{}
	for _, g := range groups {
		if v, ok := views[g[0].trackID]; ok {
			out = append(out, SoundtrackItem{Track: &v, Moments: g})
		}
	}
	return out, nil
}

type MemoryCounts struct {
	Memories int `json:"memories"`
	Photos   int `json:"photos"`
	Places   int `json:"places"`
	Chapters int `json:"chapters"`
}

func (s *Store) MemoryCounts(ctx context.Context, from, to time.Time, withPlaceholders bool) (MemoryCounts, error) {
	var c MemoryCounts
	err := s.pool.QueryRow(ctx, `select
		(select count(*) from memories where created_at >= $1 and created_at < $2 and (not placeholder or $3)),
		(select count(*) from photos where status = 'ready' and created_at >= $1 and created_at < $2 and (not placeholder or $3)),
		(select count(*) from places where created_at >= $1 and created_at < $2 and (not placeholder or $3)),
		(select count(*) from story_chapters where created_at >= $1 and created_at < $2 and (not placeholder or $3))`,
		from, to, withPlaceholders).Scan(&c.Memories, &c.Photos, &c.Places, &c.Chapters)
	return c, err
}

func (s *Store) HighlightedMemory(ctx context.Context, from, to time.Time, dayFrom, dayTo string, withPlaceholders bool) (*Memory, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `select m.id from memories m left join photos p on p.id = m.photo_id and p.status = 'ready' and (not p.placeholder or $5)
		where (not m.placeholder or $5) and ((m.date between $3::date and $4::date) or (m.created_at >= $1 and m.created_at < $2))
		order by (m.date between $3::date and $4::date) desc, (p.id is not null) desc, m.date desc, m.created_at desc limit 1`,
		from, to, dayFrom, dayTo, withPlaceholders).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m, err := s.Memory(ctx, id, withPlaceholders)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

var memoryTables = map[string]string{
	"memories":    "memories",
	"photos":      "photos",
	"albums":      "photo_albums",
	"places":      "places",
	"chapters":    "story_chapters",
	"collections": "collection_items",
	"glossary":    "glossary_entries",
}

type TableCount struct {
	Total        int `json:"total"`
	Placeholders int `json:"placeholders"`
}

func (s *Store) MemoryTableCounts(ctx context.Context) (map[string]TableCount, error) {
	out := map[string]TableCount{}
	for name, table := range memoryTables {
		var c TableCount
		if err := s.pool.QueryRow(ctx, `select count(*), count(*) filter (where placeholder) from `+table).Scan(&c.Total, &c.Placeholders); err != nil {
			return nil, err
		}
		out[name] = c
	}
	return out, nil
}

func (s *Store) PlaceholderTracks(ctx context.Context, n int) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `select t.id from tracks t join track_media tm on tm.track_id = t.id and tm.variant = 'main'
		order by md5(t.id::text) limit $1`, n)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

var placeholderCountSQL = map[string]string{
	"memories": `select count(*) from memories m left join photos p on p.id = m.photo_id
		where m.placeholder or coalesce(p.placeholder, false)`,
	"photo_albums": `select (select count(*) from photo_albums where placeholder)
		+ (select count(*) from photos where placeholder and album_id is not null)`,
	"places": `select count(*) from places x left join photos p on p.id = x.photo_id
		where x.placeholder or coalesce(p.placeholder, false)`,
	"story": `select count(*) from story_chapters c where c.placeholder or exists (select 1 from story_chapter_photos cp
		join photos p on p.id = cp.photo_id where cp.chapter_id = c.id and p.placeholder)`,
	"glossary": `select count(*) from glossary_entries g left join photos p on p.id = g.photo_id
		where g.placeholder or coalesce(p.placeholder, false)`,
	"collections": `select count(*) from collection_items where placeholder`,
}

func (s *Store) PlaceholderCount(ctx context.Context, set string) (int, error) {
	q, ok := placeholderCountSQL[set]
	if !ok {
		return 0, fmt.Errorf("unknown placeholder set %q", set)
	}
	var n int
	err := s.pool.QueryRow(ctx, q).Scan(&n)
	return n, err
}
