'use strict';

const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const { asyncHandler } = require('../utils/async');

const router = express.Router();

const searchSchema = z
  .object({
    q: z
      .string({ required_error: 'q query parameter is required' })
      .trim()
      .min(1, 'q must not be empty')
      .max(200, 'q is too long'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .passthrough();

router.get(
  '/',
  authRequired,
  validate({ query: searchSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { q, page, limit } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    // Escape LIKE special characters for safety.
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped.toLowerCase()}%`;

    const accessClause =
      '(n.owner_id = ? OR n.id IN (SELECT note_id FROM note_shares WHERE user_id = ?))';
    const matchClause =
      "(LOWER(n.title) LIKE ? ESCAPE '\\' OR LOWER(n.content) LIKE ? ESCAPE '\\')";

    const params = [userId, userId, pattern, pattern];

    const countRow = await db.get(
      `SELECT COUNT(*) AS c FROM notes n WHERE ${accessClause} AND ${matchClause}`,
      params
    );
    const total = Number(countRow.c);

    const rows = await db.all(
      `SELECT n.id, n.owner_id, n.title, n.content, n.pinned, n.archived, n.created_at, n.updated_at
       FROM notes n
       WHERE ${accessClause} AND ${matchClause}
       ORDER BY n.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      query: q,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        owner_id: r.owner_id,
        pinned: r.pinned === 1 || r.pinned === true,
        archived: r.archived === 1 || r.archived === true,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

module.exports = router;
