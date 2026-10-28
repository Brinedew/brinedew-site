# Iconoplasm daily digest

Once a day, one post in `#iconoplasm` shows members what the community did on the site the day
before. It is one long vertical picture, read like a manhwa strip on a phone (and on a laptop),
plus a short text of gene links, because a picture can't be clicked.

The design took a whole day of rejected drafts on 2026-10-21 (Linear B-733). The mistakes below are
why it looks the way it does. Read them before changing it.

## Who it is for

A member scrolling Discord. They want to see what other people made and said, find something
worth opening, and see their own work show up. They don't want statistics. The digest has to stay
honest on a dead day and readable on a viral day.

## What it shows, in the site's own words

Sections appear only when they have something in them, in this order:

1. **Canonical portrait updates.** For each gene, the previous portrait in grey, an ink arrowhead,
   and the portrait that won that day in colour, the same size, with the symbol and the full gene
   name centred under the pair. The winner shows as its blot while the gene still has that
   portrait when the job runs; if a later vote has already replaced it, the winner shows as its
   own portrait, never as the later one. Only changes people caused
   count. When nobody has voted on a gene, every candidate ties at zero and the newest one wins.
   A new candidate taking over like that is not an update; it shows under New candidates.
2. **New caretakers.** The person first: Discord avatar and name, the gene they now look after,
   and a handwritten teal "moved from X" when they switched genes.
3. **Lore.** The gene's blot, the caretaker's avatar and name, and the first lines of the text.
   Only lore switched to "Show on the gene page" at the end of the day appears. Hidden drafts never do.
4. **Comments.** Avatar, name, "on SYMBOL", the comment's first lines, and the gene's blot.
5. **New candidates.** A member wants to know which genes got new candidates and what they look
   like, not every portrait; the gene page has the rest. So each gene shows at most three new
   portraits, and two genes share a row, labelled with the symbol and full name. When a gene
   has more, its third spot is a deck: the face portrait with up to two more behind it and an
   ink tab saying how many the deck hides ("+12"). A new candidate that won the same day comes
   first, so it matches its pair under Canonical portrait updates.

Everything is settled by comparing each gene at 00:00 UTC with 24:00 UTC, not by replaying
events:

- a caretaker who hops genes all day appears once, on the gene they hold at midnight;
- autosaved lore counts as one change;
- a vote flipped back and forth counts as nothing.

Voters and creators of candidates are never named, because the site doesn't name them.

## How it adapts to the size of the day

The strip is 800 CSS px wide (Webtoon's reading width), rendered at 2×. It is held under 7,800 px
of layout height, because a WebP can't exceed 16,383 px. Users report that Discord stops previewing
images above about 10 MB; the worst case so far is 3.6 MB.

- Each section has three or four density levels. The page picks the roomiest level that fits the
  count. While the strip is too tall, the tallest section steps one level denser.
- Once every section is at its densest, the tallest section shows 20% fewer items each round. The
  rest become a teal "+ N more" line.
- New candidates get denser by showing more genes in a row, never more portraits of one gene:
  three per gene at 6, 9, 12 and then 15 portraits a row, then two per gene, then one deck per
  gene, 14 a row. Whole genes go to "+ N more" only after that, because members would rather see
  more genes than more portraits of one gene (owner, 2026-10-28). The 7,800 px budget is a
  ceiling for a heavy day, not room to fill on a normal one.
- The text links at most k genes per section line and counts the rest. k shrinks until the
  message fits Discord's 2,000 characters.
- A day with nothing in any section posts nothing: no picture and no text, and the next post
  covers only its own day.

Measured on 2026-10-21 for every section:

| Day    | Strip (px) | WebP   | Render |
| ------ | ---------- | ------ | ------ |
| quiet  | 2,012      | 0.2 MB | 2 s    |
| normal | 14,636     | 2.8 MB | 9 s    |
| 10×    | 14,478     | 3.6 MB | 10 s   |
| 100×   | 15,368     | 3.6 MB | 10 s   |

At 100× the strip shows:

- 76 of 700 canonical portrait updates;
- 76 of 400 lore texts, as blot and avatar only;
- 20 of 600 comments, one line each;
- 286 of 10,400 genes with new candidates.

Measured on 2026-10-28 for New candidates, on the real 27 October day (14 updates, 1 caretaker,
95 new portraits on 12 genes) and that day changed:

| Day                                 | Strip (px) | WebP   | Candidates shown                         |
| ----------------------------------- | ---------- | ------ | ---------------------------------------- |
| quiet (H2AX and SOX11)              | 1,528      | 0.2 MB | both genes, 3 portraits each             |
| normal (27 Oct)                     | 5,672      | 1.2 MB | all 12 genes in 6 rows                   |
| mixed (120 genes, most with 1 or 2) | 9,926      | 2.4 MB | all 120 genes, 9 portraits a row         |
| 10× (120 genes)                     | 12,516     | 3.4 MB | all 120 genes, 4 genes a row             |
| 100× (1,200 genes)                  | 15,418     | 3.9 MB | 491 genes as one deck each, + 709 more   |
| one gene with 300 new               | 6,078      | 1.3 MB | that gene as 2 portraits and a +297 deck |

## The mistakes

Numbers 1–8 are reconstructed from the owner's corrections. 9–15 and 21–25 are the owner's own
list. 16–20 are the ones the owner left for the agent to find.

1. **Sizing from today's traffic.** The sites haven't been shared yet. Design for the viral day,
   not today's handful of members.
2. **No theory of mind for a Discord member.** Recommendations came before anyone imagined a
   person scrolling the channel.
3. **Ignoring edge cases the rules allow.** For example, a caretaker who switches genes every 15
   minutes, autosaved lore, and vote togglers within the 200-a-day cap. Ten such members must not
   produce a hundred lines.
4. **A feed instead of a digest.** The ask was one daily post with a text summary and a generated
   picture. The drafts went from one post per event to one post an hour.
5. **Homemade and invisible.** A design built without looking at real precedents, described in
   words instead of shown as a picture.
6. **Investor statistics.** Traffic charts, totals and deltas mean nothing to members. Show what
   people made.
7. **A showcase instead of a digest.** The drafts picked highlights and kept "neck and neck"
   races. Below about 2 votes nearly every gene is tied, so the race means nothing.
8. **Categories not derived from what users can do.** The drafts confused blots with portraits,
   didn't know about the current portrait or how candidates arrive, and published who voted for
   what although nobody asked for open ballots. They also took one critique as an absolute rule
   and threw away the rest.
9. **No lore or comment previews.** Members want to read what people wrote, not see a count.
10. **The old portrait smaller.** Previous portrait and new blot are the same size. The owner
    first asked for both in colour, then on 2026-10-23 for the superseded portrait in grey, so
    the new one reads as current at a glance.
11. **Bureaucratic markings.** A red dot plus a sentence explaining it. Drop the marking instead
    of explaining it.
12. **Invented section names.** Nobody says "voted in". The site says "Canonical portrait
    updates", "Candidates", "New candidate", "Lore", "Comments".
13. _(The owner's list skipped 13.)_
14. **Caretakers not shown as people.** Show the avatar and the name, not just the gene's blot.
15. **The laziest layout.** Equal bands of equal tiles. Design it like a printed bulletin with
    hierarchy.
16. **Not looking like Iconoplasm.** Use the site's own type and colours:
    - League Spartan for symbols;
    - Special Elite for what people typed;
    - IBM Plex Mono for printed labels;
    - teal Caveat for handwritten notes;
    - cream paper and ink.
17. **A fence of the agent's own.** "No names in the picture, because erasure can't rewrite it."
    Nobody asked for it, and it cost the digest its people.
18. **Every candidate given the same weight.** A gene with many new portraits shows it in the
    count on its deck ("+12"), not in extra rows.
19. **The text repeating the picture in other words.** The text exists for links. Keep it to gene
    links per section.
20. **Fake data in a mock.** Invented usernames, comments from different months presented as one
    day, and lore quoted although the caretaker had hidden it. Build mocks from real records,
    label anything composed, and never quote hidden lore.
21. **Caring about deleted accounts in a daily post.** A digest is a dated snapshot. It needs no
    erasure machinery.
22. **Demanding thumbnails be readable at Discord's inline size.** Discord shows a preview and
    a tap opens the full picture. Design for the opened picture.
23. **Splitting one picture into two.** It is one strip.
24. **Wide layouts.** The target is a vertical, phone-first strip that is also readable on a
    laptop.
25. **Not saying whether the render survives real loads.** Every render is tested on empty,
    quiet, normal, 10× and 100× days, and the numbers are reported with it.
26. **Teal on a printed mark (2026-10-23).** The arrowhead between the old portrait and the new
    blot was drawn teal. Teal means a handwritten Caveat note; printed marks such as arrows and
    rules are ink.

27. **A candidate tile that contradicted its own update (2026-10-28).** On the 27 October post,
    H2AX's new canonical portrait was not the H2AX tile under New candidates: a gene with fewer
    than three new portraits showed only its first, and the winner was another. 30 of 95 new
    portraits were dropped with no "+ N more" line. The update pair also drew the gene's blot as
    of the next morning, which can be a later winner. The winner now comes first, the update draws
    the winner itself, and every hidden portrait sits in a deck with its count.
28. **Numbers with no reader behind them.** "Three or more new portraits get a strip", "two rows
    per strip", "six strips". The fix is a number that has a reader's reason, not no number.
29. **Treating the height budget as room to fill (2026-10-28).** The first fix for 27 and 28 let
    "the space decide" how many portraits a gene showed. On a normal day POLA1 filled three full
    rows, and a 300-portrait day became a wall of one gene. The owner: "dozens of rows of
    characters no one cares about for a single gene". The default comes from the reader's
    question (three per gene); the budget only bounds the heavy day.

## Where it lives

- **The day's data:** `workers/iconoplasm/daily-digest.js` (`readDailyDigest`). It finds the
  day's id range in the publish-event and comment tables by binary search, because neither has
  a `created_at` index, then reads only that day's rows. The integration test with the edge
  cases above is `workers/iconoplasm/daily-digest.test.js`.
- **The routes:** `workers/iconoplasm-daily-digest-route.js`. `GET
/api/iconoplasm/admin/daily-digest/day?day=` serves a finished UTC day; `POST
/api/iconoplasm/admin/daily-digest/post` posts it once to `#iconoplasm`.
- **The picture:** `scripts/iconoplasm-daily-digest/template.html` (the design above, with the
  site's fonts and the CC0 ambientCG Paper001 texture), drawn by
  `scripts/post-iconoplasm-daily-digest.mjs`. Run it with `--dry-run --day YYYY-MM-DD` to see
  a day without posting.
- **The schedule:** `.github/workflows/post-iconoplasm-daily-digest.yml`, 02:17 UTC.
- **The switch:** "Iconoplasm daily digest" on the admin panel's Discord tab (`/admin#discord`,
  `workers/discord-integration-switches.js`). While it is off, the post route refuses and the
  job draws nothing.

Ordering when a section is capped: canonical portrait updates by the new winner's score, lore
and comments newest first, candidates by most new portraits. A dry run (`--dry-run`, or the
workflow's manual run) also keeps the site's day as `iconoplasm-<day>-day.json`, so a strip can
be redrawn from real data. The design mock and its load test
at five sizes stay in `artifacts/daily-digest-mock/` (ignored by git).
