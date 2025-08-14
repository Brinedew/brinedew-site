# Website Sprint 4: Long Audio Transcription - REALITY-BASED REVISION

**Status**: 🔴 BLOCKED - Major architecture gaps identified  
**Goal**: Enable transcription of 3+ hour podcasts via audio compression and intelligent chunking  
**Timeline**: ~20-25 hours estimated effort (revised upward due to missing components)

## What We Actually Discovered

**Original sprint assumption**: Backend compression/chunking pipeline is complete, just needs testing.

**Reality (August 14, 2025)**: The frontend and backend are solving different problems:

- **Backend** (claimed): Handles large file uploads with compression and chunking
- **Frontend** (actual): Only accepts YouTube URLs, no file upload capability
- **Integration**: Untested due to vLLM startup failures
- **Architecture**: Frontend/backend mismatch makes Sprint 4 goal impossible to achieve

## Current Working State

**What actually works**:
- ✅ Frontend polls server status correctly (`/api/server-status`)
- ✅ Frontend submits YouTube URLs to `/api/transcribe` 
- ✅ Frontend polls job status via `/api/jobs/{id}`
- ✅ Frontend handles server startup delays (202 responses)

**What doesn't work**:
- ❌ No file upload UI for users to submit audio files
- ❌ Backend auto-start still failing (vLLM startup issues)
- ❌ Compression pipeline never tested end-to-end
- ❌ Chunking logic never tested end-to-end
- ❌ No way to test the sprint goal (3+ hour files)

## Revised Epic Breakdown

### Epic 0: Get Basic System Working 🔴 **BLOCKING EVERYTHING**

**Problem**: Can't test file processing when the backend won't start  
**Priority**: Must be completed before any other work

**Tasks**:
1. **Fix vLLM auto-start failure** (from bugs_log.md issue #10)
   - Debug PowerShell script execution when triggered by Sentinel
   - Verify Flask backend actually starts on port 5000
   - Test manual script execution to isolate the problem
   - Check execution policies and path issues

2. **Verify YouTube URL transcription works end-to-end**
   - Test with current working ~16 minute videos
   - Confirm job status polling works
   - Verify transcript output appears correctly
   - This establishes our baseline before adding complexity

**Effort**: 4-6 hours  
**Success Criteria**: One YouTube URL processes completely from frontend to transcript display

---

### Epic 1: Add File Upload Frontend 🔴 **REQUIRED FOR SPRINT GOAL**

**Problem**: Sprint goal requires processing user audio files, but no upload UI exists  
**Dependencies**: Epic 0 must be completed first

**Tasks**:
1. **Add file input to app.js**
   - Create file picker UI alongside YouTube URL input  
   - Add file size validation (warn about large files)
   - Show file name and size after selection

2. **Modify `/api/transcribe` to handle files**
   - Send FormData with file upload instead of JSON with URL
   - Update progress display for file upload vs URL processing
   - Handle upload progress feedback

3. **Update UI for dual workflows** 
   - Toggle between "YouTube URL" and "Upload File" modes
   - Different status messages for URL vs file processing
   - Clear indication of which mode is active

**Effort**: 6-8 hours  
**Success Criteria**: Users can upload small audio files and they process successfully

---

### Epic 2: Test Claimed Compression Pipeline ⚠️ **VERIFICATION NEEDED**

**Problem**: Backend compression claimed complete but never tested  
**Dependencies**: Epic 0 and Epic 1 completed

**Tasks**:
1. **Test compression with real files**
   - Upload files larger than current 16-minute limit
   - Verify FFmpeg compression actually runs
   - Measure file size reduction (should be ~6x smaller)
   - Compare transcription quality before/after compression

2. **Fix compression issues discovered during testing**
   - This is a placeholder - we don't know what will break yet
   - Could be FFmpeg not installed, wrong parameters, timing issues
   - Could be file format compatibility problems

3. **Document compression performance**
   - Measure compression time vs transcription time
   - Test various input formats (MP3, WAV, M4A, etc.)
   - Verify 30-minute files become ~5.4MB as claimed

**Effort**: 4-6 hours (could be much more if major issues found)  
**Success Criteria**: Files that previously failed due to size now process successfully

---

### Epic 3: Test Claimed Chunking Pipeline ⚠️ **VERIFICATION NEEDED**  

**Problem**: Chunking logic claimed implemented but never tested  
**Dependencies**: Epic 2 completed successfully

**Tasks**:
1. **Test chunking with long files**
   - Create or find 2-3 hour test files
   - Verify files get split into proper 30-minute segments  
   - Check that overlap logic works as designed
   - Confirm sequential processing doesn't crash

2. **Test transcript stitching quality**
   - Verify stitched transcript is coherent across boundaries
   - Check for repeated or missing words at segment joins
   - Test that timestamps remain continuous if supported

3. **Fix chunking issues discovered during testing**
   - Another placeholder for unknown issues
   - Could be segment boundary problems, stitching logic errors
   - Could be memory issues with multiple segments

**Effort**: 6-8 hours (could be much more if major issues found)  
**Success Criteria**: 3+ hour files process completely with coherent transcripts

---

## Why This Revision Was Necessary

**Original sprint planning mistake**: Assumed implementation was complete based on documentation rather than testing actual functionality.

**Frontend/backend mismatch**: The sprint goal requires file uploads, but the frontend only handles YouTube URLs. This is a foundational architecture problem, not a minor oversight.

**Untested code isn't implemented code**: Code that's never been verified to work should be considered incomplete, not "done pending testing."

**Cascading dependencies**: Each epic depends on the previous one actually working, not just being "theoretically complete."

## Realistic Success Metrics

**Epic 0 Success**: YouTube URL transcription works reliably end-to-end  
**Epic 1 Success**: Users can upload and transcribe small audio files  
**Epic 2 Success**: Large files get compressed and transcribe correctly  
**Epic 3 Success**: 3+ hour files complete with coherent results  

**Sprint Success**: Users can upload a 3-hour podcast file and receive a complete, accurate transcript.

## Risk Assessment

**High Risk**: Backend auto-start issue could take much longer than expected to resolve  
**Medium Risk**: Compression/chunking may have significant bugs requiring rework  
**Low Risk**: Frontend file upload is straightforward once backend works  

**Contingency Plan**: If Epic 0 takes too long, consider this sprint blocked and move to a different epic that doesn't depend on the backend working.

---

*Reality-based revision completed: August 14, 2025*
*Next sprint planning should be based on what actually works, not what we hope works*