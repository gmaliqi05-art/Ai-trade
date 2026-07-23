"""
Telegram Sin — SETUP me një komandë.
Ekzekuto NJË HERË:  python setup.py

Të kërkon api_id, api_hash, numrin e telefonit dhe kodin (që vjen në Telegram).
Pastaj shtyp:
  1) TG_SESSION  — vargu sekret që të duhet për host-in (ruaje, mos ia jep askujt)
  2) listën e kanaleve me ID — gjej "FX+ | XNINE LEVEL 2" dhe kopjo ID-në (TG_SOURCE)
"""
from telethon import TelegramClient
from telethon.sessions import StringSession

print("=== Telegram Sin — Setup ===\n")
api_id = int(input("1) TG_API_ID (nga my.telegram.org): ").strip())
api_hash = input("2) TG_API_HASH: ").strip()
print("\n(Do të kërkohet numri i telefonit dhe kodi që vjen në Telegram)\n")

with TelegramClient(StringSession(), api_id, api_hash) as client:
    session_str = client.session.save()
    me = client.get_me()

    print("\n\n================= TG_SESSION =================")
    print(session_str)
    print("=============================================")
    print("↑ Kopjoje TË GJITHIN. Vendose si sekret 'TG_SESSION'. MOS ia jep askujt.\n")

    print("\n============== KANALET E TUA (gjej FX+) ==============")
    print(f"{'ID (TG_SOURCE)':>18}  {'lloji':7}  emri")
    print("-" * 64)
    for d in client.iter_dialogs():
        if d.is_channel or d.is_group:
            kind = "kanal" if d.is_channel else "grup"
            print(f"{d.id:>18}  {kind:7}  {d.name}")
    print("\n↑ Gjej rreshtin 'FX+ | XNINE LEVEL 2' dhe kopjo ID-në (kolona e parë) → TG_SOURCE.\n")
