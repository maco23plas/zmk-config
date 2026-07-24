import { computePostRates, computeWeeklyRates } from "./calc";
import type { PostEntry, WeeklyEntry } from "./types";

/** CSV セルのエスケープ（カンマ・改行・ダブルクォート対応）。 */
function cell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number | null)[][]): string {
  // Excel の文字化け対策に BOM を付与
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function rate(v: number | null): string {
  return v === null ? "" : (v * 100).toFixed(2);
}

/** 週次データを CSV（生値＋計算レート %）に変換。 */
export function weeklyToCsv(entries: WeeklyEntry[]): string {
  const header = [
    "週開始日",
    "週初フォロワー数",
    "新規フォロワー",
    "投稿数",
    "ストーリーズ本数",
    "ビュー数",
    "リーチ",
    "フォロワーリーチ",
    "プロフィールアクセス",
    "保存",
    "シェア",
    "外部リンククリック",
    "ストーリーズ閲覧",
    "CV数",
    "フォロワー増加率%",
    "ホーム率%",
    "フォロワー外リーチ率%",
    "プロフアクセス率%",
    "フォロワー転換率%",
    "保存率%",
    "シェア率%",
    "リンクCTR%",
    "ストーリーズ閲覧率%",
    "成約率%",
  ];
  const rows = [...entries]
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .map((e) => {
      const r = computeWeeklyRates(e);
      return [
        e.weekStart,
        e.followersStart,
        e.newFollowers,
        e.posts,
        e.stories,
        e.views,
        e.reach,
        e.followerReach,
        e.profileVisits,
        e.saves,
        e.shares,
        e.linkClicks,
        e.storyViews,
        e.conversions,
        rate(r.followerGrowth),
        rate(r.homeRate),
        rate(r.nonFollowerReachRate),
        rate(r.profileVisitRate),
        rate(r.followerConversionRate),
        rate(r.saveRate),
        rate(r.shareRate),
        rate(r.linkCtr),
        rate(r.storyViewRate),
        rate(r.conversionRate),
      ];
    });
  return toCsv([header, ...rows]);
}

/** 投稿別データを CSV（生値＋計算レート %）に変換。 */
export function postsToCsv(entries: PostEntry[]): string {
  const header = [
    "投稿日",
    "形式",
    "企画名",
    "フック",
    "判定",
    "ビュー数",
    "リーチ",
    "フォロワー外リーチ率%",
    "動画尺(秒)",
    "平均視聴時間(秒)",
    "いいね",
    "コメント",
    "保存",
    "シェア",
    "プロフィールアクセス",
    "フォロー数",
    "維持率%",
    "いいね率%",
    "保存率%",
    "シェア率%",
    "プロフアクセス率%",
    "学びメモ",
  ];
  const rows = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => {
      const r = computePostRates(p);
      return [
        p.date,
        p.format,
        p.title,
        p.hook,
        p.verdict,
        p.views,
        p.reach,
        p.nonFollowerReachPct,
        p.videoSec,
        p.avgWatchSec,
        p.likes,
        p.comments,
        p.saves,
        p.shares,
        p.profileVisits,
        p.follows,
        rate(r.retentionRate),
        rate(r.likeRate),
        rate(r.saveRate),
        rate(r.shareRate),
        rate(r.profileVisitRate),
        p.memo,
      ];
    });
  return toCsv([header, ...rows]);
}

/** ブラウザでテキストをファイルとしてダウンロードさせる。 */
export function downloadText(
  filename: string,
  text: string,
  mime = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
