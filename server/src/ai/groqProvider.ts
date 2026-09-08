import type { AIProvider } from "./types.js";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq OpenAI-compatible chat completions via fetch.
 * API key stays server-side; never imported by the client.
 */
export class GroqProvider implements AIProvider {
  readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY missing");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty Groq content");
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
