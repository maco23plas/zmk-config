// Cloudflare D1 用のドライバ。D1 は SQLite 互換なのでSQLはそのまま使える。
// 対話的なトランザクションが無いため、まとめ書きは batch()（アトミック）を使う。

export function d1Driver(binding) {
  return {
    binding,
    async all(sql, params = []) {
      const { results } = await binding.prepare(sql).bind(...params).all();
      return results || [];
    },
    async get(sql, params = []) {
      return (await binding.prepare(sql).bind(...params).first()) ?? null;
    },
    async run(sql, params = []) {
      const r = await binding.prepare(sql).bind(...params).run();
      return { changes: r.meta?.changes ?? 0, lastInsertRowid: r.meta?.last_row_id ?? 0 };
    },
    async batch(statements) {
      if (statements.length === 0) return;
      await binding.batch(statements.map((s) => binding.prepare(s.sql).bind(...(s.params || []))));
    },
  };
}
