import { z } from 'zod';
import { cfg } from './config.js';
import { geminiKey, groqKey, llmProvider } from './settings.js';
import { log } from './util.js';

/** LLM をプロバイダ非依存で呼ぶ。全プロバイダに無料枠 or 無料ローカル動作がある。 */

async function callProvider(system: string, user: string, json: boolean, maxTokens = 8192): Promise<string> {
  switch (llmProvider()) {
    case 'gemini': {
      if (!geminiKey()) throw new Error('GEMINI_API_KEY が未設定です (設定画面で入力してください)');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent?key=${geminiKey()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              ...(json ? { responseMimeType: 'application/json' } : {}),
            },
          }),
        }
      );
      if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    }
    case 'groq': {
      if (!groqKey()) throw new Error('GROQ_API_KEY が未設定です (設定画面で入力してください)');
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey()}` },
        body: JSON.stringify({
          model: cfg.groqModel,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Groq API ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? '';
    }
    case 'anthropic': {
      if (!cfg.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY が未設定です');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.anthropicModel,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return data.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? '';
    }
    case 'ollama': {
      const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.ollamaModel,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? '';
    }
  }
}

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

/** 自由記述 (Markdown) を返す呼び出し */
export async function chatText(system: string, user: string, maxTokens = 8192): Promise<string> {
  return (await callProvider(system, user, false, maxTokens)).trim();
}

/** JSON を返させて zod で検証する呼び出し。失敗時は最大3回リトライ。 */
export async function chatJSON<T>(
  system: string,
  user: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const hint =
        attempt === 0
          ? ''
          : '\n\n重要: 出力は有効な JSON オブジェクトのみ。コードフェンスや説明文を含めないこと。';
      const raw = await callProvider(system, user + hint, true);
      return schema.parse(JSON.parse(stripFences(raw)));
    } catch (e) {
      lastErr = e;
      log('llm', `JSON 出力の検証に失敗 (attempt ${attempt + 1}):`, (e as Error).message);
    }
  }
  throw new Error(`LLM の JSON 出力が3回とも不正でした: ${(lastErr as Error)?.message}`);
}
