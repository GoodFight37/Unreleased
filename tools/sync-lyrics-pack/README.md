# Offline Synced-Lyrics Pack Pipeline (CUDA GPU)

This standalone script runs **locally on your GPU** (outside the Electron app bundle) to build a lightweight compressed pack (`synced-lyrics-pack.json.gz`, ~2–4 MB) that every Unreleased Glass user automatically downloads from GitHub Releases.

## Setup (Windows + NVIDIA CUDA GPU)

```powershell
python -m venv tools/sync-lyrics-pack/.venv
tools/sync-lyrics-pack/.venv/Scripts/Activate.ps1
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r tools/sync-lyrics-pack/requirements.txt
```

## Run overnight (resumable)

```powershell
# Test on 20 songs first
python tools/sync-lyrics-pack/run_batch.py --limit 20

# Full catalogue overnight (safe to Ctrl+C and resume anytime)
python tools/sync-lyrics-pack/run_batch.py
```

## Publish for all Unreleased Glass users

Upload `tools/sync-lyrics-pack/out/synced-lyrics-pack.json.gz` as an asset on a GitHub Release tagged **`lyrics-pack-latest`** in `GoodFight37/Unreleased`.
The app automatically fetches, caches in `userData/synced-lyrics-pack.json.gz`, and updates once every 24h via ETag.
