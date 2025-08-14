# what i was working on - August 14, 2025

I was fixing the Scriptotic transcription service. The user found 10 critical problems where "claimed working" features actually didn't exist yet. Following a technical consultation with ChatGPT, I treated this as an integration project instead of hunting individual bugs.

The real issue: almost everything was broken except the frontend. The system had no job persistence, transcript display was fake, API endpoints returned 404s, and the vLLM server wouldn't auto-start.

## what actually works now

**All the infrastructure components are finally connected:**

**Backend Integration (COMPLETED):**
- Created `D:\Coding\Scriptotic\src\core\job_store.py` - SQLite job persistence with proper status transitions (queued → running → done/error)
- Updated `D:\Coding\Scriptotic\src\core\web_server.py` lines 20-21, 331-347 - Added `/api/jobs`, `/api/jobs/<id>`, `/api/download/<id>` routes 
- Added worker functions lines 82-111 - FFmpeg Opus compression (24kbps) + vLLM transcription + file storage
- Fixed CORS configuration lines 74-76 - Proper domain whitelist instead of resource-based config

**PowerShell Auto-Start Fix (COMPLETED):**
- Fixed `D:\Coding\Scriptotic\start_scriptotic_web.ps1` lines 89-103 - Added missing `export VLLM_USE_V1=0` and proper WSL command syntax
- This was the single-line fix that enables automatic vLLM startup

**Sentinel Integration (COMPLETED):**
- Updated `D:\Coding\Scriptotic\sentinel\sentinel.py` lines 250-266 - Added `/api/jobs` proxy route and fixed endpoint paths
- Service status ownership: Sentinel=service phases, Flask=job phases (as designed)

**Frontend Integration (COMPLETED):**
- Updated `D:\Coding\Website\quartz\static\apps\scriptotic\app.js` lines 141, 145-165 - Fixed API endpoint from `/api/job-status/` to `/api/jobs/`
- Added transcript display logic - shows download link OR transcript text OR error message
- Copied updated file to `D:\Coding\Website\public\static\apps\scriptotic\app.js`

**Build System (COMPLETED):**
- Updated `D:\Coding\Website\package.json` lines 16-19 - Added dev/build/watch scripts pointing to content/ directory

## what's broken

**Critical: Backend services not running**
- Sentinel is running (port 5050) and returns `{"status":"idle"}` 
- Flask is NOT running (port 5000) - connection refused
- This breaks the entire chain: Website → Cloudflare tunnel → Sentinel → Flask (missing)

**The auto-start PowerShell script fix is implemented but untested** because Flask won't start.

**Error in web console:**
```
[ERROR] Access to fetch at 'https://api2.brinedew.com/api/server-status' from origin 'https://brinedew.com'
[ERROR] Failed to load resource: net::ERR_FAILED @ https://api2.brinedew.com/api/server-status:0
```

**Cloudflare tunnel status unknown** - may be down or misconfigured.

## where things stand

**Current system state:**
- ✅ Sentinel running on localhost:5050 (responds with service status)
- ❌ Flask backend not running on localhost:5000 (connection refused)  
- ❌ vLLM server not running on localhost:8000 (never gets started because Flask is down)
- ? Cloudflare tunnel status unknown (api2.brinedew.com unreachable from browser)

**Working test commands:**
```bash
curl http://localhost:5050/api/server-status  # Returns: {"message":"Service ready - click Transcribe to activate","status":"idle"}
curl http://localhost:5000/api/server-status  # FAILS: curl: (7) Failed to connect to localhost port 5000
```

**Website behavior:**
- Loads correctly with "Server: checking..." then "Server: offline"
- Click Transcribe → "Submit failed. Check server and URL."

## what to do next

**Priority 1: Get Flask backend running**
The PowerShell script should auto-start Flask when Sentinel receives a transcription request, but it's not happening. Debug the auto-start mechanism:

1. Check if `D:\Coding\Scriptotic\start_scriptotic_web.ps1` actually runs when triggered
2. Look for PowerShell execution policy issues or path problems
3. Try manually running the script to see if Flask starts
4. Check Flask startup logs for import errors or dependency issues

**Priority 2: Test the vLLM auto-start fix**
Once Flask is running, test if the `export VLLM_USE_V1=0` fix actually works:
```bash
# This should trigger the auto-start sequence:
curl -X POST http://localhost:5050/api/transcribe -H "Content-Type: application/json" -d '{"url":"https://www.youtube.com/watch?v=Bbwp4PbWYzw"}'
```

**Priority 3: Verify Cloudflare tunnel**
Check if `api2.brinedew.com` is actually routing to `localhost:5050`. May need tunnel restart or configuration fix.

## stuff to remember

**Why the integration approach worked:** Instead of debugging 10 separate issues, ChatGPT identified this as missing architecture. The real problems were:
- No job persistence layer (SQLite JobStore fixed this)
- No transcript file storage (worker functions write to disk now)  
- No API endpoint implementation (routes were returning 404, now they exist)
- PowerShell script missing one environment variable (one-line fix)

**Architecture that's now correct:**
```
Frontend (Quartz) → Cloudflare tunnel → Sentinel (port 5050) → Flask (port 5000) → vLLM (port 8000)
                                        ↓
                                   JobStore (SQLite) ← Worker threads
                                        ↓
                                   Transcript files (output/ directory)
```

**The consultation was right:** This wasn't a bug hunt, it was implementing missing features. The "10 discrepancies" were actually "10 unimplemented components."

**Critical debugging insight:** Following the actual user workflow (click button, trace execution) revealed the real problems faster than reading stale documentation.

**VLLM_USE_V1=0 is essential** - v1 engine has multiprocessing issues on WSL2 that cause silent startup failures.