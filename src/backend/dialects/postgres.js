// dialects/postgres.js
// PostgreSQL dialect implementation.

function quoteIdent(name) {
  // Reject anything that is not a plain identifier to prevent SQL injection
  // through schema/table/column names coming from the metadata tables.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

module.exports = {
  name: 'postgres',

  quoteIdent,

  likeOperator(negated) {
    return negated ? 'NOT ILIKE' : 'ILIKE';
  },

  regexOperator() {
    return '~'; // PostgreSQL POSIX regex operator
  },

  castNumeric(expr) {
    return `${expr}::numeric`;
  },

  anyOperator(negated, paramIdx) {
    return negated
      ? `!= ALL($${paramIdx})`
      : `= ANY($${paramIdx})`;
  },

  /**
   * Lateral join that explodes a comma-separated column into one row per value.
   * `sqlExpr` is the raw column expression, `alias` the lateral join alias.
   */
  splitMultiValueLateral(sqlExpr, alias) {
    return `LEFT JOIN LATERAL unnest(string_to_array(NULLIF(TRIM(${sqlExpr}), ''), ',')) AS ${alias}(val) ON true`;
  },

  /**
   * SELECT fragment + GROUP BY fragment for a multi-value column, using the
   * lateral alias produced above.
   */
  splitMultiValueSelect(alias) {
    const uAlias = `u_${alias}`;
    return {
      uAlias,
      select: `COALESCE(NULLIF(TRIM(${uAlias}.val), ''), 'Ninguno/Sin especificar') AS ${alias}`,
      groupBy: `COALESCE(NULLIF(TRIM(${uAlias}.val), ''), 'Ninguno/Sin especificar')`,
    };
  },
};
