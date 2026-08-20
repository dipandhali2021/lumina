/**
 * One enhancer for every OpenAI-compatible /chat/completions endpoint.
 *
 * Groq and the Vercel AI Gateway differ only in base URL, key, and model name, so both
 * modes are served by this class with different config rather than duplicated clients.
 */
import { UpstreamError } from "../../core/errors.js";
import { logger } from "../../core/logger.js";
import type { EnhanceInput, TextEnhancer } from "../../core/ports.js";
import { upstreamJson } from "../../http/upstream.js";

export interface OpenAICompatibleConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /** Human-readable vendor name, used only in error messages. */
  readonly label: string;
  /** Groq-specific knob; harmlessly ignored by gateways that don't know it. */
  readonly reasoningEffort?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** Upper bound on the rewritten prompt — image models degrade on very long inputs. */
const MAX_PROMPT_CHARS = 1200;

export class OpenAICompatibleEnhancer implements TextEnhancer {
  readonly id: string;
  readonly model: string;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.model = config.model;
  }

  async enhance({ prompt, systemPrompt, signal }: EnhanceInput): Promise<string> {
    const log = logger.child({ provider: this.config.id, model: this.config.model });
    const startedAt = Date.now();

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.config.temperature,
      max_completion_tokens: this.config.maxTokens,
      top_p: 0.95,
      // Non-streaming: we only need the final text, and the SSE we expose to the
      // browser is about pipeline stages, not token-by-token output.
      stream: false,
    };
    if (this.config.reasoningEffort) {
      body.reasoning_effort = this.config.reasoningEffort;
    }

    const json = await upstreamJson<ChatCompletionResponse>({
      url: `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body,
      timeoutMs: this.config.timeoutMs,
      signal,
      retries: 1,
      label: this.config.label,
    });

    const content = json.choices?.[0]?.message?.content?.trim();
    const usage = json.usage;
    // Enough to diagnose the two failures these models actually produce: a reply that is
    // all reasoning and no prompt, and a reply truncated by the token budget.
    log.debug(
      {
        durationMs: Date.now() - startedAt,
        finishReason: json.choices?.[0]?.finish_reason,
        completionTokens: usage?.completion_tokens,
        reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
        rawChars: content?.length ?? 0,
      },
      "enhancement completion received"
    );

    if (!content) {
      throw new UpstreamError(`${this.config.label} returned an empty completion.`);
    }
    const cleaned = sanitize(content);
    if (!cleaned) {
      // e.g. the whole reply was reasoning that got cut off — no usable prompt.
      throw new UpstreamError(
        `${this.config.label} returned no usable prompt text.`,
        content.slice(0, 300)
      );
    }
    return cleaned;
  }
}

/**
 * Strip the wrappers chat models like to add — reasoning tags, code fences, "Prompt:"
 * prefixes, surrounding quotes — so the image model receives a bare description.
 */
export function sanitize(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // An unterminated <think> means the model ran out of budget mid-reasoning: everything
  // after the tag is scratch work, not a prompt, so drop it rather than shipping it.
  const openThink = text.search(/<think>/i);
  if (openThink !== -1) text = text.slice(0, openThink).trim();
  text = text.replace(/<\/?think>/gi, "").trim();

  const fence = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();

  text = text
    .replace(/^(?:enhanced\s+)?prompt\s*[:-]\s*/i, "")
    .replace(/^["'“”](.*)["'“”]$/s, "$1")
    .trim();

  // Collapse any internal newlines: a single-paragraph prompt is what these models want.
  text = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();

  if (text.length > MAX_PROMPT_CHARS) {
    const clipped = text.slice(0, MAX_PROMPT_CHARS);
    const lastComma = clipped.lastIndexOf(",");
    text = (lastComma > MAX_PROMPT_CHARS * 0.6 ? clipped.slice(0, lastComma) : clipped).trim();
  }

  return text;
}
