import vikeReact from 'vike-react/config'
import type { Config } from 'vike/types'

// SSR React app powered by vike-react. Client routing on by default.
export default {
  extends: vikeReact,
  title: 'Notes — bench-app-gemstack',
} satisfies Config
