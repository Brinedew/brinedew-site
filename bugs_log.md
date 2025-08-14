# Technical Bugs Report
*Updated: 2025-08-11*

## Fixed Issues ✅

### 1. Dark Mode Toggle - FIXED ✅
**Status**: ✅ **RESOLVED** - commit `a0cae8f`
**Files Fixed**: 
- `quartz/components/scripts/darkmode.inline.ts` - changed `saved-theme` to `data-theme` attribute
- `quartz/components/styles/darkmode.scss` - updated CSS selectors to match `data-theme`
- `quartz/static/custom.css` - implemented Pattern A CSS cascade fix

**Root Cause Identified**: JavaScript was setting `saved-theme` attribute but CSS was looking for `data-theme`. Additionally, `@media (prefers-color-scheme: dark)` was overriding explicit user choice due to CSS cascade order.

**Fix Applied**: Pattern A approach - base defaults, system preference with `:not([data-theme])` guard, then explicit user choice attributes. This ensures user choice always wins over system preference.

**Resolution Verified**: Dark mode toggle now switches themes correctly on both light/dark system preferences.

---

### 2. Search Button Positioning - FIXED ✅  
**Status**: ✅ **RESOLVED** - commit `a0cae8f`
**File Fixed**: `quartz/static/custom.css` - search button CSS

**Root Cause**: Search button was using `position: fixed; bottom: 2rem; right: 2rem` with excessive padding, making it a huge floating element.

**Fix Applied**: Changed to inline flexbox positioning with other header buttons, removed "Search" text, proper icon centering.

**Resolution Verified**: Search button now properly sized and positioned with dark mode/reader mode buttons.

---

## Recently Fixed Issues ✅

### 3. Mobile Click Blocking - FIXED ✅
**Status**: ✅ **RESOLVED** - commit `f6392d8`
**Files Fixed**: 
- `quartz/components/styles/explorer.scss` - Default mobile CSS to closed state with `.is-open` class
- `quartz/components/scripts/explorer.inline.ts` - Use `matchMedia()` instead of `checkVisibility()` for breakpoint detection

**Root Cause**: CSS defaulted to open state on mobile (`&:not(.collapsed)`), requiring JavaScript to fight against it. Also used unreliable visibility detection instead of actual breakpoint matching.

**Fix Applied**: ChatGPT's "breakpoint as source of truth" approach - CSS defaults closed, JavaScript only opts into open state using `matchMedia('(max-width: 800px)')` listener.

**Resolution Verified**: 
- Mobile navigation starts closed when resizing desktop→mobile ✅
- Hamburger menu opens/closes correctly on tap ✅
- No click blocking on mobile viewports ✅
- Desktop navigation remains unaffected ✅

---

### 4. Excalidraw Images Not Rendering 
**Status**: 🟡 Medium Priority - **DOCUMENTATION PROVIDED**
**Expected**: Embedded image display  
**Actual**: Text link `Vibes-are-principal-components-2025-07-28-12.52.03.excalidraw`

**Root Cause**: Missing PNG auto-export from Obsidian Excalidraw plugin
**Fix Required**: User configuration in Obsidian:
1. Obsidian → Settings → Community plugins → Excalidraw
2. ✅ Enable "Auto export PNG" 
3. ✅ Set "Keep same folder as drawing"

**Documentation**: Setup instructions added to `CLAUDE.md`

---

### 5. Package.json Script Path Issue  
**Status**: 🟡 Low Priority - **NOT BLOCKING**
**File**: `package.json:16`
**Current**: `"docs": "npx quartz build --serve -d docs"`
**Issue**: Content moved from `docs/` to `content/` during migration  
**Fix**: Update to `"docs": "npx quartz build --serve"` or point to correct directory

---

## Working Features ✅
- ✅ Dark mode toggle (fixed in commit `a0cae8f`)
- ✅ Search functionality with proper positioning
- ✅ SPA navigation and breadcrumbs  
- ✅ Content rendering and markdown processing
- ✅ Explorer sidebar structure display
- ✅ Site architecture and content organization
- ✅ Mobile hamburger navigation (fixed in commit `f6392d8`)
- ✅ Desktop-to-mobile viewport transitions
- ✅ Self-hosted fonts (Crimson Pro) via nuclear patch approach
- ✅ Editorial design transformation complete
- ✅ MkDocs to Quartz 4 migration complete

---

### 6. Font Loading Errors - FIXED ✅  
**Status**: ✅ **RESOLVED** - August 2025
**Issue**: Font loading errors resolved - Crimson Pro now loads correctly on live site
**Resolution Verified**: Typography displays as intended with self-hosted variable fonts

---

## Outstanding Issues

### 7. Scriptotic Sentinel Backend Startup Failure - FIXED ✅
**Status**: ✅ **RESOLVED** - August 13, 2025
**Issue**: Sentinel activation failed due to Python environment conflicts and PowerShell path separator issues

**Root Causes Identified**:
1. **Python Environment**: PowerShell PATH resolved to Anaconda (`C:\ProgramData\anaconda3\python.exe`) instead of system Python (`C:\Python313\python.exe`)
2. **Path Separators**: PowerShell argument `"src\core\web_server.py"` became `"srccoreweb_server.py"` due to backslash escape processing

**Fixes Applied**:
- Updated PowerShell script to use explicit Python path: `C:\Python313\python.exe`
- Fixed argument separator: `"src/core/web_server.py"` (forward slashes)
- Added permanent documentation to root `CLAUDE.md` about Windows path separator syntax

**Resolution Verified**:
- ✅ Sentinel triggers PowerShell script correctly
- ✅ Flask backend starts with proper Python environment
- ✅ Sentinel detects healthy backend and transitions to "ready" state
- ✅ API proxy works: POST /api/transcribe returns job_id successfully
- ✅ End-to-end activation flow: offline → starting → ready → proxy requests

**Files Fixed**:
- `D:\Coding\Scriptotic\start_scriptotic_web.ps1` - Explicit Python path and forward slashes
- `D:\Coding\CLAUDE.md` - Added Windows PowerShell path separator documentation

---

### 8. Scriptotic Backend Environment Mismatch - FIXED ✅
**Status**: ✅ **RESOLVED** - Environment consolidation complete
**Issue**: PowerShell startup script uses wrong Python virtual environment for vLLM

**Root Cause**: PowerShell script calls `source voxtral-env/bin/activate` but vLLM is installed in `~/venv-vllm-stable/bin/activate`

**Fix Applied**: 
- Consolidated to 2 clean environments (Windows venv + WSL2 venv-vllm-stable)
- Updated all scripts to use explicit interpreter paths
- Added runtime guards to prevent wrong environment usage
- Archived broken voxtral-env
- Optimized vLLM memory settings (FP8 KV cache, V0 engine)

**Resolution Verified**: Transcription pipeline works up to vLLM audio size limits (~16 minutes)

**Working Command (Updated with Memory Optimization)**:
```bash
wsl -d Ubuntu bash -c "source ~/venv-vllm-stable/bin/activate && python -m vllm.entrypoints.openai.api_server --model mistralai/Voxtral-Mini-3B-2507 --task transcription --dtype bfloat16 --kv-cache-dtype fp8_e5m2 --calculate-kv-scales --gpu-memory-utilization 0.95 --max-model-len 4096 --max-num-seqs 1 --port 8000 --host 0.0.0.0 --tokenizer-mode mistral --config-format mistral --load-format mistral"
```

**Evidence**: KV cache memory increased from 0.24GB → 1.81GB available with optimizations

---

### 9. vLLM Audio File Size Limits - NEW ❌
**Status**: 🔴 **UNRESOLVED** - Blocking 3+ hour podcast transcription
**Issue**: vLLM rejects audio files over ~16 minutes with "Maximum file size exceeded" error

**Root Cause**: Voxtral Mini 3B has built-in audio processing limits that can't handle long podcasts

**Impact**: 
- 16-minute video transcribes successfully but fails at vLLM stage
- 3+ hour podcasts will definitely exceed limits
- Need audio chunking or compression preprocessing

**Next Steps**: 
- Implement audio chunking (split into 10-15 minute segments)
- Or audio compression (mono, lower sample rate, silence removal)
- Or investigate larger Voxtral models with higher limits