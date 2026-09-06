// ════════════════════════════════════════════════════════
// worker/ai-proxy.js —— Cloudflare Worker AI 代理：转发 chat/completions 请求，Key 只存在 Worker 环境变量
// ════════════════════════════════════════════════════════
// 为什么需要：VITE_ 前缀变量会被 Vite 内联进构建产物，直连 DeepSeek 时 key 明文暴露给每个访客。
// 本 Worker 收到前端请求后注入 Authorization 再转发上游，流式响应（SSE）原样透传。
//
// 部署三步：
//   1) npx wrangler deploy
//   2) npx wrangler secret put AI_API_KEY        # 值为 DeepSeek key
//   3) 前端 .env 设 VITE_AI_BASE_URL=https://<worker-name>.<account>.workers.dev
// 可选防盗刷：npx wrangler secret put ALLOWED_ORIGIN 设为你的站点域名（如 https://xxx.pages.dev），
// 未设置时放行任意来源——谁都能拿你的 Worker 刷你的 Key 额度，上线前务必设置。
// 本地调试：npx wrangler dev，key 放同目录 .dev.vars（已在 .gitignore）。
const UPSTREAM = 'https://api.deepseek.com/chat/completions'

function corsHeaders(allowedOrigin, requestOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin || requestOrigin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(env.ALLOWED_ORIGIN, request.headers.get('Origin'))
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers })
    if (!env.AI_API_KEY) return new Response('Proxy missing AI_API_KEY secret', { status: 500, headers })

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AI_API_KEY}`
      },
      body: await request.text()
    })
    // body 透传即流式：Workers 的 Response 会按上游 chunk 边收边发，SSE 不会被缓冲
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', ...headers }
    })
  }
}
