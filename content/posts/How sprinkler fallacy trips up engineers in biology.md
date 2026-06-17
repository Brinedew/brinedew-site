---
title: How sprinkler fallacy trips up engineers in biology
tags:
  - content/post
date: 2026-06-13
draft: true
aliases:
  -
---
# How sprinkler fallacy trips up engineers in biology

The last entry in the handbook *Universal Principles of Design* (available [here](https://people.engr.tamu.edu/pcr/courses/csce431/winter20/UniversalPrinciplesOfDesign.pdf)) is named "Weakest Link". According to authors, it is a design pattern featuring an element whose job is to fail and protect other, more valuable elements.

Crumple zones in cars absorb the kinetic energy on collision, protecting the passenger.

Fuses in electrical circuits short out first and turn off the device without frying the electronics.

Shear pins in boat motors easily break when the propeller hits a rock, saving the engine.

And the glass bulb of the sprinkler shatters in the heat of the fire, allowing the water to spray out.
*** 
Components designed for self-destruction are called "Sacrificial components" or "Fusible links"

Imagine a very naive engineer tasked with resiliencemaxxing various systems. They might start by finding the most fragile components and making them less fragile. 

Of course, this will end up in tragic proposals like:

* Make car hulls from stronger metal
* Swap fuses for normal wiring
* Make shear pins solid diamond
* Make sprinkler bulbs from bulletproof acrylic

The pattern in these proposals makes up a fallacy - known as "Perverse resilience" or "Suboptimization", but I prefer "Sprinkler fallacy". 

"Surely", you might object, "no technical person would actually suggest making sprinklers unbreakable."

***

Let's say you're a local handyman. One day, you notice some shards of glass and puddles of water around your house. Something in your house broke! This is inconvenient, and you're worried about the mold, so you decide to make sure that whatever happened doesn't happen again. 

You diagnose the origin of the breakage (the broken bulb in your ceiling), and make a replacement, from much stronger glass, that won't easily break.

A week later, your house is gone. Turns out, the device you "repaired" was a sprinkler. Sprinklers are designed so that the heat from the fire breaks the sprinkler's glass bulb. Broken bulb allows the water to leak out and quench the fire. By making the sprinkler glass unbreakable, you doomed your house to die in a fire.

*Repairman's paradox* is a situation where **making a part of the system more resilient ends up destroying the system quicker**. In the spirit of the Sequences, you could say that "repairing a sprinkler during a fire" is a *repairman's fallacy*.

Okay, the sprinkler example had to be kind of contrived, because these kinds of paradoxes occur very rarely in everyday repair of inanimate objects. Our devices weren't produced by natural selection, they were designed by engineers. Rational design principles make sure that our our devices are modular, fully documented, and have few degrees of freedom, which makes their repair straightforward and intuitive. Plus, we expect devices to be repaired by skilled people with full knowledge of the underlying mechanisms. Our repairman would rightfully be ridiculed for not knowing what sprinklers are for.

However, in biology, there's a huge conceptual gap between discovering a mechanism and discovering what the mechanism is for. It's not so easy to draw a distinction between "damage" and "damage prevention" when organisms have to repair themselves (regenerate) all the time, and nobody has a full model of what all the mechanisms do, across all the nested levels of complexity. Repairing the gene often kills the cell, and killing the cell often saves the organism.

I see repairman's paradox tripping up people coming to biology from other STEM fields like engineering, physics, and computer science. They see something that pattern-matches to "damage" and go full steam with initiatives to "repair" the "damage", without being concerned about the context of what's going on more broadly. 

In biology, what first looks like damage often ends up being adaptive for the organism. And not adaptive in a "group selection" kind of way, where it helps the organism's kin, but adaptive in a straightforward, fitness-increasing kind of way, where the organism with this "damage" has better fitness, health, and lifespan.

So this pattern of *adaptive degradation* ends up pretty much everywhere in biology, if you know what to look for. Some examples:
***
1) "Don't quench the fever" type advice
2) Lizard shedding its own tail
3) Sunburn apoptosis
4) Telomere shortening
5) Cell senescence


You're probably fixing a sprinkler if:
* You're breaking something that natural selection had millions of years to break but didn't.
* You're silencing a gene that predictably gets expressed more with age. Exception: genes stochastically activated by random mutation
* You're making a cell into a supercompetitor within its niche.
* 