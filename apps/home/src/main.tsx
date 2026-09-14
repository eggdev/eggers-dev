import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/mona-sans/wght.css'
import '@repo/design/styles.css'
import { App } from '@home/App'

const root = document.getElementById('root')
if (!root) throw new Error('Home root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
