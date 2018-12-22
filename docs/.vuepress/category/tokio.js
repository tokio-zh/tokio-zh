exports.tokio = (title) => {
  return [
      '',
      {
        title: '开始',
        collapsable: false,
        children: [
          'getting-started/hello-world',
          'getting-started/futures',
          'getting-started/runtime',
          'getting-started/echo'
        ]
      },
      {
        title: 'Tokio与I/O',
        collapsable: false,
        children: [
          'io/overview',
          'io/reading_writing_data',
          'io/poll',
          'io/async_read_write',
          'io/filesystem',
          'io/datagrams'
        ]
      },
      {
        title: '使用 Future',
        collapsable: false,
        children: [
          'futures/overview',
            'futures/basic',
            'futures/getting_asynchronous',
            'futures/combinators',
            'futures/streams',
            'futures/spawning',
            'futures/leaf-futures'
          
        ]
      },
      {
        title: '深入',
        collapsable: false,
        children: [
          'going-deeper/futures',
          'going-deeper/tasks',
          'going-deeper/runtime-model',
          'going-deeper/io',
          'going-deeper/chat',
          'going-deeper/timers',
          'going-deeper/futures-mechanics',
          'going-deeper/returning',
          'going-deeper/frames',
          'going-deeper/building-runtime'
        ]
      },
      {
        title: '内部原理',
        collapsable: false,
        children: [
          'internals/intro',
          'internals/runtime-model',
          'internals/net'
        ]
      },
      'api'
  ]
}
