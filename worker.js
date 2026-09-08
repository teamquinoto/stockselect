/* ============================================================
   Stock Select — API (Cloudflare Worker + D1)   [stockselect]
   ------------------------------------------------------------
   Instancia NUEVA e independiente de la app anterior: su propio
   Worker, su propia base D1 y sus propios secrets => datos 100%
   separados de la app vieja.

   Cambios respecto del worker original (solo agregados, nada roto):
     1) GET / y GET /health  -> chequeo de vida SIN token, para
        testear en el navegador que el Worker está publicado.
     2) CORS configurable: si definís la variable ALLOWED_ORIGINS
        (orígenes separados por coma) restringe a esos; si no la
        definís, queda "*" como antes.

   Endpoints:
     GET  /  |  /health            -> {ok:true, app, ...}  (sin token)
     POST /login          {user, pass} -> {token, space, role, vendedorId, name}
     POST /parse-invoice  {pdf, mime}  -> Gemini OCR de factura (Bearer)
     GET  /state?space=...             -> lee estado (Bearer)
     PUT  /state?space=...             -> guarda con control de rev (Bearer)

   Secrets / Variables:
     TOKEN            -> Bearer interno que usa la app para leer/escribir estado
     USERS            -> JSON array de usuarios (ver ejemplo abajo)  [o ADMIN_*]
     ADMIN_USER       -> admin único legacy   [opcional]
     ADMIN_PASS       -> admin único legacy   [opcional]
     GEMINI_KEY       -> key de Google AI para /parse-invoice  [opcional]
     ALLOWED_ORIGINS  -> p.ej. "https://teamquinoto.github.io"  [opcional]
   Binding:
     DB               -> base D1 (el nombre de la variable DEBE ser DB)

   Ejemplo de USERS:
     [
       {"user":"tonio","pass":"…","role":"admin"},
       {"user":"pablo","pass":"…","role":"admin"},
       {"user":"teo","pass":"…","role":"seller","name":"Teo"}
     ]
   ============================================================ */

const APP_NAME = "stockselect";

/* CORS: refleja el Origin si está en ALLOWED_ORIGINS; si no hay lista, "*". */
function cors(env, req) {
  const origin = (req && req.headers.get("Origin")) || "";
  const list = String(env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  let allow = "*";
  if (list.length) allow = list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(headers || {}) }
  });
}

/* Resuelve user+pass contra USERS json (preferido) o ADMIN_* legacy. */
function resolveUser(env, user, pass) {
  if (env.USERS) {
    let list = [];
    try { list = JSON.parse(env.USERS); } catch (_) { list = []; }
    const u = list.find(x => String(x.user) === user && String(x.pass) === pass);
    if (u) {
      const role = (u.role === "seller") ? "seller" : "admin";
      if (role === "seller") {
        const vid = String(u.id || u.user || user).trim().toLowerCase();
        return { user, role, vendedorId: vid, name: u.name || user };
      }
      return { user, role, vendedorId: "", name: u.name || user };
    }
  }
  if (env.ADMIN_USER && env.ADMIN_PASS && user === env.ADMIN_USER && pass === env.ADMIN_PASS) {
    return { user, role: "admin", vendedorId: "", name: env.ADMIN_USER };
  }
  return null;
}

export default {
  async fetch(req, env) {
    const CORS = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");

      // ---------- HEALTH (sin token) ----------
      if (path === "" || path === "/health") {
        return json({ ok: true, app: APP_NAME, ts: new Date().toISOString() }, 200, CORS);
      }

      // ---------- LOGIN (sin Bearer) ----------
      if (path === "/login") {
        if (req.method !== "POST") return json({ error: "use POST" }, 405, CORS);
        if (!env.USERS && !(env.ADMIN_USER && env.ADMIN_PASS)) {
          return json({ error: "config: define USERS or ADMIN_USER/ADMIN_PASS" }, 500, CORS);
        }
        let b;
        try { b = await req.json(); } catch { return json({ error: "invalid JSON" }, 400, CORS); }
        const user = String((b && b.user) || "").trim();
        const pass = String((b && b.pass) || "");
        const u = resolveUser(env, user, pass);
        if (u) {
          return json({ ok: true, user: u.user, role: u.role, vendedorId: u.vendedorId || "", name: u.name || u.user, token: env.TOKEN, space: "main" }, 200, CORS);
        }
        return json({ error: "wrong user or password" }, 401, CORS);
      }

      // ---------- De acá en más: Bearer + config ----------
      if (!env.TOKEN) return json({ error: "config: missing TOKEN secret" }, 500, CORS);

      const auth = req.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (token !== env.TOKEN) return json({ error: "not authorized" }, 401, CORS);

      // ---------- PARSE INVOICE (PDF -> Gemini -> líneas) ----------
      if (path === "/parse-invoice") {
        if (req.method !== "POST") return json({ error: "use POST" }, 405, CORS);
        if (!env.GEMINI_KEY) return json({ ok: false, error: "config: missing GEMINI_KEY" }, 500, CORS);
        let b;
        try { b = await req.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400, CORS); }
        const pdf = b && b.pdf;
        const mime = (b && b.mime) || "application/pdf";
        if (!pdf) return json({ ok: false, error: "missing 'pdf'" }, 400, CORS);

        // Fallback: si el primero está saturado o no disponible, se prueba el siguiente.
        const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"];
        const prompt =
          "You are reading a purchase invoice (e.g. Coqui Hobby style). Return ONLY a JSON object, no markdown, " +
          "no extra text, with this exact shape: " +
          "{\"numero\":\"\",\"fecha\":\"\",\"proveedor\":\"\",\"moneda\":\"\",\"flete\":0," +
          "\"lineas\":[{\"sku\":\"\",\"nombre\":\"\",\"cantidad\":0,\"precio\":0,\"msrp\":0}]}. " +
          "RULES:\n" +
          "- 'precio' = the NET unit price / NET PRICE of the line (the real unit cost).\n" +
          "- 'msrp' = the MSRP unit price if present, else 0.\n" +
          "- 'cantidad' = QTY (units).\n" +
          "- 'sku' = the item code before the colon (e.g. 'BAN2696877'); 'nombre' = the rest of the description.\n" +
          "- 'flete' = the SUM of all freight/shipping/handling amounts (lines like 'Freight and Handling', " +
          "'Handling Fees', 'ZZZFEES', shipping). Use the EXT/line amount for these, not a unit price.\n" +
          "- DO NOT include freight/shipping/handling lines inside 'lineas'. Only real products go in 'lineas'.\n" +
          "- 'fecha' MUST be returned as YYYY-MM-DD.\n" +
          "- If a value is unknown use 0 or an empty string. Numbers must be plain (no thousands separators, dot decimals).";

        const gReq = {
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: pdf } }
            ]
          }],
          generationConfig: {
            temperature: 0,
            response_mime_type: "application/json",
            thinkingConfig: { thinkingLevel: "low" }
          }
        };

        // Errores TRANSITORIOS de Google (sobrecarga/cuota momentánea): se reintenta.
        const TRANSIENT = [429, 500, 502, 503, 504];
        const MAX_INTENTOS = 2;               // por modelo
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        let lastErr = "sin respuesta del modelo";

        for (const model of MODELS) {
          const gUrl = "https://generativelanguage.googleapis.com/v1beta/models/" +
                       model + ":generateContent?key=" + encodeURIComponent(env.GEMINI_KEY);

          for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
            let gRes, gJson;
            try {
              gRes = await fetch(gUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(gReq)
              });
              gJson = await gRes.json();
            } catch (e) {
              // Falla de red hacia Google: se reintenta el mismo modelo.
              lastErr = "network: " + String(e && e.message || e);
              if (intento < MAX_INTENTOS) await sleep(intento * 700);
              continue;
            }

            if (gRes.ok) {
              let text = "";
              try { text = gJson.candidates[0].content.parts.map(p => p.text || "").join(""); } catch { text = ""; }
              try {
                const data = JSON.parse(text.replace(/```json|```/g, "").trim());
                return json({ ok: true, data, model }, 200, CORS);   // ✅ salió bien
              } catch (e) {
                // Respondió pero ilegible: no es transitorio, probamos el próximo modelo.
                lastErr = "could not parse model output (" + model + ")";
                break;
              }
            }

            // Error HTTP de Google.
            lastErr = (gJson && gJson.error && gJson.error.message) || ("HTTP " + gRes.status);
            if (TRANSIENT.includes(gRes.status)) {
              // Sobrecargado: esperar y reintentar el mismo modelo.
              if (intento < MAX_INTENTOS) await sleep(intento * 700);
              continue;
            }
            // Error no transitorio (400/403/404…): no insistir, pasar al próximo modelo.
            break;
          }
          // Este modelo no anduvo -> se prueba el siguiente de MODELS.
        }

        // Ningún modelo respondió bien tras reintentos + fallback.
        return json({ ok: false, error: "gemini error", detalle: lastErr }, 502, CORS);
      }

      if (!env.DB) return json({ error: "config: missing D1 binding 'DB'" }, 500, CORS);

      if (path !== "/state") return json({ error: "route not found" }, 404, CORS);
      const space = (url.searchParams.get("space") || "main").slice(0, 64);

      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS estado (space TEXT PRIMARY KEY, data TEXT, rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT)"
      ).run();

      // ---------- GET ----------
      if (req.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT data, rev, updated_at FROM estado WHERE space = ?"
        ).bind(space).first();
        if (!row) return json({ data: null, rev: 0, updated_at: null }, 200, CORS);
        return json({ data: JSON.parse(row.data), rev: row.rev, updated_at: row.updated_at }, 200, CORS);
      }

      // ---------- PUT ----------
      if (req.method === "PUT") {
        let body;
        try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400, CORS); }
        if (!body || typeof body.data !== "object") return json({ error: "missing 'data'" }, 400, CORS);

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
          }, 409, CORS);
        }

        const newRev = currentRev + 1;
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO estado (space, data, rev, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(space) DO UPDATE SET data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at"
        ).bind(space, JSON.stringify(body.data), newRev, now).run();

        return json({ ok: true, rev: newRev, updated_at: now }, 200, CORS);
      }

      return json({ error: "method not supported" }, 405, CORS);

    } catch (e) {
      return json({ error: "server exception", detail: String(e && e.message || e) }, 500, CORS);
    }
  }
};
