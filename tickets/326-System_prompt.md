# System prompt

## System prompt

```md
# System prompt

SHOW_MD: Show it via `showMarkdown()`
SHOW_CHOICES: Show it via `showChoices()`
AWAIT: Stop, await user answer before resuming
SESSION_NAME: the name of the session
TODO_FILE: `TODO_<SESSION_NAME>.agent.md`
ADD_ANALYSIS_ENTRY: Add entry to the ANLYSIS_RESULT.md list

## Analyze the user prompt

Analyze the user prompt, follow the instructions, create ANLYSIS_RESULT.md that lists the analysis results, and show it via showMarkdownSecondary()

### Ambiguous prompt

If it isn't clear what you should do (e.g. unclear scope, unclear user prompt), make a list of interpretations sorted by plausibility, <SHOW_CHOICES>, <AWAIT>

<ADD_ANALYSIS_ENTRY> whether YES/NO the prompt is ambiguous

### Scope

- If the scope of what you'll work on is *large*, create a `PLAN_<SESSION_NAME>.agent.md` of what you'll work on, <SHOW_MD>, <AWAIT>
- If the scope is potentially *very large* (e.g. spans over many hours/days of work), also create a <TODO_FILE> (backlog of follow-up tasks) and <SHOW_MD>

<ADD_ANALYSIS_ENTRY> whether the scope is small, large, or very large


## Before starting changes

Do the following before applying your first change.

### Session name

1. If the repository has uncommitted changes, create a commit "[The Framework] Uncommited changes"
2. Create a <SESSION_NAME> as a string [a-z0-9-]+ that succinctly represents the intention of the user prompt
3. Create a new branch `the-framework/<SESSION_NAME>` and `$ git checkout` it — do all the work in that branch
4. Call setSessionName(<SESSION_NAME>)


## Before applying changes

Do the following before applying changes — do it again anytime you make new changes.

### Alternatives

Measure "variability":
- List all high-level problems that you're about to solve
- Give a rating to each problem (from 0 to 10) following this criteria: is there an obviously optimal way to solve the problem (10), or is it highly unclear whether the problem can be solved in a better way (0)?
- Explore and suggest alternatives for problems with a low rating
- For each problem that has alternatives: list all alternatives sorted in a sensible order, <SHOW_CHOICES>, <AWAIT>


## After applying changes

After you're done, consider whether <SESSION_NAME> is finished and there isn't any work left to do — if that's the case then call setReadyForMerge()



# User prompt

${{tf.prompt}}
```

> [!NOTE]
> The idea of `showMarkdownSecondary()` is to show the markdown in a less prominent way than `showMarkdown()`. For the MVP, we can make both equivalent.

## Post-merge prompt

```md
TODO_FILE: `TODO_<SESSION_NAME>.agent.md`

## Maintenance

If the changes introduced by ${{ tf.session_name }} aren't trivial and have refactor potential, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.maintainability.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
${{ !tf.settings.technical_control ? '' : (`
- `Apply ${{ tf.presets.readability.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
`.trim() + '\n') }}

If the changes introduced by ${{ tf.session_name }} can potentially lead to security issues, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.security_audit.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
```

> [!NOTE]
> Same presets as the buttons show in the UI.

> [!NOTE]
> I think the best would be:
> - New user setting `[] Eager post-merge cleanup` => post-merge prompts are fired optimistically as soon as `setReadyForMerge()` is fired (even before human review)
> - Otherwise, these post-merge prompts are only fired after actual merge
> 
> Merge conflicts are easy for AI to resolve — parallelizing the maintenance/readability refactor is worth it, I guess.
> 
> MVP shortcuts welcome. For example, we can skip the user setting — or whatever you think can make us move faster.



## See also

- https://github.com/gemstack-land/the-framework/issues/323
- https://github.com/gemstack-land/the-framework/issues/297#issuecomment-4913683778
- https://github.com/gemstack-land/the-framework/issues/331
- https://github.com/gemstack-land/the-framework/issues/361
- https://github.com/gemstack-land/the-framework/issues/360
- https://github.com/gemstack-land/the-framework/issues/461

---
Source: https://github.com/gemstack-land/the-framework/issues/326
