exports.tokio = (title) => {
    return [
        '',
        {
          title: '入门',
          collapsable: false,
          children: [
            'hello-world',
            'runtime-model',
            'futures',
            'tasks',
            'IO',
            'example-chat-server'
          ]
        },
        {
          title: '深入',
          collapsable: false,
          children: [
            'timers',
            'essential-combinators',
            'returning-futures',
            'working-with-framed-streams',
            'building-runtime'
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