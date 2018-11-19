let { tokio } = require ('./category/tokio.js')
let { blog } = require ('./category/blog.js')

module.exports = {
    title: 'Tokio中文',
    description: 'Tokio：Rust编程语言的异步运行时,提供异步事件驱动平台，构建快速，可靠和轻量级网络应用。利用Rust的所有权和并发模型确保线程安全',
    head: [
      ['link', { rel: 'icon', href: `/favicon.ico` }],
      ['link', { rel: 'manifest', href: '/manifest.json' }],
      ['meta', { name: 'theme-color', content: '#3eaf7c' }],
      ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }],
      ['link', { rel: 'apple-touch-icon', href: `/icons/apple-touch-icon-152x152.png` }],
      ['meta', { name: 'msapplication-TileImage', content: '/icons/msapplication-icon-144x144.png' }],
      ['meta', { name: 'msapplication-TileColor', content: '#000000' }]
    ],
    serviceWorker: true,
    theme: 'vue',
    themeConfig: {
        repo: 'tokio-zh/tokio-zh',
        docsDir: 'docs',
        displayAllHeaders: true,
        editLinks: true,
        editLinkText: '在 GitHub 上编辑此页',
        lastUpdated: '上次更新', 
        docsDir: 'docs',
        sidebarDepth: 0,
        search: true,
        searchMaxSuggestions: 11,
        nav: [
          { text: '文档', link: '/document/' },
          { text: '社区', link: '/community/' },
          { text: '博客', link: '/blog/' },
          { text: '论坛', link: 'https://github.com/rustlang-cn/forum/issues' },
          { text: '英文', link: 'https://tokio.rs' }
        ],
        sidebar: {
          '/document/': tokio('文档'),
          '/blog/': blog('博客')
        }
    }
}

