'use strict';

const { z } = require('zod');
const { badRequest } = require('../utils/errors');

/**
 * Validate request parts against zod schemas. Replaces req[part] with the parsed result.
 *
 * Usage: router.post('/x', validate({ body: schema, query: schema, params: schema }), handler)
 */
function validate(schemas) {
  return (req, res, next) => {
    try {
      for (const part of ['body', 'query', 'params']) {
        if (schemas[part]) {
          const result = schemas[part].safeParse(req[part]);
          if (!result.success) {
            const issues = result.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
              code: i.code,
            }));
            return next(badRequest('Validation failed', issues));
          }
          req[part] = result.data;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validate, z };
