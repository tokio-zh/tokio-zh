let { tokio } = require ('./category/tokio.js')
let { blog } = require ('./category/blog.js')

module.exports = {
    title: 'Tokio中文',
    description: 'Tokio：Rust编写快速网络应用的平台',
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
        repo: 'tokio-zh',
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
          { text: '英文', link: 'https://tokio.rs' }
        ],
        sidebar: {
          '/document/': tokio('文档'),
          '/blog/': blog('博客')
        }
    }
}

