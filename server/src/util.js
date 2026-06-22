// Wrap an async Express handler so thrown errors / rejections forward to
// the error middleware instead of unhandled-rejection-killing the process.
export const a = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
