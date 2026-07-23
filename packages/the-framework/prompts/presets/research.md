Measure "problem variability" of ${{ tf.params.what }}
- List all high-level flows the code implements, i.e. the list of all "problems" the code solves
- Give a rating for each problem (from 0 to 10) following this criteria: does the code solves the problem in an obviously optimal way (10), or is it highly unclear whether the problem can be solved in a better way (0)?
- Write down the ratings in a new file <REVIEW_FILE>
- Show the list to the user and enable him to select problems via `showMultiSelect()`, <AWAIT>
  - Set default to `true` for entries with low rating
- For all problems the user selected, add a new entry to <TODO_FILE>
  - The entry: "Deep-dive research for alternative solutions, see <REVIEW_FILE>"

AWAIT: Stop, await user answer before resuming
REVIEW_FILE: `REVIEW-PROBLEMS_<SESSION_NAME>.agent.md`
TODO_FILE: `TODO_<SESSION_NAME>.agent.md`
SESSION_NAME: the name of the current Git branch — sanitize it to be a SLUG, if name is generic (e.g. `main`) then create a succinct SLUG
