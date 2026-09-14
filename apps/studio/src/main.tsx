import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@repo/design/styles.css'
import { App } from '@studio/App'

const root = document.getElementById('root')
if (!root) throw new Error('Studio root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
