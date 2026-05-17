'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const { getDb } = require('../db');
const config = require('../config');
const { validate, z } = require('../middleware/validate');
const { asyncHandler } = require('../utils/async');
const { signToken } = require('../middleware/auth');
const { conflict, unauthorized } = require('../utils/errors');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' },
});

const emailSchema = z
  .string({ required_error: 'email is required', invalid_type_error: 'email must be a string' })
  .trim()
  .toLowerCase()
  .min(3, 'email is too short')
  .max(254, 'email is too long')
  .email('email is not a valid address');

const passwordSchema = z
  .string({ required_error: 'password is required', invalid_type_error: 'password must be a string' })
  .min(8, 'password must be at least 8 characters')
  .max(128, 'password must be at most 128 characters');

const credentialsSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

// Login uses a looser password validator so we don't leak password policy via errors.
const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string({ required_error: 'password is required' }).min(1, 'password is required'),
  })
  .strict();

router.post(
  '/register',
  authLimiter,
  validate({ body: credentialsSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { email, password } = req.body;

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      throw conflict('A user with this email already exists');
    }

    const hash = await bcrypt.hash(password, config.bcrypt.rounds);
    const id = uuidv4();
    const now = new Date().toISOString();

    await db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [id, email, hash, now]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: { id, email, created_at: now },
    });
  })
);

router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { email, password } = req.body;

    const user = await db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email]);

    // Compare against a dummy hash when user is missing so timing is constant.
    const hash = user
      ? user.password_hash
      : '$2a$10$CwTycUXWue0Thq9StjUM0uJ8aE5jH1u2vEr8aF3eXmHj5Jr.5w8C2';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      throw unauthorized('Invalid email or password');
    }

    const token = signToken(user);
    res.status(200).json({ access_token: token, token_type: 'Bearer' });
  })
);

module.exports = router;
