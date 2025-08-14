# Website Sprint 4: Long YouTube Video Transcription - CORRECTED

**Status**: 🔴 BLOCKED - Backend auto-start issues  
**Goal**: Enable transcription of 3+ hour YouTube videos (not file uploads - that was a documentation error)  
**Timeline**: ~8-12 hours estimated effort  

## What We Actually Need To Build

**The real use case**: Users paste YouTube URLs for long podcasts/videos and get complete transcripts.

**Current working state**: 
- ✅ Frontend accepts YouTube URLs and polls for results
- ✅ Backend downloads videos with yt-dlp  
- ❌ Backend fails on videos longer than ~16 minutes due to audio file size limits
- ❌ Backend auto-start mechanism broken (blocking all testing)

**What the previous sprint docs got wrong**: Assumed users wanted to upload audio files. They don't. They want to transcribe YouTube content.

## Sprint Epics

### Epic 0: Fix Backend Auto-Start 🔴 **BLOCKING EVERYTHING**

**Problem**: Can't test anything when the Flask backend won't start automatically  
**Priority**: Must be completed before any other work

**Tasks**:
1. **Debug PowerShell auto-start failure**
   - Test manual execution of `start_scriptotic_web.ps1`
   - Check execution policies and path issues  
   - Verify Flask actually starts on port 5000
   - Fix whatever's preventing Sentinel → Flask communication

2. **Verify basic YouTube transcription works**
   - Test with current working ~16 minute videos
   - Confirm end-to-end: URL → download → transcription → results
   - This establishes baseline before adding long-video support

**Effort**: 3-4 hours  
**Success Criteria**: Users can transcribe short YouTube videos end-to-end

---

### Epic 1: Audio Compression After Download 🟡 **CORE FEATURE**

**Problem**: yt-dlp downloads large files that exceed vLLM's HTTP upload limits  
**Solution**: Compress downloaded audio before sending to vLLM

**Tasks**:
1. **Add compression step in audio processing pipeline**
   - After yt-dlp download, before vLLM submission
   - Use FFmpeg Opus compression: mono 16kHz at 24kbps  
   - Target: 30 minutes ≈ 5.4MB (well under 25MB limit)

2. **Update job status reporting** 
   - Add "compressing audio" status between download and transcription
   - Show compression progress to user
   - Handle compression failures gracefully

3. **Test with real long videos**
   - Find 30-60 minute YouTube videos that currently fail
   - Verify compression allows successful processing
   - Compare transcription quality vs original

**Effort**: 4-5 hours  
**Success Criteria**: Videos that previously failed due to size now complete successfully

---

### Epic 2: 30-Minute Chunking for Very Long Videos ⚠️ **IF NEEDED**

**Problem**: Even compressed, 3+ hour videos may exceed vLLM's 30-minute capacity limit  
**Solution**: Split very long videos into 30-minute segments

**Tasks**:
1. **Implement duration-based segmentation**
   - Check compressed audio duration
   - If ≤30 minutes: send directly to vLLM
   - If >30 minutes: split into segments with 5-10 second overlaps

2. **Sequential processing with progress tracking**
   - Process segments one at a time (avoid VRAM pressure)
   - Update job status: "Processing segment 2 of 6"  
   - Handle individual segment failures gracefully

3. **Transcript stitching**
   - Combine segment results into coherent transcript
   - Remove overlap artifacts at segment boundaries
   - Maintain proper timestamps if supported

**Effort**: 4-6 hours  
**Dependencies**: Epic 1 completed  
**Success Criteria**: 3+ hour YouTube videos process completely with readable transcripts

## Technical Architecture

**Current Working Flow** (unchanged):
```
User → Frontend → Cloudflare Tunnel → Sentinel → Flask → vLLM
```

**Enhanced Processing Pipeline**:
```
YouTube URL → yt-dlp download → FFmpeg compression → 
  If ≤30min: Direct to vLLM
  If >30min: Chunk → Sequential vLLM calls → Stitch Results
```

**Key Decisions**:
- Keep existing YouTube URL workflow (no file upload UI needed)
- Use proven Opus compression for size reduction
- Leverage vLLM's actual 30-minute capacity 
- Sequential processing to avoid GPU memory issues

## Why This Correction Was Necessary

**Original sprint assumption**: Users need to upload audio files for transcription  
**Reality**: Users want to transcribe YouTube content (much simpler workflow)

**Architecture mismatch**: The frontend was already correct - it handles YouTube URLs as intended  
**Documentation error**: Previous sprint docs assumed file uploads without checking user requirements

**Simplified solution**: Instead of adding file upload UI, just fix the audio processing pipeline for downloaded YouTube content.

## Success Metrics

**Epic 0 Complete**: Basic YouTube transcription works reliably  
**Epic 1 Complete**: 30-60 minute videos that currently fail now work  
**Epic 2 Complete**: 3+ hour videos process successfully  

**Sprint Success**: Users can transcribe any reasonable-length YouTube video

## Risk Assessment

**High Risk**: Backend auto-start could take longer than expected to debug  
**Low Risk**: Audio compression is well-understood (FFmpeg + Opus)  
**Medium Risk**: Chunking logic needs careful testing for edge cases

**Contingency**: If Epic 0 takes too long, this sprint is blocked and we should work on a different feature.

---

*Corrected based on actual user requirements: YouTube URLs, not file uploads*  
*Sprint planning: August 14, 2025*