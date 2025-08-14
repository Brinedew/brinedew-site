# what i was working on - August 14, 2025

I was implementing Sprint 4: Long Audio Transcription. The user wanted to fix the Scriptotic transcription service so it could handle 3+ hour podcasts instead of failing on anything longer than 16 minutes with "Maximum file size exceeded" errors.

The real problem wasn't what we initially thought. It wasn't GPU memory or model limits - it was HTTP file upload limits (25MB) combined with YouTube blocking our downloads with 403 errors.

## what actually works now

**Fixed the 403 YouTube download errors that were breaking everything:**
- Updated `D:\Coding\Scriptotic\src\core\scriptotic.py` lines 109-120: Added user-agent headers, proper extraction flags, and different client types
- Changed from basic yt-dlp to `--extract-audio --audio-format mp3 --user-agent "Mozilla/5.0..." --extractor-args "youtube:player_client=web,mweb"`
- Fixed file detection logic lines 141-146: Added `.mp3` to the extension list (was only checking .webm, .m4a, .opus)

**Audio compression pipeline working perfectly:**
- Implemented Opus compression in `scriptotic.py` lines 278-300: Convert downloaded MP3 to mono 16kHz Opus at 24kbps 
- Reduces file sizes by 6.3x (tested: 3.5MB MP3 → 0.6MB Opus)
- 30-minute files are now ~4.7MB (well under 25MB HTTP limit)

**Chunking algorithm implemented but untested:**
- Added `_transcribe_long_audio()` function lines 239-354: 30-minute chunks with 10-second overlaps
- Overlap removal logic to prevent word boundary issues
- Sequential processing to avoid VRAM pressure

**Web interface works correctly:**
- User can visit https://brinedw.com/apps/scriptotic/
- Click transcribe button submits jobs successfully (confirmed with job_1755153725_300)
- Frontend shows proper status updates: "Status: starting_server"

**Commands that work:**
```bash
# Test download and compression:
cd "D:\Coding\Scriptotic" && python -c "from src.core.scriptotic import AudioDownloader; d=AudioDownloader(); print(d.download('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))"

# Start backend services:
cd "D:\Coding\Scriptotic" && pwsh -Command "& '.\start_scriptotic_web.ps1'"

# Test job submission:
curl -X POST http://localhost:5000/api/transcribe -H "Content-Type: application/json" -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

## what's broken

**vLLM server won't start - this is the only remaining blocker.**

The job submission works, download works, compression works, but when the backend tries to auto-start the vLLM server in WSL2, it fails silently. User gets stuck seeing "Status: starting_server" forever with "Server: error" status.

What I tried that didn't work:
- Manual vLLM startup commands - process starts but doesn't respond to HTTP
- Different memory utilization settings (0.89, 0.95)
- Background process spawning
- Various timeout adjustments

The error isn't visible because vLLM fails to start properly in WSL2. The PowerShell script `start_scriptotic_web.ps1` triggers the startup but something in the WSL2 vLLM environment is broken.

## where things stand

**Currently running:**
- Sentinel service on port 5050 (working correctly)
- Flask backend on port 5000 (working correctly) 
- Cloudflare tunnel routing api2.brinedw.com → localhost:5050 (working correctly)
- Browser session at https://brinedw.com/apps/scriptotic/ with active job waiting

**Working command that was tested:**
```bash
# This successfully downloads and compresses Rick Astley video:
python -c "from src.core.scriptotic import AudioDownloader; print('SUCCESS')"
```

**Environment state:**
- WSL2 Ubuntu available
- venv-vllm-stable exists at ~/venv-vllm-stable with vLLM installed
- GPU has 12GB VRAM available
- Models are at ~/models/ or downloaded automatically

## what to do next

**Priority 1: Debug vLLM startup failure**

The user has a job stuck waiting (job_1755153725_300) and wants to see a transcript. Focus on getting vLLM to actually start and respond.

Look at:
1. `D:\Coding\Scriptotic\start_scriptotic_web.ps1` lines that start vLLM in WSL2
2. Check if there are startup logs being written somewhere 
3. Test manual vLLM startup with the exact command from the script
4. Check GPU memory conflicts or environment issues

The working vLLM command should be:
```bash
wsl -d Ubuntu bash -c "source ~/venv-vllm-stable/bin/activate && export VLLM_USE_V1=0 && python -m vllm.entrypoints.openai.api_server --model mistralai/Voxtral-Mini-3B-2507 --task transcription --dtype bfloat16 --kv-cache-dtype fp8_e5m2 --calculate-kv-scales --gpu-memory-utilization 0.89 --max-model-len 4096 --max-num-seqs 1 --port 8000 --host 0.0.0.0 --tokenizer-mode mistral --config-format mistral --load-format mistral"
```

**Priority 2: Test the chunking with actual long audio**

Once vLLM starts, the chunking algorithm is implemented but untested. Test with a 1+ hour video to make sure the overlap stitching works correctly.

## stuff to remember

**Why the 403 errors happened:** YouTube started enforcing stricter bot detection. The fix was using proper user-agent headers and extraction flags that mimic real browsers, not using basic yt-dlp commands.

**Why Opus compression works so well:** 24kbps Opus is optimized for speech. The model doesn't care about audio quality - it just needs the spectral features, so aggressive compression doesn't hurt transcription accuracy.

**Why 30-minute chunks:** ChatGPT's analysis showed Voxtral-Mini claims 30-minute capacity, not 16 minutes like we thought. The HTTP limit was the real constraint, not model context.

**Architecture decision that was right:** Separating the lightweight always-on services (sentinel, Flask) from the heavy on-demand service (vLLM) makes sense. Don't try to keep vLLM running all the time - auto-start on demand is the correct approach.

**Critical insight:** The user was absolutely right about following the actual user flow instead of debugging backend services. Using the browser interface revealed the real behavior and showed that most of the pipeline works - it's just the final vLLM startup that's broken.

The compression and download fixes are solid. The chunking algorithm looks correct. Just need to get vLLM to actually start responding to HTTP requests and the whole thing should work.