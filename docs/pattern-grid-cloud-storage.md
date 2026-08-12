# Editable Pattern Grid Cloud Storage Contract

## Scope

This contract stores the final editable bead grid, not an upload image or a rendered preview. The browser keeps every complete local record in IndexedDB until browser storage is cleared or a quota error occurs. Cloud history counts are free `10`, VIP `20`, and merchant VIP `25`.

`works.data` remains legacy-only. New grid saves must not write it. `thumbnail_url` is preview-only and cannot be used to recover a grid.

## D1 Migration

Add the following tables without changing existing `works` columns or deleting legacy data.

```sql
CREATE TABLE IF NOT EXISTS work_grid_revisions (
  work_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE')),
  format_version INTEGER NOT NULL,
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 900),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 900),
  board_size INTEGER NOT NULL,
  brand TEXT NOT NULL,
  title TEXT NOT NULL,
  total_beads INTEGER NOT NULL CHECK (total_beads >= 0),
  palette_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  descriptors_json TEXT NOT NULL,
  chunk_size INTEGER NOT NULL CHECK (chunk_size = 128),
  bits_per_cell INTEGER NOT NULL CHECK (bits_per_cell BETWEEN 1 AND 10),
  chunk_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  root_sha256 TEXT NOT NULL,
  project_created_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  finalized_at INTEGER,
  PRIMARY KEY (work_id, revision),
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_grid_chunks (
  work_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  codec TEXT NOT NULL CHECK (codec IN ('bit-pack-v1', 'rle-v1')),
  payload BLOB NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (work_id, revision, chunk_index),
  FOREIGN KEY (work_id, revision) REFERENCES work_grid_revisions(work_id, revision) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_previews (
  work_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  payload BLOB NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (work_id, revision),
  FOREIGN KEY (work_id, revision) REFERENCES work_grid_revisions(work_id, revision) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_grid_revisions_active
  ON work_grid_revisions(work_id, status, revision DESC);
CREATE INDEX IF NOT EXISTS idx_grid_pending_cleanup
  ON work_grid_revisions(status, created_at);
```

`work_previews` is optional for the first backend implementation. It may stay empty. It is explicitly not a recovery source.

## Browser Codec

The frontend creates `128 x 128` chunks and chooses the smaller real byte payload for each chunk:

- `bit-pack-v1`: row-major palette indexes, `0` is empty, palette indexes begin at `1`.
- `rle-v1`: row-major `(paletteIndex varint, runLength varint)` pairs.

Each chunk has a SHA-256 hash. `rootSha256` is SHA-256 over the concatenated 32-byte hashes ordered by `chunk_index`. Base64 is allowed only in the JSON request/response envelope and is never written to D1.

The frontend source of truth is `src/utils/patternGridCodec.ts`.

## API

All routes require JWT and must return `ApiResp<T>`. All ownership checks use the JWT user, never an id supplied by the client.

`POST /api/user-patterns/grid/init`

Request: `{ id, title, width, height, totalBeads, manifest }` where `manifest` excludes raw chunk payloads.

Behavior:

1. Validate grid dimensions, palette snapshot, settings snapshot, manifest geometry, hashes, and expected chunk count.
2. Create or update a `PENDING` revision; preserve the prior `ACTIVE` revision. `total_beads`, `settings_json`, and ordered `descriptors_json` are stored with the revision.
3. Upsert `works` metadata with no `data` payload.
4. Return `{ revision }`.

`POST /api/user-patterns/grid/chunk`

Request: `{ id, revision, index, codec, sha256, payloadBase64 }`.

Behavior: decode base64, verify its size and SHA-256, enforce expected descriptor metadata, then write a D1 BLOB. An identical retry is successful; a different payload for the same chunk returns `409`.

`POST /api/user-patterns/grid/finalize`

Request: `{ id, revision, rootSha256 }`.

Behavior: verify all chunks, lengths, individual hashes and root hash. In one D1 `batch`, mark this revision `ACTIVE`, remove the previous active revision/chunks, then apply the per-member work count. A new free/VIP/merchant record can evict the oldest active work only after this new revision is active. A failed init/chunk/finalize must leave all previous works intact.

`GET /api/user-patterns`

Returns metadata only, including `revision`; never chunks, preview data, `works.data`, or base64 image data.

`GET /api/user-patterns/grid/open?id=...`

Returns `{ work, manifest }` for the caller-owned active revision.

`GET /api/user-patterns/grid/chunk?id=...&revision=...&index=...`

Returns `{ index, codec, payloadBase64, sha256 }` for the caller-owned active revision only.

`POST /api/user-patterns/delete`

Deletes the caller-owned `works` record and cascading revisions/chunks/previews. Return `{ deleted }`.

## Count Rules

- `member_type = 0`: 10 active cloud works.
- `member_type = 1`: 20 active cloud works.
- `member_type = 2`: 25 active cloud works.

Remove the old `expire_at` based retention check from new grid routes. Existing legacy rows can remain untouched. The list should include active grid works, and legacy data only where current product compatibility requires it.

## Required Backend Tests

- JWT ownership: user A cannot initialize, upload, open, read chunks, finalize, or delete user B's work.
- Identical chunk retry is idempotent; a different retry is `409`.
- Invalid base64, chunk hash, root hash, missing chunk, wrong chunk dimensions, and invalid palette index are rejected.
- `1x1`, `128x128`, cross-boundary, and `900x900` manifests complete successfully.
- The 11th/21st/26th finalized work evicts only the oldest successful active work. A failed finalization retains every prior work.
- Read/decode results restore the original grid exactly.
