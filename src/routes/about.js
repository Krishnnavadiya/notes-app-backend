'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    name: config.about.name,
    email: config.about.email,
    'my features': {
      'Tags & filtering':
        'Notes can be tagged with up to 20 short labels and filtered via ?tag=foo. Tags add lightweight organization (like Apple Notes folders) without forcing the user into a strict hierarchy.',
      'Pin / unpin':
        'A boolean pinned flag bubbles important notes to the top of every list response. It mirrors Google Keep behaviour and dramatically improves retrieval of the few notes you actually use daily.',
      'Archive':
        'Soft-archive notes via an archived flag. They are hidden from the default list (?archived=false) but remain searchable and shareable. Encourages decluttering without destructive deletes.',
      'Version history':
        'Every PUT /notes/{id} writes a snapshot to note_versions before mutating. GET /notes/{id}/versions returns the audit trail with editor and timestamp. Critical for collaborative editing and accidental-overwrite recovery.',
      'Read vs write sharing':
        'POST /notes/{id}/share accepts a permission of "read" (default) or "write". This adds true collaboration semantics over a plain share-link model and is the foundation for safe multi-user editing.',
      'Full-text search':
        'GET /search?q=keyword runs a case-insensitive search across title and content of every note the user can access (owned + shared), paginated. Essential at scale; a notes app without search is unusable past ~50 notes.',
      'Pagination on list endpoints':
        'GET /notes and GET /search return a {items, pagination} envelope with page, limit, total, total_pages, has_next, has_prev. Bounded limit prevents accidental large responses.',
      'Strong validation & rate limiting':
        'All inputs are validated with zod; auth endpoints are rate-limited with express-rate-limit; login uses constant-time bcrypt compare even when the user is missing to prevent user-enumeration via timing.',
    },
  });
});

module.exports = router;
