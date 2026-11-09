import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import HeadingIcon from './HeadingIcon.vue'
import Diagram from './Diagram.vue'
import BrowserFrame from './BrowserFrame.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp: ({ app }) => {
    app.component('HeadingIcon', HeadingIcon)
    app.component('Diagram', Diagram)
    app.component('BrowserFrame', BrowserFrame)
  },
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(BrowserFrame)
    })
}
