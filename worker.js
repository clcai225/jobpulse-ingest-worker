// JobPulse ingest worker
// Receives registration and execution events from the Java starter.
// Auth: Authorization: Bearer <INGEST_TOKEN>

function json(data, status) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

function authorized(request, env) {
    const expected = "Bearer " + env.INGEST_TOKEN;
    return request.headers.get("Authorization") === expected;
}

async function readJson(request) {
    try {
        return await request.json();
    } catch (e) {
        return null;
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/v1/dashboard") {
            const html = await import("./dashboard.html");
            return new Response(html.default, {
                headers: { "Content-Type": "text/html;charset=UTF-8" }
            });
        }

        if (!authorized(request, env)) {
            return json({ ok: false, error: "unauthorized" }, 401);
        }

        if (request.method === "POST" && url.pathname === "/v1/jobs/register") {
            const body = await readJson(request);
            if (!body || !body.app || !body.jobKey) {
                return json({ ok: false, error: "missing fields" }, 400);
            }
            const now = new Date().toISOString();
            await env.DB.prepare(
                "INSERT INTO jobs (app, env, job_key, schedule, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(app, env, job_key) DO UPDATE SET schedule = excluded.schedule, last_seen = excluded.last_seen"
            ).bind(body.app, body.env || "default", body.jobKey, body.schedule || "", now).run();
            return json({ ok: true });
        }

        if (request.method === "POST" && url.pathname === "/v1/executions") {
            const body = await readJson(request);
            if (!body || !body.app || !body.jobKey || !body.status) {
                return json({ ok: false, error: "missing fields" }, 400);
            }
            const stmts = [];
            stmts.push(env.DB.prepare(
                "INSERT INTO executions (app, env, job_key, status, started_at, duration_ms, error_class, error_message) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
            ).bind(
                body.app, body.env || "default", body.jobKey, body.status,
                body.startedAt || 0, body.durationMs || 0,
                body.errorClass || null, body.errorMessage || null
            ));
            stmts.push(env.DB.prepare(
                "UPDATE jobs SET last_seen = ?4, last_status = ?5 WHERE app = ?1 AND env = ?2 AND job_key = ?3"
            ).bind(
                body.app, body.env || "default", body.jobKey,
                new Date().toISOString(), body.status
            ));
            await env.DB.batch(stmts);
            return json({ ok: true });
        }

        if (request.method === "GET" && url.pathname === "/v1/health") {
            return json({ ok: true, service: "jobpulse-ingest" });
        }

        if (request.method === "GET" && url.pathname === "/v1/jobs") {
            const qp = new URL(request.url).searchParams;
            const app = qp.get("app");
            const envName = qp.get("env");
            let query = "SELECT id, app, env, job_key, schedule, first_seen, last_seen, last_status FROM jobs";
            const conditions = [];
            const params = [];
            if (app) { conditions.push("app = ?" + (params.length + 1)); params.push(app); }
            if (envName) { conditions.push("env = ?" + (params.length + 1)); params.push(envName); }
            if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
            query += " ORDER BY last_seen DESC";
            const result = await env.DB.prepare(query).bind(...params).all();
            return json({ ok: true, jobs: result.results });
        }

        if (request.method === "GET" && url.pathname === "/v1/executions") {
            const qp = new URL(request.url).searchParams;
            const app = qp.get("app");
            const envName = qp.get("env");
            const jobKey = qp.get("jobKey");
            const limit = Math.min(parseInt(qp.get("limit") || "50", 10) || 50, 200);
            let query = "SELECT id, app, env, job_key, status, started_at, duration_ms, error_class, error_message, created_at FROM executions";
            const conditions = [];
            const params = [];
            if (app) { conditions.push("app = ?" + (params.length + 1)); params.push(app); }
            if (envName) { conditions.push("env = ?" + (params.length + 1)); params.push(envName); }
            if (jobKey) { conditions.push("job_key = ?" + (params.length + 1)); params.push(jobKey); }
            if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
            query += " ORDER BY started_at DESC LIMIT " + limit;
            const result = await env.DB.prepare(query).bind(...params).all();
            return json({ ok: true, executions: result.results });
        }

        if (request.method === "GET" && url.pathname === "/v1/summary") {
            const jobsResult = await env.DB.prepare(
                "SELECT COUNT(*) as total, SUM(CASE WHEN last_status = 'FAILURE' THEN 1 ELSE 0 END) as failing FROM jobs"
            ).first();
            const execResult = await env.DB.prepare(
                "SELECT COUNT(*) as total_24h, SUM(CASE WHEN status = 'FAILURE' THEN 1 ELSE 0 END) as failures_24h FROM executions WHERE started_at > ?1"
            ).bind(Date.now() - 86400000).first();
            return json({
                ok: true,
                totalJobs: jobsResult.total || 0,
                failingJobs: jobsResult.failing || 0,
                executions24h: execResult.total_24h || 0,
                failures24h: execResult.failures_24h || 0
            });
        }

        return json({ ok: false, error: "not found" }, 404);
    }
};