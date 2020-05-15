# 一个伟大的2018年，甚至更好的2019年

一年前，`Tokio`是一个非常不同的库。它包括（现已弃用） `tokio-core`，它在单个库中提供了`future`的执行程序，`I / O`选择器和基本`TCP / UDP`类型。tokio-proto也包括在内，但我们不会谈论这个问题。在过去的一年中，Tokio已经发展成为Rust的异步I/O平台。它已通过几个数量的[大型](https://github.com/firecracker-microvm/firecracker), [企业](https://github.com/Azure/iotedge)建立的[应用程序](https://github.com/tikv/tikv)。

2018年实现了很多。一些亮点包括：

- 引入了高性能，多线程，工作窃取的调度程序。
- 定时器从头开始重建。
- 引入了文件系统API。
- UDS，TLS，信号和其他API被添加到Tokio。
- 最重要的是，Tokio运行时是作为包含电池的平台引入的，可以在其上构建异步应用程序。

这不包括无数较小的改进。改进的文档，错误修复，性能改进和改进的API等改进。这些改进是由令人印象深刻的[165名个人贡献者](https://github.com/tokio-rs/tokio/graphs/contributors)提供的。

事实上，2018年对Tokio来说是一个伟大的一年，这一切都归功于你。也就是说，我们刚刚开始，2019年才开始变得更好。我想强调一些预计将于2019年降落的大事（已在制作中）。

## async/await

`Async / await`正在构建到Rust语言中。它可以（几乎）编写异步代码，就好像它是同步的一样。这项工作已经进行了一段时间，并且应该在2019年的某个时间稳定在Rust中。在使用Tokio时，async/await的含义是一个很大的人体工程学改进。

如果您愿意使用Rust nightly编译器，那么今天就可以使用`async/await`和Tokio 。总之，取决于tokio与 `async-await-preview`功能，尝试一下。

这是一种品味：

```rust
pub fn main() {
    tokio::run_async(async {
        let client = Client::new();

        let uri = "http://httpbin.org/ip".parse().unwrap();

        let response = await!({
            client.get(uri)
                .timeout(Duration::from_secs(10))
        }).unwrap();

        println!("Response: {}", response.status());

        let mut body = response.into_body();

        while let Some(chunk) = await!(body.next()) {
            let chunk = chunk.unwrap();
            println!("chunk = {}", str::from_utf8(&chunk[..]).unwrap());
        }
    });
}
```

[完整例子](https://github.com/tokio-rs/tokio/blob/master/tokio-async-await/examples/src/hyper.rs)

那么，Tokio完全采用`async/await`的路径是什么？我们来谈谈这个。

首先，`async/await`必须登陆Rust stable。确切的目标日期是未知的，但预计会在2019年发生。一旦发生这种情况，Tokio将立即以向后兼容的方式添加支持。今天将使用实验性`async-await-preview` 功能标志探索实现这一目标的策略。在较高级别，async/await特定API将添加` _async`后缀。例如，`tokio::run_async`将是使用async fn（或a std::future::Future）启动Tokio运行时的方法。

一旦async/await支持有一个成熟的时刻，Tokio将发出一个重大更改并删除`_async`后缀。`tokio::run`默认情况下将采用异步功能。

`futures0.1`怎么样？我们不能立即放弃对期货0.1的支撑。有一个不断增长的生态系统，包括基于Tokio构建的生产应用程序，其中包括使用期货0.1。过渡需要时间。这将以多步骤方式完成。

首先，以向后兼容的方式添加对async/await的支持。这增加了对async/await 和`futures0.1`的同时支持。然后，async/await成为主API，期货0.1可以通过兼容层使用。这将允许使用尚未使用最新Tokio更新的库。

我们对这样一个事实很敏感：对于已建立的生态系统而言，变革很难，并期待与社区讨论过渡过程。

[此处](https://github.com/tokio-rs/tokio/issues/804)已打开跟踪问题。这是讨论Tokio的异步/等待计划和跟踪进度的地方。

## Tokio Trace

在处理生产应用程序时，对执行行为的可见性至关重要。这包括以下问题：

- 目前正在执行多少任务？
- 为什么这个任务挂了？
- 哪些任务的投票时间比预期的要长，原因是什么？

现在，没有好办法回答。为了帮助提高Tokio的可见性和可调试性，我们（主要是hawkw）正在开发一个主要的新功能：`Tokio Trace`。

`Tokio Trace`已经讨论过这个问题。在较高级别，Tokio跟踪是一种结构化日志记录系统，其中日志事件覆盖时间段而不是固定点。“时间段”是一个至关重要的特征。`instrumentation` API将允许指定事件何时开始以及何时结束。通过这样做，我们可以推断父/子关系。其他事件中包含的事件是子项，构建树。

一旦构建了父/子依赖关系，就可以轻松地过滤与错误任务相关的日志事件。还可以跨多个任务跟踪与错误任务相关的日志事件。

`Tokio trace`的第二部分是“结构化”部分。可以使用基元类型包括事件数据，而不是记录基本字符串。例如， Stream可以检测组合器以poll通过执行以下操作来跟踪每个处理的消息数：

```rust
trace!(messages = num_processed);
```

这里num_processed是一个usize。订阅者可以使用该usize值接收活动。

通过结合父/子结构和结构化日志记录，我们可以通过跟踪99.9％的任务轮询持续时间并检查常见原因来回答“哪些任务花费的时间比预期更长，原因是什么？”问题增加延迟，例如处理具有许多消息但没有屈服的流。其中许多检查可以通过侦听Tokio跟踪发出的事件的工具来实现。

关于这一点的更多信息将在博客中发布，一旦该功能登陆Tokio本身。

## 小组

对于Tokio来说，2019年的最后一件大事就是我已经想到了一段时间。Tokio在功能和采用方面已经超越了我能够理解的一点，即使是由组成非正式Tokio团队的一群非常出色的常规贡献者。是时候扩展Tokio的开发和维护了。

实现这一目标的策略并不新鲜，我认为Rust提供了一个很好的模型可供遵循。我们需要介绍一组团队，每个团队都关注Tokio的各个方面。

关于哪些团队将存在以及谁将成为其中一部分的具体细节仍有待确定，并将随着时间的推移而发生变化。全年都会有博客文章讨论这方面的演变。

我们还需要新手帮助加入建立和发展Tokio的努力。这包括我们花时间指导。因此，请考虑这是一个行动前的号召。您是否依赖Tokio工作，或者您只是对Rust异步I / O感兴趣？如果您觉得自己没有所需的经验或者太过“新手”，那也没关系。现在加入我们的[Gitter](https://gitter.im/tokio-rs/dev/) 频道，帮助我们找出过渡到团队的过程。

最后，非常感谢那些超越自我的人，花费大量时间帮助解决使用Tokio开发，维护，文档以及帮助Gitter用户的问题。

- @davidbarsky
- @hawkw
- @ipetkov
- @jonhoo
- @kpp
- @ralith
- @rylev
- @stjepang
- @tobz
- @vorner
