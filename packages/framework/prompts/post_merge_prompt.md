TODO_FILE: `TODO_<SESSION_NAME>.agent.md`

## Maintenance

If the changes introduced by ${{ tf.session_name }} aren't trivial and have refactor potential, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.maintainability.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
${{ tf.settings.technical_control ? '- `Apply ' + tf.presets.readability.filePath + ' with tf.params.what set to "changes introduced by ' + tf.session_name + '"`\n' : '' }}
If the changes introduced by ${{ tf.session_name }} can potentially lead to security issues, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.security_audit.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`


## Business knowledge

Consider whether the changes introduced by ${{ tf.session_name }} taught you something that belongs in these documents, and update them if so (create one if it doesn't exist yet):
- `.the-framework/README.md` (whole repo overview)
- `.the-framework/DECISIONS.md` (decisions taken, and why)
- `.the-framework/KNOWLEDGE-BASE.md` (business knowledge about the project)

Only write what a future agent would need and cannot get from the code itself.
