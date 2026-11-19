#!/usr/bin/env python3
"""
Overnight batch synced-lyrics pack builder for Unreleased Glass (CUDA GPU).

Zero-waste 3-pass funnel:
  Pass 0: Keep API synced_lyrics + query free LRCLIB for released songs + clean Genius tags.
  Pass 1: Fast direct CTC forced alignment (MMS-300M, ~1.2 GB VRAM, ~1s/song).
          When line timestamps already exist, aligns word-by-word within each line window.
  Pass 2: Vocal isolation (htdemucs) + CTC retry ONLY for tracks scoring < --demucs-threshold.
  Pass 3: Export accepted tracks (score >= --min-score) to synced-lyrics-pack.json.gz (~2-4 MB)
          and rejected tracks to review-queue.json.

Resumable via checkpoint.jsonl; temporary audio files are deleted immediately after each track.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_BASE = "https://juicewrldapi.com/juicewrld"
LRCLIB_GET = "https://lrclib.net/api/get"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"

SECTION_HEADER_RE = re.compile(r"^\s*\[[^\]]{1,60}\]\s*$")
REPEAT_MARKER_RE = re.compile(r"\s*\(\s*x\s*\d+\s*\)\s*", re.IGNORECASE)
LRC_LINE_RE = re.compile(r"^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$")


def http_get_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_file(url: str, dest: Path, timeout: int = 90) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out:
            shutil.copyfileobj(resp, out)
        return dest.exists() and dest.stat().st_size > 1024
    except Exception:
        return False


def clean_plain_lyrics(raw: str) -> list[str]:
    """Strip Genius section headers ([Intro], [Chorus]), repeat tags (x2), and empty noise."""
    lines: list[str] = []
    for raw_line in raw.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if SECTION_HEADER_RE.match(line):
            continue
        line = REPEAT_MARKER_RE.sub(" ", line).strip()
        if line:
            lines.append(line)
    return lines


def parse_lrc_lines(lrc: str) -> list[tuple[float, str]]:
    out: list[tuple[float, str]] = []
    for raw_line in lrc.replace("\r\n", "\n").split("\n"):
        m = LRC_LINE_RE.match(raw_line.strip())
        if not m:
            continue
        ts = int(m.group(1)) * 60.0 + float(m.group(2))
        text = m.group(3).strip()
        if text:
            out.append((ts, text))
    out.sort(key=lambda item: item[0])
    return out


def format_ts(sec: float) -> str:
    sec = max(0.0, sec)
    mins = int(sec // 60)
    rem = sec - mins * 60
    return f"{mins:02d}:{rem:05.2f}"


def query_lrclib(title: str, artist: str, duration_sec: float | None) -> str | None:
    params = {"track_name": title, "artist_name": artist or "Juice WRLD"}
    if duration_sec and duration_sec > 10:
        params["duration"] = str(int(round(duration_sec)))
    url = f"{LRCLIB_GET}?{urllib.parse.urlencode(params)}"
    try:
        data = http_get_json(url, timeout=15)
        synced = (data or {}).get("syncedLyrics")
        if isinstance(synced, str) and synced.strip() and parse_lrc_lines(synced):
            return synced.strip()
    except Exception:
        return None
    return None


def parse_duration(raw: Any) -> float | None:
    if isinstance(raw, (int, float)) and raw > 0:
        return float(raw)
    if isinstance(raw, str) and ":" in raw:
        parts = raw.strip().split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60.0 + float(parts[1])
            if len(parts) == 3:
                return int(parts[0]) * 3600.0 + int(parts[1]) * 60.0 + float(parts[2])
        except ValueError:
            return None
    return None


def separate_vocals_demucs(audio_path: Path, work_dir: Path, device: str) -> Path | None:
    """Isolate vocals with htdemucs for trap/808-heavy tracks that failed Pass 1."""
    out_dir = work_dir / "demucs_out"
    cmd = [
        sys.executable, "-m", "demucs",
        "-n", "htdemucs",
        "--two-stems", "vocals",
        "-d", device,
        "-o", str(out_dir),
        str(audio_path),
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if res.returncode != 0:
        return None
    vocals = out_dir / "htdemucs" / audio_path.stem / "vocals.wav"
    return vocals if vocals.exists() else None


def load_mono_16k(audio_path: Path, sample_rate: int = 16000):
    """Load any audio file (mp3/m4a/flac/wav) as 16 kHz mono float32 tensor."""
    import torch
    import torchaudio

    try:
        wav, sr = torchaudio.load(str(audio_path))
    except Exception:
        # Fallback via ffmpeg to 16 kHz mono wav when torchaudio backend cannot decode m4a/mp3
        wav_tmp = audio_path.with_suffix(".16k.wav")
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(audio_path),
            "-ac", "1", "-ar", str(sample_rate),
            str(wav_tmp),
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode != 0 or not wav_tmp.exists():
            raise RuntimeError("Could not decode audio with torchaudio or ffmpeg")
        wav, sr = torchaudio.load(str(wav_tmp))

    if wav.size(0) > 1:
        wav = wav.mean(dim=0, keepdim=True)
    if sr != sample_rate:
        wav = torchaudio.functional.resample(wav, sr, sample_rate)
    return wav


def normalize_mms_word(word: str) -> str:
    """Normalize a word to torchaudio MMS_FA dictionary characters (a-z and apostrophe)."""
    cleaned = re.sub(r"[^a-z']+", "", word.lower())
    return cleaned if cleaned else "*"


class CtcAlignerRunner:
    """Lazy-loaded native torchaudio MMS_FA (MMS-300M) forced aligner for CUDA GPU."""

    def __init__(self, device: str = "cuda"):
        self.device = device
        self._bundle = None
        self._model = None
        self._tokenizer = None
        self._aligner = None

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        import torch
        import torchaudio

        if self.device == "cuda" and not torch.cuda.is_available():
            self.device = "cpu"
        self._bundle = torchaudio.pipelines.MMS_FA
        self._model = self._bundle.get_model(with_star=True).to(self.device)
        self._model.eval()
        self._tokenizer = self._bundle.get_tokenizer()
        self._aligner = self._bundle.get_aligner()

    def _compute_emission(self, wav):
        """Compute log-prob emissions in 45s chunks so long studio sessions never OOM."""
        import torch

        sr = self._bundle.sample_rate
        chunk_samples = sr * 45
        emissions = []
        with torch.inference_mode():
            for start in range(0, wav.size(1), chunk_samples):
                chunk = wav[:, start : start + chunk_samples].to(self.device)
                if chunk.size(1) < 400:
                    continue
                if self.device == "cuda":
                    with torch.amp.autocast("cuda", dtype=torch.float16):
                        em, _ = self._model(chunk)
                else:
                    em, _ = self._model(chunk)
                emissions.append(em.float().cpu())
        if not emissions:
            return None
        return torch.cat(emissions, dim=1)

    def align_lines(
        self,
        audio_path: Path,
        lines: list[str],
        duration_sec: float | None = None,
        line_windows: list[tuple[float, float]] | None = None,
    ) -> tuple[str | None, float]:
        """
        Align cleaned lyric lines to audio using torchaudio MMS_FA and return
        (enhanced_lrc, confidence_score).
        """
        self._ensure_loaded()
        wav = load_mono_16k(audio_path, self._bundle.sample_rate)
        emission = self._compute_emission(wav)
        if emission is None or emission.size(1) == 0:
            return None, 0.0

        # Flatten words while tracking which line each word belongs to
        flat_words: list[tuple[int, str, str]] = []
        for line_idx, line in enumerate(lines):
            for raw_word in line.split():
                flat_words.append((line_idx, raw_word, normalize_mms_word(raw_word)))

        if not flat_words:
            return None, 0.0

        transcript = [w[2] for w in flat_words]
        tokens = self._tokenizer(transcript)
        # Align on CPU float32 emission (fast native C++ Viterbi in torchaudio)
        token_spans = self._aligner(emission[0], tokens)

        num_frames = emission.size(1)
        sec_per_frame = (wav.size(1) / float(self._bundle.sample_rate)) / float(num_frames)

        # Group aligned word spans back into LRC lines
        per_line: list[list[tuple[str, float, float, float]]] = [[] for _ in lines]
        prob_sum = 0.0
        aligned_count = 0
        last_end = 0.0
        crowded_words = 0

        for idx, (line_idx, raw_word, _) in enumerate(flat_words):
            spans = token_spans[idx] if idx < len(token_spans) else []
            if spans:
                st = spans[0].start * sec_per_frame
                en = max(st + 0.04, spans[-1].end * sec_per_frame)
                sc = sum(s.score for s in spans) / len(spans)
            else:
                st = last_end
                en = st + 0.12
                sc = 0.0

            if line_windows and line_idx < len(line_windows):
                win_start, win_end = line_windows[line_idx]
                st = min(max(st, win_start), max(win_start, win_end - 0.05))

            if en - st < 0.03:
                crowded_words += 1
            last_end = max(last_end, en)
            prob_sum += max(0.0, min(1.0, float(sc)))
            aligned_count += 1
            per_line[line_idx].append((raw_word, st, en, float(sc)))

        lrc_lines: list[str] = []
        for line_idx, items in enumerate(per_line):
            if not items:
                continue
            line_start = items[0][1]
            rendered = " ".join(f"<{format_ts(st)}>{word}" for word, st, _, _ in items)
            lrc_lines.append(f"[{format_ts(line_start)}]{rendered}")

        if aligned_count == 0 or not lrc_lines:
            return None, 0.0

        mean_prob = prob_sum / aligned_count
        crowd_penalty = min(0.35, (crowded_words / max(1, aligned_count)) * 0.5)
        audio_dur = duration_sec or (wav.size(1) / float(self._bundle.sample_rate))
        duration_penalty = 0.0
        if audio_dur > 15:
            if last_end > audio_dur * 1.15 or last_end < audio_dur * 0.25:
                duration_penalty = 0.25

        score = max(0.0, min(1.0, mean_prob - crowd_penalty - duration_penalty))
        return "\n".join(lrc_lines), round(score, 4)


def load_checkpoint(path: Path) -> dict[int, dict[str, Any]]:
    done: dict[int, dict[str, Any]] = {}
    if not path.exists():
        return done
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                done[int(row["id"])] = row
            except Exception:
                continue
    return done


def append_checkpoint(path: Path, row: dict[str, Any]) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def export_pack(checkpoint: dict[int, dict[str, Any]], out_dir: Path, min_score: float) -> None:
    songs: dict[str, str] = {}
    review_queue: list[dict[str, Any]] = []

    for song_id, row in sorted(checkpoint.items()):
        status = row.get("status")
        score = float(row.get("score", 0.0))
        lrc = row.get("lrc")
        if status == "ok" and isinstance(lrc, str) and lrc.strip() and score >= min_score:
            songs[str(song_id)] = lrc.strip()
        elif status in ("low_confidence", "error"):
            review_queue.append({
                "id": song_id,
                "name": row.get("name"),
                "score": score,
                "reason": row.get("reason", status),
            })

    payload = {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(songs),
        "songs": songs,
    }
    raw_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    pack_path = out_dir / "synced-lyrics-pack.json.gz"
    with gzip.open(pack_path, "wb", compresslevel=9) as gz:
        gz.write(raw_bytes)

    sha256 = hashlib.sha256(pack_path.read_bytes()).hexdigest()
    manifest = {
        "version": payload["version"],
        "generated_at": payload["generated_at"],
        "songs_included": len(songs),
        "review_queue_count": len(review_queue),
        "gz_bytes": pack_path.stat().st_size,
        "sha256": sha256,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out_dir / "review-queue.json").write_text(json.dumps(review_queue, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[export] Wrote {pack_path} ({pack_path.stat().st_size / (1024 * 1024):.2f} MB, {len(songs)} songs, {len(review_queue)} in review queue)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build synced-lyrics-pack.json.gz locally on GPU")
    parser.add_argument("--out", type=Path, default=Path("tools/sync-lyrics-pack/out"))
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on songs to process this run (0 = all)")
    parser.add_argument("--demucs-threshold", type=float, default=0.42, help="Retry with htdemucs below this MMS_FA score")
    parser.add_argument("--min-score", type=float, default=0.18, help="Minimum MMS_FA confidence score to include in final pack")
    parser.add_argument("--skip-demucs", action="store_true", help="Run Pass 0 + Pass 1 only (fastest dry run)")
    parser.add_argument("--export-only", action="store_true", help="Only rebuild synced-lyrics-pack.json.gz from checkpoint")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    ckpt_path = args.out / "checkpoint.jsonl"
    checkpoint = load_checkpoint(ckpt_path)

    if args.export_only:
        export_pack(checkpoint, args.out, args.min_score)
        return 0

    print("[pass 0] Fetching catalogue list from juicewrldapi.com...")
    catalog = http_get_json(f"{API_BASE}/songs/?all=true&omit=lyrics,synced_lyrics,groupbuy_info")
    print(f"[pass 0] Loaded {len(catalog)} songs; {len(checkpoint)} already in checkpoint.")

    aligner = CtcAlignerRunner(device=args.device)
    processed = 0

    for entry in catalog:
        song_id = int(entry["id"])
        if song_id in checkpoint:
            continue
        if args.limit and processed >= args.limit:
            break

        # Fetch full song metadata (lyrics + synced_lyrics + path)
        try:
            song = http_get_json(f"{API_BASE}/songs/{song_id}/", timeout=20)
        except Exception as exc:
            append_checkpoint(ckpt_path, {"id": song_id, "name": entry.get("name"), "status": "error", "reason": str(exc)})
            continue

        name = song.get("name") or entry.get("name") or f"song-{song_id}"
        existing_synced = (song.get("synced_lyrics") or "").strip()
        raw_lyrics = (song.get("lyrics") or "").strip()
        audio_rel = (song.get("path") or "").strip()
        duration = parse_duration(song.get("length"))
        category = song.get("category")

        # Skip songs that already have official synced_lyrics on the API
        if existing_synced:
            append_checkpoint(ckpt_path, {"id": song_id, "name": name, "status": "api_synced", "score": 1.0})
            continue

        if not raw_lyrics or not audio_rel:
            append_checkpoint(ckpt_path, {"id": song_id, "name": name, "status": "skipped", "reason": "no_lyrics_or_audio"})
            continue

        processed += 1

        # Pass 0B: Try LRCLIB first for released songs (free, instant)
        lrclib_lrc = None
        if category == "released":
            lrclib_lrc = query_lrclib(name, song.get("credited_artists") or "Juice WRLD", duration)
            if lrclib_lrc:
                append_checkpoint(ckpt_path, {"id": song_id, "name": name, "status": "ok", "source": "lrclib", "score": 0.95, "lrc": lrclib_lrc})
                print(f"[lrclib] #{song_id} {name} -> ok (0.95)")
                continue

        cleaned = clean_plain_lyrics(raw_lyrics)
        if len(cleaned) < 2:
            append_checkpoint(ckpt_path, {"id": song_id, "name": name, "status": "skipped", "reason": "too_few_lines"})
            continue

        # Download audio to a per-song temp directory that is wiped immediately after alignment
        audio_url = f"{API_BASE}/files/download/?path={urllib.parse.quote(audio_rel)}"
        with tempfile.TemporaryDirectory(prefix=f"jw_{song_id}_") as tmp_str:
            tmp_dir = Path(tmp_str)
            ext = Path(audio_rel).suffix or ".mp3"
            audio_file = tmp_dir / f"track{ext}"
            if not download_file(audio_url, audio_file):
                append_checkpoint(ckpt_path, {"id": song_id, "name": name, "status": "error", "reason": "audio_download_failed"})
                continue

            t0 = time.time()
            try:
                lrc, score = aligner.align_lines(audio_file, cleaned, duration_sec=duration)
                source = "ctc_direct"

                # Pass 2: Vocal isolation (htdemucs) ONLY when Pass 1 confidence is below threshold
                if not args.skip_demucs and score < args.demucs_threshold:
                    vocals = separate_vocals_demucs(audio_file, tmp_dir, args.device)
                    if vocals:
                        lrc2, score2 = aligner.align_lines(vocals, cleaned, duration_sec=duration)
                        if lrc2 and score2 > score:
                            lrc, score, source = lrc2, score2, "demucs_ctc"

                dt = time.time() - t0
                if lrc and score >= args.min_score:
                    row = {"id": song_id, "name": name, "status": "ok", "source": source, "score": score, "lrc": lrc}
                    print(f"[{source}] #{song_id} {name} -> {score:.2f} ({dt:.1f}s)")
                else:
                    row = {"id": song_id, "name": name, "status": "low_confidence", "source": source, "score": score}
                    print(f"[low] #{song_id} {name} -> {score:.2f} ({dt:.1f}s)")
                append_checkpoint(ckpt_path, row)
                checkpoint[song_id] = row
            except Exception as exc:
                append_checkpoint(ckpt_path, {"id": song_id, "name": name, "status": "error", "reason": str(exc)})
                print(f"[err] #{song_id} {name}: {exc}")

    export_pack(checkpoint, args.out, args.min_score)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
