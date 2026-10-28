// dialects/index.js
// Dialect registry. The query builder delegates all engine-specific SQL
// fragments to the active dialect, so adding MySQL/MariaDB later only means
// implementing this same interface and registering it here.
//
// Dialect interface:
//   quoteIdent(name)               → safely quoted identifier
//   likeOperator(negated)          → case-insensitive LIKE operator
//   regexOperator()                → regex match operator (null if unsupported)
//   castNumeric(expr)              → cast expression to numeric for SUM/AVG/…
//   anyOperator(negated, paramIdx) → array membership operators (IN / NOT IN)
//   splitMultiValueLateral(sqlExpr, alias) → lateral join fragment that explodes
//                                            a comma-separated column into rows

const postgres = require('./postgres');

const dialects = {
  postgres,
};

let activeDialect = 'postgres';

function setDialect(name) {
  if (!dialects[name]) throw new Error(`Unknown SQL dialect: ${name}`);
  activeDialect = name;
}

function getDialect(name) {
  const d = name ? dialects[name] : dialects[activeDialect];
  if (!d) throw new Error(`Unknown SQL dialect: ${name || activeDialect}`);
  return d;
}

module.exports = { setDialect, getDialect, dialects };
