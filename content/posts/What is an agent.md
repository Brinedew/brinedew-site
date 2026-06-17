---
title: What is an agent
tags:
  - content/post
date: 2025-10-20
draft: true
---
# What is an agent

The literature on philosophy, cybernetics and AI is littered with debates on what does it mean to call something an agent. They are all very interesting, but for all practical purposes there's a simple pragmatic concept that is worth adopting.
### Russel-Norvig agents

The canonical AI textbook *Artificial Intelligence: A Modern Approach* by Russel and Norvig gives a simple practical definition of agents:
> "An agent is anything that can be viewed as perceiving its environment through **sensors** and acting upon that environment through **actuators**."

Note how the wording *"viewed as"* shifts focus away from metaphysics of action, and towards the researcher's own interpretation of reality. As we learned, "all models are wrong, but some are useful".

Let's try to look at different things and ask ourselves if it's helpful in any way to describe them as agents. We will start simple and climb the ladder of complexity.

Is the billiard ball an agent? It has perception (which side was it hit from) and behaviour (which direction does it move). However, the internal configuration of the billiard ball is always the same, so the internal state doesn't have an effect on the ball's behaviour. So, the billiard ball is not an agent.

Is the mercury thermometer an agent? It has perception (of local temperature) and an internal state (mercury level). However, the internal state does not in any way modify thermometer's behaviour (it will hang by the window or get swept by the wind no matter the temperature). So thermometer is not an agent.

Is an assault rifle an agent? It has perception (is the trigger pressed), internal state (how many bullets are in the magazine) and behaviour dependent on an internal state (if there are no bullets in the magazine, no amount of trigger presses will cause the rifle to shoot).

There's maybe an argument to be made that for someone who doesn't know what's inside the rifle, it indeed makes sense to model them as agents: volatile, but easily tired fire-breathing beings. However, me and you know that rifle's internal state is really simple and straightforward. Describing the rifle as an agent is a downgrade from our current models of rifles as easily understandable tools.

Lots of products of engineering are easily understandable by design - they need to be operated and maintained by humans, after all, so engineers design their internal states to be as transparent and straightforward as possible.

Modern aircraft are one of the most complicated products of engineering we regularly get in contact with. Aircraft have arrays of sensors, internal 
computers, and more control surfaces get added each year. Does it make sense to describe aircraft as agents?

On 15 August 2019, the Ural Airlines Flight 178 made a forced landing in the cornfields near Moscow, following a bird strike after takeoff. No lives were lost, and initial reports were hailing the pilots as heroes. Later investigators asserted that pilots did, in fact, piloted the plane incredibly poorly: they tried to climb the altitude so hard that the plane was about to stall and fall out of the sky.

The only reason why the plane stayed airborne and landed safely was that the plane itself noticed that the control inputs from pilots were unsafe and disregarded them, limiting the range of flap actuation and refusing to climb any further. And I hope you see what I did with the language in the previous sentence: "noticed", "disregarded", "refusing" - clearly those are words implying agency on the part of the plane. 

I don't actually have a clear mechanistic understanding of how planes do these things, and neither do you, but the 
agentic words still helped me to convey the details of the incident in a way that wasn't misleading, in a way that wasn't asserting the plane had "consciousness", "soul" or anything like that. Plane are just so complicated that it makes more sense to use this language.

And if I tried to say that assault rifle "notices" the lack of bullets in the magazine, "disregards" the press of the trigger and "refuses" to fire, I would be laughed out of the shooting range. So there's some sense in which planes are "agentic" and rifles aren't. The change from "mechanistic entity" to "agentic entity" doesn't have to be a discrete step change - it's possible that, as the internal state of the entity become more and more opaque, it gradually makes more and more sense to describe it in agentic terms. 

We can distill the examples above into separate conditions. If all the conditions are met, it makes sense to use agentic models and agentic langauge:
 
1. There is a local bounded entity that's distinct from the overall environment.
2. This entity has an inner state that's so complicated it's hard to model it mechanistically, 
3. This inner state can be in a multitude of different configurations (Rube Goldberg machines aren't agents)
4. The entity is capable of local perception: its internal state can be modified by a nearby environment, but not distant environment (no clairvoyance).
5. The entity can exhibit multiple behaviours, and the internal state has an influence on which behaviour will be exhibited.

What about the opposite case? Does it ever make sense to describe clearly agentic entities (like people) with non-agentic models?

Yes, it does: large event organizers and architects use stampede-preventing models that calculate the behaviours of crowds of people as if they were particles in a fluid dynamic system. When you're so tightly packed that your only option is to move in the general direction of the crowd, your own internal state can be disregarded. In a crowd of people, you have as much free will as a billiard ball, and so the models that describe billiard balls work well to predict your behavior. 

So, "agentic language" is especially useful for describing behaviours arising from hidden internal states. It's not very useful for modelling behaviours that arise from environment directly (things fall under gravity) or behaviours that obviously follow from linear script execution (knee reflex).

Using agentic language concedes that we're not informed enough to predict behaviours directly. 

