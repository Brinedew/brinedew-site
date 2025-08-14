# environment consolidation + vllm optimization complete - 2025-08-14

I was working on two big problems: fixing the messy virtual environment situation and getting vLLM transcriptions to actually work without eating 100% GPU forever.

## what actually works now

**Environment consolidation is done:**
- Windows: Single `D:\Coding\Scriptotic\venv` environment for Flask/GUI (5.4GB)
- WSL2: Single `~/venv-vllm-stable` environment for vLLM (8GB, on fast ext4)
- Eliminated: `voxtral-env._trash` (archived the broken duplicate)

Files I changed:
- `start_scriptotic_web.ps1` - fixed to use explicit venv interpreter paths, added vLLM startup with optimized memory settings
- `src/core/web_server.py` - added runtime guard on line 20-22, new `/api/active-jobs` endpoint on line 381-386
- `smart_shutdown_monitor.ps1` - new file, smart activity-based shutdown (not dumb timers)

**vLLM memory optimization works:**
- Fixed KV cache from 0.24GB → 1.81GB available with FP8 + V0 engine fallback
- Command that works: `--kv-cache-dtype fp8_e5m2 --calculate-kv-scales --gpu-memory-utilization 0.95`
- RTX 4080 12GB can now run full 4096 context length

**Smart auto-shutdown implemented:**
- Monitors `/api/active-jobs` every 10 seconds
- Only shuts down after 60 seconds of ZERO active jobs
- Won't kill long transcriptions mid-process
- 4-hour safety limit to prevent runaway processes

Commands that work right now:
```bash
cd D:\Coding\Scriptotic
powershell -File "start_scriptotic_web.ps1" -Verbose  # starts everything + monitor
curl http://localhost:5000/api/active-jobs            # check job count
curl http://localhost:5000/api/server-status         # check Flask
curl http://localhost:8000/v1/models                 # check vLLM
```

## what's broken

**The core issue: vLLM can't handle 3+ hour podcasts**

Got a transcript for "The Goddess of Everything Else" (16 minutes) but it failed with:
```
HTTP 400: {"message":"Maximum file size exceeded.","type":"BadRequestError","code":400}
```

The transcription pipeline works but hits vLLM's audio processing limits around 16+ minutes. For 3-hour podcasts, we need:
- Audio chunking (split into 10-15 minute segments)
- Or audio compression/stripping (lower bitrate, mono, remove silence)
- Or different model with higher limits

**vLLM server gets stuck in processing loops:**
- After failed jobs, server stays at 100% GPU with no output
- Requires manual `pkill -f vllm` to reset
- Smart shutdown detects this but we need better error recovery

## where things stand

**System architecture is solid:**
- Environment consolidation complete (2 clean envs instead of 3 broken ones)
- Memory optimization working (FP8 KV cache, V0 engine)
- Smart shutdown monitoring active
- Flask + vLLM integration functional

**Currently running:**
- Flask server at localhost:5000 (might still be up)
- No vLLM server (killed the stuck one)
- Smart shutdown monitor probably running in background

**Test with working 16-minute video:**
- URL: `https://www.youtube.com/watch?v=Bbwp4PbWYzw`
- Downloads successfully (yt-dlp working)
- Processes until vLLM size limit hit
- Need chunking for longer content

## what to do next

**Most urgent: implement audio chunking for long podcasts**

The transcription pipeline is in `src/core/voxtral_engine.py` around lines 250-300. Need to:
1. Add audio duration detection after download
2. If >15 minutes, split into chunks using ffmpeg
3. Transcribe each chunk separately 
4. Concatenate results with timestamp alignment

Look at the `AudioDownloader` class - it already uses yt-dlp to get webm→wav. Add chunking logic there.

**Alternative approach: audio compression**
Before chunking, try aggressive compression:
- Mono audio (half the data)
- Lower sample rate (22kHz instead of 44kHz) 
- Remove silence gaps (ffmpeg silenceremove filter)

Could get 3+ hours down to vLLM's size limits.

## stuff to remember

**Environment paths that matter:**
- Windows venv: `D:\Coding\Scriptotic\venv\Scripts\python.exe` 
- WSL2 venv: `~/venv-vllm-stable/bin/activate`
- Never use `voxtral-env` (it's broken and archived)

**vLLM memory settings that work:**
```bash
--kv-cache-dtype fp8_e5m2 --calculate-kv-scales 
--gpu-memory-utilization 0.95 --max-num-seqs 1
```
Don't mess with these - they're tuned for RTX 4080 12GB.

**Smart shutdown is conservative:**
- 60 seconds true idle (no active jobs)
- Checks every 10 seconds
- 4-hour safety limit
- Won't interrupt running transcriptions

**The next person should focus on audio preprocessing, not the vLLM infrastructure.** All the hard memory/environment work is done. The bottleneck is now audio file size limits, not GPU memory or environment conflicts.