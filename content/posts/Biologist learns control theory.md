---
title: Biologist learns control theory
tags:
  - content/post
date: 2026-04-11
draft: true
---
# Biologist learns control theory

How many of these concepts are found in developmental molecular biology?

![[image-23.png]]

Quite a few. Let's take a look at building blocks of control circuits and try to find their analogues in gene regulatory networks.

***

Boolean gates:

* AND
	* Genes such and such
* OR
	* Genes such and such
* ...


Once you move above individual Boolean gates, digital systems become organized into reusable control motifs. These are not tied to a particular implementation (CMOS, FPGA, neurons, software) but describe recurring patterns for making decisions, sequencing actions, allocating resources, or maintaining state.

Here's a rough hierarchy.

|Level|Module|Purpose|
|---|---|---|
|0|AND, OR, NOT, XOR|Primitive logic|
|1|Multiplexer, decoder, encoder|Route information|
|2|Latch, flip-flop, register|Remember information|
|3|Counter, comparator, ALU|Perform simple operations|
|4|Control modules|Coordinate behavior|
|5|CPUs, controllers, operating systems|Complex decision systems|

Some of the major control modules are:

### Multiplexer (MUX)

"If condition X, choose signal A, otherwise choose signal B."

Essentially implements selection.

```
if S:    output = Aelse:    output = B
```

---

### Demultiplexer

Routes one incoming signal toward one of many outputs.

```
if S=0 -> Out0if S=1 -> Out1...
```

---

### Arbiter

Decides which competing requester gains access.

```
CPUGPUDMA ↓Arbiter ↓Memory Bus
```

Examples

- bus arbitration
- mutexes
- thread scheduling

---

### Priority Encoder

Chooses the highest-priority active request.

```
IRQ5IRQ4IRQ3↓IRQ5 wins
```

---

### Comparator

Determines

- equal
- greater
- less

Used everywhere in branching.

---

### Threshold Detector

Generalization of comparison.

```
if x > threshold:    activate
```

Examples

- thermostats
- neuron firing
- quorum sensing

---

### State Machine (FSM)

Stores internal state.

```
Idle ↓Running ↓Waiting ↓Finished
```

Every transition depends on

- current state
- inputs

rather than inputs alone.

---

### Sequencer

Runs a predefined series of operations.

```
Step 1↓Step 2↓Step 3
```

Examples

- instruction execution
- washing machine
- PCR thermocycler

---

### Timer

Produces events after elapsed time.

```
wait 5 ms↓fire signal
```

---

### Counter

Keeps track of occurrences.

```
01234
```

Used for loops and timing.

---

### Synchronizer

Coordinates asynchronous inputs.

Examples

- clock-domain crossing
- debouncing switches
- barrier synchronization

---

### Handshake Controller

Coordinates two agents.

```
Producer  ReadyConsumer  Accept↓Transfer
```

Examples

- TCP acknowledgments
- AXI bus
- USB

---

### Pipeline Controller

Determines when stages advance or stall.

```
FetchDecodeExecuteMemoryWriteback
```

Must detect hazards and stalls.

---

### Hazard Detector

Looks for conflicts.

```
Instruction Awrites XInstruction Breads X↓stall
```

---

### Scheduler

Chooses which task executes next.

Algorithms include

- round robin
- earliest deadline first
- shortest remaining time
- lottery scheduling

---

### Dispatcher

Transfers execution to the selected task.

Often follows a scheduler.

---

### Resource Allocator

Distributes limited resources.

Examples

- registers
- memory
- bandwidth
- laboratory instruments

---

### Watchdog

Monitors another controller.

```
Normal heartbeat↓No heartbeat↓Reset
```

---

### Supervisor

Higher-level monitor that can interrupt or override lower modules.

Examples

- operating system kernel
- aircraft flight supervisor
- industrial PLC supervisor

---

### Feedback Controller

Continuously compares desired and actual state.

```
Desired speed↓Measure↓Error↓Correct
```

Examples

- cruise control
- thermostat
- PID controller

---

### Rule Engine

Implements collections of conditional rules.

```
IF A and BTHEN CIF DTHEN E
```

Business software and expert systems often use these.

---

### Planner

Chooses a sequence of actions toward a goal rather than reacting immediately.

Examples

- A* search
- STRIPS planners
- robot path planning

---

### Policy Module

Maps states directly to actions.

```
state↓policy↓action
```

Reinforcement learning policies are examples.

---

### Meta-controller

Selects among multiple controllers.

```
Normal controllerEmergency controllerCalibration controller↓Meta-controller chooses
```

Aircraft flight computers, autonomous vehicles, and modern CPUs all contain meta-control logic.

## A useful taxonomy

These modules fall into a small number of abstract functions:

|Function|Representative modules|
|---|---|
|**Selection**|Multiplexer, arbiter, priority encoder, scheduler|
|**Memory**|Latch, register, FSM, counter|
|**Sequencing**|Sequencer, timer, pipeline controller|
|**Comparison**|Comparator, threshold detector, hazard detector|
|**Coordination**|Handshake controller, synchronizer, dispatcher|
|**Allocation**|Arbiter, resource allocator|
|**Monitoring**|Watchdog, supervisor|
|**Regulation**|Feedback controller, PID controller|
|**Decision making**|Rule engine, planner, policy module, meta-controller|

This way of organizing control modules is common across digital logic, operating systems, robotics, control theory, and even biological regulatory networks. For example, cell-cycle checkpoints act like supervisors and hazard detectors, transcription factors can implement threshold detectors and rule engines, and developmental gene regulatory networks often behave as finite state machines coupled to feedback controllers.