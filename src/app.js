'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { buildOpenApiSpec } = require('./openapi');

const authRoutes = require('./routes/auth');
const notesRoutes = require('./routes/notes');
const searchRoutes = require('./routes/search');
const aboutRoutes = require('./routes/about');

function createApp() {
  const app = express();

  // Render and many PaaS providers sit behind a proxy. Trust it for correct IPs.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Swagger UI loads its own assets; relax CSP for the docs route only (set per-route below).
      contentSecurityPolicy: false,
    })
  );
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  const globalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  });
  app.use(globalLimiter);

  app.get('/', (req, res) => {
    res.json({
      name: 'Notes App API',
      version: '1.0.0',
      docs: '/docs',
      openapi: '/openapi.json',
      about: '/about',
    });
  });

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  // Auth routes are mounted at the root so they match the spec: POST /register, POST /login
  app.use('/', authRoutes);

  app.use('/notes', notesRoutes);
  app.use('/search', searchRoutes);
  app.use('/about', aboutRoutes);

  // OpenAPI JSON spec
  app.get('/openapi.json', (req, res) => {
    res.json(buildOpenApiSpec());
  });

  // Swagger UI (served from swagger-ui-dist)
  const swaggerDist = require('swagger-ui-dist').getAbsoluteFSPath();
  app.use('/docs/static', express.static(swaggerDist));
  app.get('/docs', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Notes App API — Swagger UI</title>
  <link rel="stylesheet" href="/docs/static/swagger-ui.css">
  <style>html,body{margin:0;background:#fafafa}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/static/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 0,
    });
  </script>
</body>
</html>`);
  });

  // Static frontend (basic UI for the stretch goal)
  app.use('/ui', express.static(path.join(__dirname, '..', 'public')));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
