import './styles.css'
import { TopNav } from './TopNav'
import { Hero } from './Hero'
import { SectionNav } from './SectionNav'
import { StopBabysitting } from './StopBabysitting'
import { AutonomousAi } from './AutonomousAi'
import { EnhancedSystemPrompt } from './EnhancedSystemPrompt'
import { Prompts } from './Prompts'
import { Features } from './Features'
import { YourFramework } from './YourFramework'
import { Cta } from './Cta'
import { Footer } from './Footer'

export default function Page() {
  return (
    <>
      <TopNav />
      <Hero />
      <SectionNav />
      <StopBabysitting />
      <AutonomousAi />
      <EnhancedSystemPrompt />
      <Prompts />
      <Features />
      <YourFramework />
      <Cta />
      <Footer />
    </>
  )
}
