'use strict';

const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    const body = { message: err.message };
    if (err.details !== undefined) body.errors = err.details;
    return res.status(err.status).json(body);
  }

  // SyntaxError from express.json() on malformed JSON bodies
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }

  // eslint-disable-next-line no-console
  console.error('[error]', err);
  return res.status(500).json({ message: 'Internal Server Error' });
}

function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFoundHandler };
