# 宣布Tokio运行时

我很高兴宣布Tokio的新版本。 此版本包括第一个
Tokio Runtime的迭代。

## tl;dr

这就是现在编写基于多线程Tokio的服务器的方式：

```rust,ignore
extern crate tokio;

use tokio::net::TcpListener;
use tokio::prelude::*;

fn process(s: TcpStream)
  -> impl Future<Item = (), Error = ()> + Send
{ ... }

let addr = "127.0.0.1:8080".parse().unwrap();
let listener = TcpListener::bind(&addr).unwrap();

let server = listener.incoming()
    .map_err(|e| println!("error = {:?}", e))
    .for_each(|socket| {
        tokio::spawn(process(socket))
    });

tokio::run(server);
```

其中`process`表示一个用户定义的函数，它接受一个套接字和
返回处理它的未来。 对于echo服务器，可能是
从套接字读取所有数据并将其写回同一个套接字。

[guides]和[examples]已更新为使用运行时。

[guides]: https://tokio.rs/docs/getting-started/hello-world/
[examples]: https://github.com/tokio-rs/tokio/tree/master/examples

## 什么是Tokio Runtime

Rust异步堆栈正在发展为一组松散耦合的组件。
要运行基本的网络应用程序，您至少需要一个
异步任务执行器和Tokio反应器的实例。因为
一切都是分离的，这些各种各样有多种选择
组件，但这为所有应用程序添加了一堆样板。

为了帮助缓解这个问题，Tokio现在提供了运行时的概念。这是一个
预先配置的所有各种组件的包
运行应用程序。

运行时的初始版本包括reactor和a
基于[work-stealing]的线程池，用于调度和执行应用程序
码。这为应用程序提供了多线程默认值。

工作窃取默认值适用于大多数应用程序。它使用了类似的
策略如Go，Erlang，.NET，Java（ForkJoin池）等......
Tokio提供的实现是针对很多用例的
**不相关的**任务在单个线程池上复用。

## 使用Tokio Runtime

如上例所示，使用Tokio运行时的最简单方法
有两个功能：

* `tokio :: run`
* `tokio :: spawn`。

第一个函数需要一个未来种子应用程序并启动
运行。粗略地说，它做了以下事情：

1. 启动反应堆。
2. 启动线程池。
3. 将未来产生到线程池中。
4. 阻塞线程，直到运行时空闲。

运行时变为空闲**所有**生成的期货已经完成并且**全部**
绑定到反应器的I / O资源被丢弃。

从运行时的上下文中。该应用程序可能会产生额外的
使用`tokio :: spawn`进入线程池的期货。

或者，可以直接使用`Runtime`类型。这允许更多
设置和使用运行时的灵活性。


## 未来的改进

这只是Tokio运行时的初始版本。即将发布的版本将
包括对基于Tokio的应用程序有用的附加功能。一个
博客文章即将推出更详细的路线图。

如前所述，目标是尽早和经常发布。提供新的
使社区能够试验它们的功能。接下来的某个时候
几个月，整个Tokio堆栈都会有一个突破性的释放，所以任何
在此之前需要发现API中的更改。

## Tokio-core

还有一个新的'tokio-core`版本。此版本更新
`tokio-core`在引擎盖下使用`tokio`。这使所有现有的
目前依赖于`tokio-core`（如Hyper）的应用程序和库
能够使用Tokio运行时带来的改进
要求改变。

考虑到未来几个月预计会发生的流失量，
我们希望能够帮助缓解各版本的过渡。

[work-stealing]: https://en.wikipedia.org/wiki/Work_stealing
