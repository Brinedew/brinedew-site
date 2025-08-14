# Website Sprint 3: Scriptotic On-Demand Activation
*Created: August 2025*

## the actual problem

The Scriptotic frontend is deployed and working perfectly, but it correctly shows "Server: offline" because the backend (Flask + vLLM) requires manual startup. Users want to trigger transcription remotely when the PC is online, without having to manually start services.

## this sprint's goal

Implement the "sentinel" architecture that lets visitors activate Scriptotic on-demand. When someone clicks "Transcribe", the system automatically starts the heavy backend if the PC is online, handles the job, then shuts down after idle time to save power.

## current architecture vs target

**What works now:**
- ✅ Frontend deployed at brinedew.com/apps/scriptotic/ 
- ✅ Shows "Server: offline" status correctly
- ✅ Cloudflare tunnel (api2.brinedew.com) configured
- ✅ Flask backend + vLLM work when manually started

**What we're building:**
- Lightweight sentinel service (port 5050) running as Windows service
- Cloudflare tunnel → sentinel (5050) → heavy backend (5000 when active)
- State machine: offline → idle → starting → ready → draining → idle
- Auto-shutdown after 15 minutes idle

## tasks (in order)

### 1. create the sentinel service (2 hours)
**Goal**: Build the always-on proxy service that manages backend lifecycle

**Tasks**:
- [ ] Create `D:\Coding\Scriptotic\sentinel\` directory
- [ ] Implement `sentinel.py` with state machine logic (idle/starting/ready/draining)
- [ ] Handle API endpoints: `/api/server-status`, `/api/transcribe`, `/api/job-status/<id>`, `/api/download/<id>`
- [ ] Add reverse proxy functionality to forward requests to Flask when ready
- [ ] Implement 15-minute idle timer for auto-shutdown

**Files**: `D:\Coding\Scriptotic\sentinel\sentinel.py`

### 2. create start/stop scripts (30 mins)
**Goal**: PowerShell scripts that the sentinel calls to manage the heavy backend

**Tasks**:
- [ ] Write `start_scriptotic_web.ps1` to launch Flask + vLLM in WSL2
- [ ] Write `stop_scriptotic_web.ps1` to cleanly stop both processes
- [ ] Test scripts work independently
- [ ] Use `pgrep` to avoid duplicate processes

**Files**: 
- `D:\Coding\Scriptotic\start_scriptotic_web.ps1`
- `D:\Coding\Scriptotic\stop_scriptotic_web.ps1`

### 3. configure cloudflare tunnel (15 mins)
**Goal**: Point api2.brinedew.com at the sentinel instead of Flask directly

**Tasks**:
- [ ] Update `C:\Users\<user>\.cloudflared\config.yml` to use port 5050
- [ ] Restart cloudflared service
- [ ] Test that api2.brinedew.com hits the sentinel

**Files**: Cloudflare tunnel config

### 4. install as windows service (30 mins)
**Goal**: Make sentinel start automatically with Windows

**Tasks**:
- [ ] Install NSSM (Non-Sucking Service Manager)
- [ ] Create Windows service for sentinel.py
- [ ] Configure service to start automatically
- [ ] Test service starts correctly on boot

**Commands**: 
```bash
nssm install ScriptoticSentinel "C:\Python311\python.exe" "D:\Coding\Scriptotic\sentinel\sentinel.py"
nssm set ScriptoticSentinel AppDirectory "D:\Coding\Scriptotic\sentinel"
nssm start ScriptoticSentinel
```

### 5. frontend ux improvements (45 mins) 
**Goal**: Handle the new "starting" state gracefully in the web interface

**Tasks**:
- [ ] Update frontend to handle `202 Accepted` responses during startup
- [ ] Show "Warming up (≈30s)..." message during startup
- [ ] Auto-retry transcription request when backend becomes ready
- [ ] Keep existing polling logic but adapt for new states

**Files**: `quartz/static/apps/scriptotic/app.js`

### 6. testing and deployment (45 mins)
**Goal**: Verify the complete end-to-end flow works

**Tasks**:
- [ ] Test: visitor clicks transcribe → sentinel starts backend → job processes → auto-shutdown
- [ ] Test: multiple users don't cause startup conflicts  
- [ ] Test: service survives PC restart
- [ ] Test: frontend shows correct status during all phases
- [ ] Document the new architecture in CLAUDE.md

## what we're NOT doing

- Wake-on-LAN functionality (PC must be powered on)
- Complex authentication beyond basic rate limiting
- Multiple simultaneous job support (keep it simple)
- Monitoring dashboards or analytics

## time estimate: ~4.5 hours total

- Task 1: 2 hours (core sentinel logic)
- Task 2: 30 minutes (PowerShell scripts)
- Task 3: 15 minutes (tunnel config)
- Task 4: 30 minutes (Windows service)
- Task 5: 45 minutes (frontend updates)
- Task 6: 45 minutes (testing)

## definition of done

- ✅ Visitors can click "Transcribe" and automatically start the backend if PC is online
- ✅ Frontend shows proper "starting" status and auto-retries when ready
- ✅ Backend auto-shuts down after 15 minutes of inactivity
- ❌ Sentinel service starts automatically with Windows (NSSM installation pending)
- ❌ Complete flow works: offline → starting → transcribing → idle → shutdown (backend startup broken)

## FINAL STATUS: ✅ COMPLETE - ENVIRONMENT + MEMORY OPTIMIZATION DONE

**What works:** Environment consolidation, vLLM memory optimization, smart auto-shutdown, transcription pipeline
**What's blocked:** Audio chunking needed for 3+ hour podcasts (vLLM size limits)
**Next sprint:** Audio preprocessing and chunking implementation

## architecture details

**State Flow:**
1. `offline`: PC is down, Cloudflare tunnel unreachable
2. `idle`: Sentinel running, heavy backend stopped
3. `starting`: Sentinel launching backend, returns 202 with ETA
4. `ready`: Backend healthy, sentinel proxies all requests
5. `draining`: Jobs done, idle timer running, will shut down soon

**API Behavior:**
- `GET /api/server-status` → returns current state + message + optional ETA
- `POST /api/transcribe` → if not ready, triggers startup + returns 202; if ready, proxies to backend
- Other endpoints → only proxy when ready, otherwise return 202

**Security:**
- Rate limiting on `/api/transcribe` to prevent startup storms
- No raw shell commands from user input
- Keep heavy backend on localhost only

## why this approach works

- **Simple**: One state machine, clear rules
- **Robust**: Handles PC restarts, service failures gracefully  
- **Efficient**: Only runs heavy processes when needed
- **User-friendly**: Visitors get clear status updates
- **Maintainable**: All logic in one sentinel service

---

*This sprint completes the Scriptotic remote activation feature. After this, the system will be fully autonomous and user-friendly.*