# B-751: retire unattended incident quarantine

This is a lifecycle change to the two temporary B-742 GitHub recovery workflows.
The job-level retirement takes effect only after this revision reaches main.
It does not change application code, current provider controls, data or budgets.

## Verified reason

On 10 September 2026, canonical production run
[34509853637](https://github.com/Brinedew/brinedew-site/actions/runs/34509853637)
completed its full `deploy-production` job at 17:50:19 UTC for
`de1ff1753d7ea49bc6d83c3aac5c7e1e30fc7cfd`. Protected exact-head CI passed;
Worker and Pages delivery, application activation, publication aliases and both
production smoke checks succeeded. The reader-only sibling was skipped.

Despite that completed server release, the hard-quarantine timer would reinstall
reader-only maintenance at 23:58 UTC. The other reset controller would pause
Iconoplasm queues and replace its Cron schedules at 23:55 UTC and on later ticks
before checking for an already-successful production release. Those actions can
undo deliberate subsequent restoration and invalidate a full-day acceptance run.

## Installed policy

Both mutating jobs now require the exact job-level condition
`github.event_name == 'workflow_dispatch'`. Their historical push and schedule
triggers remain declared, so existing structural containment tests and incident
history stay intact, but those events skip the entire job before runner setup,
credentials, provider requests or deployment. The explicit dispatch keeps its
existing time-window and security checks. It can still put an application into
maintenance and must be used deliberately by the recovery executor.

This retires the completed server-recovery automation rather than adding a new
state probe, scheduler, approval system or production admission gate. Do not
remove the job-level condition as routine cleanup or infer renewed incident
permission from B-742 remaining open. Any future unattended recovery mechanism
needs a reviewed lifecycle, active-release race protection, bounded execution
and evidence that it stops after its own task completes.

## Compatible emergency repair remains available

The canonical `deploy-quartz.yml` workflow is unchanged. Its explicit
`reader_recovery_only` dispatch retains exact-source protected CI, compatible
installed-state validation and non-D1 headroom checks. The normal admitted
migration and activation path remains available. The retired workflows also
retain their explicit operator dispatches; the retirement does not grant new
capacity, clear reservations or change migration lineage.

Before intervening in a new incident, the executor must inspect installed
release state and active workflows, then use the existing compatible path under
[RECOVERY-001](RECOVERY_OWNERSHIP_CONTRACT.md). Reconcile any already-running old
revision separately: a merge cannot stop a job that has already started.

## Remaining B-742 acceptance

Server release success does not certify the workstation replica, either scoped
Website Ops synchronization, saved GLB1 publication, background workload or a
complete UTC reset-to-reset interval. B-749 retains its registered local Prefect
continuation; B-739 owns populated replica and cold-material readiness. B-745,
B-734 and B-746 retain finalization, producer and saved-publication delivery.

This patch never resumes queues, reinstalls background schedules, changes a
schema-transition value, increases a budget or regenerates outputs. The existing
executor must inspect actual provider queue and Cron settings and restore only
reviewed, bounded, admitted workloads. Preserve session
`20260906-050817Z--rax2-era-anima`, publication `pub-0d4a64398ddff0ce842c17a1`
and its three saved outputs.

The earlier handoff statement that reset controllers reassert containment is
historical after this retirement reaches main. Keep B-742 open until its existing
user-operation and enabled-workload acceptance is demonstrated. A skipped
incident-control job is retirement evidence, not proof of background recovery.

## Regression check

`node --test scripts/b751-quarantine-retirement.test.js` parses both workflows,
requires the manual-only condition on every mutating job, rejects removed or
widened conditions, and verifies that explicit emergency and canonical protected
release paths remain present. It performs no network requests or production work.
