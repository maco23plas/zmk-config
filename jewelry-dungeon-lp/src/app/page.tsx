import { UiProvider } from "@/components/ui/ui-context";
import { SiteHeader } from "@/components/layout/site-header";
import { Drawer } from "@/components/layout/drawer";
import { BottomBar } from "@/components/layout/bottom-bar";
import { FloatingButtons } from "@/components/layout/floating-buttons";
import { SiteFooter } from "@/components/layout/site-footer";
import { SeminarModal } from "@/components/modal/seminar-modal";
import { Hero } from "@/components/sections/hero";
import { Recommend } from "@/components/sections/recommend";
import { WhyNow } from "@/components/sections/why-now";
import { HowToPlay } from "@/components/sections/how-to-play";
import { OrbList } from "@/components/sections/orb-list";
import { Pricing } from "@/components/sections/pricing";
import { GoldOrbEntry } from "@/components/sections/gold-orb-entry";
import { HowToStart } from "@/components/sections/how-to-start";
import { Risk } from "@/components/sections/risk";
import { Support } from "@/components/sections/support";
import { Faq } from "@/components/sections/faq";
import { YourChoice } from "@/components/sections/your-choice";
import { RegistrationGuide } from "@/components/sections/registration-guide";
import { Safety } from "@/components/sections/safety";
import { FreeSession } from "@/components/sections/free-session";
import styles from "./page.module.css";

export default function Page() {
  return (
    <UiProvider>
      <div className={styles.page}>
        <SiteHeader />
        <Drawer />
        <main id="top" className={styles.main}>
          <Hero />
          <Recommend />
          <WhyNow />
          <HowToPlay />
          <OrbList />
          <Pricing />
          <GoldOrbEntry />
          <HowToStart />
          <Risk />
          <Support />
          <Faq />
          <YourChoice />
          <RegistrationGuide />
          <Safety />
          <FreeSession />
        </main>
        <SiteFooter />
        <BottomBar />
        <FloatingButtons />
        <SeminarModal />
      </div>
    </UiProvider>
  );
}
