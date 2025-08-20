# Current Website Priorities - August 20, 2025

## Immediate Actions Needed

### 1. TOC Spacing Fix - URGENT 🔴
**From handoff note**: Apply TagExplorer spacing fix to Table of Contents component

**What to do**:
- Open `quartz/components/styles/toc.scss`
- Add `line-height: 1` and `margin-bottom: 1rem` to list item styling
- Test on pages with TOC (longer blog posts)

**Why urgent**: User specifically requested this before handoff, simple CSS change

---

### 2. Flask Backend Auto-Start - CRITICAL 🔴 
**Status**: Blocking all Scriptotic transcription features

**Problem**: PowerShell auto-start script failing when Sentinel (port 5050) tries to trigger Flask (port 5000)

**Impact**: 
- Website shows "Server: offline" 
- All transcription requests fail
- Sprint 4 completely blocked

**Next steps**:
- Debug PowerShell script execution
- Check execution policies and paths
- Verify Flask startup logs

---

## Sprint Status Review

### Sprint 4: Long YouTube Transcription 
**Status**: 🔴 **BLOCKED** by Flask backend issue
- Cannot proceed with any development until backend auto-start works
- All technical work completed but system unusable

### Content Folder Flattening Sprint
**Status**: ✅ **COMPLETED** - Archived to `archive/COMPLETED-content-folder-flattening.md`
- All categorical folders flattened successfully
- Content organized by tags instead of folder hierarchy
- Minor frontmatter cleanup needed but not blocking

---

## What Needs Sprint Planning

**Currently: Nothing ready for sprint planning**

**Why**: 
- Sprint 4 blocked by critical backend issue
- Content flattening already complete
- No new epics properly scoped yet

**Recommendations**:
1. Fix immediate issues first (TOC spacing, Flask backend)
2. Then assess what new features/improvements are actually needed
3. Scope new sprint based on real requirements, not theoretical work

---

*Last updated: August 20, 2025*
*Next review: After resolving immediate blockers*