"""
Telegram Sin — userbot kopjues (forwarder).

Logohet me llogarinë TËNDE të Telegram-it (jo bot), lexon kanalin/kanalet e trejderave
ku je abonent, dhe ia përcjell çdo mesazh sistemit Telegram Sin (webhook-ut) — 24/7.
NUK poston, NUK jep reagime, NUK përcjell asgjë të dukshme te kanali. Vetëm LEXON.

Env variablat e nevojshme:
  TG_API_ID      — nga https://my.telegram.org (App api_id)
  TG_API_HASH    — nga https://my.telegram.org (App api_hash)
  TG_SESSION     — session string (krijohet një herë me login.py)
  TG_SOURCE      — kanali/kanalet: @username ose id numerik (-100...), ndaj me presje.
                   Bosh = VETËM XNINE (parazgjedhje e sigurt, shih DEFAULT_SOURCES).
  WEBHOOK_URL    — URL-ja e plotë e webhook-ut me ?key=... (nga faqja Telegram Sin)
  BACKFILL_HOURS — (opsionale) rilexo mesazhet e X orëve të fundit VETËM PËR SHIKIM
                   (shfaqen në platformë me flamurin history=true → NUK hapin tregti).
                   Vendose një herë (p.sh. 24) → ridezo → hiqe/0 që të mos rilexojë sërish.

RREGULLI I ARTË: i njëjti TG_SESSION guxon të përdoret VETËM në një instancë
(një service në Railway). Nëse e nis dy herë njëkohësisht (p.sh. service i dytë),
Telegrami e anulon çelësin përgjithmonë me AuthKeyDuplicatedError dhe feed-i ndalet.
"""
import os
import sys
import asyncio
import aiohttp
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.errors import AuthKeyDuplicatedError

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
SESSION = os.environ["TG_SESSION"]
WEBHOOK = os.environ["WEBHOOK_URL"]
_raw_sources = os.environ.get("TG_SOURCE", "").strip()
try:
    BACKFILL_HOURS = float(os.environ.get("BACKFILL_HOURS", "0") or "0")
except ValueError:
    BACKFILL_HOURS = 0.0

# Parazgjedhja: VETËM "FX+ | XNINE LEVEL 2" — që feed-i të mos dëgjojë kurrë "të gjitha"
# bisedat dhe të mos përzihet me kanale të tjera nëse TG_SOURCE lihet bosh.
DEFAULT_SOURCES = [-1003278125980]


def _parse_sources(raw: str):
    out = []
    for s in raw.split(","):
        s = s.strip()
        if not s:
            continue
        # id numerik (p.sh. -1001234567890) → int; ndryshe @username ose emër
        if s.lstrip("-").isdigit():
            out.append(int(s))
        else:
            out.append(s)
    return out


SOURCES = _parse_sources(_raw_sources) or DEFAULT_SOURCES
client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)


async def post_to_webhook(text: str, chat_id: int, message_id: int, title: str, history: bool = False):
    # Formati përputhet me atë që pret edge function-i (update.channel_post).
    # history=True → mesazhi vetëm regjistrohet/shfaqet, NUK hap tregti (rilexim historik).
    payload = {
        "channel_post": {
            "text": text,
            "chat": {"id": chat_id},
            "message_id": message_id,
            "sender_chat": {"title": title},
        }
    }
    if history:
        payload["history"] = True
    async with aiohttp.ClientSession() as s:
        try:
            async with s.post(WEBHOOK, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as r:
                body = await r.text()
                print(f"→ webhook {r.status}: {body[:200]}", flush=True)
        except Exception as e:
            print(f"! gabim webhook: {e}", flush=True)


@client.on(events.NewMessage(chats=SOURCES))
async def handler(event):
    msg = event.message
    text = msg.message or ""
    if not text.strip():
        return  # anashkalo foto/video pa tekst
    try:
        chat = await event.get_chat()
        title = getattr(chat, "title", "") or ""
    except Exception:
        title = ""
    print(f"⇢ sinjal ({title}): {text[:70].replace(chr(10), ' ')}", flush=True)
    await post_to_webhook(text, event.chat_id, msg.id, title)


async def backfill():
    """Rilexon mesazhet e BACKFILL_HOURS orëve të fundit VETËM PËR SHIKIM (history=True).
    Nuk hap tregti; dublikatat shmangen nga edge function-i (tg_message_id)."""
    if BACKFILL_HOURS <= 0:
        return
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(hours=BACKFILL_HOURS)
    print(f"↺ Backfill: po rilexoj {BACKFILL_HOURS}h të fundit (vetëm shikim)…", flush=True)
    total = 0
    for src in SOURCES:
        try:
            ent = await client.get_entity(src)
            title = getattr(ent, "title", "") or ""
        except Exception:
            title = ""
        batch = []
        try:
            async for m in client.iter_messages(src):  # nga i riu te i vjetri
                if m.date < cutoff:
                    break
                if (m.message or "").strip():
                    batch.append(m)
        except Exception as e:
            print(f"! backfill s'lexoi dot {src}: {e}", flush=True)
            continue
        batch.reverse()  # dërgoji nga i vjetri te i riu (renditje kronologjike)
        for m in batch:
            await post_to_webhook(m.message, m.chat_id, m.id, title, history=True)
            total += 1
            await asyncio.sleep(0.3)  # i butë me webhook-un
        print(f"↺ Backfill {src}: {len(batch)} mesazhe", flush=True)
    print(f"↺ Backfill përfundoi: {total} mesazhe (pa tregti). Hiqe BACKFILL_HOURS që të mos përsëritet.", flush=True)


def _print_dead_session_help():
    print("\n" + "=" * 64, flush=True)
    print("✗ SESIONI ËSHTË ANULUAR (AuthKeyDuplicatedError).", flush=True)
    print("  I njëjti TG_SESSION u përdor në dy vende njëkohësisht → Telegrami", flush=True)
    print("  e mbylli përgjithmonë. Feed-i s'do të punojë derisa ta rregullosh:", flush=True)
    print("    1) Sigurohu që ke VETËM NJË service që përdor këtë sesion.", flush=True)
    print("    2) Krijo një TG_SESSION të RI:  python login.py", flush=True)
    print("    3) Vendose te Railway → Variables → TG_SESSION → Redeploy.", flush=True)
    print("=" * 64 + "\n", flush=True)


async def main():
    # Nis me pak durim ndaj gabimeve kalimtare të rrjetit; por AuthKeyDuplicated
    # është vdekjeprurës — s'ka kuptim të riprovohet, vetëm sqarohet dhe fle gjatë
    # (që restart-i ALWAYS i Railway-t të mos e mbushë log-un me të njëjtin traceback).
    for attempt in range(1, 6):
        try:
            await client.start()
            break
        except AuthKeyDuplicatedError:
            _print_dead_session_help()
            await asyncio.sleep(900)  # 15 min pushim para se Railway ta ridezojë
            sys.exit(1)
        except Exception as e:
            wait = min(2 ** attempt, 30)
            print(f"! nisja dështoi ({e}); riprovoj për {wait}s…", flush=True)
            await asyncio.sleep(wait)
    else:
        print("! s'u lidha dot pas disa provave — dal.", flush=True)
        sys.exit(1)

    me = await client.get_me()
    who = me.username or me.first_name or me.id
    print(f"✓ Kyçur si: {who}", flush=True)
    print(f"✓ Dëgjon: {SOURCES}", flush=True)
    try:
        await backfill()
    except Exception as e:
        print(f"! backfill dështoi (vazhdoj live): {e}", flush=True)
    print("✓ Në pritje të sinjaleve… (24/7)", flush=True)
    try:
        await client.run_until_disconnected()
    except AuthKeyDuplicatedError:
        _print_dead_session_help()
        await asyncio.sleep(900)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
