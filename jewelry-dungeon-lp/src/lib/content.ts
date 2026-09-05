/** LP の構造化コピー（リスト系のコンテンツ） */

export interface NavItem {
  no: string;
  label: string;
  href: string;
}

/** ドロワーメニュー項目 */
export const drawerNavItems: NavItem[] = [
  { no: "01", label: "取引の仕組み", href: "#howtoplay" },
  { no: "02", label: "オーブと販売価格", href: "#orb" },
  { no: "03", label: "リスクについて", href: "#risk" },
  { no: "04", label: "よくある質問", href: "#faq" },
];

/** PC ヘッダーナビ */
export const headerNavItems = [
  { label: "仕組み", href: "#howtoplay" },
  { label: "オーブ", href: "#orb" },
  { label: "販売価格", href: "#pricing" },
  { label: "よくある質問", href: "#faq" },
];

/** フッターナビ（下層ページからも遷移できるよう、トップからの絶対パスで指定） */
export const footerNavItems = [
  { label: "取引の仕組み", href: "/#howtoplay" },
  { label: "オーブの種類", href: "/#orb" },
  { label: "リスクについて", href: "/#risk" },
  { label: "よくある質問", href: "/#faq" },
];

/** フッターの下層ページリンク */
export const footerPageLinks = [{ label: "運営会社", href: "/company/" }];

export interface Orb {
  key: "red" | "silver" | "gold";
  nameJa: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  specs: Array<{ label: string; value: string }>;
}

/** 05 ORB LIST */
export const orbs: Orb[] = [
  {
    key: "red",
    nameJa: "レッドオーブ",
    image: "/parts/orb-platinum.png",
    imageWidth: 604,
    imageHeight: 602,
    specs: [
      { label: "販売価格", value: "35,000〜105,000円" },
      { label: "値上げ率", value: "12%" },
      { label: "期間", value: "6日間" },
      { label: "チケット枚数", value: "100枚" },
      { label: "上限予約口数", value: "5口" },
      { label: "平均利益", value: "6,000円" },
      { label: "最小利益", value: "2,200円" },
    ],
  },
  {
    key: "silver",
    nameJa: "シルバーオーブ",
    image: "/parts/orb-silver.png",
    imageWidth: 626,
    imageHeight: 602,
    specs: [
      { label: "販売価格", value: "55,000〜165,000円" },
      { label: "値上げ率", value: "15%" },
      { label: "期間", value: "7日間" },
      { label: "チケット枚数", value: "170枚" },
      { label: "上限予約口数", value: "4口" },
      { label: "平均利益", value: "13,300円" },
      { label: "最小利益", value: "4,850円" },
    ],
  },
  {
    key: "gold",
    nameJa: "ゴールドオーブ",
    image: "/parts/orb-gold.png",
    imageWidth: 612,
    imageHeight: 604,
    specs: [
      { label: "販売価格", value: "75,000〜225,000円" },
      { label: "値上げ率", value: "17%" },
      { label: "期間", value: "8日間" },
      { label: "チケット枚数", value: "240枚" },
      { label: "上限予約口数", value: "4口" },
      { label: "平均利益", value: "20,700円" },
      { label: "最小利益", value: "7,950円" },
    ],
  },
];

export interface HowToPlayStep {
  no: string;
  title: string;
  text: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  alt: string;
}

/** 04 HOW TO PLAY */
export const howToPlaySteps: HowToPlayStep[] = [
  {
    no: "01",
    title: "オーブを選ぶ",
    text: "3種類のオーブから、オーブを選んで購入手続きします",
    image: "/parts/step1.png",
    imageWidth: 541,
    imageHeight: 308,
    alt: "オーブを選ぶ画面",
  },
  {
    no: "02",
    title: "一定期間保有する",
    text: "オーブごとに設定された期間・条件に沿って保有します",
    image: "/parts/step2.png",
    imageWidth: 541,
    imageHeight: 308,
    alt: "保有状況の画面",
  },
  {
    no: "03",
    title: "次の購入者へ販売",
    text: "販売日に出品され、購入希望者とマッチングすると売買が成立",
    image: "/parts/step3.png",
    imageWidth: 541,
    imageHeight: 341,
    alt: "売却画面",
  },
  {
    no: "04",
    title: "差額が利益になる",
    text: "取引条件に沿って売却され、購入価格に＋で販売差額が利益になります",
    image: "/parts/step4.png",
    imageWidth: 541,
    imageHeight: 341,
    alt: "資産状況の画面",
  },
];

export interface HowToStartStep {
  no: string;
  title: string;
  text: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  alt: string;
  isOrb?: boolean;
}

/** 08 HOW TO START */
export const howToStartSteps: HowToStartStep[] = [
  {
    no: "01",
    title: "会員登録をする",
    text: "メールアドレスだけで最短1分で登録完了。",
    image: "/parts/signup.png",
    imageWidth: 414,
    imageHeight: 421,
    alt: "新規登録画面",
  },
  {
    no: "02",
    title: "仕組みを理解する",
    text: "初心者向けのガイドで取引の流れを理解しましょう。",
    image: "/parts/ph2.png",
    imageWidth: 197,
    imageHeight: 300,
    alt: "ガイド画面",
  },
  {
    no: "03",
    title: "オーブを選ぶ",
    text: "3種類のオーブから選び、応募し購入します。",
    image: "/parts/orb-gold.png",
    imageWidth: 612,
    imageHeight: 604,
    alt: "ゴールドオーブ",
    isOrb: true,
  },
  {
    no: "04",
    title: "取引を体験する",
    text: "マッチングした購入者へ、販売をします。",
    image: "/parts/ph4.png",
    imageWidth: 197,
    imageHeight: 300,
    alt: "取引画面",
  },
  {
    no: "05",
    title: "収益を受け取る",
    text: "利益が上乗せされた状態で販売が完了。販売収益を受け取ります。",
    image: "/parts/ph5.png",
    imageWidth: 197,
    imageHeight: 300,
    alt: "ウォレット画面",
  },
];

/** 09 RISK */
export const riskItems = [
  {
    title: "売却できない場合があります",
    text: "マッチング状況によっては、予定どおりに売却できない場合があります。",
  },
  {
    title: "利益は保証されません",
    text: "購入金額の回収や販売利益を保証するサービスではありません。",
  },
  {
    title: "ユーザー同士の個人間取引です",
    text: "取引は個人間で行われます。期限内の確認や対応が必要です。",
  },
];

export interface FaqItem {
  question: string;
  /** 改行は \n（white-space: pre-line で表示） */
  answer: string;
}

/** 11 FOR BEGINNERS / FAQ */
export const faqItems: FaqItem[] = [
  {
    question: "知識がなくても始められますか？",
    answer:
      "はい、問題ありません。\n専門用語をできるだけ使わず、初心者の方でもわかる\nガイドやサポート体制が整っています。",
  },
  {
    question: "費用はかかりますか？",
    answer: "登録は無料です。\n取引が成立した際には所定の手数料が発生します。",
  },
  {
    question: "どれくらいの時間がかかりますか？",
    answer:
      "取引自体は数分で完結します。\n忙しい方でもスキマ時間で取り組むことができます。",
  },
  {
    question: "元本は保証されていますか？",
    answer:
      "元本保証ではありません。\n値上げ率や表示例は、利益を保証するものではありません。（詳細は「リスクについて」をご覧ください）",
  },
  {
    question: "売却はどのように行われますか？",
    answer:
      "取引はP2P（個人間取引）で行われます。購入希望者とのマッチング状況によっては、予定どおりに売却できない場合があります。",
  },
  {
    question: "スマホだけでも参加できますか？",
    answer: "はい、スマホから予約・確認・取引など多くの操作が可能です。",
  },
];

/** 13 YOUR CHOICE チェックリスト */
export const choiceA = [
  "銀行に預けるだけ",
  "増えるのはわずかな利息",
  "楽しみが少ない",
  "将来への不安が残る",
];
export const choiceB = [
  "ゲーム感覚で楽しめる",
  "好きな時間に参加できる",
  "スマホで資産を増やせる",
  "将来の選択肢が広がる",
];

/** 12 SAFETY 信頼カードのチェックリスト */
export const safetyChecks = [
  "法令・ガイドラインの遵守",
  "不正行為の監視・防止",
  "継続的なサービス改善",
];
