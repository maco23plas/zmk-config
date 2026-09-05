/** 無料説明会 申込フォームの入力値 */
export interface SeminarFormData {
  name: string;
  email: string;
}

/**
 * 無料説明会の申込を送信する。
 *
 * TODO(送信先未定): フォームの送信先（API / メール連携 / フォームサービス等）が
 * 確定していないため、現状は何も送信しない空実装。接続先が決まったら
 * ここで fetch 等を行い、失敗時は呼び出し側でエラー表示できるよう例外を投げること。
 */
export async function submitSeminarForm(data: SeminarFormData): Promise<void> {
  void data;
}
