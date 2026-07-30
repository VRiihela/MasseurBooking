# Learning Workflow — Building While Learning

Goal: ship this project at a reasonable pace *and* leave you with real understanding of backend engineering and of how to drive/review AI-generated code. The failure mode to avoid is treating every task the same — either reviewing everything so deeply you never ship, or approving everything so fast you learn nothing. This workflow spends deliberate effort only where it compounds, and defaults to fast elsewhere.

---

## 1. The per-task ritual (every task, ~10 min overhead)

Applies to all six tasks so far and everything after. Cheap enough that it shouldn't slow you down.

**Before the Architect stage runs:** read the task's acceptance criteria and, before looking at anything else, write down (a sentence is enough) what you think the hardest 1-2 technical risks are. You don't need to be right — the point is forming a prediction before you see the answer, which is what makes the comparison afterward actually teach you something instead of just washing over you.

**After the Architect stage:** read its "Assumptions" and "CIA impact" / risk sections specifically — that's consistently been where the real substance is (task 001's advisory-lock reasoning, task 003's DST handling). Compare against your prediction. Where you missed something, that's the thing worth understanding, not the whole plan.

**Keep a running log.** One new file: `documents/concepts-learned.md`. One bullet per task, one sentence each — e.g. "001: SELECT FOR UPDATE doesn't lock rows that don't exist yet — exclusion constraints are the real backstop, advisory locks are for clean error UX." This is low effort now and genuinely useful later (interview prep, your own portfolio writeup, or just remembering why you made a decision three months from now).

---

## 2. Deep-dive only on genuinely new patterns (occasional, time-boxed to ~25 min)

Don't do a hands-on exercise on every task — you don't have time for that and most of it would be repetition anyway. Reserve it for when a task introduces a pattern you haven't implemented yourself before. So far, that's been:

- **001**: row-locking vs. exclusion constraints for preventing double-booking
- **003**: interval union/subtract/slice logic, and timezone-aware date-boundary math

When a task's Architect stage names something like this as new, stop before Implementer runs. Set a timer for ~25 minutes and write a minimal standalone version yourself — a scratch script, not production code. For task 001 that might mean: write a 15-line script that fires two "concurrent" inserts against a table with an exclusion constraint and watch one fail. For task 003: write `subtractIntervals` yourself from the English description, then diff it against what Implementer actually produced.

You will not always finish, and that's fine — the value is in wrestling with the problem before seeing the answer, not in producing working code. Then let Implementer proceed normally. This is the single highest-leverage piece of this workflow: it's maybe 5-6 exercises across the whole project, not one per task, so it doesn't fight your launch timeline.

---

## 3. Self-review checklist (do this yourself before sending Architect output to me)

Right now I've been doing the technical review pass. To actually build that skill rather than rent it, flip the order: review the Architect output yourself first using the checklist below, write down what you'd flag, *then* paste it to me for a second pass. Compare the two lists. Over time you'll need me less — that's the goal, not a side effect.

This checklist isn't generic advice — every item on it is a category of bug that actually showed up in this project:

- **Concurrency**: what happens if two requests hit this at the exact same moment? (the gap in 001's naive row-lock plan)
- **Boundaries**: what happens exactly at the edges — day boundaries, empty results, the first/last item in a range? (003's DST and midnight handling)
- **Trust**: what does this endpoint accept from the client that it shouldn't fully trust, and is it re-validated/re-derived server-side? (001 deriving `end_at` server-side instead of trusting the client)
- **Partial failure**: what happens if the process crashes halfway through this operation? (the email worker's claim-before-send design in 005)
- **Silent scope gaps**: does this task quietly depend on something from a later, not-yet-built task? (001 shipping without working-hours enforcement, which 003 later closed)
- **Consistency**: does this match a decision already recorded in `context_template.md`, or does it quietly contradict one?

---

## 4. Milestone retro (every ~5 tasks, or weekly — whichever comes first)

Skim `run_log.json`, `reports/`, and your `concepts-learned.md`. Write 3-5 sentences: what pattern surprised you most, what would you do differently, is the "concepts learned" list actually building on itself or just listing disconnected facts. This is also literally reusable later — it's most of a blog post or a talking point for an interview about a real system you shipped, not a toy.

---

## 5. Wiring this into the kit so it's automatic, not something to remember

Add to `agents/context_template.md` under "Notes for AI Agents":

```markdown
- After the Architect stage, before Implementer runs, pause and wait for explicit
  go-ahead if this task introduces a pattern not yet used elsewhere in the codebase
  (check `documents/concepts-learned.md`) -- this is a deliberate learning checkpoint,
  not just a review gate.
```

This means the pipeline itself reminds you when a task is worth the 25-minute deep dive, instead of you having to notice and remember on your own.
