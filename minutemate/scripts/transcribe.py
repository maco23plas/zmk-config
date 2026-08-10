#!/usr/bin/env python3
"""ローカル文字起こし (faster-whisper)。完全無料・オフラインで動く。
usage: python3 transcribe.py <audio file> <out json>
env:   WHISPER_MODEL=tiny|base|small|medium (default small)
"""
import json
import os
import sys

from faster_whisper import WhisperModel

audio, out = sys.argv[1], sys.argv[2]
model_name = os.environ.get("WHISPER_MODEL", "small")
model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, info = model.transcribe(
    audio,
    language=os.environ.get("WHISPER_LANG") or None,
    vad_filter=True,
)
result = {
    "language": info.language,
    "segments": [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in segments
        if s.text.strip()
    ],
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
print(f"transcribed {len(result['segments'])} segments ({info.language})")
