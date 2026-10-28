// middleware/requireHostUser.js
// Minimal guard for the saved-queries router: the host application's own auth
// middleware must already have resolved the user and set
//   req.user = { id, roleId }
// This middleware only rejects requests where that contract was not met.
// Hosts can replace it with their own stricter guard when mounting the router.

module.exports = function requireHostUser(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      error: 'dash-pivot: req.user is missing. Mount this router behind your authentication middleware and set req.user = { id, roleId }.',
    });
  }
  next();
};

module.exports.requireHostUser = module.exports;
