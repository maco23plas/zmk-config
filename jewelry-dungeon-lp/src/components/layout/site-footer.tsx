import { footerNavItems } from "@/lib/content";
import { SITE_NAME, SITE_NAME_EN } from "@/lib/site";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <p className={styles.brandName}>{SITE_NAME_EN}</p>
          <p className={styles.brandSub}>{SITE_NAME}</p>
        </div>
        <nav className={styles.nav} aria-label="フッターナビゲーション">
          {footerNavItems.map((item) => (
            <a key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
      <p className={styles.legal}>
        ※ 掲載の表示例は説明資料に基づく条件であり、利益を保証するものではありません。取引はP2P（個人間取引）で行われ、売却できない場合があります。
        <br />© {SITE_NAME_EN}
      </p>
    </footer>
  );
}
