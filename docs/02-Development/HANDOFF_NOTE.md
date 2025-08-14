# what i was working on - August 13, 2025

I was implementing the Scriptotic on-demand activation system. The user wanted visitors to be able to remotely trigger transcription services when their PC is online, instead of having to manually start Flask + vLLM every time.

The real problem: Visitors would go to brinedew.com/apps/scriptotic/, click "Transcribe", and get "Server: offline" because the heavy backend wasn't running. They wanted a way to wake up the backend automatically when someone actually wants to use it.

## what actually works now

**The sentinel activation system is mostly working:**
- Built `D:\Coding\Scriptotic\sentinel\sentinel.py` - lightweight proxy that runs on port 5050
- Frontend at brinedw.com/apps/scriptotic/ sends requests to api2.brinedw.com (via Cloudflare tunnel)  
- Tunnel correctly routes api2.brinedw.com → sentinel on localhost:5050
- Sentinel returns proper 202 responses when backend is starting
- Job submission works (I got job_1755085305_967 when testing)

**Files I changed:**
- `D:\Coding\Website\quartz\static\apps\scriptotic\app.js` - Added 202 response handling, auto-retry logic, startup status display
- `D:\Coding\Website\quartz\static\apps\scriptotic\app.css` - Added visual states for offline/starting/ready server status
- `D:\Coding\Scriptotic\sentinel\sentinel.py` - Complete state machine (idle → starting → ready → draining)
- `D:\Coding\Scriptotic\start_scriptotic_web.ps1` - PowerShell script for backend startup
- `D:\Coding\Scriptotic\stop_scriptotic_web.ps1` - PowerShell script for backend shutdown

**What you can test right now:**
```bash
curl http://localhost:5050/api/server-status    # Sentinel health
curl https://api2.brinedw.com/api/server-status # Through live tunnel
```
Both should return JSON with status info.

**Frontend integration:**
- Default YouTube URL now populated: `https://www.youtube.com/watch?v=Bbwp4PbWYzw`
- Handles "starting" state with ETA countdown
- Auto-retries when backend becomes ready
- Visual feedback: red (offline), yellow pulsing (starting), green (ready)

## what's broken

**The transcription never completes** because Flask can't start vLLM properly:

1. **Wrong Python environment**: PowerShell script tries to use `voxtral-env` but vLLM is actually installed in `venv-vllm-stable`
2. **Missing required flags**: vLLM needs `--tokenizer-mode mistral --config-format mistral --load-format mistral` or it crashes with tokenizer errors

**Error I kept getting:**
```
ValueError: Kwargs ['max_loras', '_from_auto'] are not supported by `MistralCommonTokenizer.from_pretrained`.
```

**What I tried that didn't work:**
- Using system Python directly (had flask_cors issues)
- Fixing PATH issues with Anaconda vs system Python  
- Restarting Cloudflare tunnel (tunnel was fine, backend was broken)

## where things stand

**Currently running:**
- Sentinel service on port 5050 (working correctly)
- Flask backend on port 5000 (shows "error" status because vLLM won't start)
- Cloudflare tunnel routing api2.brinedw.com → localhost:5050

**GPU status:** Was at 10/12GB VRAM when I manually started vLLM with correct flags - model was actually loading successfully before I killed it.

**Working commands:**
```bash
# This worked - vLLM was actually loading the model:
wsl -d Ubuntu bash -c "source ~/venv-vllm-stable/bin/activate && python -m vllm.entrypoints.openai.api_server --model mistralai/Voxtral-Mini-3B-2507 --task transcription --dtype bfloat16 --gpu-memory-utilization 0.89 --max-model-len 4096 --port 8000 --host 0.0.0.0 --tokenizer-mode mistral --config-format mistral --load-format mistral"

# But the PowerShell script is using the wrong environment:
# WRONG: source voxtral-env/bin/activate  
# RIGHT: source ~/venv-vllm-stable/bin/activate
```

## what to do next

**Fix the PowerShell script environment** in `D:\Coding\Scriptotic\start_scriptotic_web.ps1`:

1. Change line that activates Python environment from `voxtral-env` to `~/venv-vllm-stable`
2. Add the missing Mistral flags to the vLLM command (all three are required according to CLAUDE.md)
3. Test the end-to-end flow: visit website → click transcribe → wait for "ready" → job should actually process

The architecture is working - I proved the tunnel routes correctly and the sentinel handles requests. It's just that the Flask backend can't start vLLM because it's calling the wrong Python environment.

**Why this matters:** The user submitted a transcription job (job_1755085305_967) but got no transcript because vLLM failed to start. Fix the environment path and the job should complete normally.

## stuff to remember

**Critical insight:** PowerShell PATH resolution picked up Anaconda Python instead of system Python, but that wasn't the real issue. The real issue was using the wrong WSL virtual environment entirely.

**vLLM model loading:** Takes several minutes and uses ~10GB VRAM. The startup was actually working when I used the correct environment + flags - I could see it parsing model files and loading successfully.

**Cloudflare tunnel gotcha:** I initially tried to "fix" the tunnel config but the tunnel was already working fine. The 404 errors were from trying to call api2.brinedw.com before the tunnel was configured, not from tunnel issues.

**Windows path separators:** Added documentation to root CLAUDE.md about using forward slashes in PowerShell arguments. `src\core\web_server.py` becomes `srccoreweb_server.py` due to backslash escaping.

**Chesterton's fence - Why voxtral-env exists:**

I initially thought "just change the environment path from voxtral-env to venv-vllm-stable" but that would break things. Here's why both environments exist:

```bash
# voxtral-env (on NTFS /mnt/d/...) - Flask web server dependencies:
source /mnt/d/Coding/Scriptotic/voxtral-env/bin/activate
python -c "import flask"  # ❌ Flask not available
pip list | grep requests  # ✅ requests==2.31.0

# venv-vllm-stable (on ext4 ~/...) - vLLM model server:  
source ~/venv-vllm-stable/bin/activate
python -c "import vllm"   # ✅ vllm==0.10.0  
python -c "import flask"  # ❌ Flask not available
```

**The original architecture was actually correct:**
1. Flask web server runs from `voxtral-env` (handles HTTP requests, job management)
2. vLLM model server runs from `venv-vllm-stable` (handles ML inference)
3. They communicate via HTTP: Flask → `http://localhost:8000` → vLLM

**But there's a critical performance bug:** `voxtral-env` is on NTFS filesystem which causes 12x slower Python imports (CLAUDE.md documents this: "30+ second import hangs vs 2.5s on ext4").

**What would break if I just switched to venv-vllm-stable:**
```python
# web_server.py line 15-16:
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
# ❌ Both missing from venv-vllm-stable
```

**The real fix isn't changing the environment path - it's fixing the performance issue:**

Option 1: Install Flask in the fast environment:
```bash
source ~/venv-vllm-stable/bin/activate  
pip install flask flask-cors requests
```

Option 2: Create new fast environment with all dependencies:
```bash
cd ~ && python -m venv venv-scriptotic-combined
source ~/venv-scriptotic-combined/bin/activate
pip install flask flask-cors requests vllm
```

Option 3: Move voxtral-env to ext4 filesystem:
```bash
# Move from slow NTFS to fast ext4
cp -r /mnt/d/Coding/Scriptotic/voxtral-env ~/voxtral-env-fast
# Update PowerShell script to use ~/voxtral-env-fast/bin/activate
```

**Why the separation of concerns was smart:** Flask web server and vLLM model server have different lifecycles, resource requirements, and dependency sets. Someone correctly identified they should be separate services. The bug was just putting one on the slow filesystem.

The system design is solid - lightweight sentinel proxy, proper state machine, frontend auto-retry logic. Just need to fix the filesystem performance issue without breaking the service separation.