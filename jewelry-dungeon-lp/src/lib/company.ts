/**
 * 運営会社情報（/company/ ページに表示）
 * 会社名・所在地・設立・資本金・会社法人等番号は履歴事項全部証明書に基づく。
 */

/** 運営会社ページを公開するか（会社情報が未確定の間は false にする） */
export const companyPageReady = true;

export interface CompanyRow {
  label: string;
  value: string;
  /** メールアドレスなど、リンクにする場合の href */
  href?: string;
}

export const companyRows: CompanyRow[] = [
  { label: "会社名", value: "株式会社MONTANA" },
  { label: "代表者", value: "土方 誠" },
  { label: "所在地", value: "東京都港区港南二丁目16番1号" },
  { label: "設立", value: "平成24年5月31日" },
  { label: "資本金", value: "300万円" },
  { label: "会社法人等番号", value: "0100-01-147182" },
  { label: "事業内容", value: "インターネットを利用した各種情報サービス" },
  {
    label: "メールアドレス",
    value: "jewelryp2p@gmail.com",
    href: "mailto:jewelryp2p@gmail.com",
  },
];
