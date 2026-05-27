import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import BlockedPage from './pages/BlockedPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BlockedPage />
  </StrictMode>,
)
