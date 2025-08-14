# Website Sprint 4: Long Audio Transcription

**Status**: Ready for Development  
**Goal**: Enable transcription of 3+ hour podcasts via audio compression and intelligent chunking  
**Timeline**: ~10-14 hours estimated effort  

## Background

The Scriptotic transcription service works perfectly up to ~16 minutes but fails on longer files with "Maximum file size exceeded" errors. Initial analysis suggested this was a model context limit requiring 15-minute chunking with large overlaps. 

**Technical consultation with ChatGPT revealed the real issue**: HTTP file upload limits (25MB), not model capacity limits. Voxtral-Mini actually supports up to 30 minutes per call.

## Sprint Epics

### Epic 1: Audio Compression Pipeline ✅ **READY FOR DEVELOPMENT**

**Problem**: Large audio files exceed HTTP upload limits before reaching the model  
**Solution**: Pre-compress uploads to stay under limits while maintaining quality

**Tasks**:
1. **Integrate FFmpeg compression** in Flask audio processing pipeline
   - Convert all uploads to mono 16kHz Opus at 24kbps
   - Target: 30 minutes ≈ 5.4MB (well under 25MB limit)
   - Command: `ffmpeg -y -i INPUT.ext -ac 1 -ar 16000 -c:a libopus -b:a 24k -vbr on -compression_level 10 OUT.ogg`

2. **Update file size validation** 
   - Remove artificial size limits in Flask upload handler
   - Validate duration instead of file size
   - Add progress feedback for compression step

3. **Test compression quality**
   - Verify transcription accuracy with compressed vs original audio
   - Test with current ~16 minute files that work
   - Measure compression time vs transcription time

**Effort**: 4-6 hours  
**Dependencies**: None - uses existing Flask/vLLM architecture  
**Success Criteria**: Files that previously failed due to size now process successfully

### Epic 2: 30-Minute Intelligent Chunking ✅ **READY FOR DEVELOPMENT**

**Problem**: Even compressed, 3+ hour files exceed model's 30-minute capacity  
**Solution**: Split into optimal 30-minute segments with minimal overlap

**Tasks**:
1. **Implement 30-minute segmentation**
   - Calculate optimal chunk count for duration
   - Split compressed audio at ≤30 minute intervals
   - Prefer silence-aligned cuts when possible (future enhancement)

2. **Add 5-10 second overlaps** 
   - Much smaller than original 15-30 second plan
   - Sufficient to prevent word boundary issues
   - Configurable overlap duration

3. **Sequential processing pipeline**
   - Send each segment to existing vLLM `/audio/transcriptions` endpoint
   - Maintain current job status/progress tracking
   - Add per-segment retry logic with exponential backoff

4. **Transcript stitching logic**
   - Drop first overlap/2 seconds from segments 2..N
   - Drop last overlap/2 seconds from segments 1..N-1  
   - Maintain timestamp continuity for potential VTT/SRT output

**Effort**: 6-8 hours  
**Dependencies**: Epic 1 (compression) recommended first  
**Success Criteria**: 3+ hour podcasts process completely with coherent transcripts

## Technical Architecture

**Current Working Flow** (unchanged):
```
User → Frontend → Cloudflare Tunnel → Sentinel → Flask → vLLM
```

**New Processing Pipeline**:
```
Large Audio File → FFmpeg Compression → Duration Check → 
  If ≤30min: Direct to vLLM
  If >30min: Chunk → Sequential vLLM calls → Stitch Results
```

**Key Technical Decisions**:
- Keep `--max-num-seqs 1` for reliability (no parallel processing)
- Use sequential segment processing to avoid VRAM pressure
- Leverage Voxtral's actual 30-minute capacity vs assumed 16-minute limit
- Use proven Opus compression for best size/quality ratio

## Implementation Notes

**FFmpeg Integration Options**:
- Shell out to system FFmpeg (simpler, requires FFmpeg installed)
- Use python-ffmpeg library (more integrated, adds dependency)
- **Recommendation**: Start with shell calls for MVP

**Error Handling Strategy**:
- Retry individual segments on failure (not entire job)
- Maximum 3 attempts per segment with exponential backoff
- Return partial results if segments consistently fail
- Preserve segment metadata for debugging

**Testing Strategy**:
1. **Epic 1 first**: Test compression with current working 16-minute files
2. **Verify no quality loss**: Compare transcription accuracy
3. **Epic 2 second**: Test chunking with artificially long files
4. **End-to-end**: Test actual 3+ hour podcasts

## Success Metrics

**Epic 1 Complete When**:
- Files that currently fail due to size process successfully
- Compression completes in reasonable time (< 10% of transcription time)
- Transcription quality maintained after compression

**Epic 2 Complete When**:
- 3+ hour audio files process completely
- Transcript quality is coherent across segment boundaries
- Processing time scales linearly with duration

**Sprint Complete When**:
- Users can successfully transcribe podcasts of any reasonable length
- System handles failures gracefully with partial results
- Documentation updated with new capabilities and limitations

---

## Technical Consultation Addendum

**Date**: August 14, 2025  
**Source**: ChatGPT technical consultation on vLLM audio transcription limits

### Full ChatGPT Response

**Short version**: your failure isn't about GPU—it's about **ingest limits** on the transcription endpoint and, secondarily, the **decoder's max audio window**. Voxtral-Mini 3B *can* handle long audio (up to \~30 minutes in one go), but the OpenAI-style transcription route typically enforces a **request body/file size limit** (think OpenAI's 25 MB limit by default), and vLLM's code has only recently gained built-in chunking for Whisper, not for Voxtral. So: **re-encode to small-bitrate Opus + chunk at \~30-minute "super-segments" with small overlaps**. That gets you 3-hour podcasts reliably with minimal stitching grief.

Key facts to ground this:

* Voxtral-Mini claims *long-form* context: "**process up to 30 minutes** for transcription, 40 minutes for audio understanding" (model card). ([Hugging Face][1])
* OpenAI-style transcription APIs commonly cap upload **file size** (historically 25 MB), which is why long clips get rejected unless you compress or split. ([OpenAI Platform][2], [OpenAI Community][3])
* vLLM added server-side **auto-chunking** for Whisper only (as of mid-2025); it's not guaranteed for Voxtral yet—so **external chunking** remains the robust path. ([GitHub][4])

---

## What to do (practical plan that fits your stack)

### 0) Don't fight the endpoint—shrink the payload first

Before you send anything to vLLM, transcode to **mono, 16 kHz, Opus** at **24–32 kbps**. That keeps "full 30 min" well under typical limits.

FFmpeg (Windows or WSL—either is fine):

```bash
ffmpeg -y -i INPUT.ext -ac 1 -ar 16000 -c:a libopus -b:a 24k -vbr on -compression_level 10 OUT.ogg
```

At 24 kbps, 30 min ≈ **5.4 MB**. You'll never hit 25 MB, and decode quality is still perfectly adequate for ASR.

> Corroboration: devs consistently use Opus/OGG to get around file caps; some formats even work better than MP4 with vLLM's route. ([OpenAI Platform][2], [GitHub][5])

### 1) Align chunk size with the model, not with guesswork

* **Target segment length:** **≤ 30 min** (Voxtral's claimed transcription window). For a 3-hour show, that's \~**6 segments**. ([Hugging Face][1])
* **Overlap:** **5–10 s**. That's enough to preserve cross-boundary phonemes without ballooning compute. (Whisper-style pipelines routinely use small overlaps; larger overlaps (>15 s) add latency with little gain.) ([community.groq.com][6], [Medium][7])
* **Cut points:** Prefer **silence/VAD-aligned** boundaries if available; otherwise fixed windows are fine with the small overlap. (Silence-aligned chunking is a long-standing ASR best practice.) ([arXiv][8])

### 2) Two supported calling patterns—pick one

**A. Stay on `/audio/transcriptions` (simplest)**

* Send **one Opus file per segment** (<= 30 min, < 25 MB).
* Use `temperature=0.0` for pure transcription.
* Stitch segments client-side: drop the first **overlap/2** seconds of segments 2..N and the last **overlap/2** seconds of segments 1..N-1.

**B. Or use `/chat/completions` with multiple audio chunks**

* Voxtral explicitly supports **multiple audios per message**. You can supply a message content array of audio parts; the model will produce a single transcript. This can reduce your stitching logic, but you still should respect the per-request body size. ([Hugging Face][1])

My take: **(A)** is more predictable and already matches your Flask job pipeline.

### 3) Concurrency & memory

* Keep `--max-num-seqs 1` (your reliability requirement). Process segments **sequentially**. Parallelizing would need more VRAM and makes scheduling twitchy.
* Your current vLLM flags are fine for this: `bf16` weights + `--kv-cache-dtype fp8_e5m2 --calculate-kv-scales` + `--gpu-memory-utilization 0.95`. They don't raise ingest limits; they **do** keep you within 12 GB VRAM at 4k context. ([vLLM][9])

### 4) Robust stitching & prompts

* If you ever see drift/hallucinations on boundaries, pass the **last N seconds of transcript** as a **prompt** into the next transcription call (many Whisper pipelines use "condition on previous text"). vLLM/Voxtral accept a `prompt`/instructions field in transcription or via chat. ([GitHub][10])
* Keep **timestamps** per segment (even coarse) so you can rebuild a VTT/SRT that lines up with the original audio timeline.

### 5) Frontend UX (you already have the states)

* When a file exceeds your "single-segment size" rule, display: "Preparing audio (compressing)… Splitting into **N** parts… Transcribing 1/**N**…"
* Show **per-segment retries** with exponential backoff; never restart the entire job for a single failure.

---

## Answers to your numbered questions

1. **Is chunking the best approach? Any config to raise limits?**
   Yes, chunking is the right long-term answer. You can't "config away" the **HTTP body/file cap**; compressing to Opus gets you a **single-segment 30 min** call, but for **3 hours** you still need segments. vLLM's recent built-in chunking only targets Whisper; for Voxtral you should chunk externally for now. ([GitHub][4])

2. **Alternative models?**
   Voxtral-Small 24B would need far more VRAM than your 12 GB—non-starter on this box. Whisper-large-v3-turbo also chunks internally around \~30 s and wouldn't remove the HTTP/file-size constraint. Stick with Voxtral-Mini and do segmenting. ([Hugging Face][11])

3. **Memory flags to allow larger files?**
   No. KV dtype/utilization affect **token-time memory**, not **upload size** or audio duration limits. Keep FP8-KV; it helps you maintain 4k tokens per request. ([vLLM][9])

4. **Chunking risks & overlap tuning**

   * **Word splits at boundaries** → solve with 5–10 s overlap, and optionally feed prior text as `prompt`. ([GitHub][10])
   * **Silence split errors** → use VAD-aligned cuts when possible; fall back to fixed-window+overlap. ([arXiv][8])
   * **Drift over hours** → reset the "prompt memory" every few segments; don't let cumulative bias accrue.

5. **Performance for 3 hours (≈6 segments)**
   Sequential is fine with `max-num-seqs 1`. If later you want parallelism, bump to 2 and run two *independent* processes/jobs (not two sequences in one vLLM server), but that eats VRAM headroom.

6. **Error handling**
   Retry **just the failed segment** (idempotent upload). Keep a per-segment retry budget (e.g., 3 attempts). If a segment keeps failing, mark the overall job as partial and return what you have + an error note for that span.

---

## Drop-in implementation sketch (server side)

**Segment sizing rule (keeps under \~25 MB even uncompressed):**

* Aim for **≤ 30 min** per segment by duration, and in any case **size-cap** at, say, **24 MB** after Opus encoding.
* Compute max duration from bitrate: `max_sec = floor((24 * 1024 * 1024 * 8) / bitrate_bits_per_sec)`. With 24 kbps, `max_sec ≈ 8192 s`—well above 30 min; duration will be your binding constraint.

**Pipeline:**

1. Decode once with ffmpeg → mono 16 kHz PCM in a temp file.
2. (Optional) VAD to propose cut points; otherwise fixed 30-min windows.
3. For each window: `ffmpeg` → Opus 24 kbps → upload to vLLM.
4. Keep overlap metadata and stitch by dropping overlap halves.

This slots cleanly into your existing **sentinel → Flask → vLLM** flow; no GPU changes; no new infra.

---

## Optional: try the chat route later

Voxtral supports **multiple audio files in a single chat message**. That might let you send a handful of shorter Opus parts and get one answer back—useful for "understanding/summarization." For strict transcription, the `/audio/transcriptions` route + stitching gives you deterministic segment control today. ([Hugging Face][1])

---

## Why your \~16-minute clip failed

Because the **request** exceeded the server's file/clip limit, *not* because the model can't do it. Re-encode to Opus (tiny) and/or split into ≤ 30-min segments, and it will sail through. (And if you switch to Whisper later, note vLLM's newer code already chunks >30 s internally—Voxtral isn't guaranteed there yet.) ([GitHub][4])

If you want, I can draft the exact Flask utilities (ffmpeg calls + VAD splitter + stitcher) next.

[1]: https://huggingface.co/mistralai/Voxtral-Mini-3B-2507 "mistralai/Voxtral-Mini-3B-2507 · Hugging Face"
[2]: https://platform.openai.com/docs/guides/speech-to-text?utm_source=chatgpt.com "Speech to text - OpenAI API"
[3]: https://community.openai.com/t/whisper-api-how-to-upload-file-that-larger-than-25mb/693285?utm_source=chatgpt.com "Whisper API, How to upload file that larger than 25mb"
[4]: https://github.com/vllm-project/vllm/issues/19772?utm_source=chatgpt.com "Evaluate prompt presence on subsequent audio chunks ..."
[5]: https://github.com/vllm-project/vllm/issues/16335?utm_source=chatgpt.com "[Bug]: Run transcription task with mp4 file failed. #16335"
[6]: https://community.groq.com/groq-api-tutorials-42/chunking-longer-audio-files-for-whisper-models-on-groq-117?utm_source=chatgpt.com "Chunking Longer Audio Files for Whisper Models on Groq"
[7]: https://medium.com/%40yoad/whisper-long-form-transcription-1924c94a9b86?utm_source=chatgpt.com "Whisper Long-Form Transcription"
[8]: https://arxiv.org/pdf/2404.07341?utm_source=chatgpt.com "Conformer-1: Robust ASR via Large-Scale ..."
[9]: https://docs.vllm.ai/en/stable/features/quantization/quantized_kvcache.html?utm_source=chatgpt.com "Quantized KV Cache - vLLM"
[10]: https://github.com/openai/whisper/discussions/679?utm_source=chatgpt.com "A possible solution to Whisper hallucination #679"
[11]: https://huggingface.co/mistralai/Voxtral-Small-24B-2507?utm_source=chatgpt.com "mistralai/Voxtral-Small-24B-2507"

### Key Insights from Technical Consultation

**Problem Reframed**: Not GPU memory or model context limits, but HTTP file upload limits (25MB) combined with model's actual 30-minute capacity being underutilized.

**Solution Optimized**: 
- Opus compression reduces file sizes dramatically (30min ≈ 5.4MB)
- 30-minute chunks vs 15-minute chunks (6 segments vs 12+ for 3-hour podcast)
- 5-10 second overlaps vs 15-30 seconds (much faster processing)
- Leverages model's actual capabilities rather than fighting limitations

**Effort Reduced**: From estimated 20+ hours to 10-14 hours due to simpler approach aligned with model capabilities.

**Architecture Validated**: Existing sentinel → Flask → vLLM flow requires no changes, just enhanced audio preprocessing pipeline.

---

*Sprint documented: August 14, 2025*