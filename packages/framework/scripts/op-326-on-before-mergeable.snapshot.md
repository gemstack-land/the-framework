TODO_FILE: `TODO_<SESSION_NAME>.agent.md`

## Maintenance

If the changes introduced by ${{ tf.session_name }} aren't trivial and have refactor potential, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.maintainability.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
${{ !tf.settings.technical_control ? '' : (`
- `Apply ${{ tf.presets.readability.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
`.trim() + '\n') }}

If the changes introduced by ${{ tf.session_name }} can potentially lead to security issues, add the following to <TODO_FILE>
- `Apply ${{ tf.presets.security_audit.filePath }} with tf.params.what set to "changes introduced by ${{ tf.session_name }}"`
