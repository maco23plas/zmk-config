// E2E: ビルド済み docs/insta/index.html をブラウザで開いて主要フローを検証する。
// Meta Graph API は route でモック（本物のトークン・通信は不要）。
//   npm test        … 全チェック。1つでも失敗したら exit 1
//   CHROME_PATH=... … Chromiumの場所を指定したいとき
import { chromium } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP = pathToFileURL(join(here, "..", "..", "docs", "insta", "index.html")).href;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const sub of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
        const p = join(base, d, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined; // playwright の既定ブラウザに任せる
}

const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const ig = (name, id, user, f) => ({ name, instagram_business_account: { id, username: user, followers_count: f } });

const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const mock = async () => {
  await ctx.unroute("https://graph.facebook.com/**").catch(() => {});
  await ctx.route("https://graph.facebook.com/**", (r) => {
    const u = r.request().url();
    if (u.includes("/me/accounts")) return r.fulfill(json({ data: [ig("A", "IG_A", "client_a", 8200), ig("B", "IG_B", "client_b", 3100), { name: "no ig" }] }));
    if (/\/IG_A\?fields=followers_count/.test(u)) return r.fulfill(json({ followers_count: 8250 }));
    if (u.includes("/IG_A/insights") && u.includes("metric_type=total_value"))
      return r.fulfill(json({ data: ["views:41000", "reach:23500", "total_interactions:1900", "saves:510", "shares:140", "profile_links_taps:88"].map((s) => ({ name: s.split(":")[0], total_value: { value: +s.split(":")[1] } })) }));
    if (u.includes("/IG_A/insights") && u.includes("follower_count")) return r.fulfill(json({ data: [{ name: "follower_count", values: [10, 5, 8, 4, 9, 7, 7].map((value) => ({ value })) }] }));
    if (u.includes("/IG_A/media"))
      return r.fulfill(json({ data: [
        { id: "M1", caption: "朝の時短ルーティン\n詳細", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-08-05T09:00:00+0000", like_count: 900, comments_count: 40 },
        { id: "M2", caption: "保存版まとめ", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: "2026-08-07T09:00:00+0000", like_count: 300, comments_count: 12 } ] }));
    const m = u.match(/\/(M\d)\/insights/);
    if (m) return r.fulfill(json({ data: [["views", 30000], ["reach", 21000], ["saved", 700], ["shares", 310], ["profile_visits", 260], ["follows", 55], ["ig_reels_avg_watch_time", 14200]].map(([name, value]) => ({ name, values: [{ value }] })) }));
    return r.fulfill(json({ error: { message: "unmocked: " + u } }));
  });
};
await mock();

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const go = async (hash) => { await page.evaluate((h) => (location.hash = h), hash); await wait(); };
const rows = () => page.locator("table tbody tr").count();

let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

// 1) v1データの自動移行
await page.goto(APP);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("insta-analytics-2026:weekly", JSON.stringify([{ id: "w1", weekStart: "2026-07-20", followersStart: 5000, newFollowers: 100, posts: 3, stories: 10, views: 30000, reach: 20000, followerReach: 9000, profileVisits: 800, saves: 400, shares: 100, linkClicks: 200, storyViews: 250, conversions: 5, createdAt: "x", updatedAt: "x" }]));
});
await page.reload(); await wait(400);
const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("insta-analytics-2026:accounts") || "[]"));
check("v1データが「マイアカウント」に移行される", migrated.length === 1 && migrated[0].name === "マイアカウント");
check("移行後ダッシュボードにKPIカード6枚", (await page.locator("#kpi-grid .kpi").count()) === 6);

// 2) 初回ウィザード → サンプル
await page.evaluate(() => localStorage.clear()); await page.reload(); await wait(400);
check("初回はウィザードが出る", await page.getByText("Instagram連携ではじめる").isVisible());
await page.getByText("サンプルデータで試す").click(); await wait(500);
check("サンプル投入でKPIカード6枚＋連続低下アラート", (await page.locator("#kpi-grid .kpi").count()) === 6 && (await page.locator("text=2週連続で低下").count()) >= 1);

// 3) 連携（モックAPI）→ アカウント追加
await page.getByRole("button", { name: /追加/ }).first().click(); await wait(300);
await page.getByText("Instagram連携で追加").click(); await wait(300);
await page.locator("#cm-token").fill("MOCK"); await page.locator("#cm-connect").click(); await wait(600);
check("連携モーダルにIGアカウント2件が並ぶ", (await page.getByText("@client_a").isVisible()) && (await page.getByText("@client_b").isVisible()));
await page.locator("[data-ig='0']").click(); await wait(400);
await page.locator("#cm-close").click(); await wait(400);
check("連携アカウントに「取り込む」導線が出る", await page.getByRole("button", { name: /先週ぶんを取り込む/ }).first().isVisible());

// 4) 取り込み・重複防止
const runImport = async () => { await go("#/dashboard"); await page.getByRole("button", { name: /取り込む/ }).first().click(); await wait(300); await page.locator("#im-go").click(); await wait(1500); };
await runImport();
check("取り込み完了と「手入力で補完」表示", (await page.getByText("取り込み完了").isVisible()) && (await page.getByText("手入力で補完").isVisible()));
await page.locator("#im-done").click(); await wait(300);
await go("#/weekly"); check("週次が1行（autoバッジ付き）", (await rows()) === 1 && (await page.locator("table .pill.api").count()) === 1);
await go("#/posts"); check("投稿が2件取り込まれる", (await rows()) === 2);
await runImport(); await page.locator("#im-done").click(); await wait(300);
await go("#/posts"); check("再取り込みしても投稿が重複しない", (await rows()) === 2);

// 5) アカウント間のデータ分離
await page.locator(".acct-chip", { hasText: "サンプル" }).click(); await wait(400);
await go("#/posts"); check("サンプルのアカウントは投稿5件のまま", (await rows()) === 5);

// 6) 手動アカウント＋週次入力のライブ計算
await page.getByRole("button", { name: /追加/ }).first().click(); await wait(300);
await page.getByText("手動アカウントを追加").click(); await wait(300);
await page.locator("#ma-name").fill("@manual_client"); await page.getByRole("button", { name: "追加する" }).click(); await wait(400);
await go("#/weekly"); await page.getByRole("button", { name: /週を追加/ }).first().click(); await wait(300);
await page.locator("#f-followersStart").fill("2000"); await page.locator("#f-followerReach").fill("900"); await wait(300);
check("入力中にホーム率45.0%が即時計算される", /45\.0%/.test(await page.locator("#weekly-preview").innerText()));
await page.getByRole("button", { name: /保存する/ }).click(); await wait(400);
check("手動の週次が保存される", (await rows()) === 1);

// 7) 削除 → 元に戻す
await page.locator('[data-act="w-del"]').first().click(); await wait(300);
await page.getByRole("button", { name: "削除する" }).click(); await wait(300);
await page.getByRole("button", { name: "元に戻す" }).click(); await wait(400);
check("削除を元に戻せる", (await rows()) === 1);

// 8) 診断フロー（ディープリンク）と設定の永続化
await go("#/diagnosis?kpi=" + encodeURIComponent("保存率") + "&state=" + encodeURIComponent("減った"));
check("診断ディープリンクで保存率/減ったの3件", (await page.locator("text=試した施策にする").count()) === 3);
await go("#/settings");
await page.locator('[data-bench="homeRate"][data-field="good"]').fill("55");
await page.getByRole("button", { name: /設定を保存/ }).click(); await wait(300);
await page.reload(); await go("#/settings");
check("設定が再読み込み後も残る", (await page.locator('[data-bench="homeRate"][data-field="good"]').inputValue()) === "55");

// 9) トークン失効のエラー表示
await ctx.unroute("https://graph.facebook.com/**");
await ctx.route("https://graph.facebook.com/**", (r) => r.fulfill(json({ error: { message: "Error validating access token: session has expired" } })));
await page.getByRole("button", { name: /トークンを設定/ }).click(); await wait(300);
await page.locator("#cm-connect").click(); await wait(600);
check("トークン失効時に日本語の案内が出る", await page.getByText(/期限切れ/).isVisible());

check("コンソールエラーなし", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failed ? `\n${failed} 件失敗` : "\n全チェック合格");
process.exit(failed ? 1 : 0);
