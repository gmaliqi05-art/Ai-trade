# GOLDTRADE — Aplikacioni Android

Mbështjellës nativ i platformës web me **bllokim të vërtetë të screenshot-eve** (`FLAG_SECURE`):
screenshot-et, regjistrimet e ekranit dhe screen-share dalin **të zeza** ose refuzohen nga
sistemi operativ — mbrojtje që shfletuesi nuk mund ta japë.

## Si merret APK-ja

Ndërtohet automatikisht nga GitHub Actions (workflow **Build Android APK**) sa herë ndryshon
diçka në `android/`, dhe publikohet te **Releases → GOLDTRADE — Android APK** (tag `android-apk`).
Linku i shkarkimit mbetet gjithmonë i njëjti.

Instalimi në telefon: shkarko `GOLDTRADE.apk` → hape → lejo "Instalimin nga burime të panjohura" → Instalo.

## Konfigurimi

- **Adresa e platformës**: konstantja `APP_URL` te `MainActivity.java` (një rresht).
- **Llogaria e përjashtuar nga bllokimi**: kontrollohet nga platforma web
  (`src/components/ScreenshotShield.tsx`, lista `ALLOWED_EMAILS`) përmes urës `AndroidShield` —
  s'ka nevojë të ndryshohet asgjë këtu.

## Kufizim i njohur

Njoftimet push të web-it nuk funksionojnë brenda WebView-it të Android-it (kufizim i platformës).
Përdoruesit që duan push-et i marrin nga shfletuesi/PWA; integrimi FCM nativ është hap i ardhshëm
nëse kërkohet.
