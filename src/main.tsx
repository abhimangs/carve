import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import Crash from './ui/Crash.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>,
)
