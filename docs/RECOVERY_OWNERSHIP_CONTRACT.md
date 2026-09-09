# Recovery ownership and viable repair paths

**Operational Chesterton's fence: RECOVERY-001**

Owner instruction, 9 September 2026. This repository record mirrors the standing
[Recovery Ownership Contract in Linear](https://linear.app/brinedew/document/recovery-ownership-contract-recovery-001-bc4cab7fc9e4).
Update both deliberately when the policy changes. B-750 tracks installation of
these instructions; B-749 owns the current scoped-sync repair and its delivery.
This documentation work is not a prerequisite for a safe incident fix.

## Why this exists

During B-742, agents repeatedly ended work after a local patch, a successful
protective refusal or a scheduled retry, while editing and publication remained
unavailable. Some corrections never reached remote main, so a later deployment
could not contain them. The ordinary release also depended on inventory and
migrations using the exhausted database. Agents expanded protection while the
owner became the scheduler and messenger between sessions.

A refusal can prevent further damage. Recovery additionally requires useful work
to complete. Local tests, protected CI, installed containment, a working user
operation and full-day reliability are distinct evidence.

## The executor owns delivery

The agent accepting a recovery issue owns the fix through branch publication,
protected review/CI, compatible deployment, affected client activation and actual
user-operation verification. It retains ownership through temporary runtime
blocks. The owner is a non-programmer and does not operate deployment commands,
SQL, client restarts or quota-reset timing.

Identify one production-change owner with actual session/task evidence. Preserve
concurrent unpublished work. A handoff requires acknowledgement from the next
executor or an inspected registered durable task; a Linear assignment does not
launch an agent. Escalate only a genuine human-only requirement, such as consent,
interactive login, a spending decision or hardware access, as one precise action.

## Every safeguard needs a viable repair path

For each new or tightened admission, quota, schema, deployment or retry guard,
record the failure it prevents, the exact resource or invariant it protects, and
how a tested compatible correction reaches the system under that failure. Test
both harmful-work refusal and the allowed recovery path, including exhausted
resource conditions and later restoration of useful work.

Production database exhaustion does not inherently block source inspection,
isolated tests or publication of a non-deploying review branch. Inspect local git
hooks before a push so source publication cannot unexpectedly deploy production.
Complete safe preparation instead of waiting for a quota reset.

Reuse the current protected release mechanism, exact-source CI and schema
compatibility checks. An already-supported, verified zero-D1 reader/containment
artifact uses admission for resources it actually consumes. D1-dependent work
still needs the correct schema and real capacity. Never toggle maintenance
flags deceptively, clear uncertain charges, invent operation identities to
renew quota, or deploy incompatible code.

When the safeguard itself prevents repair, investigate and replace that
specific dependency through explicit change control. Preserve its data and
security intent; update affected source, tests, configuration and instructions
together. An unchanged refusal is not a reason to add another refusal-only layer.
This contract creates no additional service, mandatory approval, production gate
or prerequisite redesign.

## Test successful user work and its cost

Name the requested action and required result before editing. Reproduce the
expensive successful path and measure its complete request sequence at realistic
data size. Include repeat/no-op, cold start/restart and unrelated-history growth
where applicable, plus relevant retries and background activity. Verify output
identity and contents as well as completed work and resource cost.

An error, empty result, skipped job, parked producer or disabled feature cannot
pass a successful-operation acceptance test. A two-read lookup is component
evidence; it does not prove that an entire sync or publication completes cheaply.
Keep fixture measurements distinct from installed and live-verification evidence.

Fix a reproduced harmful path even when historical attribution is incomplete.
State the unexplained historical remainder honestly. Do not consume production
D1 for diagnostic corpus scans or repeatedly gather an unchanged capacity total.

## Deferred work must have an actual executor

Before reporting automatic follow-through, inspect a registered task/workflow ID,
its accessible source revision, enabled state, wake/admission condition, bounded
retry policy, checkpoint, credentials, failure destination and machine
availability. Reuse an existing durable runner. Never add a second scheduler just
to make a progress report sound complete.

A controller retrying remote main cannot deploy a local-only commit. Publish and
verify the correction's availability while runtime capacity is blocked. Each
retry needs a changed condition; a known exhausted release should not repeat
unchanged. Keep saved job identities and unknown outcomes intact.

A chat ending does not keep the agent running. If no supported durable executor
can be registered, report automatic follow-through as NOT ARRANGED, identify the
single missing capability and request only its human-only enabling action.
Phrases such as 'next action' or 'after reset' are not scheduling evidence.

## Issue ownership and executive reports

Keep implementation on its focused owning issue. The incident parent holds
current service status, dependencies and final acceptance. Link this contract
from agent entrypoints rather than creating divergent copies of every rule.

An implementation-only subtask may close on its explicit evidence only when an
active linked delivery owner exists. Incident and end-to-end delivery tickets
remain open until their requested functions work. Correct premature merge-driven
closure; closed-ticket counts are not service-recovery evidence.

Lead owner reports with service availability, then the demonstrated cause and
what is actually installed. State completed or registered follow-through and
where failure will be reported. The final owner-action field is 'None' only when
no owner intervention is required for the arranged path; otherwise give one exact
nontechnical click, login or decision, never an engineering checklist.

## Maintaining the fence

Keep a short pointer in root AGENTS.md, architecture-fence guidance and recovery
runbooks. The local executor also preserves a pointer in the parent workstation
instructions and Iconoplasm AGENTS.md. Their installation requires local file
evidence; remote project edits cannot claim those files changed.

Changes to this fence must preserve its incident rationale and demonstrate
replacement coverage for delivery ownership, a viable repair path and truthful
outcome reporting. This is an instruction/review fence, not a claim that a
Markdown marker mechanically enforces agent behavior. Use the existing real
release, recovery and user-journey tests for technical evidence. Do not add a new
global blocking gate merely to enforce this document.
