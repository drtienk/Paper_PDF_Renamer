import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <main className="container">
      <h1>Paper PDF Renamer</h1>
      <p>Vite + React app is now served from repository root for Vercel deployment.</p>
      <p>
        API endpoint is available at <code>/api/rename.py</code>.
      </p>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
