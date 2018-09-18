# Tokio改造的RFC

你好，Tokio社区！

Carl，Alex和我一直在努力开发简化方法，
精简，并专注于Tokio项目。作为这项努力的一部分，我们有
写了第一个Tokio [RFC]！

这是对所提议内容的快速破坏。

* 在`tokio-core`中添加一个自动管理的全局事件循环默认。此更改消除了设置和管理自己的需要在绝大多数情况下都是事件循环。

  * 此外，删除“Handle”和“Remote”之间的区别
  `tokio-core`使`Handle`既是'Send`又是'Sync`并弃用
  `Remote`。因此，即使使用自定义事件循环也变得更加简单。

* 从Tokio中解除所有任务执行功能，而不是提供它通过标准期货组件。与事件循环一样，提供默认值全局线程池，足以满足大多数用例，删除需要任何手动设置。

  * 此外，当线程本地运行任务时（非'发送'期货），
    提供更多万无一失的API，有助于避免丢失唤醒。

* 在一个新的'tokio`箱子中提供上述变化，这是一个瘦身
  今天的'tokio-core`版本，可能*最终* 重新导出内容
  `tokio-io` 'tokio-core`箱子已弃用，但仍可使用
  为了向后兼容。从长远来看，大多数用户应该只需要
  依靠`tokio`来使用Tokio堆栈。

* 主要关注`tokio`而不是on
  `TOKIO-proto`。提供更广泛的食谱风格示例
  和一般指导方针，以及更深入的工作指南
  期货。

总而言之，这些变化以及[async / await]应该会持续很长时间
让Tokio成为新人友好图书馆的距离。请看一下
[RFC]并留下您的反馈！

一旦我们就RFC达成共识，我们计划形成一个impl期*工作
小组* ，主要侧重于文档和示例。从那里，我们将
与Hyper团队合作，找出该故事的下一章。敬请关注！

[async/await]: https://internals.rust-lang.org/t/help-test-async-await-generators-coroutines/5835
[RFC]: https://github.com/carllerche/tokio-rfcs/pull/2
