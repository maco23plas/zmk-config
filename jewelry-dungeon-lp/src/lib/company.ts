/**
 * 運営会社情報（/company/ ページに表示）
 * TODO(公開前必須): 「【要記入】」を実データに差し替える。不要な行は削除してよい。
 */
/**
 * 運営会社ページを公開するか。
 * false の間はフッターの「運営会社」リンクを出さず、/company/ は「準備中」表示になる。
 * 会社情報を companyRows に入れたら true にする。
 */
export const companyPageReady = false;

export interface CompanyRow {
  label: string;
  value: string;
}

export const companyRows: CompanyRow[] = [
  { label: "会社名", value: "【要記入】" },
  { label: "代表者", value: "【要記入】" },
  { label: "所在地", value: "【要記入】" },
  { label: "設立", value: "【要記入】" },
  { label: "事業内容", value: "【要記入】" },
  { label: "メールアドレス", value: "【要記入】" },
  { label: "電話番号", value: "【要記入】" },
];
