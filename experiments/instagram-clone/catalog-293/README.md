# #293 catalog changes (staged for compare-ai-generations)

This is the #293 work: the `instagram` catalog spec + the baseline/boost prompt treatments,
built and verified against `vikejs/compare-ai-generations`. It is staged here because forking
is disabled on that repo and I have read-only access, so I cannot open the PR directly yet.

To land it, one of us with write access applies the patch on a branch in compare-ai-generations
and opens the PR (or enable forking / add me as a collaborator and I push the ready commit):

```
cd compare-ai-generations
git checkout -b test/instagram-matrix
git apply /path/to/293-catalog.patch
```

## What the patch does

- `specs/instagram.yaml` (new): the #292-derived spec. `requirements` = the 7 must-haves (the
  judge's checklist, scores every run the same). Two prompt treatments: `baseline` (bare ask,
  the laziness control) and `boost` (same ask + the anti-laziness push from brillout's gist).
  Stack-agnostic evaluation (`npm run dev` + smoke `/`, `/login`, `/signup`); deploy left out.
- `profiles.yaml`: adds `baseline` + `boost` as prompt treatments (not personas). A spec only
  runs the profiles it has prompts for, so these do not touch `dog-instagram`'s dev/ceo runs.
- `catalog.test.ts`: updates the pinned profile/spec lists and adds a test that the instagram
  matrix is 6 cells (3 stacks x 2 treatments) and that boost extends baseline verbatim.

`compose` (baseline + build-on-vike-* framing) is deliberately not here; it lands once #291
publishes the vike-* packages, so prompts vs extensions stay separable.

## Verified

Ran the real `loadCatalog` + `composeTasks` from the compare-ai-generations source against the
edited example-config: profiles load, the instagram spec composes to baseline+boost only, the
boost prompt is the baseline prompt plus the anti-laziness push, and dog-instagram is unchanged.
