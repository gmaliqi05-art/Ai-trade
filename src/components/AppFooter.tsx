// Footer global — shfaqet në fund të çdo faqeje (klient, admin, hyrje).
import { useI18n } from '../i18n/i18n';

export default function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="text-center text-[11px] text-gray-600 py-4 px-4 select-none">
      {t('Krijuar nga')} <span className="text-gray-400 font-semibold">MarGroup</span> 🇩🇪
    </footer>
  );
}
