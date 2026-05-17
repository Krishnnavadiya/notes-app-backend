'use strict';

/** Wraps an async route handler so thrown errors are forwarded to next(). */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
