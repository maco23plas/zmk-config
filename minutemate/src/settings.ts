/**
 * アプリ内設定 (data/settings.json)。
 * 配布アプリでは、エンドユーザーが .env を編集する代わりに設定画面で API キーを入れる。
 * 優先順位: 設定画面(settings.json) > 環境変数(.env)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

export interface Settings {
  geminiApiKey?: string;
  groqApiKey?: string;
  mailTo?: string;
  llmProvider?: string;
  sttProvider?: string;
}

const FILE = () => path.join(cfg.dataDir, 'settings.json');
let cache: Settings | null = null;

function load(): Settings {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Settings;
  } catch {
    cache = {};
  }
  return cache;
}

export function getSettings(): Settings {
  return { ...load() };
}

export function setSettings(patch: Partial<Settings>): void {
  const cur = load();
  // 空文字は「変更なし」として無視 (マスク表示のフォームで消してしまわないため)
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== '') (cur as Record<string, unknown>)[k] = v;
  }
  cache = cur;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cur, null, 2));
}

const pick = (settingVal: string | undefined, envVal: string) =>
  settingVal && settingVal.length ? settingVal : envVal;

export const geminiKey = () => pick(load().geminiApiKey, cfg.geminiApiKey);
export const groqKey = () => pick(load().groqApiKey, cfg.groqApiKey);
export const llmProvider = () => (pick(load().llmProvider, cfg.llmProvider) as typeof cfg.llmProvider);
export const sttProvider = () => (pick(load().sttProvider, cfg.sttProvider) as typeof cfg.sttProvider);
export const mailTo = (): string[] => {
  const s = load().mailTo;
  return s && s.length ? s.split(',').map((x) => x.trim()).filter(Boolean) : cfg.mailTo;
};

/** 議事録生成に最低限必要な鍵が揃っているか (既定の gemini+groq 構成) */
export function hasRequiredKeys(): boolean {
  const okLlm = llmProvider() === 'ollama' ? true : !!geminiKey() || llmProvider() !== 'gemini';
  const okStt = sttProvider() === 'local' ? true : !!groqKey();
  // 既定構成 (gemini + groq) では両方の鍵を要求する
  if (llmProvider() === 'gemini' && !geminiKey()) return false;
  if (sttProvider() === 'groq' && !groqKey()) return false;
  return okLlm && okStt;
}
