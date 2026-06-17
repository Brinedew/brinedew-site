---
title: Taxonomy of AI footguns for non-coders
tags:
  - content/post
date: 2025-09-02
draft: true
---
# Taxonomy of AI footguns for non-coders

A collection of generative AI fails from my own personal use.

This is written with the "your personal coder" LLMs in mind, not the web chatroom ones. Like Claude Code and Codex.
### AI poorly optimizes something that's free-only-below-ceiling

I made a Cloudflare database that used something called "D1 reads". It was free under 5 billion reads, but paid otherwise.

My initial attempts revealed that I barely spend any of these D1 reads, so I promptly forgot about tracking them.

Unrelatedly, I also added my debit card to Cloudflare so that I can pay for their $5/month subscription that gave me extra storage, for protein structures and such.

After a few months, I got a bill for $80 in D1 reads. Turns out, ChatGPT 5.4 used D1 reads liberally throughout my code in a very wasteful way.

I couldn't pay the bill so I got downgraded to the free Cloudflare tier. This has cost me my storage and other useful perks, and I had to spend weeks refactoring around that.

**How to avoid:** for any service that has your card info, centralize all metered usage through a single chokepoint file. Name the file something stupid obvious like "single-allowed-worker-do-not-duplicate.py". Make the usage budget smartly rationed, auto-throttled, and easily inspectable through a single monitoring dashboard. 

### AI accepts a very slow process as "this is just how things are around here".

I had a very poorly optimized pipeline that took multiple hours to do simple operations on each of the 19 thousand of the human genes. My AI would just sit there and watch them tick one by one instead of trying things like batching and parallelization. 

**How to avoid:** ask your coder to pre-register its timing expectations for a full process duration before kicking off any long process. 

If anything runs 50% longer than the pre-registration, abort the process and optimize better. 

If anything runs for longer than 5 minutes without a pre-registration, it means the AI expected it to be shorter than 5 minutes, so it should also be aborted and optimized.

### AI treats the fever instead of the bug

The hardest bug to debug for me right now is the one where the solution technically works but causes my PC to stall and crash because of ungodly SSD pagefile load.

Me: my PC stalls during the task because of SSD load 
...
AI: got it, I added an SSD tripwire guard

Me: now run the task
...
AI: yep, the guard trips as expected and stopped the task

Me: no, I mean like, debug the task 
...
AI: the task works now! I removed the tripwire.

I use the expression "treat the bug, not the fever" for the situations where the visible perpetrators of the problem are actually desirable defenses against an even worse, different, invisible problem. Fevers are defenses against infections, and cooling down the fever would also boost the infection. It's also our first instinct to cool them down. It's very tempting to do, and this pattern shows up in other adversarial contexts.

**How to avoid:** haven't got anything here

### AI assumes someone else will provide the stuff it's missing

Very common for stuff like API tokens (which it can get itself) and other authorization details.

Worse, instead of flagging the user with a question mid-run, it either stops the debug run entirely (making me waste 1 more credit to prompt it again) or refactors the implementation completely to use a worse no-auth solution.

![[image-2.png]]

**How to avoid:** it helps to remind it "you're the only maintainer. if you don't fix this, no one will", but currently doesn't stick well.