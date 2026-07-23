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
                   Bosh = dëgjon TË GJITHA bisedat (jo e rekomanduar).
  WEBHOOK_URL    — URL-ja e plotë e webhook-ut me ?key=... (nga faqja Telegram Sin)
"""
import os
import asyncio
import aiohttp
from telethon import TelegramClient, events
from telethon.sessions import StringSession

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
SESSION = os.environ["TG_SESSION"]
WEBHOOK = os.environ["WEBHOOK_URL"]
_raw_sources = os.environ.get("TG_SOURCE", "").strip()


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


SOURCES = _parse_sources(_raw_sources)
client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)


async def post_to_webhook(text: str, chat_id: int, message_id: int, title: str):
    # Formati përputhet me atë që pret edge function-i (update.channel_post).
    payload = {
        "channel_post": {
            "text": text,
            "chat": {"id": chat_id},
            "message_id": message_id,
            "sender_chat": {"title": title},
        }
    }
    async with aiohttp.ClientSession() as s:
        try:
            async with s.post(WEBHOOK, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as r:
                body = await r.text()
                print(f"→ webhook {r.status}: {body[:200]}", flush=True)
        except Exception as e:
            print(f"! gabim webhook: {e}", flush=True)


@client.on(events.NewMessage(chats=SOURCES if SOURCES else None))
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


async def main():
    await client.start()
    me = await client.get_me()
    who = me.username or me.first_name or me.id
    print(f"✓ Kyçur si: {who}", flush=True)
    print(f"✓ Dëgjon: {SOURCES if SOURCES else 'TË GJITHA bisedat'}", flush=True)
    print("✓ Në pritje të sinjaleve… (24/7)", flush=True)
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
