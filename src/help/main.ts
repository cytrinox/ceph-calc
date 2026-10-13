// Help pages (help/index.html, filled by build/help.ts): the calculator's fonts, themes and base styles, the article
// styles, and the calculator's theme toggle (same component, same saved setting).
import { createApp } from 'vue'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '../styles/main.scss'
import './help.scss'
import ThemeToggle from '../components/ThemeToggle.vue'

const toggle = document.getElementById('theme-toggle')
if (toggle) createApp(ThemeToggle).mount(toggle)
