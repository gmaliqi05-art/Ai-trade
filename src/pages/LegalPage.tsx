import { Scale, ShieldAlert, TrendingUp, Bot, FileText, CreditCard, UserCheck, Lock, Baby, RefreshCw, Gavel, Mail, ArrowLeft } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import LanguageSwitcher from '../i18n/LanguageSwitcher';

// POLITIKAT LIGJORE — faqe publike (hapet me #legal, edhe pa llogari).
// Qëllimi mbrojtës: shërbimi ynë është ANALIZË, HULUMTIM dhe DIJE tregtare nga ekspertë —
// JO këshillë e licencuar investimi dhe KURRË garanci fitimi. Pranohen te regjistrimi (tik i
// detyrueshëm; koha ruhet te profiles.accepted_terms_at).
const LAST_UPDATED = '2 gusht 2026';

export default function LegalPage() {
  const { t } = useI18n();

  const sections: { icon: React.ElementType; title: string; paras: string[] }[] = [
    {
      icon: TrendingUp,
      title: t('1. Kush jemi dhe çfarë ofrojmë'),
      paras: [
        t('GOLDSNIPER (goldsniper.vip), e operuar nga MarGroup, është një platformë shërbimesh analitike dhe teknologjike për tregtimin e arit (XAUUSD) dhe instrumenteve të lidhura. Ne jemi tregtarë me përvojë: bëjmë analizat tona, hulumtimet tona dhe tregtimet tona, dhe përmes platformës ndajmë me abonentët dijen, sinjalet, veglat dhe infrastrukturën që përdorim vetë.'),
        t('Kushdo që dëshiron, mund të bashkohet dhe të tregtojë krahas nesh — duke përdorur sinjalet dhe veglat tona në llogarinë e vet personale të tregtimit, me vendimet e veta dhe nën përgjegjësinë e vet të plotë.'),
      ],
    },
    {
      icon: FileText,
      title: t('2. Natyra e shërbimit — jo këshillë investimi'),
      paras: [
        t('Gjithçka që ofron platforma — sinjalet, analizat, raportet, roboti i ekzekutimit, materialet edukative dhe çdo përmbajtje tjetër — ka natyrë INFORMATIVE dhe EDUKATIVE. Ajo pasqyron mendimin dhe metodologjinë tonë tregtare, dhe NUK përbën këshillë të personalizuar investimi, rekomandim financiar, ligjor apo tatimor për situatën tënde personale.'),
        t('Ne nuk jemi bankë, broker, ndërmjetës financiar apo këshilltar i licencuar investimesh, dhe nuk mbajmë kurrë fondet e tua. Tregtimi kryhet gjithmonë në llogarinë TËNDE personale te brokeri YT, të cilin e zgjedh dhe e kontrollon vetëm ti. Para çdo vendimi financiar konsultohu me një këshilltar të licencuar nëse e sheh të nevojshme.'),
      ],
    },
    {
      icon: ShieldAlert,
      title: t('3. Paralajmërimi i rrezikut — ASNJË garanci fitimi'),
      paras: [
        t('Tregtimi i arit, valutave dhe instrumenteve me levë mbart RREZIK TË LARTË dhe mund të çojë në humbjen e pjesshme ose të plotë të kapitalit të investuar. Leva financiare i zmadhon si fitimet, ashtu edhe humbjet.'),
        t('NE NUK GARANTOJMË ASNJËHERË FITIM — as 100%, as asnjë përqindje tjetër. Asnjë përmbajtje e platformës (statistika, përqindje suksesi, rezultate historike, mesazhe apo komunikime) nuk duhet kuptuar si premtim apo garanci fitimi. Rezultatet e kaluara NUK janë tregues i rezultateve të ardhshme.'),
        t('Tregto vetëm me para që mund të përballosh t\'i humbasësh. Vendimi për të hyrë në çdo pozicion — manualisht apo me robotin automatik — është gjithmonë vendimi YT dhe përgjegjësia JOTE.'),
      ],
    },
    {
      icon: Bot,
      title: t('4. Tregtimi automatik dhe palët e treta'),
      paras: [
        t('Roboti i ekzekutimit vepron VETËM në llogarinë tënde MT5, me parametrat që ti i cakton vetë (lot, TP, SL, numri i pozicioneve). Ti mund ta ndalësh në çdo moment. Konfigurimi i saktë i parametrave është përgjegjësia jote.'),
        t('Ekzekutimi varet nga palë të treta jashtë kontrollit tonë: brokeri yt, MetaApi, Telegram, ofruesit e internetit dhe të infrastrukturës. Vonesat, ndërprerjet, rrëshqitjet e çmimit (slippage), refuzimet e urdhrave apo dështimet teknike të këtyre palëve mund të ndikojnë në rezultat dhe nuk përbëjnë përgjegjësi tonën.'),
      ],
    },
    {
      icon: Scale,
      title: t('5. Kufizimi i përgjegjësisë'),
      paras: [
        t('Shërbimi ofrohet "SIÇ ËSHTË" dhe "SIPAS DISPONUESHMËRISË". Bëjmë çdo përpjekje të arsyeshme për saktësi dhe funksionim të pandërprerë, por nuk garantojmë pandërprerje, pagabueshmëri apo saktësi absolute të të dhënave.'),
        t('Në masën maksimale të lejuar nga ligji, MarGroup, pronarët, punonjësit dhe bashkëpunëtorët e saj NUK mbajnë përgjegjësi për humbje tregtare, humbje fitimi, humbje të dhënash apo dëme të tërthorta që rrjedhin nga përdorimi i platformës, i sinjaleve apo i robotit — përfshirë rastet e gabimeve teknike, vonesave apo pasaktësive.'),
      ],
    },
    {
      icon: CreditCard,
      title: t('6. Abonimet dhe pagesat'),
      paras: [
        t('Qasja në shërbime ofrohet me abonim (provë falas, mujor ose vjetor), me pagesë me kartë Debit/Kredit përmes Stripe dhe rinovim automatik në fund të periudhës. Çmimet shfaqen qartë para pagesës.'),
        t('Pagesa e abonimit blen QASJE në shërbimet, analizat dhe veglat tona — jo rezultat tregtar. Abonimin mund ta anulosh në çdo kohë nga "Menaxho abonimin"; qasja mbetet deri në fund të periudhës së paguar. Duke qenë shërbim dixhital me qasje të menjëhershme, periudhat e nisura nuk rimbursohen.'),
      ],
    },
    {
      icon: UserCheck,
      title: t('7. Llogaria, përdorimi i lejuar dhe pronësia intelektuale'),
      paras: [
        t('Regjistrimi kërkon të dhëna të sakta dhe të plota. Llogaria është personale dhe e patransferueshme — ndarja e kredencialeve, e sinjaleve apo e përmbajtjes me palë të treta është e ndaluar.'),
        t('Sinjalet, analizat, tekstet, kodi dhe gjithë përmbajtja e platformës janë pronë intelektuale e MarGroup. Kopjimi, fotografimi, rishpërndarja, rishitja ose publikimi i tyre pa leje me shkrim është i ndaluar dhe çon në mbylljen e menjëhershme të llogarisë pa rimbursim, si dhe në ndjekje sipas ligjit.'),
      ],
    },
    {
      icon: Lock,
      title: t('8. Privatësia dhe mbrojtja e të dhënave'),
      paras: [
        t('Mbledhim vetëm të dhënat e nevojshme për shërbimin: emri, mbiemri, email-i, datëlindja, telefoni, adresa, foto e profilit (opsionale), të dhënat e lidhjes me brokerin (të ruajtura të mbrojtura dhe të paekspozuara), historiku tregtar brenda platformës dhe të dhënat e pagesës (të përpunuara nga Stripe — ne nuk i shohim kurrë të dhënat e kartës).'),
        t('Të dhënat përdoren vetëm për funksionimin e shërbimit, nuk u shiten kurrë palëve të treta, dhe ruhen në infrastrukturë të sigurt (Supabase). Ke të drejtë të kërkosh qasje, korrigjim ose fshirje të plotë të të dhënave të tua — fshirjen e llogarisë e bën vetë nga Cilësimet → Abonimi, ose na shkruaj në support@goldsniper.vip.'),
      ],
    },
    {
      icon: Baby,
      title: t('9. Mosha minimale'),
      paras: [
        t('Platforma është vetëm për persona mbi 18 vjeç. Regjistrimi kërkon datëlindjen dhe llogaritë e personave nën 18 vjeç refuzohen automatikisht, për sigurinë e tyre.'),
      ],
    },
    {
      icon: RefreshCw,
      title: t('10. Ndryshimet e politikave'),
      paras: [
        t('Këto politika mund të përditësohen me zhvillimin e platformës. Versioni aktual gjendet gjithmonë në këtë faqe, me datën e përditësimit të fundit. Vazhdimi i përdorimit pas një ndryshimi nënkupton pranimin e versionit të ri.'),
      ],
    },
    {
      icon: Gavel,
      title: t('11. Ligji i zbatueshëm dhe pranimi'),
      paras: [
        t('Këto politika rregullohen nga ligjet e Republikës Federale të Gjermanisë, ku operon MarGroup. Nëse një dispozitë rezulton e pavlefshme, pjesa tjetër mbetet plotësisht në fuqi.'),
        t('Duke shënuar kutinë e pranimit gjatë regjistrimit dhe duke përdorur platformën, konfirmon se i ke lexuar, i ke kuptuar dhe i pranon plotësisht këto politika — përfshirë paralajmërimin e rrezikut dhe faktin që fitimi nuk garantohet kurrë.'),
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <button onClick={() => { window.location.hash = ''; }}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" />{t('Kthehu')}
          </button>
          <LanguageSwitcher />
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Scale className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Politikat Ligjore dhe Kushtet e Përdorimit')}</h1>
            <p className="text-gray-500 text-xs">GOLDSNIPER · goldsniper.vip · {t('Përditësuar më')} {LAST_UPDATED}</p>
          </div>
        </div>

        {/* Paralajmërimi kryesor — gjithmonë i pari dhe i padiskutueshëm. */}
        <div className="my-6 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 flex gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200 leading-relaxed font-medium">
            {t('PARALAJMËRIM RREZIKU: Tregtimi mbart rrezik të lartë humbjeje. Ne NUK garantojmë fitim — kurrë dhe në asnjë rrethanë. Ne jemi ekspertë tregtimi që ndajmë analizat, hulumtimet dhe dijen tonë; vendimi dhe përgjegjësia e çdo tregtimi mbetet gjithmonë e jotja.')}
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.title} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                  <Icon className="w-4 h-4 text-amber-400 shrink-0" />{s.title}
                </h2>
                <div className="space-y-2.5">
                  {s.paras.map((p, i) => (
                    <p key={i} className="text-[13px] text-gray-300 leading-relaxed">{p}</p>
                  ))}
                </div>
              </section>
            );
          })}

          <section className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.04] p-5">
            <h2 className="text-white font-bold text-sm mb-2 flex items-center gap-2">
              <Mail className="w-4 h-4 text-sky-400" />{t('12. Kontakti')}
            </h2>
            <p className="text-[13px] text-gray-300 leading-relaxed">
              {t('Për çdo pyetje rreth këtyre politikave, të dhënave apo shërbimit:')}{' '}
              <a href="mailto:support@goldsniper.vip" className="text-sky-300 font-semibold hover:underline">support@goldsniper.vip</a>
              {' · '}<span className="text-gray-400">goldsniper.vip</span>
            </p>
          </section>
        </div>

        <p className="text-center text-[11px] text-gray-600 mt-8">
          © {new Date().getFullYear()} MarGroup 🇩🇪 · GOLDSNIPER — goldsniper.vip
        </p>
      </div>
    </div>
  );
}
