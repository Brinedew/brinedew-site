---
title: Website
project: Website
owner: 
status: active
priority: medium
milestone: 
due: 
risk_level: medium
next_action: 
tags: [project]
---

Status: `INPUT[inlineSelect(option(active), option(blocked), option(on-hold), option(done)):status]`

Priority: `INPUT[inlineSelect(option(high), option(medium), option(low)):priority]`

Owner: `INPUT[text:owner]`

Due: `INPUT[text:due]`

Next action:
```meta-bind
INPUT[textArea(class(meta-bind-full-width)):next_action]
```

# Intent
One sentence on what this project delivers.

# Current Status
- Brief summary of where things are today.

# Next 3
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

# Milestones
- 2025-..-..: Milestone name

# Risks
- Risk: impact — mitigation

# Decisions
- See: [[Decision Log.md]]

# Links
- Folder: Website/
