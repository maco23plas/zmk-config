// 動画をR2にアップロードする補助スクリプト
//   npm run cf:media:put -- ./media/seminar.mp4          （キーはファイル名）
//   npm run cf:media:put -- ./media/seminar.mp4 v2.mp4   （キーを指定）
//   npm run cf:media:put -- ./media/seminar.mp4 --local  （ローカル検証用のR2へ）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const local = args.includes('--local');
const [file, keyArg] = args.filter((a) => a !== '--local');

if (!file) {
  console.error('使い方: npm run cf:media:put -- <動画ファイル> [R2上の名前] [--local]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`ファイルが見つかりません: ${file}`);
  process.exit(1);
}

const key = keyArg || path.basename(file);
const sizeMb = fs.statSync(file).size / 1024 / 1024;
const contentType = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }[path.extname(file).toLowerCase()] || 'video/mp4';

console.log(`アップロード: ${file} (${sizeMb.toFixed(1)}MB) → ${key}${local ? '（ローカル）' : ''}`);
const result = spawnSync('npx', [
  '--yes', 'wrangler', 'r2', 'object', 'put', `antai-webinar-media/${key}`,
  '--file', file, '--content-type', contentType, local ? '--local' : '--remote',
], { stdio: 'inherit' });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`\n完了。管理画面の「動画」欄に次のように指定してください:\n  file:${key}`);
