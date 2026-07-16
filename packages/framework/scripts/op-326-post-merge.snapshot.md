TODO_FILE: `TODO_<SESSION_NAME>.agent.md`

## Maintenance

If the changes introduced by ${{ tf.session_name }} aren't trivial and have refactor potential, add the following to <TODO_FILE>
- "Apply preset `maintainability` on the changes introduced by ${{ tf.session_name }}"
${{ !tf.settings.technical_control ? '' : (`
- "Apply preset `readability` on the changes introduced by ${{ tf.session_name }}"
`.trim() + '\n') }}

If the changes introduced by ${{ tf.session_name }} can potentially lead to security issues, add the following to <TODO_FILE>
- "Apply preset `security_audit` on the changes introduced by ${{ tf.session_name }}"
