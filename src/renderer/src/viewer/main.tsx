import { createRoot } from 'react-dom/client'
import '../shared/styles.css'
import './viewer.css'
import { ViewerApp } from './ViewerApp'

const container = document.getElementById('root')

if (!container) {
  throw new Error('阅读窗口缺少 #root 容器')
}

createRoot(container).render(<ViewerApp />)
