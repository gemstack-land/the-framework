TODO_FILE: `TODO_<SESSION_NAME>.agent.md`

## Maintenance

If the changes introduced by ${{ tf.session_name }} aren't trivial and have refactor potential, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.maintainability.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
${{ tf.settings.technical_control ? '- `Apply ' + tf.presets.readability.filePath + ' with tf.params.what set to "changes introduced by ' + tf.session_name + '"`\n' : '' }}
If the changes introduced by ${{ tf.session_name }} can potentially lead to security issues, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.security_audit.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`


## Business knowledge

If you didn't already, consider updating the following based on the changes and discussions of ${{ tf.session_name }} (you can create the files if they're missing):
- `DECISIONS.md` (decisions taken, and why)
- `KNOWLEDGE-BASE.md` (knowledge and insights related to the project)

Only write what a future agent would need and cannot get from the code itself.
