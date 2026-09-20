const DEFAULT_ORIGIN = "https://gaolai923-hub.github.io";

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGIN).split(",").map(v => v.trim());
  const value = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function response(data, status, origin, env) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin, env) });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, "0")).join("");
}

async function authorize(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const attempt = await env.DB.prepare("SELECT attempts, first_attempt, blocked_until FROM auth_attempts WHERE ip = ?").bind(ip).first();
  if (attempt && Number(attempt.blocked_until) > now) return { ok: false, status: 429 };

  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const valid = supplied && (await sha256(supplied)) === env.ACCESS_CODE_HASH;
  if (valid) {
    if (attempt) await env.DB.prepare("DELETE FROM auth_attempts WHERE ip = ?").bind(ip).run();
    return { ok: true };
  }

  const reset = !attempt || now - Number(attempt.first_attempt) > 900;
  const attempts = reset ? 1 : Number(attempt.attempts) + 1;
  const blockedUntil = attempts >= 5 ? now + 900 : 0;
  await env.DB.prepare("INSERT INTO auth_attempts (ip, attempts, first_attempt, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, first_attempt = excluded.first_attempt, blocked_until = excluded.blocked_until")
    .bind(ip, attempts, reset ? now : Number(attempt.first_attempt), blockedUntil).run();
  return { ok: false, status: blockedUntil ? 429 : 401 };
}

async function getAll(env) {
  const [records, comments, setting] = await Promise.all([
    env.DB.prepare("SELECT id, date, in_time AS inTime, out_time AS outTime, hours, pay, learning FROM records ORDER BY date, in_time").all(),
    env.DB.prepare("SELECT id, who, text, time FROM comments ORDER BY time").all(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'hourlyRate'").first()
  ]);
  return { records: records.results || [], comments: comments.results || [], hourlyRate: Number(setting?.value) || 1200 };
}

async function handleAction(body, env) {
  if (body.action === "saveRecord") {
    const r = body.record || {};
    if (!r.id || !r.date || !r.inTime || !r.outTime) throw new Error("勤務記録の必須項目がありません");
    await env.DB.prepare("INSERT INTO records (id, date, in_time, out_time, hours, pay, learning, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date=excluded.date, in_time=excluded.in_time, out_time=excluded.out_time, hours=excluded.hours, pay=excluded.pay, learning=excluded.learning, updated_at=excluded.updated_at")
      .bind(String(r.id), String(r.date), String(r.inTime), String(r.outTime), Number(r.hours) || 0, Math.round(Number(r.pay) || 0), String(r.learning || ""), new Date().toISOString()).run();
    return { ok: true };
  }
  if (body.action === "deleteRecord") {
    await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(String(body.id || "")).run();
    return { ok: true };
  }
  if (body.action === "saveComment") {
    const c = body.comment || {};
    if (!c.id || !c.text) throw new Error("コメントの必須項目がありません");
    await env.DB.prepare("INSERT INTO comments (id, who, text, time) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET who=excluded.who, text=excluded.text, time=excluded.time")
      .bind(String(c.id), String(c.who || "shacho"), String(c.text), String(c.time || new Date().toISOString())).run();
    return { ok: true };
  }
  if (body.action === "saveSettings") {
    const rate = Math.max(0, Math.round(Number(body.hourlyRate) || 1200));
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('hourlyRate', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(rate)).run();
    return { ok: true };
  }
  throw new Error("不明な操作です");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, env) });
    if (origin && !String(env.ALLOWED_ORIGINS || DEFAULT_ORIGIN).split(",").map(v => v.trim()).includes(origin)) {
      return response({ error: "許可されていない接続元です" }, 403, origin, env);
    }
    try {
      const auth = await authorize(request, env);
      if (!auth.ok) return response({ error: auth.status === 429 ? "しばらく待ってから再試行してください" : "合言葉が違います" }, auth.status, origin, env);
      if (request.method === "GET") return response(await getAll(env), 200, origin, env);
      if (request.method === "POST") return response(await handleAction(await request.json(), env), 200, origin, env);
      return response({ error: "Method not allowed" }, 405, origin, env);
    } catch (error) {
      console.error(error);
      return response({ error: "同期サーバーでエラーが発生しました" }, 500, origin, env);
    }
  }
};
