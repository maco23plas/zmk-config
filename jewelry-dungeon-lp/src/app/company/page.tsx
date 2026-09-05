import type { Metadata } from "next";
import Image from "next/image";
import { asset, withBasePath } from "@/lib/asset";
import { companyPageReady, companyRows } from "@/lib/company";
import { SITE_NAME, SITE_NAME_EN } from "@/lib/site";
import { SiteFooter } from "@/components/layout/site-footer";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: `運営会社｜${SITE_NAME}`,
  description: `${SITE_NAME}の運営会社情報です。`,
};

/** 運営会社ページ */
export default function CompanyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href={withBasePath("/")} className={styles.brand} aria-label={`${SITE_NAME} トップへ`}>
            <Image
              src={asset("/parts/orb-gold.png")}
              alt=""
              width={34}
              height={34}
              className={styles.brandLogo}
            />
            <span className={styles.brandText}>
              <span className={styles.brandName}>{SITE_NAME_EN}</span>
              <span className={styles.brandSub}>{SITE_NAME}</span>
            </span>
          </a>
          <a href={withBasePath("/")} className={styles.back}>
            トップページへ戻る
          </a>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <div className={styles.inner}>
            <p className={styles.label}>COMPANY</p>
            <h1 className={styles.title}>運営会社</h1>
            {companyPageReady ? (
              <dl className={styles.table}>
                {companyRows.map((row) => (
                  <div key={row.label} className={styles.row}>
                    <dt className={styles.dt}>{row.label}</dt>
                    <dd className={styles.dd}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className={styles.preparing}>運営会社情報は現在準備中です。</p>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
