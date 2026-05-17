'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { asyncHandler } = require('../utils/async');
const { badRequest, notFound, forbidden, conflict } = require('../utils/errors');

const router = express.Router();

router.use(authRequired);

// ---------- helpers ----------

function asBool(v) {
  return v === 1 || v === true || v === '1' || v === 'true';
}

function noteRowToDto(row, tags = []) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: asBool(row.pinned),
    archived: asBool(row.archived),
    tags,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getTagsFor(db, noteIds) {
  if (noteIds.length === 0) return new Map();
  const placeholders = noteIds.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders}) ORDER BY tag ASC`,
    noteIds
  );
  const map = new Map();
  for (const id of noteIds) map.set(id, []);
  for (const r of rows) map.get(r.note_id).push(r.tag);
  return map;
}

async function loadAccessibleNote(db, noteId, userId) {
  const note = await db.get('SELECT * FROM notes WHERE id = ?', [noteId]);
  if (!note) return { note: null, access: null };
  if (note.owner_id === userId) return { note, access: 'owner' };
  const share = await db.get(
    'SELECT permission FROM note_shares WHERE note_id = ? AND user_id = ?',
    [noteId, userId]
  );
  if (share) return { note, access: share.permission === 'write' ? 'write' : 'read' };
  return { note, access: null };
}

function normalizeTags(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  const cleaned = arr
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 32)
    .filter((t) => /^[a-z0-9][a-z0-9\-_]{0,31}$/.test(t));
  return Array.from(new Set(cleaned)).slice(0, 20);
}

async function replaceTags(db, noteId, tags) {
  await db.run('DELETE FROM note_tags WHERE note_id = ?', [noteId]);
  for (const tag of tags) {
    await db.run('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)', [noteId, tag]);
  }
}

async function snapshotVersion(db, note, editorId) {
  await db.run(
    'INSERT INTO note_versions (id, note_id, title, content, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), note.id, note.title, note.content, editorId, new Date().toISOString()]
  );
}

// ---------- schemas ----------

const idParam = z.object({
  id: z.string().uuid('id must be a valid UUID v4'),
});

const tagsSchema = z.array(z.string().max(32)).max(20).optional();

const createNoteSchema = z
  .object({
    title: z
      .string({ required_error: 'title is required' })
      .trim()
      .min(1, 'title must not be empty')
      .max(200, 'title must be at most 200 characters'),
    content: z
      .string({ invalid_type_error: 'content must be a string' })
      .max(100_000, 'content must be at most 100,000 characters')
      .default(''),
    tags: tagsSchema,
    pinned: z.boolean().optional(),
  })
  .strict();

const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(100_000).optional(),
    tags: tagsSchema,
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

const shareSchema = z
  .object({
    share_with_email: z
      .string({ required_error: 'share_with_email is required' })
      .trim()
      .toLowerCase()
      .email('share_with_email is not a valid address'),
    permission: z.enum(['read', 'write']).optional().default('read'),
  })
  .strict();

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    archived: z
      .enum(['true', 'false', 'all'])
      .optional()
      .default('false'),
    tag: z.string().trim().toLowerCase().max(32).optional(),
    shared: z.enum(['owned', 'shared', 'all']).optional().default('all'),
    sort: z.enum(['created_at', 'updated_at', 'title']).optional().default('updated_at'),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .strict()
  .passthrough();

// ---------- routes ----------

// GET /notes — list notes accessible to the user (owned + shared), with pagination, tag filter, etc.
router.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { page, limit, archived, tag, shared, sort, order } = req.query;
    const offset = (page - 1) * limit;

    // Build the access predicate.
    let accessClause;
    const accessParams = [];
    if (shared === 'owned') {
      accessClause = 'n.owner_id = ?';
      accessParams.push(userId);
    } else if (shared === 'shared') {
      accessClause = 'n.id IN (SELECT note_id FROM note_shares WHERE user_id = ?)';
      accessParams.push(userId);
    } else {
      accessClause =
        '(n.owner_id = ? OR n.id IN (SELECT note_id FROM note_shares WHERE user_id = ?))';
      accessParams.push(userId, userId);
    }

    const whereParts = [accessClause];
    const whereParams = [...accessParams];

    if (archived === 'true') {
      whereParts.push('n.archived = 1');
    } else if (archived === 'false') {
      whereParts.push('n.archived = 0');
    }

    if (tag) {
      whereParts.push('n.id IN (SELECT note_id FROM note_tags WHERE tag = ?)');
      whereParams.push(tag);
    }

    const whereSql = `WHERE ${whereParts.join(' AND ')}`;
    const orderSql = `ORDER BY n.pinned DESC, n.${sort} ${order.toUpperCase()}`;

    const countRow = await db.get(`SELECT COUNT(*) AS c FROM notes n ${whereSql}`, whereParams);
    const total = Number(countRow.c);

    const rows = await db.all(
      `SELECT n.* FROM notes n ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );

    const tagsMap = await getTagsFor(db, rows.map((r) => r.id));
    const items = rows.map((r) => noteRowToDto(r, tagsMap.get(r.id) || []));

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        has_next: offset + items.length < total,
        has_prev: page > 1,
      },
    });
  })
);

// GET /notes/:id — get a single note (owner or shared)
router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { note, access } = await loadAccessibleNote(db, req.params.id, req.user.id);
    if (!note) throw notFound('Note not found');
    if (!access) throw forbidden('You do not have access to this note');
    const tagsMap = await getTagsFor(db, [note.id]);
    res.json(noteRowToDto(note, tagsMap.get(note.id) || []));
  })
);

// POST /notes — create a new note
router.post(
  '/',
  validate({ body: createNoteSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    const tags = normalizeTags(req.body.tags);
    const pinned = req.body.pinned ? 1 : 0;

    await db.tx(async (tx) => {
      await tx.run(
        `INSERT INTO notes (id, owner_id, title, content, pinned, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, req.user.id, req.body.title, req.body.content ?? '', pinned, now, now]
      );
      for (const tag of tags) {
        await tx.run('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)', [id, tag]);
      }
    });

    const note = await db.get('SELECT * FROM notes WHERE id = ?', [id]);
    res.status(201).json(noteRowToDto(note, tags));
  })
);

// PUT /notes/:id — update a note (owner or writer)
router.put(
  '/:id',
  validate({ params: idParam, body: updateNoteSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { note, access } = await loadAccessibleNote(db, req.params.id, req.user.id);
    if (!note) throw notFound('Note not found');
    if (access !== 'owner' && access !== 'write') {
      throw forbidden('You do not have permission to edit this note');
    }

    const updates = [];
    const params = [];

    if (req.body.title !== undefined) {
      updates.push('title = ?');
      params.push(req.body.title);
    }
    if (req.body.content !== undefined) {
      updates.push('content = ?');
      params.push(req.body.content);
    }
    if (req.body.pinned !== undefined) {
      // Only the owner can pin/unpin
      if (access !== 'owner') throw forbidden('Only the owner can pin or unpin a note');
      updates.push('pinned = ?');
      params.push(req.body.pinned ? 1 : 0);
    }
    if (req.body.archived !== undefined) {
      if (access !== 'owner') throw forbidden('Only the owner can archive a note');
      updates.push('archived = ?');
      params.push(req.body.archived ? 1 : 0);
    }

    const now = new Date().toISOString();

    await db.tx(async (tx) => {
      // Take a version snapshot before any change (custom feature: version history)
      await snapshotVersion(tx, note, req.user.id);

      if (updates.length > 0) {
        updates.push('updated_at = ?');
        params.push(now);
        params.push(req.params.id);
        await tx.run(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`, params);
      } else if (req.body.tags !== undefined) {
        // tags-only change still bumps updated_at
        await tx.run('UPDATE notes SET updated_at = ? WHERE id = ?', [now, req.params.id]);
      }

      if (req.body.tags !== undefined) {
        if (access !== 'owner') throw forbidden('Only the owner can change tags');
        await replaceTags(tx, req.params.id, normalizeTags(req.body.tags));
      }
    });

    const fresh = await db.get('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    const tagsMap = await getTagsFor(db, [req.params.id]);
    res.json(noteRowToDto(fresh, tagsMap.get(req.params.id) || []));
  })
);

// DELETE /notes/:id — delete a note (owner only)
router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const note = await db.get('SELECT owner_id FROM notes WHERE id = ?', [req.params.id]);
    if (!note) throw notFound('Note not found');
    if (note.owner_id !== req.user.id) throw forbidden('Only the owner can delete this note');
    await db.run('DELETE FROM notes WHERE id = ?', [req.params.id]);
    res.status(204).end();
  })
);

// POST /notes/:id/share — share a note with another user
router.post(
  '/:id/share',
  validate({ params: idParam, body: shareSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const note = await db.get('SELECT owner_id FROM notes WHERE id = ?', [req.params.id]);
    if (!note) throw notFound('Note not found');
    if (note.owner_id !== req.user.id) throw forbidden('Only the owner can share this note');

    const target = await db.get('SELECT id, email FROM users WHERE email = ?', [
      req.body.share_with_email,
    ]);
    if (!target) throw notFound('User to share with not found');

    if (target.id === req.user.id) {
      throw badRequest('You cannot share a note with yourself');
    }

    const existing = await db.get(
      'SELECT permission FROM note_shares WHERE note_id = ? AND user_id = ?',
      [req.params.id, target.id]
    );

    if (existing) {
      // Update permission if it changed; otherwise it's a no-op.
      if (existing.permission !== req.body.permission) {
        await db.run(
          'UPDATE note_shares SET permission = ?, shared_at = ? WHERE note_id = ? AND user_id = ?',
          [req.body.permission, new Date().toISOString(), req.params.id, target.id]
        );
        return res.status(200).json({
          message: `Note share updated. ${target.email} now has '${req.body.permission}' access.`,
        });
      }
      throw conflict(`Note is already shared with ${target.email} (${existing.permission}).`);
    }

    await db.run(
      'INSERT INTO note_shares (note_id, user_id, permission, shared_at) VALUES (?, ?, ?, ?)',
      [req.params.id, target.id, req.body.permission, new Date().toISOString()]
    );

    res.status(200).json({
      message: `Note successfully shared with ${target.email} (${req.body.permission} access).`,
    });
  })
);

// DELETE /notes/:id/share — revoke a user's access
router.delete(
  '/:id/share',
  validate({
    params: idParam,
    body: z.object({ revoke_email: z.string().trim().toLowerCase().email() }).strict(),
  }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const note = await db.get('SELECT owner_id FROM notes WHERE id = ?', [req.params.id]);
    if (!note) throw notFound('Note not found');
    if (note.owner_id !== req.user.id) throw forbidden('Only the owner can manage shares');

    const target = await db.get('SELECT id FROM users WHERE email = ?', [req.body.revoke_email]);
    if (!target) throw notFound('User not found');

    const result = await db.run(
      'DELETE FROM note_shares WHERE note_id = ? AND user_id = ?',
      [req.params.id, target.id]
    );
    if (result.changes === 0) throw notFound('No active share for that user');
    res.json({ message: `Revoked access for ${req.body.revoke_email}` });
  })
);

// GET /notes/:id/shares — list users this note is shared with (owner only)
router.get(
  '/:id/shares',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const note = await db.get('SELECT owner_id FROM notes WHERE id = ?', [req.params.id]);
    if (!note) throw notFound('Note not found');
    if (note.owner_id !== req.user.id) throw forbidden('Only the owner can view shares');
    const shares = await db.all(
      `SELECT u.email, s.permission, s.shared_at
       FROM note_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.note_id = ?
       ORDER BY s.shared_at DESC`,
      [req.params.id]
    );
    res.json({ shares });
  })
);

// GET /notes/:id/versions — list version history (any user with access can view)
router.get(
  '/:id/versions',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { note, access } = await loadAccessibleNote(db, req.params.id, req.user.id);
    if (!note) throw notFound('Note not found');
    if (!access) throw forbidden('You do not have access to this note');
    const versions = await db.all(
      `SELECT v.id, v.title, v.content, v.edited_at, u.email AS edited_by_email
       FROM note_versions v
       JOIN users u ON u.id = v.edited_by
       WHERE v.note_id = ?
       ORDER BY v.edited_at DESC`,
      [req.params.id]
    );
    res.json({ versions });
  })
);

module.exports = router;
