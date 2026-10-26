import asyncio
import sys
import edge_tts

text_path, voice, rate, pitch, out_path = sys.argv[1:6]
with open(text_path, "r", encoding="utf-8") as f:
    text = f.read().strip()
if not text:
    raise SystemExit("empty text")
async def main():
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await communicate.save(out_path)
asyncio.run(main())
