import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Scale, BookOpen, Shield, Home, Calendar, Wrench } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type MessageRole = "user" | "assistant";

interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
}

interface ChatMessage {
  role: MessageRole;
  content: string;
  lawContext?: string;
  toolCalls?: ToolCallRecord[];
}

const EXAMPLE_QUESTIONS = [
  { text: "근로기준법의 주요 내용이 무엇인가요?", icon: <Scale className="w-4 h-4 mr-2" /> },
  { text: "개인정보보호법에서 개인정보란 무엇인가요?", icon: <Shield className="w-4 h-4 mr-2" /> },
  { text: "형사소송법에서 피의자의 권리는?", icon: <BookOpen className="w-4 h-4 mr-2" /> },
  { text: "부동산 계약 관련 주요 법령은?", icon: <Home className="w-4 h-4 mr-2" /> },
  { text: "저작권법의 보호 기간은?", icon: <Calendar className="w-4 h-4 mr-2" /> },
];

const API_BASE = __WORKER_URL__;

async function sendChatRequest(messages: Array<{ role: string; content: string }>): Promise<{
  content: string;
  toolCalls: ToolCallRecord[];
  lawContext?: string;
}> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "알 수 없는 오류");
    throw new Error(`오류: ${res.status} - ${errText}`);
  }

  const data = (await res.json()) as {
    message: string | { role: string; content: string };
    toolCalls?: ToolCallRecord[];
    lawContext?: string;
    error?: string;
  };

  if (data.error) throw new Error(data.error);

  const content =
    typeof data.message === "string" ? data.message : (data.message?.content ?? "");
  return {
    content,
    toolCalls: data.toolCalls ?? [],
    lawContext: data.lawContext,
  };
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isPending, setIsPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isPending]);

  const handleSubmit = async (e?: React.FormEvent, customInput?: string) => {
    e?.preventDefault();
    const messageText = customInput || input;
    if (!messageText.trim() || isPending) return;

    const userMessage: ChatMessage = { role: "user", content: messageText.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setIsPending(true);

    try {
      const result = await sendChatRequest(
        nextMessages.map(({ role, content }) => ({ role, content })),
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.content,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
          lawContext: result.lawContext,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        },
      ]);
      console.error("Chat request failed:", error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground font-sans">
      <header className="flex-none py-4 px-6 border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-10 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 shadow-inner">
            <Scale className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">한국 법령 AI 어시스턴트</h1>
            <p className="text-xs text-muted-foreground font-medium">정확하고 신뢰할 수 있는 법률 정보</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-24 flex flex-col gap-6" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full gap-8 py-12">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-primary/5 rounded-2xl mx-auto flex items-center justify-center border border-primary/10 shadow-sm mb-6">
                <Scale className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">어떤 법령 정보가 필요하신가요?</h2>
              <p className="text-muted-foreground text-lg max-w-xl leading-relaxed">
                법제처 Open API의 공식 데이터를 기반으로 AI가 빠르고 정확하게 답변해 드립니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl mt-8">
              {EXAMPLE_QUESTIONS.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  className="h-auto py-4 px-5 justify-start text-left font-medium bg-card hover:bg-accent/50 border-border/50 hover:border-primary/30 transition-all hover:shadow-sm"
                  onClick={() => handleSubmit(undefined, q.text)}
                  data-testid={`btn-example-${i}`}
                >
                  {q.icon}
                  <span className="line-clamp-2">{q.text}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full flex flex-col gap-6 pb-6">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`msg-${msg.role}-${index}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                    <Scale className="w-4 h-4 text-primary" />
                  </div>
                )}

                <div className={`flex flex-col gap-2 max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card border border-border/40 rounded-tl-sm text-foreground"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-li:my-0.5 prose-table:text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <Accordion type="single" collapsible className="w-full mt-1" data-testid={`accordion-tools-${index}`}>
                      <AccordionItem value="tools" className="border rounded-xl bg-card overflow-hidden shadow-sm">
                        <AccordionTrigger className="px-4 py-2.5 hover:bg-accent/30 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                          <div className="flex items-center gap-2">
                            <Wrench className="w-3.5 h-3.5" />
                            도구 호출 내역 ({msg.toolCalls.length}건)
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="border-t">
                          {msg.toolCalls.map((tc, ti) => (
                            <div key={ti} className="px-4 py-3 text-xs border-b last:border-b-0 bg-muted/20">
                              <div className="font-mono font-semibold text-primary mb-1">{tc.name}</div>
                              <div className="text-muted-foreground mb-1">
                                인수: <span className="font-mono">{JSON.stringify(tc.arguments)}</span>
                              </div>
                              <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap break-all">
                                결과: {tc.result.slice(0, 300)}{tc.result.length > 300 ? "…" : ""}
                              </div>
                            </div>
                          ))}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}

                  {msg.lawContext && (
                    <Accordion type="single" collapsible className="w-full mt-1" data-testid={`accordion-context-${index}`}>
                      <AccordionItem value="context" className="border rounded-xl bg-card overflow-hidden shadow-sm">
                        <AccordionTrigger className="px-4 py-2.5 hover:bg-accent/30 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-3.5 h-3.5" />
                            참조된 법령 컨텍스트
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 py-3 bg-muted/30 border-t text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                          {msg.lawContext}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              </div>
            ))}

            {isPending && (
              <div className="flex gap-4 justify-start" data-testid="msg-loading">
                <div className="w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <Scale className="w-4 h-4 text-primary" />
                </div>
                <div className="px-5 py-4 rounded-2xl bg-card border border-border/40 rounded-tl-sm flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm font-medium text-muted-foreground animate-pulse">법령 정보를 분석하고 있습니다...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="flex-none p-4 md:p-6 bg-background border-t border-border/40">
        <div className="max-w-4xl mx-auto w-full">
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-3 bg-card border shadow-sm rounded-xl p-2 focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-all"
            data-testid="form-chat"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="궁금한 법령에 대해 질문해주세요..."
              disabled={isPending}
              className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-base py-6 px-4"
              data-testid="input-chat"
            />
            <Button
              type="submit"
              disabled={!input.trim() || isPending}
              size="icon"
              className="h-12 w-12 rounded-lg shrink-0"
              data-testid="btn-send"
            >
              {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </form>
          <div className="text-center mt-3">
            <p className="text-[11px] text-muted-foreground font-medium">
              이 챗봇은 법제처 Open API를 참고하여 답변을 생성합니다. 전문적인 법률 상담은 법률 전문가와 상담하시기 바랍니다.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
