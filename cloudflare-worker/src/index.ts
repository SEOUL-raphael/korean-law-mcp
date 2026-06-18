export interface Env {
  MINIMAX_API_KEY: string;
  LAW_OC: string;
  AI_MODEL: string;
  ALLOWED_ORIGIN: string;
  AI_INTEGRATIONS_OPENAI_BASE_URL: string;
}

const LAW_API_BASE = "https://www.law.go.kr/DRF";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_law",
      description:
        "법제처 Open API를 통해 한국 법령을 검색합니다. 법령명 또는 키워드로 법령 목록을 조회합니다. 법령 전문이 필요하면 get_law_text를 추가로 호출하세요.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색할 법령명 또는 키워드 (한국어)" },
          display: { type: "number", description: "검색 결과 수 (기본값: 5, 최대: 20)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_law_text",
      description:
        "법령 일련번호(MST)로 해당 법령의 주요 조문을 가져옵니다. search_law로 MST를 먼저 확인하세요.",
      parameters: {
        type: "object",
        properties: {
          mst: { type: "string", description: "법령 일련번호 (search_law 결과의 mst 값)" },
        },
        required: ["mst"],
      },
    },
  },
];

function buildSystemPrompt(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10);
  return `당신은 한국 법령 전문 AI 어시스턴트입니다. 법제처 Open API를 통해 실시간 법령 정보를 검색하고 사용자의 질문에 정확하고 친절하게 답변합니다.

오늘 날짜(KST): ${dateStr}

사용 가능한 도구:
- search_law: 법령명 또는 키워드로 법령 목록 검색 → 법령명, MST(일련번호), 구분, 공포일 반환
- get_law_text: MST로 법령 주요 조문 조회

도구 사용 지침:
1. 사용자가 특정 법령을 언급하면 반드시 search_law로 검색 후 답변하세요
2. 조문 내용이 필요하면 get_law_text를 추가로 호출하세요
3. 검색 결과를 바탕으로 구체적이고 정확한 정보를 제공하세요

주요 역할:
- 한국 법령에 대한 질문에 답변
- 법령의 내용, 적용 범위, 해석에 대한 안내
- 법적 절차 및 권리에 대한 일반적인 정보 제공
- 전문적이지만 이해하기 쉬운 언어로 설명
- Markdown 형식으로 답변 작성 (표, 목록, 강조 활용)

중요 주의사항:
- 법적 조언이 아닌 법령 정보를 제공합니다
- 구체적인 사안에 대해서는 변호사 등 전문가 상담을 권유합니다
- 최신 법령 정보를 기반으로 하되, 변경 가능성이 있음을 안내합니다`;
}

function parseLawXml(xml: string): Array<{ name: string; mst: string; lawType: string; promDate: string }> {
  const results: Array<{ name: string; mst: string; lawType: string; promDate: string }> = [];
  const lawRegex = /<law[^>]*>([\s\S]*?)<\/law>/g;
  let match;
  while ((match = lawRegex.exec(xml)) !== null) {
    const block = match[1];
    const name =
      (block.match(/<법령명한글><!\[CDATA\[([^\]]+)\]\]><\/법령명한글>/) ||
        block.match(/<법령명한글>([^<]+)<\/법령명한글>/))?.[1]?.trim() || "";
    const mst = block.match(/<법령일련번호>([^<]+)<\/법령일련번호>/)?.[1]?.trim() || "";
    const lawType = block.match(/<법령구분명>([^<]+)<\/법령구분명>/)?.[1]?.trim() || "";
    const promDate = block.match(/<공포일자>([^<]+)<\/공포일자>/)?.[1]?.trim() || "";
    if (name) results.push({ name, mst, lawType, promDate });
  }
  return results;
}

async function searchLaw(query: string, display: number, oc: string): Promise<string> {
  try {
    const url = `${LAW_API_BASE}/lawSearch.do?OC=${encodeURIComponent(oc)}&type=XML&target=law&query=${encodeURIComponent(query)}&display=${display}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KoreanLawBot/1.0)" },
    });
    if (!res.ok) return JSON.stringify({ error: `법제처 API 오류: HTTP ${res.status}` });
    const xml = await res.text();

    const errCode = xml.match(/<resultCode>([^<]+)<\/resultCode>/)?.[1];
    if (errCode && errCode !== "00") {
      const errMsg = xml.match(/<resultMsg>([^<]+)<\/resultMsg>/)?.[1] || "알 수 없는 오류";
      return JSON.stringify({ error: `법제처 API 오류: ${errMsg}` });
    }

    const laws = parseLawXml(xml);
    if (laws.length === 0) {
      return JSON.stringify({ notice: "검색 결과가 없습니다.", query });
    }
    return JSON.stringify({ results: laws, total: laws.length, query });
  } catch (e: unknown) {
    return JSON.stringify({ error: String(e) });
  }
}

async function getLawText(mst: string, oc: string): Promise<string> {
  try {
    const url = `${LAW_API_BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=eflaw&type=XML&MST=${encodeURIComponent(mst)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KoreanLawBot/1.0)" },
    });
    if (!res.ok) return JSON.stringify({ error: `법제처 API 오류: HTTP ${res.status}` });
    const xml = await res.text();

    const lawName =
      (xml.match(/<법령명한글><!\[CDATA\[([^\]]+)\]\]><\/법령명한글>/) ||
        xml.match(/<법령명한글>([^<]+)<\/법령명한글>/))?.[1]?.trim() || "";

    const articles: string[] = [];
    const joRegex = /<조문내용>([\s\S]*?)<\/조문내용>/g;
    let m;
    while ((m = joRegex.exec(xml)) !== null && articles.length < 8) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 10) articles.push(text.slice(0, 500));
    }

    if (articles.length === 0) {
      const cleaned = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
      return JSON.stringify({ lawName, text: cleaned, mst });
    }
    return JSON.stringify({ lawName, articles, mst, total: articles.length });
  } catch (e: unknown) {
    return JSON.stringify({ error: String(e) });
  }
}

async function executeTool(name: string, args: Record<string, unknown>, env: Env): Promise<string> {
  const oc = env.LAW_OC;
  if (name === "search_law") {
    return searchLaw(String(args["query"] || ""), Number(args["display"] || 5), oc);
  }
  if (name === "get_law_text") {
    return getLawText(String(args["mst"] || ""), oc);
  }
  return JSON.stringify({ error: `알 수 없는 도구: ${name}` });
}

function resolveAllowedOrigin(origin: string, env: Env): string | null {
  if (!origin) return null;

  // Exact matches from ALLOWED_ORIGIN env var (comma-separated list)
  const envOrigins = (env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envOrigins.includes(origin)) return origin;

  // Hard-coded production GitHub Pages origin
  if (origin === "https://chrisryugj.github.io") return origin;

  // Local development: exact localhost or 127.0.0.1 with any port
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;

  // Replit preview domains (development only)
  if (/^https:\/\/[a-zA-Z0-9-]+\.replit\.dev$/.test(origin)) return origin;
  if (/^https:\/\/[a-zA-Z0-9-]+\.repl\.co$/.test(origin)) return origin;

  return null;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface AiMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
}

interface AiResponse {
  choices?: Array<{ message: AiMessage }> | null;
  base_resp?: { status_code: number; status_msg: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.MINIMAX_API_KEY) {
      return new Response("Worker configuration error: MINIMAX_API_KEY is not set.", { status: 500 });
    }
    if (!env.LAW_OC) {
      return new Response("Worker configuration error: LAW_OC is not set.", { status: 500 });
    }

    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = resolveAllowedOrigin(origin, env);

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    };

    if (request.method === "OPTIONS") {
      if (!allowedOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/healthz") {
      return Response.json({ ok: true, ts: Date.now() }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (origin && !allowedOrigin) {
        return new Response("Forbidden", { status: 403 });
      }

      try {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        const { messages } = body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          return Response.json(
            { error: "messages가 필요합니다." },
            { status: 400, headers: corsHeaders },
          );
        }

        const openaiBase = (env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.minimax.io/v1").replace(/\/$/, "");
        const openaiKey = env.MINIMAX_API_KEY;
        const model = env.AI_MODEL || "MiniMax-M2.7";

        const chatMessages: unknown[] = [
          { role: "system", content: buildSystemPrompt() },
          ...messages,
        ];

        const collectedToolCalls: Array<{
          name: string;
          arguments: Record<string, unknown>;
          result: string;
        }> = [];
        const maxIter = 8;
        let iterCount = 0;
        let finalMessage = "";

        while (iterCount < maxIter) {
          iterCount++;

          const aiRes = await fetch(`${openaiBase}/text/chatcompletion_v2`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: 8192,
              messages: chatMessages,
              tools: TOOLS,
              tool_choice: "auto",
            }),
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(`AI API 오류: ${aiRes.status} - ${errText.slice(0, 200)}`);
          }

          const aiData = (await aiRes.json()) as AiResponse;

          if (aiData.base_resp && aiData.base_resp.status_code !== 0) {
            throw new Error(`AI API 오류: ${aiData.base_resp.status_msg}`);
          }

          const assistantMsg = aiData.choices?.[0]?.message;
          if (!assistantMsg) break;

          if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            chatMessages.push({
              role: "assistant",
              tool_calls: assistantMsg.tool_calls,
              content: assistantMsg.content ?? null,
            });

            for (const tc of assistantMsg.tool_calls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                args = {};
              }
              const result = await executeTool(tc.function.name, args, env);
              collectedToolCalls.push({ name: tc.function.name, arguments: args, result });
              chatMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
            }
          } else {
            finalMessage = assistantMsg.content || "";
            break;
          }
        }

        return Response.json(
          {
            message: { role: "assistant", content: finalMessage },
            toolCalls: collectedToolCalls,
          },
          { headers: corsHeaders },
        );
      } catch (err: unknown) {
        return Response.json(
          { error: String(err) },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
