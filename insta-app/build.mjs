// src/ を1枚のHTMLにまとめて docs/insta/index.html に出力する。
//   node build.mjs          書き出し
//   node build.mjs --check  書き出さず、現在のファイルと一致するか検証（不一致なら exit 1）
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const OUT = join(root, "..", "docs", "insta", "index.html");

const jsDir = join(root, "src", "js");
const scripts = readdirSync(jsDir).filter((f) => f.endsWith(".js")).sort()
  .map((f) => readFileSync(join(jsDir, f), "utf8")).join("");

const data = JSON.parse(read("src/data/insta_data.json")); // 壊れていたらここで失敗する
const html = read("src/index.template.html")
  .replace("__STYLES__", () => read("src/styles.css"))
  .replace("__SCRIPTS__", () => scripts.replace("__DATA__", () => JSON.stringify(data, null, 2)));

if (process.argv.includes("--check")) {
  const same = readFileSync(OUT, "utf8") === html;
  console.log(same ? "OK: docs/insta/index.html は src/ と一致" : "NG: src/ を編集したら `npm run build` を実行してください");
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, html);
console.log(`built ${OUT} (${html.length} bytes)`);
