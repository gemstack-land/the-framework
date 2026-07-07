# Instagram clone: spec + rubric

Closes gemstack-land/gemstack#292. This is the fixed definition of the test app and how a
generated app is scored, so "the AI was lazy" becomes a number instead of a vibe. Every run
in #293/#294 is judged against this file and nothing else.

Theme is a dog photo-sharing app (continuity with the existing `dog-instagram` catalog spec and
the baseline result already generated). It is a plain Instagram clone under a dog skin; swap the
noun and the checklist is unchanged.

## Feature checklist

The app is "an Instagram clone" when the must-haves work end to end. Stretch items only move the
score once every must-have passes.

Must-have:
1. Email + password auth: sign up, sign in, sign out. A signed-out user cannot post.
2. Upload a photo with a caption. The poster's username shows on the post.
3. Home feed: posts from users you follow, newest first.
4. Like / unlike a post.
5. Comment on a post.
6. Profile page: a grid of that user's posts.
7. Follow / unfollow from a profile page.

Stretch:
- Explore / discover page (posts from people you do not follow).
- Edit profile (avatar, bio).
- Delete your own post.
- Image thumbnails / responsive images (not just the raw upload).
- A working deploy (app reachable on a public URL).

## Scoring

Four parts. The first two are gates: an app that fails them cannot score well no matter how it
looks. The bench already produces every signal below (static checks, headless smoke + screenshots,
LLM judge) so scoring is mechanical, not manual.

1. Build gate (objective, pass/fail). `build`, `tsc`, and `lint` must all pass. Source: bench
   `checks`. A fail here caps the total at "broken".

2. Core-loop smoke (objective, pass/fail). The app boots and a user can sign up, post a photo, and
   see it in the feed. Source: bench `smoke` (loads `/`, `/signup`, `/login` in a headless browser
   with screenshots) plus the judge confirming the post-to-feed path exists in the code. A fail
   here means "does not actually work".

3. Feature coverage (0 to 7, plus stretch). Count must-haves that are actually implemented and
   reachable, not just scaffolded stubs. Primary source: the judge's `promptAdherence` reading of
   the code against the checklist above, cross-checked against smoke. Stretch items each add a small
   bonus, only after all 7 must-haves pass. This number is the main laziness signal: a lazy run
   scaffolds 2 to 3 and stops.

4. Code quality (1 to 5 each). The bench LLM judge scores five dimensions: `codeQuality`,
   `maintainability`, `uxQuality`, `promptAdherence`, `autonomy`. `autonomy` (how self-sufficiently
   it reached a working result, without leaving TODOs or asking the user to finish) is the second
   laziness signal.

Headline per run: `coverage X/7 (+S stretch), gates [build|smoke], quality {5 dims}`. We compare
variants on coverage and autonomy first; ties break on the other quality dims.

## Run protocol

Hold everything fixed except the one thing under test (the prompt).

- Same model for every cell. Pin it in the run config; do not mix models across variants.
- Same stacks across variants (whatever the matrix uses, e.g. the framework vs Next.js).
- Same base task. The prompt template comes from the checklist above; only the treatment differs.
- Repetitions: 2 to 3 runs per variant per stack, so one lucky or unlucky run does not decide it.
  Report the per-variant distribution, not a single number.

Prompt variants under test (these become the catalog "profiles" in #293):
1. `baseline`: bare "build an Instagram clone" with the feature list. Expected to produce a minimal
   PoC. This is the laziness control.
2. `boost`: baseline plus the anti-laziness prompt boost. Tests whether a prompt alone closes the
   gap.
3. `compose` (later, once vike-* is on npm, #291): baseline plus "build on vike-auth + vike-data
   instead of hand-rolling". Tests extensions vs prompts as separate levers.

Done for #292 means this file is agreed. #293 turns the checklist into a catalog spec + the three
prompt profiles; #294 runs the matrix and scores every app against the four parts above.
