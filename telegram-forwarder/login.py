"""
Hapi NJË HERË: krijon 'session string' për userbot-in.
Ekzekuto në kompjuterin tënd:  python login.py
Të kërkon api_id, api_hash, numrin e telefonit dhe kodin që të vjen në Telegram.
Në fund shtyp një varg të gjatë — ai është TG_SESSION (ruaje si sekret, mos ia jep askujt).
"""
from telethon import TelegramClient
from telethon.sessions import StringSession

print("=== Krijimi i session string për Telegram Sin ===\n")
api_id = int(input("TG_API_ID (nga my.telegram.org): ").strip())
api_hash = input("TG_API_HASH: ").strip()

with TelegramClient(StringSession(), api_id, api_hash) as client:
    print("\n\n================= TG_SESSION =================\n")
    print(client.session.save())
    print("\n=============================================")
    print("↑ Kopjoje të gjithin. Vendose si sekret 'TG_SESSION'. MOS ia jep askujt.\n")
