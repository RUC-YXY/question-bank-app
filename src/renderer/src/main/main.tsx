import { createRoot } from 'react-dom/client'
import '../shared/styles.css'
import './main.css'
import './drawer.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

createRoot(container).render(<App />)
