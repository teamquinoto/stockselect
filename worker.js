/* ============================================================
   Mayor de Stock — API (Cloudflare Worker + D1)
   ------------------------------------------------------------
   Endpoints:
     POST /login  {user, pass}  -> valida admin, devuelve {token, space}
     GET  /state?space=...      -> lee el estado (requiere Bearer)
     PUT  /state?space=...      -> guarda con control de rev (Bearer)
   Secrets necesarios:
     TOKEN        -> token interno que la app usa como Bearer
     ADMIN_USER   -> usuario administrador
     ADMIN_PASS   -> contraseña del administrador
   ============================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");

      // ---------- LOGIN (sin Bearer) ----------
      if (path === "/login") {
        if (req.method !== "POST") return json({ error: "usá POST" }, 405);
        if (!env.ADMIN_USER || !env.ADMIN_PASS) {
          return json({ error: "config: faltan ADMIN_USER / ADMIN_PASS" }, 500);
        }
        let b;
        try { b = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
        const user = String((b && b.user) || "").trim();
        const pass = String((b && b.pass) || "");
        if (user === env.ADMIN_USER && pass === env.ADMIN_PASS) {
          return json({ ok: true, user, token: env.TOKEN, space: "main" });
        }
        return json({ error: "usuario o contraseña incorrectos" }, 401);
      }

      // ---------- A partir de acá se requiere Bearer + config ----------
      if (!env.DB) return json({ error: "config: falta el binding D1 'DB'" }, 500);
      if (!env.TOKEN) return json({ error: "config: falta el secret TOKEN" }, 500);

      const auth = req.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (token !== env.TOKEN) return json({ error: "no autorizado" }, 401);

      if (path !== "/state") return json({ error: "ruta no encontrada" }, 404);
      const space = (url.searchParams.get("space") || "main").slice(0, 64);

      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS estado (space TEXT PRIMARY KEY, data TEXT, rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT)"
      ).run();

      // ---------- GET ----------
      if (req.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT data, rev, updated_at FROM estado WHERE space = ?"
        ).bind(space).first();
        if (!row) return json({ data: null, rev: 0, updated_at: null });
        return json({ data: JSON.parse(row.data), rev: row.rev, updated_at: row.updated_at });
      }

      // ---------- PUT ----------
      if (req.method === "PUT") {
        let body;
        try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
        if (!body || typeof body.data !== "object") return json({ error: "falta 'data'" }, 400);

        const baseRev = Number(body.baseRev || 0);
        const force = !!body.force;

        const cur = await env.DB.prepare(
          "SELECT data, rev, updated_at FROM estado WHERE space = ?"
        ).bind(space).first();
        const currentRev = cur ? cur.rev : 0;

        if (!force && baseRev !== currentRev) {
          return json({
            conflict: true,
            rev: currentRev,
            data: cur ? JSON.parse(cur.data) : null,
            updated_at: cur ? cur.updated_at : null
          }, 409);
        }

        const newRev = currentRev + 1;
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO estado (space, data, rev, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(space) DO UPDATE SET data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at"
        ).bind(space, JSON.stringify(body.data), newRev, now).run();

        return json({ ok: true, rev: newRev, updated_at: now });
      }

      return json({ error: "método no soportado" }, 405);

    } catch (e) {
      return json({ error: "excepción en el servidor", detalle: String(e && e.message || e) }, 500);
    }
  }
};
