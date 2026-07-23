"""
Ndihmës: liston bisedat/kanalet e tua me ID-të e tyre — që të gjesh ID-në e saktë
të kanalit "FX+ | XNINE LEVEL 2" për ta vendosur te TG_SOURCE.
Ekzekuto:  python list_chats.py   (kërkon TG_API_ID, TG_API_HASH, TG_SESSION si env)
"""
import os
from telethon import TelegramClient
from telethon.sessions import StringSession

with TelegramClient(StringSession(os.environ["TG_SESSION"]), int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"]) as client:
    print(f"{'ID':>16}  {'lloji':10}  emri")
    print("-" * 60)
    for d in client.iter_dialogs():
        kind = "kanal" if d.is_channel else ("grup" if d.is_group else "person")
        print(f"{d.id:>16}  {kind:10}  {d.name}")
