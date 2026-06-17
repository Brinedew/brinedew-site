---
title: "I made Geneguessr"
tags:
  - content/post
date: 2025-12-19
draft: false
---

# I made Geneguessr

[https://geneguessr.brinedew.bio/](https://geneguessr.brinedew.bio/)

Inspired by Geoguessr and Wordle, this is a free web game where you get shown a random human protein each day, and you have to triangulate its gene name using similarity clues.

My background is in wet lab biology and I intend this to be comprehensible mostly to other biologists. But if you're outside the field, I'm interested to know if you can still solve it with browser use LLMs, and if you learned something interesting from doing so. Let me know what you think.

I made it with Claude over the last 2 months. My coding experience is limited to basic python data analysis and figure making. If you've been asking yourself "Now that we have coding AI, why isn't there a deluge of awesome AI-generated apps made by non-coders?", you might be interested to check out Geneguessr to understand what an app by a non-coder looks like.

I might write more about the process if there's a demand, but what really unlocked the project for Claude was Linear MCP, where it could put each individual issue on a shared Kanban board. This, and Playwright MCP for testing on live site, were the two workhorses that got me through this. For bugs Claude couldn't one-shot, Linear was great for consolidating issue information so that I could dump it into ChatGPT Codex - it would usually think for like half an hour, output very confusing explanations, but the bug was gone.

I still haven't figured out mobile testing though - let me know if any bugs remain there.
